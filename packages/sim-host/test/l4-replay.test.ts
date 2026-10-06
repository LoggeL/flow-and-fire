/**
 * L4 (PLAN §3.12): record → replay gives the same hash chain; arena restore in the middle of a
 * game gives the same end hashes; keyframe seek + re-simulation equals the direct run.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { unitCount } from '@faf/sim';
import {
  CommandLogError,
  HeadlessSim,
  KeyframeStore,
  LOG_ENTRY_HEADER_BYTES,
  LogEntryKind,
  MarkKind,
  parseCommandLog,
  replayLog,
  ReplaySource,
  entryCheck,
} from '../src/index.ts';
import { gameSimBin, runScenario } from './support/fixtures.ts';

const TICKS = 2000;
const SEED = 0x5eed1234;

interface Direct {
  sim: HeadlessSim;
  chain: number[];
  full: Map<number, number>;
  rule: Map<number, number>;
  snap1000: Uint8Array;
  log: Uint8Array;
}

let table: SimBpTable;
let direct: Direct;

function fresh(options: Partial<ConstructorParameters<typeof HeadlessSim>[0]> = {}): HeadlessSim {
  return new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, buildHash: 'test-build', ...options });
}

beforeAll(() => {
  table = decodeSimBin(gameSimBin());
  const sim = fresh();
  const full = new Map<number, number>();
  const rule = new Map<number, number>();
  let snap1000: Uint8Array = new Uint8Array(0);
  runScenario(sim, TICKS, (t) => {
    if (t % 100 === 0) {
      full.set(t, sim.fullHash());
      rule.set(t, sim.ruleHash());
    }
    if (t === 1000) snap1000 = sim.snapshot();
  });
  direct = { sim, chain: sim.hashChain(), full, rule, snap1000, log: sim.exportLog() };
}, 180_000);

describe('L4 log replay', { timeout: 180_000 }, () => {
  it('the direct run is a real 1,000-cube game with 200 hashes', () => {
    expect(direct.chain).toHaveLength(TICKS / 10);
    expect(new Set(direct.chain).size).toBeGreaterThan(150);
    expect(unitCount(direct.sim.world)).toBeGreaterThan(900);
    const log = parseCommandLog(direct.log);
    expect(log.endTick).toBe(TICKS);
    expect(log.hashes.map((h) => h.hash)).toEqual(direct.chain);
    expect(log.commands.map((c) => c.tick)).toEqual([1, 5, 137, 300, 555, 700, 1001, 1100, 1333, 1500, 1777]);
    expect(log.tainted).toBe(true); // cheat spawns
    expect(log.marks.filter((m) => m.kind === MarkKind.Cheat).map((m) => m.tick)).toEqual([1, 700, 1777]);
  });

  it('replaying the command log gives the identical hash chain and end hashes', () => {
    const r = replayLog(direct.log, { bpTable: table });
    expect(r.lastTick).toBe(TICKS);
    expect(r.compared).toBe(200);
    expect(r.mismatches).toEqual([]);
    expect(r.trail.map((e) => e.hash)).toEqual(direct.chain);
    expect(r.ruleHash).toBe(direct.rule.get(TICKS));
    expect(r.fullHash).toBe(direct.full.get(TICKS));
    // Re-recording the replay reproduces the command and hash entries byte for byte.
    const again = parseCommandLog(r.sim.exportLog());
    const orig = parseCommandLog(direct.log);
    const cmds = (l: typeof orig): Uint8Array[] => l.commands.map((c) => l.bytes.slice(c.offset, c.offset + c.length));
    expect(cmds(again)).toEqual(cmds(orig));
    expect(again.hashes).toEqual(orig.hashes);
  });

  it('works with an explicit ReplaySource and sim.bin bytes', () => {
    const src = new ReplaySource(parseCommandLog(direct.log));
    const sim = new HeadlessSim({ simBin: gameSimBin(), seed: SEED, armyCount: 2, sources: [src], record: false, keyframes: false });
    sim.runUntil(TICKS);
    expect(sim.hashChain()).toEqual(direct.chain);
    expect(() => sim.submit(new Uint8Array([1, 0, 0]))).toThrow(/custom sources/);
  });

  it('detects a desync: a tampered command changes the hashes from its tick on', () => {
    const bytes = direct.log.slice();
    const log = parseCommandLog(bytes);
    const e = log.commands.find((c) => c.tick === 1100)!;
    // Move target x of the first envelope: payload starts after 13 + 4·units + 2 bytes.
    const dv = new DataView(bytes.buffer);
    const units = dv.getUint16(e.offset + 3 + 9, true);
    const px = e.offset + 3 + 11 + units * 4 + 2;
    dv.setInt32(px, dv.getInt32(px, true) + 4096 * 20, true);
    // Fix the entry check so the parser accepts the entry (an honest-looking but different log).
    const h = e.offset - LOG_ENTRY_HEADER_BYTES;
    dv.setUint32(h + 12, entryCheck(LogEntryKind.Cmds, 0, 0, 1100, bytes, e.offset, e.length), true);
    const r = replayLog(bytes, { bpTable: table });
    expect(r.mismatches.length).toBeGreaterThan(0);
    expect(r.mismatches[0]!.tick).toBe(1100);
    expect(r.trail.slice(0, 109).map((t) => t.hash)).toEqual(direct.chain.slice(0, 109));
  });

  it('rejects a log of another sim (seed ok, blueprints differ)', () => {
    const bytes = direct.log.slice();
    new DataView(bytes.buffer).setUint32(8, 0x1234, true); // simId
    expect(() => replayLog(bytes, { bpTable: table })).toThrow(CommandLogError);
  });
});

describe('L4 arena restore', { timeout: 180_000 }, () => {
  it('restore of the tick-1000 snapshot into a fresh sim ⇒ same rule and full hash at 2000', () => {
    const src = new ReplaySource(parseCommandLog(direct.log));
    const sim = fresh({ sources: [src] });
    sim.restore(direct.snap1000);
    expect(sim.tick).toBe(1000);
    expect(sim.fullHash()).toBe(direct.full.get(1000));
    sim.runUntil(TICKS);
    expect(sim.ruleHash()).toBe(direct.rule.get(TICKS));
    expect(sim.fullHash()).toBe(direct.full.get(TICKS));
    expect(sim.hashChain()).toEqual(direct.chain.slice(100));
    // The restore is marked in the log (taint).
    expect(parseCommandLog(sim.exportLog()).marks.some((m) => m.kind === MarkKind.Restore && m.tick === 1000)).toBe(true);
  });

  it('restore into the diverged original sim ⇒ same hashes (timeline branch)', () => {
    const sim = fresh();
    runScenario(sim, 1000);
    const snap = sim.snapshot();
    runScenario(sim, 1400);
    sim.restore(snap);
    expect(sim.tick).toBe(1000);
    expect(sim.hashTrail().at(-1)!.tick).toBe(1000);
    runScenario(sim, TICKS);
    expect(sim.ruleHash()).toBe(direct.rule.get(TICKS));
    expect(sim.fullHash()).toBe(direct.full.get(TICKS));
    expect(sim.hashChain()).toEqual(direct.chain);
    // The branch's log: entries after 1000 were dropped before the continuation was recorded.
    const log = parseCommandLog(sim.exportLog());
    expect(log.hashes.map((h) => h.hash)).toEqual(direct.chain);
  });
});

describe('keyframes: seek + re-simulation == direct run', { timeout: 180_000 }, () => {
  it('seeks backward and forward within the recorded timeline', () => {
    const sim = fresh();
    runScenario(sim, TICKS);
    const kf = sim.keyframes!;
    expect(Array.from({ length: kf.count }, (_, i) => kf.tickAt(i))).toEqual([0, 600, 1200, 1800]);
    for (const t of [1000, 300, 1900, 600, 1500, 100]) {
      sim.seek(t);
      expect(sim.tick).toBe(t);
      expect(sim.fullHash()).toBe(direct.full.get(t));
      expect(sim.ruleHash()).toBe(direct.rule.get(t));
    }
    expect(sim.mismatches).toEqual([]);
    // After a seek the recorded timeline is re-simulated up to its end, then it is live again.
    expect(sim.core.replaying).toBe(true);
    expect(() => sim.submit([])).toThrow(/re-simulating/);
    sim.runUntil(TICKS);
    expect(sim.core.replaying).toBe(false);
    expect(sim.fullHash()).toBe(direct.full.get(TICKS));
    expect(sim.hashChain()).toEqual(direct.chain);
    expect(sim.mismatches).toEqual([]);
    runScenario(sim, TICKS + 50);
    expect(sim.tick).toBe(TICKS + 50);
    expect(() => sim.seek(TICKS + 51)).toThrow(RangeError);
  });

  it('keyframe store stays within its byte budget by thinning out', () => {
    const sim = fresh({ keyframes: false });
    const store = new KeyframeStore(sim.world.snapshotByteLength, { intervalTicks: 10, maxBytes: sim.world.snapshotByteLength * 4 });
    expect(store.capacity).toBe(4);
    store.capture(sim.world);
    runScenario(sim, 60);
    const seen: number[] = [];
    for (let t = 61; t <= 400; t++) {
      runScenario(sim, t);
      if (store.maybeCapture(sim.world)) seen.push(t);
      expect(store.byteLength).toBeLessThanOrEqual(store.snapshotBytes * store.capacity);
    }
    expect(store.thinnings).toBeGreaterThan(0);
    expect(store.tickAt(0)).toBe(0);
    expect(store.intervalTicks).toBeGreaterThan(10);
    // Every kept keyframe restores to the right state.
    const probe = fresh({ keyframes: false });
    const i = store.latestAtOrBefore(250);
    const t = store.tickAt(i);
    runScenario(probe, t);
    const expected = probe.fullHash();
    store.restoreInto(probe.world, i);
    expect(probe.fullHash()).toBe(expected);
    store.discardAfter(t - 1);
    expect(store.latestAtOrBefore(10_000)).toBe(i - 1);
    expect(seen.length).toBeGreaterThan(3);
  });
});
