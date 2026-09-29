import { afterEach, describe, expect, it } from 'vitest';
import { FrameReader, FrameFlags, decodeBatch, Op } from '@faf/protocol';
import { unitHandles } from '@faf/sim';
import { createTestPlaneMap, mapSimHash } from '@faf/formats';
import {
  DebugFlags,
  DebugSectionKind,
  LOG_DIR_NAME,
  MarkKind,
  METRIC_COUNT,
  parseCommandLog,
  replayLog,
  SimHost,
  simIdFor,
  STATS_EVERY_TICKS,
  type HostReadyMsg,
  type HostStatsMsg,
  type HostStatusMsg,
} from '../src/index.ts';
import { FakeDir } from './support/fake-opfs.ts';
import { bufferOf, gameSimBin, moveCmd, spawnCmd } from './support/fixtures.ts';
import { FRAME_CAP, makeTestHost, type TestHost } from './support/host.ts';
import { decodeSimBin } from '@faf/blueprints/simbin';

let open: TestHost[] = [];
function host(...args: Parameters<typeof makeTestHost>): TestHost {
  const h = makeTestHost(...args);
  open.push(h);
  return h;
}
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const reader = new FrameReader();
function frame(h: TestHost): FrameReader | null {
  const f = h.consumer.poll();
  if (f === null) return null;
  expect(reader.reset(f)).toBe(true);
  return reader;
}

