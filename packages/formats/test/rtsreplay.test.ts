import { deflateRawSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_BATCH_VERSION, CommandBatchEncoder, Op } from '@faf/protocol';
import {
  CMDS_BLOCK_TICKS,
  CMDS_CHUNK_VERSION,
  CmdsCodec,
  FormatError,
  MAX_CMDS_BLOCK_BYTES,
  RTSREPLAY_FORMAT_VERSION,
  RTSREPLAY_MAGIC,
  ReplayFlags,
  ReplayMarkKind,
  RtsReplayBuilder,
  blockIndexForTick,
  cmdsBlockRaw,
  decodeCmdsBlock,
  decodeCmdsRaw,
  deflateRaw,
  encodeCmdsChunk,
  encodeCmdsRaw,
  parseCmdsChunk,
  readAllCommands,
  readContainer,
  readRtsReplay,
  readRtsReplayHead,
  replayContentEndTick,
  replayFormatIncompatibility,
  replayMetaToCanonicalJson,
  replaySizeReport,
  rewriteRtsReplay,
  rtsReplayToInput,
  writeContainer,
  writeRtsReplay,
  type ContainerChunk,
  type ReplayGame,
  type ReplayHashes,
  type ReplayHead,
  type ReplayMark,
  type ReplayMeta,
  type ReplayTickCommands,
  type RtsReplayInput,
} from '../src/index.ts';

// ---- deterministic generator of valid replays ------------------------------------------------

