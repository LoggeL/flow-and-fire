import { decodeBatch, encodeBatch, Op } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import {
  BatchBuilder,
  CommandLogError,
  CommandLogRecorder,
  DEFAULT_KEEP_LOGS,
  LocalSource,
  LOG_DIR_NAME,
  LOG_ENTRY_HEADER_BYTES,
  LOG_FIXED_HEADER_BYTES,
  LOG_V1_FIXED_HEADER_BYTES,
  LOG_VERSION,
  parseLogHeader,
  legacyTestPlaneMapSimHash,
  LogEntryKind,
  listLogFiles,
  logFileName,
  MarkKind,
  openOpfsLogSink,
  parseCommandLog,
  ReplaySource,
  type LogHeader,
} from '../src/index.ts';
import { FakeDir, type FakeFile } from './support/fake-opfs.ts';
import { killCmd, moveCmd, spawnCmd } from './support/fixtures.ts';
import { asHandle } from '@faf/fixed';

const HEADER: LogHeader = {
  simId: 0xdeadbeef,
  layoutHash: 0xa15987bf,
  seed: 4242,
  bpSimHash: 0xd4135af1,
  mapSizeWu: 512,
  armyCount: 2,
  playerArmy: 0,
  hashInterval: 10,
  buildHash: 'b-äöü-🚀-7f3a',
  mapSimHash: 0x90ec94f0,
};

function stamped(tick: number, envs: Parameters<typeof encodeBatch>[0]): Uint8Array {
  return encodeBatch(envs.map((e) => ({ ...e, tick: tick as never })));
}

