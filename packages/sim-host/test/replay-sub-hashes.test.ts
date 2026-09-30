/**
 * Sub-hashes (PLAN §3.11 HASH chunk): one hash per rule region, names = the arena's dynamic,
 * non-derived regions in registration order; a column change touches exactly its region's hash;
 * snapshot/restore reproduces them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { handleIndex, XxHash32 } from '@faf/fixed';
import { unitHandles } from '@faf/sim';
import { computeSubHashes, HeadlessSim, ruleRegionNames, SNAPSHOT_HEADER_BYTES, subHashCount } from '../src/index.ts';
import { gameSimBin, runScenario } from './support/fixtures.ts';

let table: SimBpTable;
let sim: HeadlessSim;
const hasher = new XxHash32();

function subHashes(s: HeadlessSim): Uint32Array {
  const out = new Uint32Array(subHashCount(s.world));
  computeSubHashes(s.world, out, hasher);
  return out;
}

beforeAll(() => {
  table = decodeSimBin(gameSimBin());
  sim = new HeadlessSim({ bpTable: table, seed: 0x5b5b0001, armyCount: 2, record: false, keyframes: false });
  runScenario(sim, 400);
});

describe('sub-hashes', () => {
  it('names are the dynamic, non-derived arena regions in registration order', () => {
    const expected = sim.world.arena.regions.filter((r) => r.area === 'dynamic' && !r.derived).map((r) => r.name);
    const names = ruleRegionNames(sim.world);
    expect(names).toEqual(expected);
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(names).toContain('units');
    expect(names).toContain('movers');
    expect(subHashCount(sim.world)).toBe(names.length);
    // Derived regions (spatial grid, last-hash record) are not part of the rule state.
    const derived = sim.world.arena.regions.filter((r) => r.derived).map((r) => r.name);
    for (const d of derived) expect(names).not.toContain(d);
  });

  it('are stable, allocation-free per call and differ between regions', () => {
    const a = subHashes(sim);
    const b = new Uint32Array(a.length + 3).fill(0xdeadbeef);
    computeSubHashes(sim.world, b, hasher);
    expect(Array.from(b.subarray(0, a.length))).toEqual(Array.from(a));
    expect(b[a.length]).toBe(0xdeadbeef); // only the first `regions` slots are written
    expect(new Set(a).size).toBe(a.length);
    expect(() => computeSubHashes(sim.world, new Uint32Array(a.length - 1), hasher)).toThrow(RangeError);
  });

  it('a column change changes exactly the sub-hash of its region', () => {
    const names = ruleRegionNames(sim.world);
    const before = subHashes(sim);
    const snap = sim.snapshot();
    const slot = handleIndex(unitHandles(sim.world, 0)[5]!);

    const check = (region: string, mutate: () => void): void => {
      mutate();
      const after = subHashes(sim);
      const changed = names.filter((_, i) => after[i] !== before[i]);
      expect(changed).toEqual([region]);
      sim.world.arena.restore(snap.subarray(SNAPSHOT_HEADER_BYTES));
      expect(Array.from(subHashes(sim))).toEqual(Array.from(before));
    };

    check('units', () => {
      sim.world.units.col.hp[slot] = sim.world.units.col.hp[slot]! - 7;
    });
    check('movers', () => {
      expect(sim.world.movers.count).toBeGreaterThan(0);
      sim.world.movers.col.tx[0] = sim.world.movers.col.tx[0]! + 1;
    });
    // The rule hash follows the sub-hashes: a changed unit column changes it too.
    const rule = sim.ruleHash();
    sim.world.units.col.x[slot] = sim.world.units.col.x[slot]! + 1;
    expect(sim.ruleHash()).not.toBe(rule);
    sim.world.arena.restore(snap.subarray(SNAPSHOT_HEADER_BYTES));
    expect(sim.ruleHash()).toBe(rule);
  });

  it('are equal after snapshot, divergence and restore', () => {
    const other = new HeadlessSim({ bpTable: table, seed: 0x5b5b0001, armyCount: 2, record: false, keyframes: false });
    runScenario(other, 400);
    const at400 = subHashes(other);
    expect(Array.from(at400)).toEqual(Array.from(subHashes(sim)));
    const snap = other.snapshot();
    runScenario(other, 800);
    const at800 = subHashes(other);
    expect(Array.from(at800)).not.toEqual(Array.from(at400));
    other.restore(snap);
    expect(other.tick).toBe(400);
    expect(Array.from(subHashes(other))).toEqual(Array.from(at400));
    // A fresh sim of the same session restored from the snapshot has the same sub-hashes.
    const fresh = new HeadlessSim({ bpTable: table, seed: 0x5b5b0001, armyCount: 2, record: false, keyframes: false });
    fresh.restore(snap);
    expect(Array.from(subHashes(fresh))).toEqual(Array.from(at400));
    runScenario(fresh, 800);
    expect(Array.from(subHashes(fresh))).toEqual(Array.from(at800));
  });
});