/** xorshift32 stream (test data only). */
function rngOf(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

interface GenKnobs {
  readonly seed: number;
  /** Last tick that may carry commands (0 = no commands at all when density is 0). */
  readonly span: number;
  /** Probability (‰) that a tick carries a batch. */
  readonly density: number;
  readonly armies: number;
  readonly hashCount: number;
  readonly subRows: number;
  readonly regions: number;
  readonly markCount: number;
  readonly taint: boolean;
  readonly meta: boolean;
  readonly extras: number;
}

const OPS: readonly number[] = Object.values(Op);
const POS_OPS: readonly number[] = [Op.Move, Op.AttackMove, Op.AttackGround, Op.Patrol, Op.SetRally, Op.FormationMove];
const TARGET_OPS: readonly number[] = [Op.Attack, Op.Guard, Op.Assist, Op.Repair, Op.Reclaim, Op.Overcharge];
const TEXT_POOL: readonly string[] = ['', 'a', 'Ärger', 'Spieler 1', 'x"y\\z', 'tab\tnew\nline', '雪原', '🙂 smile', '\u0000ctl', 'long '.repeat(20)];

function pick<T>(r: () => number, a: readonly T[]): T {
  return a[r() % a.length]!;
}

function randBytes(r: () => number, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = r() & 0xff;
  return b;
}

/** Random command batches with the shapes the CMDS coder predicts and some it does not. */
function genCommands(r: () => number, span: number, density: number, armyIdx: readonly number[]): ReplayTickCommands[] {
  const seq = new Map<number, number>();
  const lastList = new Map<number, number[]>();
  const pool: number[] = [];
  for (let i = 0; i < 64; i++) pool.push(((r() % 4096) << 20) | (r() % 3000));
  const out: ReplayTickCommands[] = [];
  const enc = new CommandBatchEncoder();
  for (let tick = 0; tick <= span; tick++) {
    if (r() % 1000 >= density) continue;
    enc.reset();
    const n = r() % 16 === 0 ? 0 : 1 + (r() % 4);
    for (let e = 0; e < n; e++) {
      const army = r() % 8 === 0 ? r() % 16 : pick(r, armyIdx);
      let s = seq.get(army) ?? (r() % 4 === 0 ? 0xfff0 + (r() % 16) : r() % 100);
      if (r() % 10 === 0) s = r() & 0xffff; // jump (resync, lost commands)
      seq.set(army, (s + 1) & 0xffff);
      const op = r() % 12 === 0 ? r() & 0xff : pick(r, OPS);
      const flags = r() % 10 === 0 ? r() & 0xff : r() & 1;
      let units: number[];
      const prev = lastList.get(army);
      const k = r() % 10;
      if (prev !== undefined && k < 4) units = prev;
      else if (prev !== undefined && prev.length > 2 && k < 5) units = prev.filter(() => r() % 5 !== 0);
      else if (k < 6) units = [];
      else {
        const len = r() % 8 === 0 ? 20 + (r() % 50) : 1 + (r() % 6);
        units = [];
        for (let i = 0; i < len; i++) units.push(r() % 3 === 0 ? r() >>> 0 : pick(r, pool) >>> 0);
      }
      lastList.set(army, units);
      let payload: Uint8Array;
      const pk = r() % 10;
      if (POS_OPS.includes(op) && pk < 7) {
        payload = new Uint8Array(op === Op.FormationMove ? 14 : 12);
        const dv = new DataView(payload.buffer);
        const aligned = r() % 2 === 0;
        for (let i = 0; i < 3; i++) dv.setInt32(i * 4, aligned ? (r() % 512) << 16 : r() | 0, true);
        if (payload.length > 12) dv.setUint16(12, r() & 0xffff, true);
      } else if (op === Op.Build && pk < 7) {
        payload = randBytes(r, 16);
      } else if (TARGET_OPS.includes(op) && pk < 7) {
        payload = new Uint8Array(4);
        new DataView(payload.buffer).setUint32(0, pick(r, pool) >>> 0, true);
      } else {
        payload = randBytes(r, r() % 20 === 0 ? 100 + (r() % 400) : r() % 24);
      }
      enc.addRaw(tick, army, s, op, flags, units, payload);
    }
    out.push({ tick, batch: enc.view().slice() });
  }
  return out;
}

function genInput(k: GenKnobs): RtsReplayInput {
  const r = rngOf(k.seed);
  const armyIdx: number[] = [];
  for (let i = 0; i < 16 && armyIdx.length < k.armies; i++) if (r() % 3 !== 0 || 16 - i <= k.armies - armyIdx.length) armyIdx.push(i);
  const hashInterval = 1 + (r() % 30);
  const subHashInterval = k.subRows > 0 ? 1 + (r() % 200) : r() % 3;
  const marks: ReplayMark[] = [];
  let mt = 0;
  for (let i = 0; i < k.markCount; i++) {
    mt += r() % 300;
    let kind = r() % 6 === 0 ? 9 + (r() % 200) : pick(r, [ReplayMarkKind.Pause, ReplayMarkKind.Resume, ReplayMarkKind.Speed, ReplayMarkKind.Step, ReplayMarkKind.AiTimeout]);
    if (k.taint && i === k.markCount - 1) kind = pick(r, [ReplayMarkKind.Cheat, ReplayMarkKind.DevReload, ReplayMarkKind.Restore]);
    marks.push({ tick: mt, kind, value: r() >>> 0 });
  }
  const tainted = marks.some((m) => m.kind === ReplayMarkKind.Cheat || m.kind === ReplayMarkKind.DevReload || m.kind === ReplayMarkKind.Restore);
  const head: ReplayHead = {
    formatVersion: RTSREPLAY_FORMAT_VERSION,
    simBuild: `sim-${r() % 1000}${pick(r, TEXT_POOL)}`,
    buildHash: (r() >>> 0).toString(16),
    simId: r() >>> 0,
    bpSimHash: r() >>> 0,
    mapSimHash: r() >>> 0,
    layoutHash: r() >>> 0,
    protocolVersion: COMMAND_BATCH_VERSION,
    hashInterval,
    subHashInterval,
    flags: ((r() & ~ReplayFlags.Tainted) | (tainted ? ReplayFlags.Tainted : 0)) >>> 0,
    sourceLogVersion: r() % 3,
  };
  const game: ReplayGame = {
    seed: r() >>> 0,
    mapName: pick(r, TEXT_POOL),
    mapSizeWu: r() & 0xffff,
    playerArmy: armyIdx.length === 0 || r() % 4 === 0 ? -1 : pick(r, armyIdx),
    armies: armyIdx.map((index) => ({
      index,
      kind: r() % 3,
      team: r() & 0xff,
      aixPermille: r() & 0xffff,
      name: pick(r, TEXT_POOL),
      aiProfile: pick(r, TEXT_POOL),
      faction: pick(r, ['varkan', 'core', '']),
    })),
    alliances: randBytes(r, 32),
  };
  const regionNames: string[] = [];
  for (let i = 0; i < k.regions; i++) regionNames.push(`${pick(r, ['world', 'units', 'movers', 'eco', 'r'])}${i}`);
  const hashes: ReplayHashes = {
    interval: hashInterval,
    firstTick: k.hashCount > 0 ? r() % 100 : 0,
    hashes: Uint32Array.from({ length: k.hashCount }, () => r() >>> 0),
    subInterval: subHashInterval,
    subFirstTick: k.subRows > 0 && k.regions > 0 ? r() % 1000 : 0,
    regionNames,
    subHashes: Uint32Array.from({ length: k.regions > 0 ? k.subRows * k.regions : 0 }, () => r() >>> 0),
  };
  const commands = genCommands(r, k.span, k.density, armyIdx.length > 0 ? armyIdx : [0]);
  // META.endTick must not lie before the recorded content (reader/writer rule).
  let contentEnd = commands.length > 0 ? commands[commands.length - 1]!.tick : 0;
  if (hashes.hashes.length > 0) contentEnd = Math.max(contentEnd, hashes.firstTick + (hashes.hashes.length - 1) * hashes.interval);
  const subRowCount = regionNames.length > 0 ? hashes.subHashes.length / regionNames.length : 0;
  if (subRowCount > 0) contentEnd = Math.max(contentEnd, hashes.subFirstTick + (subRowCount - 1) * hashes.subInterval);
  if (marks.length > 0) contentEnd = Math.max(contentEnd, marks[marks.length - 1]!.tick);
  const stats: Record<string, number> = {};
  const extra: Record<string, string> = {};
  for (let i = r() % 5; i > 0; i--) stats[`${pick(r, TEXT_POOL)}${i}`] = (r() | 0) * (r() % 3 === 0 ? 1000 : 1);
  for (let i = r() % 4; i > 0; i--) extra[pick(r, TEXT_POOL) + String(i)] = pick(r, TEXT_POOL);
  const meta: ReplayMeta | null = k.meta
    ? {
        durationTicks: r() >>> 0,
        endTick: contentEnd + (r() % 1000),
        players: armyIdx.map((army) => ({ army, name: pick(r, TEXT_POOL) })),
        result: { winner: r() % 3 === 0 ? -1 : r() % 16, reason: pick(r, ['', 'acu-killed', 'surrender', 'Aufgabe']) },
        stats,
        extra,
      }
    : null;
  const extraChunks = [];
  for (let i = 0; i < k.extras; i++) extraChunks.push({ id: pick(r, ['XTRA', 'CHAT', 'zzz1', 'OBS ']), data: randBytes(r, r() % 40) });
  return {
    head,
    game,
    commands,
    hashes,
    marks,
    meta,
    extraChunks,
  };
}

const knobsArb: fc.Arbitrary<GenKnobs> = fc.record({
  seed: fc.integer({ min: 0, max: 0x7fffffff }),
  span: fc.oneof(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 0, max: 3200 })),
  density: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 120 }), fc.integer({ min: 100, max: 1000 })),
  armies: fc.integer({ min: 0, max: 16 }),
  hashCount: fc.integer({ min: 0, max: 120 }),
  subRows: fc.integer({ min: 0, max: 12 }),
  regions: fc.integer({ min: 0, max: 6 }),
  markCount: fc.integer({ min: 0, max: 8 }),
  taint: fc.boolean(),
  meta: fc.boolean(),
  extras: fc.integer({ min: 0, max: 2 }),
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function expectSameCommands(actual: readonly ReplayTickCommands[], expected: readonly ReplayTickCommands[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]!.tick).toBe(expected[i]!.tick);
    if (!bytesEqual(actual[i]!.batch, expected[i]!.batch)) {
      expect(Array.from(actual[i]!.batch)).toEqual(Array.from(expected[i]!.batch));
    }
  }
}

function expectFormatError(fn: () => unknown, code: string): FormatError {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof FormatError)) throw e;
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`expected FormatError '${code}'`);
}