describe('command log format + recorder', () => {
  it('roundtrips header, command batches, marks, hashes and END', () => {
    const r = new CommandLogRecorder(HEADER, { initialCapacity: 64 }); // forces buffer growth
    const b1 = stamped(1, [spawnCmd(0, 10, 100, 100, 5, 1)]);
    const b5 = stamped(5, [moveCmd(0, [asHandle(1), asHandle(2), asHandle(3)], 10, 20, 2), moveCmd(1, [], 1, 1, 7)]);
    r.commands(1, b1);
    r.hash(10, 0x12345678);
    r.mark(12, MarkKind.Pause);
    r.mark(12, MarkKind.Speed, 2500);
    r.commands(13, stamped(13, [moveCmd(0, [asHandle(9)], 1, 2, 3)]));
    r.commands(13, new Uint8Array(0)); // ignored
    r.mark(13, MarkKind.Resume);
    r.commands(15, b5);
    r.hash(20, 0xffffffff);
    expect(r.tainted).toBe(true); // b1 contains a cheat spawn
    const log = parseCommandLog(r.export(25));
    expect(log.header).toEqual(HEADER);
    expect(log.truncated).toBe(false);
    expect(log.endTick).toBe(25);
    expect(log.lastTick).toBe(25);
    expect(log.tainted).toBe(true);
    expect(log.commands.map((c) => c.tick)).toEqual([1, 13, 15]);
    const d = (i: number): Uint8Array => log.bytes.subarray(log.commands[i]!.offset, log.commands[i]!.offset + log.commands[i]!.length);
    expect(d(0)).toEqual(b1);
    expect(d(2)).toEqual(b5);
    expect(decodeBatch(d(2)).map((e) => e.tick)).toEqual([5, 5]);
    expect(log.hashes).toEqual([
      { tick: 10, hash: 0x12345678 },
      { tick: 20, hash: 0xffffffff },
    ]);
    expect(log.marks).toEqual([
      { tick: 1, kind: MarkKind.Cheat, value: 0 },
      { tick: 12, kind: MarkKind.Pause, value: 0 },
      { tick: 12, kind: MarkKind.Speed, value: 2500 },
      { tick: 13, kind: MarkKind.Resume, value: 0 },
    ]);
    // The live log continues after an export (no END inside).
    expect(parseCommandLog(r.bytes).endTick).toBe(-1);
    expect(parseCommandLog(r.bytes).lastTick).toBe(20);
  });

  it('header v4 carries mapSimHash and empty setup (byte layout pinned)', () => {
    const r = new CommandLogRecorder(HEADER);
    const b = r.bytes;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    expect(LOG_VERSION).toBe(4);
    expect(LOG_FIXED_HEADER_BYTES).toBe(40);
    expect(dv.getUint16(4, true)).toBe(4);
    expect(dv.getUint32(32, true)).toBe(0x90ec94f0);
    const parsed = parseCommandLog(r.export(0));
    expect(dv.getUint32(36, true)).toBe(0);
    expect(parsed.version).toBe(4);
    expect(parsed.header).toEqual(HEADER);
    expect(parseLogHeader(b).headerBytes).toBe(dv.getUint16(6, true));
  });

  it('reads MS1 v1 logs (no mapSimHash ⇒ test plane of their size)', () => {
    // A v1 file as MS1 wrote it: 32-byte fixed header, buildHash at 32, entries unchanged.
    const v2 = new CommandLogRecorder({ ...HEADER, buildHash: 'ms1', mapSizeWu: 256 });
    v2.commands(3, stamped(3, [moveCmd(0, [asHandle(1)], 1, 1, 1)]));
    v2.hash(10, 0xabcdef01);
    const cur = new Uint8Array(v2.export(12));
    const cdv = new DataView(cur.buffer);
    const hb2 = cdv.getUint16(6, true);
    const bh = new TextEncoder().encode('ms1');
    const hb1 = (LOG_V1_FIXED_HEADER_BYTES + bh.length + 3) & ~3;
    const v1 = new Uint8Array(hb1 + (cur.byteLength - hb2));
    v1.set(cur.subarray(0, 32), 0);
    const dv = new DataView(v1.buffer);
    dv.setUint16(4, 1, true);
    dv.setUint16(6, hb1, true);
    v1.set(bh, 32);
    v1.set(cur.subarray(hb2), hb1);
    const log = parseCommandLog(v1);
    expect(log.version).toBe(1);
    expect(log.truncated).toBe(false);
    expect(log.header).toEqual({ ...HEADER, buildHash: 'ms1', mapSizeWu: 256, mapSimHash: legacyTestPlaneMapSimHash(256) });
    expect(log.commands.map((c) => c.tick)).toEqual([3]);
    expect(log.hashes).toEqual([{ tick: 10, hash: 0xabcdef01 }]);
    expect(log.endTick).toBe(12);
    // Unknown versions are refused.
    dv.setUint16(4, 5, true);
    expect(() => parseCommandLog(v1)).toThrow(/version 5/);
    dv.setUint16(4, 0, true);
    expect(() => parseCommandLog(v1)).toThrow(CommandLogError);
  });

  it('reads an independently encoded v2 header as an empty-world setup', () => {
    const name = new TextEncoder().encode('old-v2'), bytes = new Uint8Array(44), dv = new DataView(bytes.buffer);
    dv.setUint32(0, 0x4c464146, true); dv.setUint16(4, 2, true); dv.setUint16(6, 44, true);
    dv.setUint32(8, HEADER.simId, true); dv.setUint32(12, HEADER.layoutHash, true); dv.setUint32(16, HEADER.seed, true);
    dv.setUint32(20, HEADER.bpSimHash, true); dv.setUint16(24, HEADER.mapSizeWu, true);
    dv.setUint8(26, HEADER.armyCount); dv.setInt8(27, HEADER.playerArmy); dv.setUint16(28, HEADER.hashInterval, true);
    dv.setUint16(30, name.length, true); dv.setUint32(32, HEADER.mapSimHash, true); bytes.set(name, 36);
    const log = parseCommandLog(bytes);
    expect(log.version).toBe(2); expect(log.header).toEqual({ ...HEADER, buildHash: 'old-v2' });
    expect(log.header.initialization).toBeUndefined(); expect(log.lastTick).toBe(0);
  });
  it('FAFL v4 retains full setup and still reads an independent faction-only v3 header', () => {
    const initialization = { kind:'skirmish' as const, faction:0, slots:[
      {start:7,team:1,faction:0,controller:'human' as const},
      {start:2,team:2,faction:0,controller:'ai' as const,difficulty:'hard' as const,aixFactorQ16:98304},
    ], rules:{unitCap:550,fog:'revealed' as const,victory:'supremacy' as const} };
    const full=new CommandLogRecorder({...HEADER,armyCount:2,initialization});
    expect(parseCommandLog(full.bytes).header.initialization).toEqual(initialization);
    const wrong=full.bytes.slice(); new DataView(wrong.buffer).setUint32(36,0xffffffff,true);
    expect(()=>parseCommandLog(wrong)).toThrow(CommandLogError);
    const old=new Uint8Array(44),view=new DataView(old.buffer);
    view.setUint32(0,0x4c464146,true);view.setUint16(4,3,true);view.setUint16(6,44,true);
    view.setUint16(24,512,true);view.setUint8(26,2);view.setUint16(30,3,true);
    view.setUint8(36,1);view.setUint8(37,0);old.set(new TextEncoder().encode('old'),40);
    const parsed=parseLogHeader(old);expect(parsed.version).toBe(3);expect(parsed.header.initialization).toEqual({kind:'skirmish',faction:0});
    old[38]=1;expect(()=>parseLogHeader(old)).toThrow(/initialization/);
  });

  it('only cheat / devReload / restore marks taint the log', () => {
    const r = new CommandLogRecorder(HEADER);
    r.commands(3, stamped(3, [moveCmd(0, [asHandle(1)], 1, 1, 1)]));
    r.mark(4, MarkKind.Pause);
    r.mark(4, MarkKind.Step, 3);
    expect(r.tainted).toBe(false);
    expect(parseCommandLog(r.export(5)).tainted).toBe(false);
    r.mark(6, MarkKind.DevReload);
    expect(r.tainted).toBe(true);
    const k = new CommandLogRecorder(HEADER);
    k.commands(2, stamped(2, [moveCmd(0, [], 1, 1, 1), killCmd(0, [asHandle(4)], 2)]));
    expect(parseCommandLog(k.bytes).marks).toEqual([{ tick: 2, kind: MarkKind.Cheat, value: 0 }]);
  });

  it('is tick ordered', () => {
    const r = new CommandLogRecorder(HEADER);
    r.hash(20, 1);
    expect(() => r.hash(10, 1)).toThrow(RangeError);
  });

  it('cuts off a torn or corrupt tail (crash while appending)', () => {
    const r = new CommandLogRecorder(HEADER);
    for (let t = 10; t <= 100; t += 10) r.hash(t, t * 7);
    r.commands(101, stamped(101, [moveCmd(0, [asHandle(1), asHandle(2)], 5, 5, 9)]));
    const full = r.bytes.slice();
    const good = parseCommandLog(full);
    expect(good.truncated).toBe(false);
    expect(good.lastTick).toBe(101);
    // Torn: the last entry is incomplete.
    const torn = parseCommandLog(full.subarray(0, full.length - 5));
    expect(torn.truncated).toBe(true);
    expect(torn.hashes).toHaveLength(10);
    expect(torn.commands).toHaveLength(0);
    expect(torn.lastTick).toBe(100);
    // Corrupt: one flipped bit inside an earlier entry's data.
    const bad = full.slice();
    const off = parseCommandLog(full).validBytes - 1;
    bad[off - 20] = bad[off - 20]! ^ 0x10;
    const c = parseCommandLog(bad);
    expect(c.truncated).toBe(true);
    // Not a log at all.
    expect(() => parseCommandLog(new Uint8Array(64))).toThrow(CommandLogError);
    expect(() => parseCommandLog(full.subarray(0, 10))).toThrow(CommandLogError);
  });

  it('truncateAfter drops later entries (timeline branch)', () => {
    const r = new CommandLogRecorder(HEADER);
    for (let t = 10; t <= 50; t += 10) r.hash(t, t);
    r.truncateAfter(30);
    expect(r.lastTick).toBe(30);
    expect(r.entryCount).toBe(3);
    r.hash(40, 999);
    expect(parseCommandLog(r.bytes).hashes.map((h) => h.hash)).toEqual([10, 20, 30, 999]);
  });

  it('records allocation-free per entry (no growth beyond the preallocated buffer)', () => {
    const r = new CommandLogRecorder(HEADER, { initialCapacity: 1 << 20 });
    const b = stamped(1, [moveCmd(0, [asHandle(1), asHandle(2)], 5, 5, 9)]);
    r.commands(1, b);
    const buf = r.bytes.buffer;
    for (let t = 2; t < 5000; t++) {
      if (t % 10 === 0) r.hash(t, t);
      if (t % 100 === 0) r.commands(t, b);
    }
    expect(r.bytes.buffer).toBe(buf);
  });
});

