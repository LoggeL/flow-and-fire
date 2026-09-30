/**
 * Fuzz of the .rtsreplay reader: every mutation of a valid file must end in a FormatError or in a
 * replay that decodes completely and rewrites byte-identical to the mutated input. No other
 * exception (RangeError, TypeError …) may escape, and no CMDS block may decode to more than
 * MAX_CMDS_BLOCK_BYTES.
 */

import { describe, expect, it } from 'vitest';
import { COMMAND_BATCH_VERSION, CommandBatchEncoder, Op } from '@faf/protocol';
import {
  CmdsCodec,
  FormatError,
  MAX_CMDS_BLOCK_BYTES,
  RTSREPLAY_FORMAT_VERSION,
  RTSREPLAY_MAGIC,
  ReplayMarkKind,
  deflateRaw,
  readAllCommands,
  readContainer,
  readRtsReplay,
  readRtsReplayHead,
  replayFormatIncompatibility,
  rewriteRtsReplay,
  writeContainer,
  writeRtsReplay,
  type ContainerChunk,
  type ReplayTickCommands,
  type RtsReplayInput,
} from '../src/index.ts';

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

/** A realistic small replay: two armies, moves/builds/targets, repeated selections. */
function baseInput(seed: number, span: number): RtsReplayInput {
  const r = rngOf(seed);
  const enc = new CommandBatchEncoder();
  const commands: ReplayTickCommands[] = [];
  const seq = [0xfffa, 3];
  const lists: number[][] = [[], []];
  for (let tick = 1; tick <= span; tick++) {
    if (r() % 10 !== 0) continue;
    enc.reset();
    for (let army = 0; army < 2; army++) {
      if (r() % 2 === 0) continue;
      if (r() % 3 === 0 || lists[army]!.length === 0) {
        const n = 1 + (r() % 12);
        lists[army] = Array.from({ length: n }, () => (((r() % 8) << 20) | (r() % 900)) >>> 0);
      }
      const kind = r() % 4;
      const op = kind === 0 ? Op.Move : kind === 1 ? Op.Build : kind === 2 ? Op.Attack : Op.FactoryQueue;
      const payload = new Uint8Array(kind === 0 ? 12 : kind === 1 ? 16 : 4);
      for (let i = 0; i < payload.length; i++) payload[i] = r() & 0xff;
      enc.addRaw(tick, army, seq[army]!, op, r() & 1, lists[army]!, payload);
      seq[army] = (seq[army]! + 1) & 0xffff;
    }
    if (enc.count > 0) commands.push({ tick, batch: enc.view().slice() });
  }
  const hashes = Uint32Array.from({ length: Math.floor(span / 10) }, () => r() >>> 0);
  const rows = Math.floor(span / 100);
  return {
    head: {
      formatVersion: RTSREPLAY_FORMAT_VERSION,
      simBuild: 'fuzz-1',
      buildHash: 'abc123',
      simId: r() >>> 0,
      bpSimHash: r() >>> 0,
      mapSimHash: r() >>> 0,
      layoutHash: r() >>> 0,
      protocolVersion: COMMAND_BATCH_VERSION,
      hashInterval: 10,
      subHashInterval: 100,
      flags: 1 | 2,
      sourceLogVersion: 0,
    },
    game: {
      seed: r() >>> 0,
      mapName: 'hollow-ridge',
      mapSizeWu: 256,
      playerArmy: 0,
      armies: [
        { index: 0, kind: 0, team: 1, aixPermille: 1000, name: 'Spieler', aiProfile: '', faction: 'varkan' },
        { index: 1, kind: 1, team: 2, aixPermille: 1200, name: 'KI', aiProfile: 'turtle', faction: 'varkan' },
      ],
      alliances: new Uint8Array(32).fill(0x11),
    },
    commands,
    hashes: {
      interval: 10,
      firstTick: 10,
      hashes,
      subInterval: 100,
      subFirstTick: 100,
      regionNames: ['world', 'units', 'movers'],
      subHashes: Uint32Array.from({ length: rows * 3 }, () => r() >>> 0),
    },
    marks: [
      { tick: 1, kind: ReplayMarkKind.Speed, value: 1000 },
      { tick: 50, kind: ReplayMarkKind.Cheat, value: 0 },
      { tick: 70, kind: 99, value: 5 },
    ],
    meta: { durationTicks: span, endTick: span, players: [{ army: 0, name: 'Spieler' }], result: { winner: 0, reason: 'acu' }, stats: { apm: 120, units: -3 }, extra: { scenario: 'fuzz' } },
    extraChunks: [{ id: 'XTRA', data: new Uint8Array([9, 8, 7]) }],
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Tally {
  cases: number;
  ok: number;
  codes: Record<string, number>;
}

/** The fuzz property for one input (strict reader, and the tolerant head reader). */
function check(bytes: Uint8Array, t: Tally): void {
  t.cases++;
  try {
    // Tolerant head reader: a result or a FormatError, nothing else; for a strictly readable file
    // it must agree with the strict HEAD.
    let info: ReturnType<typeof readRtsReplayHead> | null = null;
    try {
      info = readRtsReplayHead(bytes);
    } catch (e) {
      if (!(e instanceof FormatError)) throw new Error(`non-FormatError escaped readRtsReplayHead: ${(e as Error).stack ?? String(e)}`, { cause: e });
    }
    const r = readRtsReplay(bytes);
    const cmds = readAllCommands(r);
    let perBlock = 0;
    for (const b of r.blocks) expect(b.rawLength).toBeLessThanOrEqual(MAX_CMDS_BLOCK_BYTES);
    for (const c of cmds) perBlock = Math.max(perBlock, c.batch.length);
    expect(perBlock).toBeLessThanOrEqual(MAX_CMDS_BLOCK_BYTES);
    expect(bytesEqual(rewriteRtsReplay(r), bytes)).toBe(true);
    expect(info).not.toBeNull();
    expect(info!.simBuild).toBe(r.head.simBuild);
    expect(info!.buildHash).toBe(r.head.buildHash);
    expect(info!.protocolVersion).toBe(r.head.protocolVersion);
    expect(replayFormatIncompatibility(info!)).toBeNull();
    t.ok++;
  } catch (e) {
    if (!(e instanceof FormatError)) {
      throw new Error(`non-FormatError escaped: ${(e as Error).stack ?? String(e)}`, { cause: e });
    }
    t.codes[e.code] = (t.codes[e.code] ?? 0) + 1;
  }
}

function chunksOf(bytes: Uint8Array): ContainerChunk[] {
  return readContainer(bytes, RTSREPLAY_MAGIC).chunks.map((c) => ({ id: c.id, data: c.data.slice() }));
}

function rebuild(chunks: readonly ContainerChunk[], version = RTSREPLAY_FORMAT_VERSION): Uint8Array {
  return writeContainer(RTSREPLAY_MAGIC, version, chunks);
}

const BASES: readonly Uint8Array[] = [writeRtsReplay(baseInput(1, 700)), writeRtsReplay(baseInput(2, 1900)), writeRtsReplay({ ...baseInput(3, 300), meta: null, extraChunks: [] })];

describe('.rtsreplay fuzz', () => {
  it('only FormatError or a byte-identical rewrite (≥ 10,000 mutations)', () => {
    const r = rngOf(0xf022);
    const t: Tally = { cases: 0, ok: 0, codes: {} };
    const started = Date.now();
    for (const base of BASES) {
      check(base, t);
      const chunks = chunksOf(base);
      const pickChunk = (): number => r() % chunks.length;

      // 1. Raw bit flips anywhere (mostly caught by the container CRC).
      for (let i = 0; i < 700; i++) {
        const b = base.slice();
        for (let k = 1 + (r() % 4); k > 0; k--) b[r() % b.length]! ^= 1 << (r() % 8);
        check(b, t);
      }
      // 2. Truncation and extension.
      for (let i = 0; i < 300; i++) check(base.subarray(0, r() % base.length), t);
      for (let i = 0; i < 100; i++) {
        const b = new Uint8Array(base.length + 1 + (r() % 64));
        b.set(base);
        for (let k = base.length; k < b.length; k++) b[k] = r() & 0xff;
        check(b, t);
      }
      // 3. Structurally valid containers (correct CRC) with flipped bits in one chunk's data.
      for (let i = 0; i < 1200; i++) {
        const cs = chunks.map((c) => ({ id: c.id, data: c.data }));
        const j = pickChunk();
        const d = cs[j]!.data.slice();
        if (d.length > 0) for (let k = 1 + (r() % 3); k > 0; k--) d[r() % d.length]! ^= 1 << (r() % 8);
        cs[j] = { id: cs[j]!.id, data: d };
        check(rebuild(cs), t);
      }
      // 4. Garbage payloads (random bytes, random length) in every chunk type, keeping or not
      //    keeping the chunk version prefix.
      for (let i = 0; i < 600; i++) {
        const cs = chunks.map((c) => ({ id: c.id, data: c.data }));
        const j = pickChunk();
        const n = r() % 3 === 0 ? r() % 8 : r() % 300;
        const d = new Uint8Array(n);
        for (let k = 0; k < n; k++) d[k] = r() & 0xff;
        if (n >= 2 && r() % 2 === 0) {
          d[0] = 1;
          d[1] = 0;
        }
        if (cs[j]!.id === 'CMDS' && n >= 16 && r() % 2 === 0) d.set(cs[j]!.data.subarray(0, 16));
        cs[j] = { id: cs[j]!.id, data: d };
        check(rebuild(cs), t);
      }
      // 5. Chunk data truncated / extended with a valid CRC.
      for (let i = 0; i < 400; i++) {
        const cs = chunks.map((c) => ({ id: c.id, data: c.data }));
        const j = pickChunk();
        const src = cs[j]!.data;
        let d: Uint8Array;
        if (r() % 2 === 0) d = src.subarray(0, src.length === 0 ? 0 : r() % src.length);
        else {
          d = new Uint8Array(src.length + 1 + (r() % 16));
          d.set(src);
          for (let k = src.length; k < d.length; k++) d[k] = r() & 0xff;
        }
        cs[j] = { id: cs[j]!.id, data: d };
        check(rebuild(cs), t);
      }
      // 6. CMDS header fields: wrong raw length / entry count / codec / first tick, huge lengths.
      const cmdsIdx = chunks.map((c, i) => (c.id === 'CMDS' ? i : -1)).filter((i) => i >= 0);
      for (let i = 0; i < 500; i++) {
        const cs = chunks.map((c) => ({ id: c.id, data: c.data }));
        const j = cmdsIdx[r() % cmdsIdx.length]!;
        const d = cs[j]!.data.slice();
        const dv = new DataView(d.buffer);
        switch (r() % 6) {
          case 0:
            dv.setUint32(12, dv.getUint32(12, true) + (r() % 9) - 4, true);
            break;
          case 1:
            dv.setUint32(8, dv.getUint32(8, true) + (r() % 5) - 2, true);
            break;
          case 2:
            dv.setUint32(12, [0xffffffff, MAX_CMDS_BLOCK_BYTES, MAX_CMDS_BLOCK_BYTES + 1, 0x7fffffff][r() % 4]!, true);
            d[2] = r() % 2;
            break;
          case 3:
            d[2] = r() & 0xff;
            break;
          case 4:
            dv.setUint32(4, r() % 3 === 0 ? r() >>> 0 : dv.getUint32(4, true) + 600, true);
            break;
          default:
            dv.setUint32(8, r() % 2 === 0 ? 0xffffffff : 600, true);
            break;
        }
        cs[j] = { id: 'CMDS', data: d };
        check(rebuild(cs), t);
      }
      // 6b. Range coded block data: flipped bits and garbage behind a consistent stored header
      //     (codec 0, rawLength = payload length) — exercises the symbol decoder itself.
      for (let i = 0; i < 1500; i++) {
        const cs = chunks.map((c) => ({ id: c.id, data: c.data }));
        const j = cmdsIdx[r() % cmdsIdx.length]!;
        const src = cs[j]!.data;
        let d: Uint8Array;
        if (i % 3 !== 2 && src.length > 16) {
          d = src.slice();
          for (let k = 1 + (r() % 3); k > 0; k--) d[16 + (r() % (d.length - 16))]! ^= 1 << (r() % 8);
        } else {
          const n = 5 + (r() % 600);
          d = new Uint8Array(16 + n);
          d.set(src.subarray(0, 16));
          for (let k = 17; k < d.length; k++) d[k] = r() & 0xff;
          const dv = new DataView(d.buffer);
          dv.setUint32(8, 1 + (r() % 600), true);
          dv.setUint32(12, n, true);
        }
        d[2] = CmdsCodec.Stored;
        cs[j] = { id: 'CMDS', data: d };
        check(rebuild(cs), t);
      }
      // 7. Chunk-level shuffles: delete, duplicate, swap, insert unknown chunks.
      for (let i = 0; i < 300; i++) {
        const cs = chunks.map((c) => ({ id: c.id, data: c.data }));
        const a = pickChunk();
        const b = pickChunk();
        switch (r() % 4) {
          case 0:
            cs.splice(a, 1);
            break;
          case 1:
            cs.splice(b, 0, cs[a]!);
            break;
          case 2:
            [cs[a], cs[b]] = [cs[b]!, cs[a]!];
            break;
          default:
            cs.splice(b, 0, { id: 'Q' + String.fromCharCode(0x41 + (r() % 26)) + 'ZZ', data: new Uint8Array(r() % 9) });
            break;
        }
        check(rebuild(cs, r() % 20 === 0 ? 2 : RTSREPLAY_FORMAT_VERSION), t);
      }
    }
    // 8. Deflate bombs and compressed garbage in CMDS blocks.
    const zeros = deflateRaw(new Uint8Array(32 * 1024 * 1024), 9);
    const cs0 = chunksOf(BASES[1]!);
    const cmdsAt = cs0.findIndex((c) => c.id === 'CMDS');
    for (let i = 0; i < 40; i++) {
      const cs = cs0.map((c) => ({ id: c.id, data: c.data }));
      const garbage = new Uint8Array(1 + (r() % 2000));
      for (let k = 0; k < garbage.length; k++) garbage[k] = r() & 0xff;
      const z = i < 6 ? zeros : i < 20 ? deflateRaw(garbage) : garbage;
      const d = new Uint8Array(16 + z.length);
      d.set(cs[cmdsAt]!.data.subarray(0, 16));
      d[2] = CmdsCodec.DeflateRaw;
      const dv = new DataView(d.buffer);
      dv.setUint32(12, i < 6 ? [1, 1024, MAX_CMDS_BLOCK_BYTES, 4096, 65536, 1 << 20][i]! : i < 20 ? garbage.length : 1 + (r() % 100000), true);
      if (dv.getUint32(8, true) === 0) dv.setUint32(8, 1, true);
      d.set(z, 16);
      cs[cmdsAt] = { id: 'CMDS', data: d };
      check(rebuild(cs), t);
    }
    const ms = Date.now() - started;
    // Summary for the status fragment (visible with --reporter=verbose / on failure).
    console.log(`rtsreplay fuzz: ${t.cases} cases, ${t.ok} readable, ${ms} ms, codes ${JSON.stringify(t.codes)}`);
    expect(t.cases).toBeGreaterThanOrEqual(10_000);
    expect(ms).toBeLessThan(60_000);
    // The mutations must reach the chunk decoders, not only the CRC check.
    for (const code of ['bad-crc', 'bad-value', 'truncated', 'too-large', 'bad-compression', 'missing-chunk', 'duplicate-chunk', 'chunk-order', 'unsupported-version', 'non-canonical']) {
      expect(t.codes[code] ?? 0, code).toBeGreaterThan(0);
    }
    expect(t.ok).toBeGreaterThan(0);
  }, 90_000);
});