/** Container chunks of a file (copies of the data). */
function chunksOf(bytes: Uint8Array): ContainerChunk[] {
  return readContainer(bytes, RTSREPLAY_MAGIC).chunks.map((c) => ({ id: c.id, data: c.data.slice() }));
}

function rebuild(chunks: readonly ContainerChunk[], version = RTSREPLAY_FORMAT_VERSION): Uint8Array {
  return writeContainer(RTSREPLAY_MAGIC, version, chunks);
}

/** A medium replay used by the example based tests. */
function sampleInput(overrides: Partial<GenKnobs> = {}): RtsReplayInput {
  return genInput({ seed: 4242, span: 2500, density: 200, armies: 2, hashCount: 250, subRows: 25, regions: 5, markCount: 4, taint: false, meta: true, extras: 0, ...overrides });
}

// ---- tests ----------------------------------------------------------------------------------

describe('.rtsreplay roundtrip (property)', () => {
  it('read(write(x)) == x, rewrite(read(b)) == b, write(toInput(read(b))) == b, deterministic (1,000 replays)', () => {
    fc.assert(
      fc.property(knobsArb, (k) => {
        const input = genInput(k);
        const bytes = writeRtsReplay(input);
        expect(bytesEqual(writeRtsReplay(input), bytes)).toBe(true);
        const r = readRtsReplay(bytes, { verifyBlocks: true });
        expect(r.formatVersion).toBe(RTSREPLAY_FORMAT_VERSION);
        expect(r.byteLength).toBe(bytes.length);
        expect(r.head).toEqual(input.head);
        expect(r.game).toEqual(input.game);
        expectSameCommands(readAllCommands(r), input.commands);
        expect(r.hashes.interval).toBe(input.hashes.interval);
        expect(r.hashes.firstTick).toBe(input.hashes.firstTick);
        expect(Array.from(r.hashes.hashes)).toEqual(Array.from(input.hashes.hashes));
        expect(r.hashes.subInterval).toBe(input.hashes.subInterval);
        expect(r.hashes.subFirstTick).toBe(input.hashes.subFirstTick);
        expect(r.hashes.regionNames).toEqual(input.hashes.regionNames);
        expect(Array.from(r.hashes.subHashes)).toEqual(Array.from(input.hashes.subHashes));
        expect(r.marks).toEqual(input.marks);
        expect(r.meta).toEqual(input.meta);
        expect(r.unknown.map((c) => [c.id, Array.from(c.data)])).toEqual((input.extraChunks ?? []).map((c) => [c.id, Array.from(c.data)]));
        const lastTick = input.commands.length > 0 ? input.commands[input.commands.length - 1]!.tick : -1;
        expect(r.blocks.length).toBe(lastTick < 0 ? 0 : Math.floor(lastTick / CMDS_BLOCK_TICKS) + 1);
        expect(bytesEqual(rewriteRtsReplay(r), bytes)).toBe(true);
        expect(bytesEqual(writeRtsReplay(rtsReplayToInput(r)), bytes)).toBe(true);
        const size = replaySizeReport(bytes);
        expect(Object.values(size.byChunk).reduce((a, b) => a + b, 0)).toBe(bytes.length);
      }),
      { numRuns: 1000, seed: 0x5eed },
    );
  }, 120_000);
});