describe('OPFS persistence (fake sync access handles)', () => {
  it('writes the log so far on attach, appends every entry and survives a crash', async () => {
    const root = new FakeDir();
    const r = new CommandLogRecorder(HEADER, { flushEveryEntries: 4 });
    r.commands(1, stamped(1, [spawnCmd(0, 5, 10, 10, 1, 1)]));
    r.hash(10, 111);
    const sink = await openOpfsLogSink(root, { simId: HEADER.simId });
    expect(r.attachSink(sink)).toBe(true);
    expect(r.storage).toBe('opfs');
    const dir = root.dirs.get(LOG_DIR_NAME)!;
    const file = dir.files.get(sink.name)!;
    expect(file.bytes()).toEqual(r.bytes);
    for (let t = 20; t <= 200; t += 10) r.hash(t, t);
    r.mark(200, MarkKind.Pause);
    expect(file.bytes()).toEqual(r.bytes); // appended block by block, no close needed
    expect(file.flushes).toBeGreaterThan(1);
    // "Crash": the file is read back without END.
    const back = parseCommandLog(file.bytes());
    expect(back.truncated).toBe(false);
    expect(back.endTick).toBe(-1);
    expect(back.lastTick).toBe(200);
    expect(back.hashes).toHaveLength(20);
    r.truncateAfter(100);
    expect(file.bytes()).toEqual(r.bytes);
    r.close();
    expect(file.open).toBe(false);
  });

  it(`keeps only the last ${DEFAULT_KEEP_LOGS} games (never deletes a locked file)`, async () => {
    const root = new FakeDir();
    const names: string[] = [];
    const sinks = [];
    for (let i = 0; i < 8; i++) {
      const s = await openOpfsLogSink(root, { simId: 7, date: new Date(Date.UTC(2026, 8, 28, 12, 0, i)) });
      names.push(s.name);
      if (i === 1) sinks.push(s); // game 1 stays open (another tab)
      else s.close();
    }
    const dir = root.dirs.get(LOG_DIR_NAME)!;
    const left = await listLogFiles(dir);
    expect(left).toContain(names[1]);
    expect(left.slice(-4)).toEqual(names.slice(-4));
    expect(left.length).toBeLessThanOrEqual(DEFAULT_KEEP_LOGS + 1);
    expect(left).not.toContain(names[0]);
    for (const s of sinks) s.close();
    const s9 = await openOpfsLogSink(root, { simId: 7, date: new Date(Date.UTC(2026, 8, 28, 13)) });
    expect(await listLogFiles(dir)).toHaveLength(DEFAULT_KEEP_LOGS);
    s9.close();
  });

  it('file names sort chronologically', () => {
    const a = logFileName(1, new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)), 1);
    const b = logFileName(1, new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 7)), 0);
    expect(a).toMatch(/^log-20260102T030405006-00000001-1\.faflog$/);
    expect(a < b).toBe(true);
  });

  it('falls back to memory when a write fails', async () => {
    const root = new FakeDir();
    const r = new CommandLogRecorder(HEADER);
    const sink = await openOpfsLogSink(root, { simId: 1 });
    r.attachSink(sink);
    const file = [...root.dirs.get(LOG_DIR_NAME)!.files.values()][0] as FakeFile;
    file.failWrites = true;
    r.hash(10, 1);
    expect(r.storage).toBe('memory');
    expect(r.sinkError).toMatch(/Quota/);
    r.hash(20, 2);
    expect(parseCommandLog(r.bytes).hashes).toHaveLength(2);
  });
});

