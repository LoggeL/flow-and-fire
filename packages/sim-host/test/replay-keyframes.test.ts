/**
 * Compressed arena keyframes (PLAN §3.11 "Seek"): restore from a compressed keyframe and
 * re-simulation equals the direct run (rule and full hash), compression rate, adaptive thinning
 * under a small budget, timeline branches (discardAfter), the asynchronous native path and
 * foreign-session snapshots.
 */
import { Buffer } from 'node:buffer';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { deflateRaw, FormatError, inflateRaw } from '@faf/formats';
import { unitCount, unitHandles, type World } from '@faf/sim';
import type { CommandEnvelope } from '@faf/protocol';
import {
  CompressedKeyframeStore,
  DEFAULT_KEYFRAME_LEVEL,
  deflateRawNative,
  hasNativeDeflate,
  HeadlessSim,
  inflateRawNative,
  SnapshotError,
} from '../src/index.ts';
import { gameSimBin, hollowRidgeBytes, moveCmd, runScenario, spawnCmd } from './support/fixtures.ts';

const TICKS = 2000;
const SEED = 0x6b66c0de;

let table: SimBpTable;
let ridge: Uint8Array;

/** hollow-ridge load: 2 × 500 cubes on the NW side of the river, group moves every 150 ticks. */
function ridgeCommands(w: World, tick: number): CommandEnvelope[] {
  const seq = (tick * 4) & 0xffff;
  if (tick === 1) return [spawnCmd(0, 500, 120, 140, 50, seq), spawnCmd(1, 500, 175, 160, 50, seq + 1)];
  if (tick !== 2 && tick % 150 !== 0) return [];
  const out: CommandEnvelope[] = [];
  for (let army = 0; army < 2; army++) {
    const hs = unitHandles(w, army);
    const per = Math.ceil(hs.length / 4);
    for (let g = 0; g < 4; g++) {
      const a = Math.imul(tick * 8 + army * 4 + g + 1, 0x9e3779b1) >>> 0;
      out.push(moveCmd(army, hs.slice(g * per, (g + 1) * per), 40 + (a % 160), 40 + ((a >>> 12) % 160), (seq + 2 + army * 4 + g) & 0xffff));
    }
  }
  return out;
}

function runRidge(sim: HeadlessSim, untilTick: number, onTick?: (tick: number) => void): void {
  while (sim.tick < untilTick) {
    const t = sim.tick + 1;
    const cmds = ridgeCommands(sim.world, t);
    if (cmds.length > 0) sim.submit(cmds);
    sim.step(1);
    onTick?.(t);
  }
}

type Drive = (sim: HeadlessSim, untilTick: number, onTick?: (tick: number) => void) => void;

interface MapCase {
  readonly name: string;
  readonly map: () => Uint8Array | undefined;
  readonly drive: Drive;
}

const CASES: readonly MapCase[] = [
  { name: 'test plane', map: () => undefined, drive: runScenario },
  { name: 'hollow-ridge', map: () => ridge, drive: runRidge },
];

function fresh(map: Uint8Array | undefined): HeadlessSim {
  return new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, record: false, keyframes: false, ...(map !== undefined ? { map } : {}) });
}

beforeAll(() => {
  table = decodeSimBin(gameSimBin());
  ridge = hollowRidgeBytes();
});

