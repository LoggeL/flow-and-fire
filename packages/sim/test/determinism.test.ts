import { describe, expect, it } from 'vitest';
import { createWorld, fullHash, restore, ruleHash, snapshot, spawnRejectedCount, unitCount } from '../src/index.ts';
import { gameTable } from './support/fixtures.ts';
import { hollowRidgeSim } from './support/maps.ts';
import { continueScenario, runScenario } from './support/scenario.ts';

describe('determinism (L1/L4, 1,000 cubes, 2,000 ticks)', () => {
  const table = gameTable();

  it('same seed + commands ⇒ identical hash chain, independent of the command input form', () => {
    const a = runScenario(table, 0xc0ffee, 2000, 'batch');
    const b = runScenario(table, 0xc0ffee, 2000, 'envelopes');
    expect(a.chain.length).toBe(200);
    expect(b.chain).toEqual(a.chain);
    expect(ruleHash(b.world)).toBe(ruleHash(a.world));
    expect(fullHash(b.world)).toBe(fullHash(a.world));
    // The chain actually moves (units are driving) …
    expect(new Set(a.chain).size).toBeGreaterThan(150);
    // … and 1,000 − 50 killed + 50 respawned units exist.
    expect(unitCount(a.world)).toBe(1000);
    // A different seed changes the spawn positions and therefore the chain.
    const c = runScenario(table, 0xc0ffef, 200, 'batch');
    expect(c.chain).not.toEqual(a.chain.slice(0, 20));
  });

  it('snapshot at tick 1,000 + restore ⇒ same rule and full hash at tick 2,000', () => {
    const direct = runScenario(table, 42, 2000, 'view');
    const first = runScenario(table, 42, 1000, 'view');
    const snap = snapshot(first.world);
    expect(snap.length).toBe(first.world.snapshotByteLength);
    // Restore into a fresh world (same layout) and into the original after it diverged.
    const fresh = createWorld({ bpTable: table, seed: 42, armyCount: 2 });
    expect(fresh.layoutHash).toBe(first.world.layoutHash);
    restore(fresh, snap);
    expect(fresh.tick).toBe(1000);
    expect(ruleHash(fresh)).toBe(ruleHash(first.world));
    expect(fullHash(fresh)).toBe(fullHash(first.world));
    const resumed = continueScenario(fresh, 2000, 'view');
    expect(ruleHash(resumed.world)).toBe(ruleHash(direct.world));
    expect(fullHash(resumed.world)).toBe(fullHash(direct.world));
    expect([...direct.chain.slice(0, 100), ...resumed.chain]).toEqual(direct.chain);

    continueScenario(first.world, 1500, 'view');
    restore(first.world, snap);
    continueScenario(first.world, 2000, 'view');
    expect(fullHash(first.world)).toBe(fullHash(direct.world));
  });
});

describe('determinism with a map (hollow-ridge, 2,000 ticks)', () => {
  const table = gameTable();
  const map = hollowRidgeSim();

  it('same seed + commands ⇒ identical hash chain; the map changes the chain', () => {
    const a = runScenario(table, 0xc0ffee, 2000, 'batch', map);
    const b = runScenario(table, 0xc0ffee, 2000, 'envelopes', map);
    expect(a.chain.length).toBe(200);
    expect(b.chain).toEqual(a.chain);
    expect(fullHash(b.world)).toBe(fullHash(a.world));
    // The respawn at (256, 256) lies in the lake: all 50 are rejected (M2).
    expect(spawnRejectedCount(a.world)).toBe(50);
    expect(unitCount(a.world)).toBe(950);
    const plane = runScenario(table, 0xc0ffee, 200, 'batch');
    expect(plane.chain).not.toEqual(a.chain.slice(0, 20));
  });

  it('snapshot at tick 1,000 + restore ⇒ same rule and full hash at tick 2,000 (static map untouched)', () => {
    const direct = runScenario(table, 42, 2000, 'view', map);
    const first = runScenario(table, 42, 1000, 'view', map);
    const snap = snapshot(first.world);
    const fresh = createWorld({ bpTable: table, seed: 42, armyCount: 2, map });
    expect(fresh.layoutHash).toBe(first.world.layoutHash);
    restore(fresh, snap);
    expect(ruleHash(fresh)).toBe(ruleHash(first.world));
    const resumed = continueScenario(fresh, 2000, 'view');
    expect(ruleHash(resumed.world)).toBe(ruleHash(direct.world));
    expect(fullHash(resumed.world)).toBe(fullHash(direct.world));
    expect([...direct.chain.slice(0, 100), ...resumed.chain]).toEqual(direct.chain);
    expect(fresh.terrain.heights).toEqual(map.heights);
  });
});