describe('SimHost (fake clock, SAB transport)', () => {
  it('init ⇒ ready with simId/layoutHash, first frame at tick 0, status', () => {
    const h = host();
    const ready = h.of('ready')[0] as HostReadyMsg;
    const table = decodeSimBin(gameSimBin());
    expect(ready.simId).toBe(simIdFor(table.simHash, mapSimHash(createTestPlaneMap(512)) >>> 0));
    expect(ready.layoutHash).toBe(h.host.core.world.layoutHash >>> 0);
    expect(ready.transport).toBe('sab');
    expect(ready.simBuild).toMatch(/^faf-sim\//);
    const f = frame(h)!;
    expect(f.tick).toBe(0);
    expect(f.paused).toBe(false);
    expect(f.viewer).toBe(0);
    const st = h.of('status').at(-1) as HostStatusMsg;
    expect(st).toMatchObject({ tick: 0, paused: false, speed: 1, ticksBehind: 0, recorder: 'memory', recorderNote: 'persistence disabled' });
  });

  it('ticks at 10 Hz, one frame per slice, stats every 10 ticks', () => {
    const h = host();
    frame(h);
    h.host.submit(bufferOf([spawnCmd(0, 20, 100, 100, 5, 1)]));
    h.wake.advance(100);
    const f = frame(h)!;
    expect(f.tick).toBe(1);
    expect(f.unitCount).toBe(20);
    expect(f.ackSeq).toBe(1);
    h.wake.advance(1900);
    expect(h.host.tick).toBe(20);
    const stats = h.of('stats') as HostStatsMsg[];
    expect(stats.map((s) => s.tick)).toEqual([10, 20]);
    expect(stats[1]!.phases.map((p) => p.name)).toEqual(['CommandApply', 'Orders', 'Movement', 'SpatialRebuild', 'Cleanup', 'Output', 'HashTick', 'Frame', 'Host']);
    expect(STATS_EVERY_TICKS).toBe(10);
    // SPK6 pipeline invariant: a cmd is applied in the next tick after its arrival.
    expect(stats[1]!.cmdBatchesApplied).toBe(1);
    expect(stats[1]!.cmdApplyTicksMax).toBe(1);
    expect(frame(h)!.tick).toBe(20);
    expect(frame(h)).toBeNull();
    expect(h.host.core.hashTrail().map((e) => e.tick)).toEqual([10, 20]);
  });

  it('pause: tick stands, commands are accepted and applied in the next step; resume continues', () => {
    const h = host();
    h.host.submit(bufferOf([spawnCmd(0, 20, 100, 100, 5, 1)]));
    h.wake.advance(1000);
    expect(h.host.tick).toBe(10);
    frame(h);
    h.host.ctl({ t: 'pause' });
    // The last frame is republished with the paused bit.
    let f = frame(h)!;
    expect(f.paused).toBe(true);
    expect(f.tick).toBe(10);
    expect((h.of('status').at(-1) as HostStatusMsg).paused).toBe(true);
    h.wake.advance(2000);
    expect(h.host.tick).toBe(10);
    expect(frame(h)).toBeNull();
    // A move command during the pause is accepted but not applied yet.
    const units = unitHandles(h.host.core.world, 0);
    h.host.submit(bufferOf([moveCmd(0, units, 300, 300, 2)]));
    h.wake.advance(1000);
    expect(h.host.tick).toBe(10);
    expect(h.host.core.local.queued).toBe(1);
    // step(1): exactly one tick, the command applies in it.
    h.host.ctl({ t: 'step', ticks: 1 });
    h.wake.advance(0);
    expect(h.host.tick).toBe(11);
    f = frame(h)!;
    expect(f.tick).toBe(11);
    expect(f.paused).toBe(true);
    expect(f.ackSeq).toBe(2);
    const log = parseCommandLog(h.host.core.recorder!.bytes);
    const cmd = log.commands.at(-1)!;
    expect(cmd.tick).toBe(11);
    const envs = decodeBatch(log.bytes.subarray(cmd.offset, cmd.offset + cmd.length));
    expect(envs.map((e) => [e.tick, e.op, e.seq])).toEqual([[11, Op.Move, 2]]);
    h.host.ctl({ t: 'step', ticks: 4 });
    h.wake.advance(0);
    expect(h.host.tick).toBe(15);
    h.host.ctl({ t: 'resume' });
    expect(frame(h)!.paused).toBe(false);
    h.wake.advance(100);
    expect(h.host.tick).toBe(16);
    // The units drive towards the target.
    f = frame(h)!;
    let moving = 0;
    for (let i = 0; i < f.unitCount; i++) if (f.unitCur(i, 0) !== f.unitPrev(i, 0) || f.unitCur(i, 2) !== f.unitPrev(i, 2)) moving++;
    expect(moving).toBeGreaterThan(10);
    const all = parseCommandLog(h.host.core.recorder!.bytes).marks.map((m) => [m.tick, m.kind, m.value]);
    expect(all).toEqual([
      [1, MarkKind.Cheat, 0],
      [10, MarkKind.Pause, 0],
      [10, MarkKind.Step, 1],
      [11, MarkKind.Step, 4],
      [15, MarkKind.Resume, 0],
    ]);
  });

  it('step is ignored while running; speed changes the rate and the frame header', () => {
    const h = host();
    h.host.ctl({ t: 'step', ticks: 5 });
    h.wake.advance(0);
    expect(h.host.tick).toBe(0);
    h.host.ctl({ t: 'speed', speed: 3 });
    h.wake.advance(1000);
    expect(h.host.tick).toBe(30);
    expect(frame(h)!.speedPermille).toBe(3000);
    h.host.ctl({ t: 'speed', speed: 0.1 }); // clamped to 0.25
    h.wake.advance(2000);
    expect(h.host.tick).toBe(35);
    expect((h.of('status').at(-1) as HostStatusMsg).speed).toBe(0.25);
    const marks = parseCommandLog(h.host.core.recorder!.bytes).marks.filter((m) => m.kind === MarkKind.Speed);
    expect(marks.map((m) => m.value)).toEqual([3000, 250]);
  });

  it('can start paused (autostart=0) and be stepped deterministically', () => {
    const h = host({ startPaused: true });
    expect(frame(h)!.paused).toBe(true);
    h.wake.advance(5000);
    expect(h.host.tick).toBe(0);
    h.host.ctl({ t: 'step', ticks: 2 });
    h.wake.advance(0);
    expect(h.host.tick).toBe(2);
  });

  it('viewer and debug ctl: republished frame with viewer, ackSeq of that army and phase times', () => {
    const h = host();
    h.host.submit(bufferOf([spawnCmd(0, 5, 100, 100, 5, 9)]));
    h.wake.advance(300);
    h.host.ctl({ t: 'pause' });
    frame(h);
    h.host.ctl({ t: 'viewer', army: 1 });
    let f = frame(h)!;
    expect(f.viewer).toBe(1);
    expect(f.ackSeq).toBe(0xffffffff);
    h.host.ctl({ t: 'viewer', army: -1 });
    expect(frame(h)!.viewer).toBe(-1);
    h.host.ctl({ t: 'debug', flags: DebugFlags.PhaseTimes });
    f = frame(h)!;
    expect(f.debugBytes).toBe(4 + 4 * METRIC_COUNT);
    const d = f.debugSection();
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    expect(dv.getUint16(0, true)).toBe(DebugSectionKind.PhaseTimes);
    expect(dv.getUint16(2, true)).toBe(METRIC_COUNT);
    expect(f.unitCount).toBe(5);
    h.host.ctl({ t: 'watch', handles: [1, 2, 3] });
    expect(h.host.watched).toEqual([1, 2, 3]);
  });

  it('exportLog ⇒ log message whose replay reproduces the hash chain', () => {
    const h = host();
    h.host.submit(bufferOf([spawnCmd(0, 50, 100, 100, 10, 1), spawnCmd(1, 50, 400, 400, 10, 1)]));
    h.wake.advance(500);
    h.host.submit(bufferOf([moveCmd(0, unitHandles(h.host.core.world, 0), 300, 300, 2)]));
    h.wake.advance(2000);
    h.host.ctl({ t: 'devReload' });
    h.host.ctl({ t: 'exportLog' });
    const log = h.of('log')[0]!;
    const parsed = parseCommandLog(log.bytes);
    expect(parsed.endTick).toBe(25);
    expect(parsed.tainted).toBe(true);
    expect(parsed.marks.some((m) => m.kind === MarkKind.DevReload)).toBe(true);
    const r = replayLog(parsed, { simBin: gameSimBin() });
    expect(r.mismatches).toEqual([]);
    expect(r.compared).toBe(2);
    expect(r.trail).toEqual(h.host.core.hashTrail());
    expect(r.fullHash).toBe(h.host.core.fullHash());
  });

  it('reports malformed input as error messages instead of throwing', () => {
    const msgs: { t: string; message?: string }[] = [];
    const bare = new SimHost({ post: (m) => msgs.push(m), opfs: null, autoStart: false });
    bare.handleMessage({ t: 'cmd', batch: new ArrayBuffer(3) });
    expect(msgs.at(-1)!.message).toMatch(/not initialized/);
    bare.handleMessage({ t: 'init', simBin: new ArrayBuffer(8), seed: 1, armyCount: 2, playerArmy: 0, transport: 'transfer', frameCapacity: FRAME_CAP, buildHash: 'x' });
    expect(msgs.at(-1)!.message).toMatch(/port/);
    bare.handleMessage({ t: 'init', simBin: new ArrayBuffer(8), seed: 1, armyCount: 2, playerArmy: 0, transport: 'transfer', frameCapacity: 64, buildHash: 'x' });
    expect(msgs.at(-1)!.message).toMatch(/frameCapacity/);
    bare.dispose();
    const h = host();
    const n = h.msgs.length;
    h.host.handleMessage({ t: 'cmd', batch: new ArrayBuffer(2) });
    h.host.handleMessage({ t: 'cmd', batch: new Uint8Array([1, 1, 0, 9]).buffer });
    h.host.handleMessage({ t: 'bogus' });
    h.host.handleMessage(42);
    h.host.handleMessage({ t: 'frameReturn', buffer: new ArrayBuffer(8) }); // transport traffic: ignored
    h.host.handleMessage({ t: 'init', simBin: new ArrayBuffer(8), seed: 1, armyCount: 2, playerArmy: 0, transport: 'sab', frameCapacity: FRAME_CAP, buildHash: 'x' });
    h.host.handleMessage({ t: 'step', ticks: 0 });
    const errs = h.msgs.slice(n).filter((m) => m.t === 'error');
    expect(errs).toHaveLength(6);
    expect(h.host.tick).toBe(0);
    h.wake.advance(200);
    expect(h.host.tick).toBe(2); // still healthy
  });

  it('persists the command log to OPFS when available', async () => {
    const root = new FakeDir();
    const h = host({ host: { opfs: async () => root } });
    h.host.submit(bufferOf([spawnCmd(0, 10, 100, 100, 5, 1)]));
    h.wake.advance(500);
    for (let i = 0; i < 20 && (h.of('status').at(-1) as HostStatusMsg).recorder !== 'opfs'; i++) await new Promise((r) => setImmediate(r));
    const st = h.of('status').at(-1) as HostStatusMsg;
    expect(st.recorder).toBe('opfs');
    expect(st.recorderNote).toBeNull();
    h.wake.advance(1500);
    const file = [...root.dirs.get(LOG_DIR_NAME)!.files.values()][0]!;
    expect(file.bytes()).toEqual(h.host.core.recorder!.bytes);
    expect(parseCommandLog(file.bytes()).hashes).toHaveLength(2);
  });

  it('reports memory-only recording when OPFS is unavailable', async () => {
    const h = host({ host: { opfs: async () => null } });
    for (let i = 0; i < 20 && (h.of('status').at(-1) as HostStatusMsg).recorderNote === null; i++) await new Promise((r) => setImmediate(r));
    const st = h.of('status').at(-1) as HostStatusMsg;
    expect(st.recorder).toBe('memory');
    expect(st.recorderNote).toMatch(/OPFS unavailable/);
  });

  it('transfer transport: the paused frame is re-sent when a buffer comes back', async () => {
    const h = host({ transport: 'transfer' });
    // Main does not return buffers for a while: every buffer is in flight.
    h.wake.advance(300);
    h.host.ctl({ t: 'pause' });
    const frames: Uint8Array[] = [];
    const r = new FrameReader();
    for (let i = 0; i < 50; i++) {
      await new Promise((res) => setImmediate(res));
      const f = h.consumer.poll();
      if (f !== null) frames.push(f.slice());
      if (frames.length > 0 && r.reset(frames.at(-1)!) && r.paused) break;
    }
    expect(r.reset(frames.at(-1)!)).toBe(true);
    expect(r.paused).toBe(true);
    expect(r.flags & FrameFlags.Paused).toBe(FrameFlags.Paused);
    expect(r.tick).toBe(3);
  });
});