describe('CMDS block coding', () => {
  const blockArb = fc.record({ seed: fc.integer({ min: 0, max: 0x7fffffff }), block: fc.integer({ min: 0, max: 50 }), density: fc.integer({ min: 1, max: 1000 }), armies: fc.integer({ min: 1, max: 16 }) });

  it('encode/decode of random blocks is byte-identical (seq wrap, repeated and trimmed unit lists, any payload)', () => {
    fc.assert(
      fc.property(blockArb, ({ seed, block, density, armies }) => {
        const r = rngOf(seed);
        const armyIdx = Array.from({ length: armies }, (_, i) => i);
        const first = block * CMDS_BLOCK_TICKS;
        const entries = genCommands(r, CMDS_BLOCK_TICKS - 1, density, armyIdx).map((e) => {
          const b = e.batch.slice();
          const dv = new DataView(b.buffer);
          // Re-stamp the envelopes with the block's ticks.
          let p = 3;
          for (let i = 0; i < dv.getUint16(1, true); i++) {
            dv.setUint32(p, first + e.tick, true);
            p += 11 + dv.getUint16(p + 9, true) * 4;
            p += 2 + dv.getUint16(p, true);
          }
          return { tick: first + e.tick, batch: b };
        });
        const raw = encodeCmdsRaw(entries, first);
        expectSameCommands(decodeCmdsRaw(raw, first, entries.length), entries);
        expect(bytesEqual(encodeCmdsRaw(entries, first), raw)).toBe(true);
        const chunk = encodeCmdsChunk(block, entries);
        const ref = parseCmdsChunk(chunk, block, 0);
        expect(ref.entryCount).toBe(entries.length);
        expect(ref.rawLength).toBe(raw.length);
        expectSameCommands(decodeCmdsBlock(ref), entries);
      }),
      { numRuns: 400, seed: 0xc0de },
    );
  }, 120_000);

  it('keeps seq across the u16 wrap and a unit list repeated by reference', () => {
    const enc = new CommandBatchEncoder();
    const entries: ReplayTickCommands[] = [];
    const units = [0x00100005, 0x00200006, 7];
    for (let i = 0; i < 40; i++) {
      enc.reset();
      enc.addRaw(i * 3, 1, (0xfff0 + i) & 0xffff, Op.Move, 0, units, new Uint8Array(12));
      enc.addRaw(i * 3, 0, (0xffff + i * 7) & 0xffff, Op.Stop, 1, i % 2 === 0 ? units : [], new Uint8Array(0));
      entries.push({ tick: i * 3, batch: enc.view().slice() });
    }
    const raw = encodeCmdsRaw(entries, 0);
    expectSameCommands(decodeCmdsRaw(raw, 0, entries.length), entries);
    // Highly repetitive: far below the protocol bytes.
    const protocolBytes = entries.reduce((a, e) => a + e.batch.length, 0);
    expect(raw.length).toBeLessThan(protocolBytes / 10);
  });

  it('writer rejects envelope ticks that differ from the entry tick, unordered ticks and malformed batches', () => {
    const enc = new CommandBatchEncoder();
    enc.addRaw(5, 0, 0, Op.Stop, 0, [], new Uint8Array(0));
    const b5 = enc.view().slice();
    expectFormatError(() => encodeCmdsRaw([{ tick: 6, batch: b5 }], 0), 'bad-value');
    expectFormatError(() => encodeCmdsRaw([{ tick: 5, batch: b5 }, { tick: 5, batch: b5 }], 0), 'bad-value');
    expectFormatError(() => encodeCmdsRaw([{ tick: 5, batch: b5.subarray(0, 8) }], 0), 'bad-value');
    expectFormatError(() => encodeCmdsRaw([{ tick: 5, batch: b5 }], 600), 'bad-value');
    const input = sampleInput();
    const bad = { ...input, commands: [...input.commands, { tick: input.commands[input.commands.length - 1]!.tick + 1, batch: b5 }] };
    expectFormatError(() => writeRtsReplay(bad), 'bad-value');
  });

  it('stores a block uncompressed when DEFLATE does not shrink it, compressed when it does', () => {
    const enc = new CommandBatchEncoder();
    const entries: ReplayTickCommands[] = [];
    // The same random 400-byte payload every tick: the per-position byte models cannot see the
    // repetition, DEFLATE's matches can.
    const blob = randBytes(rngOf(7), 400);
    for (let t = 0; t < 600; t += 2) {
      enc.reset();
      enc.addRaw(t, 0, t, Op.Cheat, 0, [], blob);
      entries.push({ tick: t, batch: enc.view().slice() });
    }
    const ref = parseCmdsChunk(encodeCmdsChunk(0, entries), 0, 0);
    expect(ref.codec).toBe(CmdsCodec.DeflateRaw);
    expect(ref.payload.length).toBeLessThan(ref.rawLength);
    expectSameCommands(decodeCmdsBlock(ref), entries);
    const stored = parseCmdsChunk(encodeCmdsChunk(0, entries, 0), 0, 0);
    expect(stored.codec).toBe(CmdsCodec.Stored);
    expectSameCommands(decodeCmdsBlock(stored), entries);
    const small = readRtsReplay(writeRtsReplay(sampleInput())).blocks;
    expect(small.every((b) => b.codec === CmdsCodec.Stored)).toBe(true);
  });

  it('reads blocks whose data was compressed natively (node:zlib, CompressionStream)', async () => {
    const input = sampleInput();
    const bytes = writeRtsReplay(input);
    const chunks = chunksOf(bytes);
    const replay = readRtsReplay(bytes);
    const recompress = async (how: 'zlib' | 'stream'): Promise<Uint8Array> => {
      const out: ContainerChunk[] = [];
      let bi = 0;
      for (const c of chunks) {
        if (c.id !== 'CMDS') {
          out.push(c);
          continue;
        }
        const ref = replay.blocks[bi++]!;
        const raw = cmdsBlockRaw(ref);
        let z: Uint8Array;
        if (how === 'zlib') z = new Uint8Array(deflateRawSync(raw, { level: 9 }));
        else z = new Uint8Array(await new Response(new Blob([raw.slice()]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
        const data = new Uint8Array(16 + z.length);
        data.set(c.data.subarray(0, 16));
        data[2] = CmdsCodec.DeflateRaw;
        data.set(z, 16);
        out.push({ id: 'CMDS', data });
      }
      return rebuild(out);
    };
    for (const how of ['zlib', 'stream'] as const) {
      const native = await recompress(how);
      const r = readRtsReplay(native, { verifyBlocks: true });
      expect(r.blocks.every((b) => b.codec === CmdsCodec.DeflateRaw)).toBe(true);
      expectSameCommands(readAllCommands(r), input.commands);
      expect(bytesEqual(rewriteRtsReplay(r), native)).toBe(true);
    }
  });

  it('rejects oversized declared raw lengths before inflating and deflate bombs', () => {
    const bytes = writeRtsReplay(sampleInput());
    const chunks = chunksOf(bytes);
    const i = chunks.findIndex((c) => c.id === 'CMDS');
    const c = chunks[i]!;
    const tooBig = c.data.slice();
    new DataView(tooBig.buffer).setUint32(12, MAX_CMDS_BLOCK_BYTES + 1, true);
    tooBig[2] = CmdsCodec.DeflateRaw;
    chunks[i] = { id: 'CMDS', data: tooBig };
    expectFormatError(() => readRtsReplay(rebuild(chunks)), 'too-large');
    // 64 MiB of zeros compress to ~65 KB; declared as 1 MiB → bad-compression, no 64 MiB buffer.
    const bomb = deflateRaw(new Uint8Array(64 * 1024 * 1024), 9);
    const data = new Uint8Array(16 + bomb.length);
    data.set(c.data.subarray(0, 16));
    data[2] = CmdsCodec.DeflateRaw;
    new DataView(data.buffer).setUint32(12, 1024 * 1024, true);
    data.set(bomb, 16);
    chunks[i] = { id: 'CMDS', data };
    const r = readRtsReplay(rebuild(chunks));
    expectFormatError(() => readAllCommands(r), 'bad-compression');
  });
});

describe('versioning, chunk order and unknown chunks', () => {
  const input = sampleInput({ span: 1900 });
  const bytes = writeRtsReplay(input);

  it('keeps an unknown chunk between CMDS blocks and rewrites byte-exact', () => {
    const chunks = chunksOf(bytes);
    const firstCmds = chunks.findIndex((c) => c.id === 'CMDS');
    expect(chunks.filter((c) => c.id === 'CMDS').length).toBeGreaterThan(2);
    const xtra = { id: 'XTRA', data: new Uint8Array([1, 2, 3, 4, 5]) };
    chunks.splice(firstCmds + 1, 0, xtra);
    chunks.push({ id: 'xtr2', data: new Uint8Array(0) });
    const file = rebuild(chunks);
    const r = readRtsReplay(file, { verifyBlocks: true });
    expect(r.unknown.map((c) => c.id)).toEqual(['XTRA', 'xtr2']);
    expect(Array.from(r.unknown[0]!.data)).toEqual([1, 2, 3, 4, 5]);
    expect(r.chunks.map((c) => c.id)).toEqual(chunks.map((c) => c.id));
    expectSameCommands(readAllCommands(r), input.commands);
    expect(bytesEqual(rewriteRtsReplay(r), file)).toBe(true);
    // The writer takes unknown chunks too (appended after the known ones).
    const w = writeRtsReplay({ ...input, extraChunks: [xtra] });
    expect(readRtsReplay(w).unknown.map((c) => c.id)).toEqual(['XTRA']);
    expectFormatError(() => writeRtsReplay({ ...input, extraChunks: [{ id: 'HASH', data: new Uint8Array(0) }] }), 'bad-value');
  });

  it('rejects a newer container format version and newer chunk versions', () => {
    const chunks = chunksOf(bytes);
    expectFormatError(() => readRtsReplay(rebuild(chunks, 2)), 'unsupported-version');
    expectFormatError(() => readRtsReplay(rebuild(chunks, 0)), 'bad-format-version');
    for (const id of ['HEAD', 'GAME', 'CMDS', 'HASH', 'MARK', 'META']) {
      const cs = chunksOf(bytes);
      const c = cs.find((x) => x.id === id)!;
      c.data[0] = 2;
      const e = expectFormatError(() => readRtsReplay(rebuild(cs)), 'unsupported-version');
      expect(e.chunkId).toBe(id);
    }
    // A newer command protocol version inside HEAD.
    const cs = chunksOf(bytes);
    new DataView(cs[0]!.data.buffer).setUint16(4, COMMAND_BATCH_VERSION + 1, true);
    expectFormatError(() => readRtsReplay(rebuild(cs)), 'unsupported-version');
  });

  it('reads the frozen HEAD prefix of any version tolerantly (build redirect)', () => {
    const info = readRtsReplayHead(bytes);
    expect(info).toMatchObject({
      containerVersion: 1,
      formatVersion: RTSREPLAY_FORMAT_VERSION,
      headChunkVersion: 1,
      protocolVersion: COMMAND_BATCH_VERSION,
      simBuild: input.head.simBuild,
      buildHash: input.head.buildHash,
      simId: input.head.simId,
      flags: input.head.flags,
    });
    expect(info.chunkVersions).toEqual({ HEAD: 1, GAME: 1, CMDS: 1, HASH: 1, MARK: 1, META: 1 });
    expect(replayFormatIncompatibility(info)).toBeNull();

    // Older and newer command protocol: strict reader 'unsupported-version' (never 'bad-value'),
    // tolerant reader still names the build.
    for (const pv of [COMMAND_BATCH_VERSION - 1, COMMAND_BATCH_VERSION + 1]) {
      const cs = chunksOf(bytes);
      new DataView(cs[0]!.data.buffer).setUint16(4, pv, true);
      const file = rebuild(cs);
      expectFormatError(() => readRtsReplay(file), 'unsupported-version');
      const hi = readRtsReplayHead(file);
      expect(hi.protocolVersion).toBe(pv);
      expect(hi.buildHash).toBe(input.head.buildHash);
      expect(replayFormatIncompatibility(hi)?.reason).toBe('protocol');
    }
    // A newer HEAD version that appends a field after buildHash.
    const cs = chunksOf(bytes);
    const head = cs[0]!;
    const longer = new Uint8Array(head.data.length + 6);
    longer.set(head.data);
    longer[0] = 2;
    longer.set([1, 2, 3, 4, 5, 6], head.data.length);
    cs[0] = { id: 'HEAD', data: longer };
    const v2 = rebuild(cs);
    expectFormatError(() => readRtsReplay(v2), 'unsupported-version');
    const hv2 = readRtsReplayHead(v2);
    expect(hv2.headChunkVersion).toBe(2);
    expect(hv2.simBuild).toBe(input.head.simBuild);
    expect(replayFormatIncompatibility(hv2)?.reason).toBe('format');
    // Newer container format version / newer CMDS version.
    expect(replayFormatIncompatibility(readRtsReplayHead(rebuild(chunksOf(bytes), RTSREPLAY_FORMAT_VERSION + 1)))?.reason).toBe('format');
    const cc = chunksOf(bytes);
    cc.find((c) => c.id === 'CMDS')!.data[0] = CMDS_CHUNK_VERSION + 1;
    const hc = readRtsReplayHead(rebuild(cc));
    expect(hc.chunkVersions['CMDS']).toBe(CMDS_CHUNK_VERSION + 1);
    expect(replayFormatIncompatibility(hc)).toEqual({ reason: 'format', detail: expect.stringContaining('CMDS') });
    // Not a replay / broken HEAD: FormatError.
    expectFormatError(() => readRtsReplayHead(new Uint8Array(8)), 'truncated');
    expectFormatError(() => readRtsReplayHead(writeContainer('RTSM', 1, [])), 'bad-magic');
    const broken = bytes.slice();
    broken[16 + 8 + 3] = broken[16 + 8 + 3]! ^ 0xff; // inside the HEAD data
    expectFormatError(() => readRtsReplayHead(broken), 'bad-crc');
    expectFormatError(() => readRtsReplayHead(rebuild(chunksOf(bytes).slice(1))), 'missing-chunk');
  });

  it('decodes each CMDS block with the decoder of its own chunk version', () => {
    const r = readRtsReplay(bytes);
    const block = r.blocks.find((b) => b.entryCount > 0)!;
    expect(block.version).toBe(CMDS_CHUNK_VERSION);
    const entries = decodeCmdsBlock(block);
    expectSameCommands(decodeCmdsRaw(cmdsBlockRaw(block), block.firstTick, block.entryCount, -1, 1), entries);
    // A (synthetic) block of a version without a decoder is never decoded with the v1 rules.
    const e = expectFormatError(() => decodeCmdsBlock({ ...block, version: CMDS_CHUNK_VERSION + 1 }), 'unsupported-version');
    expect(e.chunkId).toBe('CMDS');
    expectFormatError(() => decodeCmdsRaw(cmdsBlockRaw(block), block.firstTick, block.entryCount, -1, 0), 'unsupported-version');
    // A file with one synthetic CMDS v2 block: the strict reader refuses it as a whole (no silent
    // mis-decode) while the v1 file keeps decoding.
    const cs = chunksOf(bytes);
    const ci = cs.map((c) => c.id).lastIndexOf('CMDS');
    cs[ci]!.data[0] = CMDS_CHUNK_VERSION + 1;
    expectFormatError(() => readRtsReplay(rebuild(cs)), 'unsupported-version');
    expectSameCommands(readAllCommands(readRtsReplay(bytes, { verifyBlocks: true })), input.commands);
  });

  it('detects missing, duplicate and misordered mandatory chunks', () => {
    const base = chunksOf(bytes);
    const without = (id: string): ContainerChunk[] => base.filter((c) => c.id !== id);
    for (const id of ['HEAD', 'GAME', 'HASH', 'MARK']) expectFormatError(() => readRtsReplay(rebuild(without(id))), 'missing-chunk');
    const dup = (id: string): ContainerChunk[] => {
      const cs = base.slice();
      const i = cs.findIndex((c) => c.id === id);
      cs.splice(i + 1, 0, cs[i]!);
      return cs;
    };
    for (const id of ['HASH', 'MARK', 'META']) expectFormatError(() => readRtsReplay(rebuild(dup(id))), 'duplicate-chunk');
    const swap = (a: string, b: string): ContainerChunk[] => {
      const cs = base.slice();
      const i = cs.findIndex((c) => c.id === a);
      const j = cs.findIndex((c) => c.id === b);
      [cs[i], cs[j]] = [cs[j]!, cs[i]!];
      return cs;
    };
    expectFormatError(() => readRtsReplay(rebuild(swap('HEAD', 'GAME'))), 'chunk-order');
    expectFormatError(() => readRtsReplay(rebuild(swap('HASH', 'MARK'))), 'chunk-order');
    expectFormatError(() => readRtsReplay(rebuild(swap('MARK', 'META'))), 'chunk-order');
    const cmdsLast = base.slice();
    const ci = cmdsLast.map((c) => c.id).lastIndexOf('CMDS');
    cmdsLast.push(cmdsLast.splice(ci, 1)[0]!);
    expectFormatError(() => readRtsReplay(rebuild(cmdsLast)), 'chunk-order');
    // Swapped CMDS blocks: block index / first tick mismatch.
    const cs = base.slice();
    const k = cs.findIndex((c) => c.id === 'CMDS');
    [cs[k], cs[k + 1]] = [cs[k + 1]!, cs[k]!];
    expectFormatError(() => readRtsReplay(rebuild(cs)), 'bad-value');
    // No META is fine.
    const r = readRtsReplay(rebuild(without('META')));
    expect(r.meta).toBeNull();
  });

  it('checks HEAD/HASH/MARK consistency (intervals, Tainted flag)', () => {
    // A known taint mark needs the flag …
    expectFormatError(() => writeRtsReplay({ ...input, marks: [...input.marks, { tick: 99999, kind: ReplayMarkKind.Cheat, value: 0 }], meta: null }), 'bad-value');
    expectFormatError(() => writeRtsReplay({ ...input, head: { ...input.head, hashInterval: input.head.hashInterval + 1 } }), 'bad-value');
    expectFormatError(() => writeRtsReplay({ ...input, head: { ...input.head, subHashInterval: input.head.subHashInterval + 1 } }), 'bad-value');
    // … but the flag without a known taint mark is accepted (taint kinds of newer builds) and kept.
    const flagged = writeRtsReplay({ ...input, head: { ...input.head, flags: input.head.flags | ReplayFlags.Tainted } });
    expect(readRtsReplay(flagged).head.flags & ReplayFlags.Tainted).toBe(ReplayFlags.Tainted);
    expect(bytesEqual(writeRtsReplay(rtsReplayToInput(readRtsReplay(flagged))), flagged)).toBe(true);
    const cs = chunksOf(bytes);
    const head = cs[0]!;
    const dv = new DataView(head.data.buffer);
    dv.setUint32(28, dv.getUint32(28, true) | ReplayFlags.Tainted, true); // flags (see chunks.ts layout)
    expect(readRtsReplay(rebuild(cs)).head.flags & ReplayFlags.Tainted).toBe(ReplayFlags.Tainted);
    // A Restore mark without the flag is refused by the reader.
    const tainted = writeRtsReplay({
      ...input,
      head: { ...input.head, flags: input.head.flags | ReplayFlags.Tainted },
      marks: [...input.marks, { tick: input.meta!.endTick, kind: ReplayMarkKind.Restore, value: 0 }],
    });
    const ct = chunksOf(tainted);
    const dvt = new DataView(ct[0]!.data.buffer);
    dvt.setUint32(28, dvt.getUint32(28, true) & ~ReplayFlags.Tainted, true);
    expectFormatError(() => readRtsReplay(rebuild(ct)), 'bad-value');
    const cs2 = chunksOf(bytes);
    new DataView(cs2[0]!.data.buffer).setUint16(6, input.head.hashInterval + 1, true);
    expectFormatError(() => readRtsReplay(rebuild(cs2)), 'bad-value');
  });

  it('refuses a META.endTick before the recorded content (reader and writer)', () => {
    const h = input.hashes;
    const lastHash = h.firstTick + (h.hashes.length - 1) * h.interval;
    const lastCmd = input.commands[input.commands.length - 1]!.tick;
    // Writer: exact bound (commands, hashes, sub-hashes, marks).
    const e = expectFormatError(() => writeRtsReplay({ ...input, meta: { ...input.meta!, endTick: lastHash - 1 } }), 'bad-value');
    expect(e.chunkId).toBe('META');
    if (lastCmd > 0) expectFormatError(() => writeRtsReplay({ ...input, meta: { ...input.meta!, endTick: lastCmd - 1 } }), 'bad-value');
    const contentEnd = Math.max(lastHash, lastCmd, input.marks[input.marks.length - 1]?.tick ?? 0);
    expect(readRtsReplay(writeRtsReplay({ ...input, meta: { ...input.meta!, endTick: contentEnd } })).meta!.endTick).toBe(contentEnd);
    // Reader: a META chunk shortened afterwards (the verification would stop early).
    const shortened = (endTick: number): Uint8Array => {
      const cs = chunksOf(bytes);
      const i = cs.findIndex((c) => c.id === 'META');
      const t = new TextEncoder().encode(replayMetaToCanonicalJson({ ...input.meta!, endTick }));
      const data = new Uint8Array(2 + t.length);
      data[0] = 1;
      data.set(t, 2);
      cs[i] = { id: 'META', data };
      return rebuild(cs);
    };
    const m = expectFormatError(() => readRtsReplay(shortened(Math.floor(lastHash / 2))), 'bad-value');
    expect(m.chunkId).toBe('META');
    // Commands after every hash and mark: the cheap bound (last block start) and verifyBlocks (exact).
    const onlyCmds = writeRtsReplay({
      ...input,
      hashes: { ...h, firstTick: 0, hashes: new Uint32Array(0), subFirstTick: 0, subHashes: new Uint32Array(0) },
      marks: [],
      meta: { ...input.meta!, endTick: lastCmd },
    });
    const cs = chunksOf(onlyCmds);
    const i = cs.findIndex((c) => c.id === 'META');
    const lastBlockStart = Math.floor(lastCmd / CMDS_BLOCK_TICKS) * CMDS_BLOCK_TICKS;
    const t = new TextEncoder().encode(replayMetaToCanonicalJson({ ...input.meta!, endTick: lastBlockStart - 1 }));
    const data = new Uint8Array(2 + t.length);
    data[0] = 1;
    data.set(t, 2);
    cs[i] = { id: 'META', data };
    if (lastBlockStart > 0) expectFormatError(() => readRtsReplay(rebuild(cs)), 'bad-value');
    if (lastCmd > lastBlockStart) {
      const t2 = new TextEncoder().encode(replayMetaToCanonicalJson({ ...input.meta!, endTick: lastCmd - 1 }));
      const d2 = new Uint8Array(2 + t2.length);
      d2[0] = 1;
      d2.set(t2, 2);
      cs[i] = { id: 'META', data: d2 };
      expect(readRtsReplay(rebuild(cs)).meta!.endTick).toBe(lastCmd - 1); // lazy: not detected
      expectFormatError(() => readRtsReplay(rebuild(cs), { verifyBlocks: true }), 'bad-value');
    }
    expect(replayContentEndTick(readRtsReplay(onlyCmds))).toBe(lastCmd);
    expect(replayContentEndTick(readRtsReplay(bytes))).toBe(contentEnd);
  });

  it('rejects non-canonical and invalid META JSON', () => {
    const variants: [string, string][] = [
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{}} ', 'non-canonical'],
      ['{"endTick":1,"durationTicks":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{}}', 'non-canonical'],
      ['{"durationTicks":1e1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{}}', 'non-canonical'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{"a":1.0}}', 'non-canonical'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"\\u0041","winner":-1},"stats":{}}', 'non-canonical'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{"b":1,"a":2}}', 'non-canonical'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{"a":1,"a":2}}', 'non-canonical'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{"a":1.5}}', 'bad-value'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-2},"stats":{}}', 'bad-value'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"\\ud800","winner":-1},"stats":{}}', 'bad-value'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{},"x":1.50}', 'non-canonical'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{},"x":{"b":1,"a":2}}', 'non-canonical'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"x":1}', 'bad-value'],
      ['{"durationTicks":1,"endTick":1,"extra":{},"players":[{"army":0,"name":"a","x":1}],"result":{"reason":"","winner":-1},"stats":{}}', 'bad-value'],
      ['{"durationTicks":1,"endTick":1,"extra":{"__proto__":"x"},"players":[],"result":{"reason":"","winner":-1},"stats":{}}', 'bad-value'],
      ['{"durationTicks":1,', 'bad-json'],
    ];
    const ok = '{"durationTicks":1,"endTick":1,"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{}}';
    const withMeta = (json: string): Uint8Array => {
      const cs = chunksOf(bytes);
      const i = cs.findIndex((c) => c.id === 'META');
      // endTick must cover the recorded content of `bytes`.
      const t = new TextEncoder().encode(json.replace('"endTick":1,', `"endTick":${input.meta!.endTick},`));
      const data = new Uint8Array(2 + t.length);
      data[0] = 1;
      data.set(t, 2);
      cs[i] = { id: 'META', data };
      return rebuild(cs);
    };
    expect(readRtsReplay(withMeta(ok)).meta!.durationTicks).toBe(1);
    for (const [json, code] of variants) expectFormatError(() => readRtsReplay(withMeta(json)), code);
  });

  it('keeps unknown top-level META keys of newer builds (canonical JSON, roundtrip)', () => {
    const json =
      '{"aNew":[1,"x",{"k":null,"z":true}],"durationTicks":1,"endTick":' +
      String(input.meta!.endTick) +
      ',"extra":{},"players":[],"result":{"reason":"","winner":-1},"stats":{},"zz":1.5}';
    const cs = chunksOf(bytes);
    const i = cs.findIndex((c) => c.id === 'META');
    const t = new TextEncoder().encode(json);
    const data = new Uint8Array(2 + t.length);
    data[0] = 1;
    data.set(t, 2);
    cs[i] = { id: 'META', data };
    const file = rebuild(cs);
    const r = readRtsReplay(file);
    expect(r.meta!.extensions).toEqual({ aNew: '[1,"x",{"k":null,"z":true}]', zz: '1.5' });
    expect(replayMetaToCanonicalJson(r.meta!)).toBe(json);
    expect(bytesEqual(writeRtsReplay(rtsReplayToInput(r)), file)).toBe(true);
    expect(bytesEqual(rewriteRtsReplay(r), file)).toBe(true);
    expectFormatError(() => writeRtsReplay({ ...input, meta: { ...input.meta!, extensions: { endTick: '1' } } }), 'bad-value');
    expectFormatError(() => writeRtsReplay({ ...input, meta: { ...input.meta!, extensions: { x: '{"b":1,"a":2}' } } }), 'bad-value');
    expectFormatError(() => writeRtsReplay({ ...input, meta: { ...input.meta!, extensions: { x: 'nope' } } }), 'bad-value');
    expectFormatError(() => writeRtsReplay({ ...input, meta: { ...input.meta!, stats: { a: 0.5 } } }), 'bad-value');
    expectFormatError(() => writeRtsReplay({ ...input, meta: { ...input.meta!, endTick: -1 } }), 'bad-value');
  });
});