describe.each(CASES)('compressed keyframes on the $name', ({ map, drive }) => {
  let store: CompressedKeyframeStore;
  let rule2000 = 0;
  let full2000 = 0;
  let units = 0;

  beforeAll(() => {
    const sim = fresh(map());
    store = new CompressedKeyframeStore(sim.core.snapshotByteLength);
    expect(store.maybeCapture(sim.core)).toBe(true); // tick 0
    drive(sim, TICKS, () => store.maybeCapture(sim.core));
    rule2000 = sim.ruleHash();
    full2000 = sim.fullHash();
    units = unitCount(sim.world);
  });

  it('captures every 600 ticks and keeps them compressed', () => {
    expect(units).toBeGreaterThanOrEqual(950);
    expect(store.intervalTicks).toBe(600);
    expect(store.thinnings).toBe(0);
    expect(Array.from({ length: store.count }, (_, i) => store.tickAt(i))).toEqual([0, 600, 1200, 1800]);
    expect(store.indexOf(1200)).toBe(2);
    expect(store.indexOf(1201)).toBe(-1);
    expect(store.latestAtOrBefore(1799)).toBe(2);
    expect(store.latestAtOrBefore(-1)).toBe(-1);
    expect(store.rawByteLength).toBe(4 * store.snapshotByteLength);
    let sum = 0;
    for (let i = 0; i < store.count; i++) sum += store.bytesAt(i).length;
    expect(store.byteLength).toBe(sum);
    // ~1,000 units: every keyframe < 10 % of the raw session snapshot.
    for (let i = 1; i < store.count; i++) expect(store.bytesAt(i).length).toBeLessThan(store.snapshotByteLength / 10);
    expect(store.byteLength).toBeLessThan(store.rawByteLength / 10);
  });

  it('restoring keyframe 1,200 and re-simulating gives the direct run’s rule and full hash at 2,000', () => {
    const b = fresh(map());
    expect(store.restoreInto(b.core, store.indexOf(1200))).toBe(1200);
    expect(b.tick).toBe(1200);
    drive(b, TICKS);
    expect(b.ruleHash()).toBe(rule2000);
    expect(b.fullHash()).toBe(full2000);
  });

  it('seeking backwards in a running sim (restore 600) re-simulates to the same end state', async () => {
    const c = fresh(map());
    drive(c, 1500);
    expect(await store.restoreIntoAsync(c.core, store.indexOf(600))).toBe(600);
    expect(c.tick).toBe(600);
    drive(c, TICKS);
    expect(c.ruleHash()).toBe(rule2000);
    expect(c.fullHash()).toBe(full2000);
  });
});

describe('adaptive budget', () => {
  it('thins out (interval doubles, first keyframe stays) and still covers the whole game', () => {
    const probe = fresh(undefined);
    runScenario(probe, 600);
    const one = deflateRaw(probe.snapshot(), DEFAULT_KEYFRAME_LEVEL).length;
    const budget = Math.floor(one * 3.5); // ≈ 3 keyframes

    const sim = fresh(undefined);
    const store = new CompressedKeyframeStore(sim.core.snapshotByteLength, { intervalTicks: 100, maxBytes: budget });
    store.maybeCapture(sim.core);
    let maxHeld = 0;
    let lastThinnings = 0;
    runScenario(sim, TICKS, (t) => {
      store.maybeCapture(sim.core);
      maxHeld = Math.max(maxHeld, store.byteLength);
      if (store.thinnings !== lastThinnings) {
        lastThinnings = store.thinnings;
        // Coverage: after every thinning the newest keyframe is less than one interval behind.
        expect(t - store.tickAt(store.count - 1)).toBeLessThan(store.intervalTicks);
      }
    });
    expect(store.thinnings).toBeGreaterThanOrEqual(2);
    expect(store.intervalTicks).toBe(100 * 2 ** store.thinnings);
    expect(maxHeld).toBeLessThanOrEqual(budget);
    expect(store.tickAt(0)).toBe(0);
    const ticks = Array.from({ length: store.count }, (_, i) => store.tickAt(i));
    for (const t of ticks) expect(t % store.intervalTicks).toBe(0);
    expect(TICKS - ticks[ticks.length - 1]!).toBeLessThan(store.intervalTicks);
    expect(store.count).toBeLessThanOrEqual(4);

    // The newest keyframe still restores to the direct run.
    const direct = fresh(undefined);
    runScenario(direct, TICKS);
    const b = fresh(undefined);
    store.restoreInto(b.core, store.count - 1);
    runScenario(b, TICKS);
    expect(b.ruleHash()).toBe(direct.ruleHash());
    expect(b.fullHash()).toBe(direct.fullHash());
  });

  it('never drops below two keyframes when a single one exceeds the budget', () => {
    const sim = fresh(undefined);
    runScenario(sim, 50);
    const store = new CompressedKeyframeStore(sim.core.snapshotByteLength, { intervalTicks: 10, maxBytes: 16 });
    for (let t = 50; t <= 200; t++) {
      store.maybeCapture(sim.core);
      runScenario(sim, t + 1);
    }
    expect(store.count).toBe(2);
    expect(store.tickAt(0)).toBe(50);
    expect(store.thinnings).toBeGreaterThan(0);
  });
});