describe('command sources', () => {
  it('LocalSource merges all batches that arrive before a tick into that tick', () => {
    const s = new LocalSource();
    expect(s.batchFor(1)).toBeNull();
    s.push(encodeBatch([moveCmd(0, [asHandle(1)], 1, 1, 1)]));
    s.push(encodeBatch([moveCmd(0, [asHandle(2)], 2, 2, 2), moveCmd(1, [asHandle(3)], 3, 3, 1)]));
    s.push(encodeBatch([]));
    expect(s.queued).toBe(3);
    const b = s.batchFor(7)!;
    const envs = decodeBatch(b);
    expect(envs.map((e) => [e.army, e.seq])).toEqual([
      [0, 1],
      [0, 2],
      [1, 1],
    ]);
    // A push after batchFor belongs to the next tick; the returned view stays valid until then.
    s.push(encodeBatch([moveCmd(0, [asHandle(5)], 5, 5, 3)]));
    expect(decodeBatch(b)).toHaveLength(3);
    expect(decodeBatch(s.batchFor(8)!)).toHaveLength(1);
    expect(s.batchFor(9)).toBeNull();
    expect(() => s.push(new Uint8Array([1, 5, 0]))).toThrow(RangeError);
    expect(s.commandsFor(10 as never)).toEqual([]);
  });

  it('BatchBuilder keeps a valid batch while growing', () => {
    const m = new BatchBuilder(64);
    const envs = [];
    for (let i = 0; i < 50; i++) {
      const e = moveCmd(i % 2, [asHandle(i)], i, i, i + 1);
      envs.push(e);
      m.append(encodeBatch([e]));
    }
    expect(m.count).toBe(50);
    expect(decodeBatch(m.view()).map((e) => e.seq)).toEqual(envs.map((e) => e.seq));
  });

  it('ReplaySource returns the recorded batch per tick, handles jumps and exposes hashes', () => {
    const r = new CommandLogRecorder(HEADER);
    const b3 = stamped(3, [moveCmd(0, [asHandle(1)], 1, 1, 1)]);
    r.commands(3, b3);
    r.hash(10, 42);
    r.commands(11, stamped(11, [moveCmd(0, [], 3, 3, 3)]));
    const src = new ReplaySource(parseCommandLog(r.bytes));
    const got: number[] = [];
    for (let t = 1; t <= 12; t++) if (src.batchFor(t) !== null) got.push(t);
    expect(got).toEqual([3, 11]);
    expect(src.batchFor(3)).toEqual(b3); // backward jump (seek)
    expect(src.expectedHash(10)).toBe(42);
    expect(src.expectedHash(20)).toBe(-1);
    expect(src.expectedHash(10)).toBe(42);
    expect(src.pending(1)).toBe(false);
    const envs = src.commandsFor(11 as never);
    expect(envs !== 'pending' && envs[0]!.op).toBe(Op.Move);
    // Format constants are part of the persisted format.
    expect(LOG_ENTRY_HEADER_BYTES).toBe(16);
    expect([LogEntryKind.Cmds, LogEntryKind.Mark, LogEntryKind.Hash, LogEntryKind.End]).toEqual([1, 2, 3, 4]);
  });
});