describe('RtsReplayBuilder and helpers', () => {
  it('produces the same bytes as writeRtsReplay when fed incrementally', () => {
    const input = sampleInput({ taint: true, extras: 1 });
    const b = new RtsReplayBuilder({ ...input.head, flags: (input.head.flags & ~ReplayFlags.Tainted) >>> 0 }, input.game, { regionNames: input.hashes.regionNames, extraChunks: input.extraChunks ?? [] });
    // Interleaved like a live recording: per tick commands, then hashes, then marks.
    const h = input.hashes;
    const rc = h.regionNames.length;
    let hi = 0;
    let si = 0;
    let mi = 0;
    const lastTick = Math.max(input.commands[input.commands.length - 1]?.tick ?? 0, h.firstTick + h.hashes.length * h.interval, h.subFirstTick + (h.subHashes.length / rc) * h.subInterval, input.marks[input.marks.length - 1]?.tick ?? 0);
    let ci = 0;
    for (let t = 0; t <= lastTick; t++) {
      if (ci < input.commands.length && input.commands[ci]!.tick === t) {
        b.commands(t, input.commands[ci]!.batch);
        ci++;
      }
      if (hi < h.hashes.length && h.firstTick + hi * h.interval === t) b.hash(t, h.hashes[hi++]!);
      if (si * rc < h.subHashes.length && h.subFirstTick + si * h.subInterval === t) {
        b.subHashes(t, h.subHashes.slice(si * rc, si * rc + rc));
        si++;
      }
      while (mi < input.marks.length && input.marks[mi]!.tick === t) {
        const m = input.marks[mi++]!;
        b.mark(m.tick, m.kind, m.value);
      }
    }
    const out = b.finish(input.meta);
    expect(bytesEqual(out, writeRtsReplay(input))).toBe(true);
    expect(readRtsReplay(out).head.flags & ReplayFlags.Tainted).toBe(ReplayFlags.Tainted);
    expect(() => b.finish(null)).toThrow();
  });

  it('copies batches, fills gaps with empty blocks and indexes blocks by tick', () => {
    const head = sampleInput().head;
    const game = sampleInput().game;
    const b = new RtsReplayBuilder({ ...head, flags: 0 }, game);
    const enc = new CommandBatchEncoder();
    enc.addRaw(10, 0, 0, Op.Stop, 0, [], new Uint8Array(0));
    const batch = enc.view().slice();
    b.commands(10, batch);
    batch.fill(0); // must not affect the recording
    enc.reset().addRaw(2 * 600 + 5, 1, 0, Op.Stop, 0, [3], new Uint8Array(0));
    b.commands(1205, enc.view());
    expect(() => b.commands(1205, enc.view())).toThrow(FormatError);
    expect(() => b.hash(3, 1)).not.toThrow();
    expect(() => b.hash(3, 1)).toThrow(FormatError);
    expect(() => b.subHashes(100, new Uint32Array(1))).toThrow(FormatError); // no region names
    const out = b.finish(null);
    const r = readRtsReplay(out, { verifyBlocks: true });
    expect(r.blocks.map((x) => x.entryCount)).toEqual([1, 0, 1]);
    const cmds = readAllCommands(r);
    expect(cmds.map((c) => c.tick)).toEqual([10, 1205]);
    expect(cmds[0]!.batch[0]).toBe(COMMAND_BATCH_VERSION);
    expect(blockIndexForTick(r, 0)).toBe(0);
    expect(blockIndexForTick(r, 599)).toBe(0);
    expect(blockIndexForTick(r, 600)).toBe(1);
    expect(blockIndexForTick(r, 1799)).toBe(2);
    expect(blockIndexForTick(r, 1800)).toBe(-1);
    expect(blockIndexForTick(r, -1)).toBe(-1);
    expect(r.hashes.hashes.length).toBe(1);
    expect(r.meta).toBeNull();
  });

  it('writes an empty replay (no commands, hashes, marks)', () => {
    const s = sampleInput();
    const input: RtsReplayInput = {
      head: { ...s.head, flags: 0 },
      game: s.game,
      commands: [],
      hashes: { interval: s.head.hashInterval, firstTick: 0, hashes: new Uint32Array(0), subInterval: s.head.subHashInterval, subFirstTick: 0, regionNames: [], subHashes: new Uint32Array(0) },
      marks: [],
      meta: null,
    };
    const bytes = writeRtsReplay(input);
    const r = readRtsReplay(bytes);
    expect(r.blocks).toEqual([]);
    expect(r.chunks.map((c) => c.id)).toEqual(['HEAD', 'GAME', 'HASH', 'MARK']);
    expect(bytesEqual(rewriteRtsReplay(r), bytes)).toBe(true);
    const size = replaySizeReport(bytes);
    expect(size.blocks).toBe(0);
    expect(size.total).toBe(bytes.length);
  });

  it('keeps unknown mark kinds (append-only) and equals the sim-host mark values', () => {
    expect(ReplayMarkKind).toEqual({ Pause: 1, Resume: 2, Speed: 3, Cheat: 4, DevReload: 5, Step: 6, Restore: 7, AiTimeout: 8 });
    expect(ReplayFlags).toEqual({ Tainted: 1, Complete: 2, Truncated: 4 });
    const s = sampleInput({ markCount: 0 });
    const marks: ReplayMark[] = [
      { tick: 0, kind: 200, value: 1 },
      { tick: 0, kind: ReplayMarkKind.AiTimeout, value: 1 },
      { tick: 7, kind: 255, value: 0xffffffff },
    ];
    const r = readRtsReplay(writeRtsReplay({ ...s, marks }));
    expect(r.marks).toEqual(marks);
  });
});