describe('timeline and capture paths', () => {
  let sim: HeadlessSim;
  let store: CompressedKeyframeStore;

  beforeAll(() => {
    sim = fresh(undefined);
    store = new CompressedKeyframeStore(sim.core.snapshotByteLength);
    store.maybeCapture(sim.core);
    runScenario(sim, 1300, () => store.maybeCapture(sim.core));
  });

  it('discardAfter drops later keyframes; re-simulating captures identical bytes again', () => {
    expect(store.count).toBe(3);
    const kf1200 = store.bytesAt(2).slice();
    const before = store.byteLength;
    store.discardAfter(1000);
    expect(store.count).toBe(2);
    expect(store.byteLength).toBe(before - kf1200.length);
    expect(store.latestAtOrBefore(1300)).toBe(1);
    store.restoreInto(sim.core, 1);
    expect(sim.tick).toBe(600);
    runScenario(sim, 1300, () => store.maybeCapture(sim.core));
    expect(store.count).toBe(3);
    expect(Buffer.compare(store.bytesAt(2), kf1200), 'recaptured tick-1200 keyframe bytes').toBe(0); // deterministic state + canonical fflate bytes
  });

  it('inserts keyframes captured out of order (replay re-simulation) without dropping later ones', () => {
    const s = new CompressedKeyframeStore(sim.core.snapshotByteLength);
    for (const i of [0, 2]) expect(s.captureBytes(store.tickAt(i), store.bytesAt(i), store.snapshotByteLength)).toBe(true);
    expect(s.captureBytes(store.tickAt(1), store.bytesAt(1), store.snapshotByteLength)).toBe(true);
    expect(s.captureBytes(store.tickAt(1), store.bytesAt(1), store.snapshotByteLength)).toBe(false);
    expect([s.tickAt(0), s.tickAt(1), s.tickAt(2)]).toEqual([0, 600, 1200]);
    expect(() => s.captureBytes(1800, store.bytesAt(1), store.snapshotByteLength - 1)).toThrow(RangeError);
    // A view into a larger buffer is copied (the store never pins foreign memory).
    const big = new Uint8Array(store.bytesAt(1).length + 100);
    big.set(store.bytesAt(1), 50);
    s.captureBytes(1800, big.subarray(50, 50 + store.bytesAt(1).length), store.snapshotByteLength);
    expect(s.bytesAt(3).buffer).not.toBe(big.buffer);
    expect(Buffer.compare(s.bytesAt(3), store.bytesAt(1)), 'copied keyframe view bytes').toBe(0);
  });

  it('captureAsync (native CompressionStream) restores to the same hashes as the synchronous path', async () => {
    expect(hasNativeDeflate()).toBe(true); // Node 24
    const tick = sim.tick;
    const rule = sim.ruleHash();
    const full = sim.fullHash();
    const syncStore = new CompressedKeyframeStore(sim.core.snapshotByteLength);
    const asyncStore = new CompressedKeyframeStore(sim.core.snapshotByteLength);
    expect(syncStore.capture(sim.core)).toBe(true);
    const pending = asyncStore.captureAsync(sim.core);
    expect(asyncStore.pendingCount).toBe(1);
    expect(asyncStore.isDue(tick)).toBe(false);
    expect(await asyncStore.captureAsync(sim.core)).toBe(false); // same tick already in flight
    runScenario(sim, tick + 20); // the core ticks on while the compressor runs
    expect(await pending).toBe(true);
    expect(asyncStore.pendingCount).toBe(0);
    expect(asyncStore.tickAt(0)).toBe(tick);

    for (const s of [syncStore, asyncStore]) {
      const b = fresh(undefined);
      s.restoreInto(b.core, 0);
      expect(b.tick).toBe(tick);
      expect(b.ruleHash()).toBe(rule);
      expect(b.fullHash()).toBe(full);
    }
    // Cross-decoding: fflate reads the native stream and the native decoder reads fflate's.
    const nativeBytes = asyncStore.bytesAt(0);
    const fflateBytes = syncStore.bytesAt(0);
    expect(Buffer.compare(inflateRaw(nativeBytes, asyncStore.snapshotByteLength), await inflateRawNative(fflateBytes, syncStore.snapshotByteLength)), 'native/fflate cross-decoded snapshot bytes').toBe(0);
  });

  it('an async capture whose tick left the timeline meanwhile is dropped', async () => {
    const s = new CompressedKeyframeStore(sim.core.snapshotByteLength);
    const p = s.captureAsync(sim.core);
    s.discardAfter(sim.tick - 1);
    expect(await p).toBe(false);
    expect(s.count).toBe(0);
    // Keyframes at or before the discard point survive.
    const q = s.captureAsync(sim.core);
    s.discardAfter(sim.tick);
    expect(await q).toBe(true);
    expect(s.count).toBe(1);
    expect(s.maybeCaptureAsync(sim.core)).toBeNull(); // already held
  });

  it('a snapshot of another session is refused with SnapshotError', () => {
    const other = fresh(ridge);
    runRidge(other, 30);
    const s = new CompressedKeyframeStore(other.core.snapshotByteLength);
    s.capture(other.core);
    const plane = fresh(undefined);
    runScenario(plane, 30);
    const h = plane.fullHash();
    expect(() => s.restoreInto(plane.core, 0)).toThrow(SnapshotError);
    expect(plane.fullHash()).toBe(h); // nothing was written
    expect(plane.tick).toBe(30);
  });
});

describe('native deflate helpers', () => {
  it('round-trip and read fflate output', async () => {
    const data = new Uint8Array(300_000);
    for (let i = 0; i < data.length; i++) data[i] = (i % 251) ^ ((i >>> 10) & 0xff);
    const native = await deflateRawNative(data);
    expect(native.length).toBeLessThan(data.length / 5);
    expect(Buffer.compare(await inflateRawNative(native, data.length), data), 'native deflate/native inflate bytes').toBe(0);
    expect(Buffer.compare(inflateRaw(native, data.length), data), 'native deflate/fflate inflate bytes').toBe(0);
    expect(Buffer.compare(await inflateRawNative(deflateRaw(data), data.length), data), 'fflate deflate/native inflate bytes').toBe(0);
    expect(Buffer.compare(await inflateRawNative(await deflateRawNative(new Uint8Array(0)), 0), new Uint8Array(0)), 'empty native roundtrip bytes').toBe(0);
  });

  it('reports bad data, wrong lengths and bombs as FormatError', async () => {
    const data = new Uint8Array(50_000).fill(7);
    const z = await deflateRawNative(data);
    const codeOf = async (p: Promise<unknown>): Promise<string> => {
      try {
        await p;
        return 'ok';
      } catch (e) {
        expect(e).toBeInstanceOf(FormatError);
        return (e as FormatError).code;
      }
    };
    expect(await codeOf(inflateRawNative(z, data.length + 1))).toBe('bad-compression');
    expect(await codeOf(inflateRawNative(z, data.length - 1))).toBe('bad-compression');
    expect(await codeOf(inflateRawNative(z.subarray(0, z.length >> 1), data.length))).toBe('bad-compression');
    expect(await codeOf(inflateRawNative(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 10))).toBe('bad-compression');
    expect(await codeOf(inflateRawNative(new Uint8Array(0), 0))).toBe('bad-compression');
    expect(await codeOf(inflateRawNative(z, 1000, 999))).toBe('too-large');
    expect(await codeOf(inflateRawNative(z, 1.5))).toBe('bad-value');
    // Deflate bomb: 64 MiB of zeros declared as 1 KiB → cancelled at the first overflowing chunk.
    const bomb = deflateRaw(new Uint8Array(64 * 1024 * 1024));
    expect(await codeOf(inflateRawNative(bomb, 1024))).toBe('bad-compression');
    // Random corruption never escapes as anything but FormatError.
    let seed = 12345;
    for (let k = 0; k < 50; k++) {
      const c = z.slice();
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const at = seed % c.length;
      c[at] = c[at]! ^ (1 << (seed >>> 29));
      const code = await codeOf(inflateRawNative(c, data.length));
      expect(['ok', 'bad-compression']).toContain(code);
    }
  });
});
