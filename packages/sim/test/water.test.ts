/**
 * Water in the sim (M2 rule, MS3 with passability + pathing, M5/M6): land units never stand in
 * water deeper than 0.5 WU nor on nav cells that are blocked for their class; orders across the
 * channel are routed over the ford; targets in deep water are retargeted to the nearest reachable
 * point on the bank; shallow water is passable; cheat spawns into deep water are rejected and
 * counted. Test map: support/maps.ts `channelMap()` (sloped banks, deep for x in (25, 39)).
 */
import { describe, expect, it } from 'vitest';
import { FX_ONE, type Handle } from '@faf/fixed';
import { mapSimData } from '@faf/formats';
import { isDeepWaterForLand, LAND_MAX_WATER_DEPTH_RAW, sampleHeightRaw } from '@faf/rules';
import {
  createWorld,
  MoverState,
  pathStats,
  spawnRejectedCount,
  step,
  unitClass,
  unitCount,
  unitHandles,
  unitInfo,
  UnitState,
  waterDepth,
  type World,
} from '../src/index.ts';
import { gameTable, moveCmd, spawnCmd, stopCmd } from './support/fixtures.ts';
import { channelMap, slopeMap } from './support/maps.ts';

const channel = mapSimData(channelMap());

function channelWorld(seed = 5): World {
  return createWorld({ bpTable: gameTable(), seed, armyCount: 2, map: channel });
}

/**
 * Steps `n` ticks and checks after each that no unit stands in deep water or on a nav cell not
 * passable for its class, and that y is the terrain.
 */
function runChecked(w: World, n: number, onTick?: () => void): void {
  const U = w.units.col;
  for (let t = 0; t < n; t++) {
    step(w);
    const hw = w.units.highWater;
    for (let i = 0; i < hw; i++) {
      if (w.units.alive[i] !== 1) continue;
      const x = U.x[i]!;
      const z = U.z[i]!;
      if (isDeepWaterForLand(channel, channel.waterLevelRaw, x, z)) throw new Error(`tick ${w.tick}: slot ${i} in deep water at (${x / FX_ONE}, ${z / FX_ONE})`);
      if (U.y[i] !== sampleHeightRaw(channel, x, z)) throw new Error(`tick ${w.tick}: slot ${i} y ${U.y[i]} ≠ terrain`);
      const c = w.navClear[((z >> 12) << w.navShift) | (x >> 12)]!;
      if (c < unitClass(w, i)) throw new Error(`tick ${w.tick}: slot ${i} on a blocked cell (${x / FX_ONE}, ${z / FX_ONE}), clearance ${c}`);
    }
    onTick?.();
  }
}

/** Spawns one cube of army 0 at an exact point (spread 0) and returns its handle. */
function one(w: World, xWu: number, zWu: number): Handle {
  const before = new Set(unitHandles(w, 0));
  step(w, [spawnCmd(0, 1, xWu, zWu, 0)]);
  const h = unitHandles(w, 0).find((k) => !before.has(k));
  if (h === undefined) throw new Error('spawn failed');
  return h;
}

describe('deep water and pathing (M2 + M5/M6)', () => {
  it('an order straight across the channel is routed over the ford; the unit never enters deep water', () => {
    const w = channelWorld();
    const h = one(w, 12, 10);
    step(w, [moveCmd(0, [h], 52, 10)]);
    expect(pathStats(w).requestsIssued).toBe(1);
    let maxZ = 0;
    let arrivedAt = -1;
    runChecked(w, 600, () => {
      const u = unitInfo(w, h)!;
      if (u.z > maxZ) maxZ = u.z;
      if (arrivedAt < 0 && !u.moving) arrivedAt = w.tick;
    });
    const u = unitInfo(w, h)!;
    expect(arrivedAt).toBeGreaterThan(0);
    expect(u.state).toBe(UnitState.Idle);
    // It went through the ford (z in [40, 48]) and reached its target on the far bank.
    expect(maxZ).toBeGreaterThan(39 * FX_ONE);
    expect(Math.hypot(u.x - 52 * FX_ONE, u.z - 10 * FX_ONE)).toBeLessThan(0.5 * FX_ONE);
  });

  it('a target in deep water is retargeted to the nearest reachable point on the bank', () => {
    const w = channelWorld();
    const h = one(w, 12, 20);
    step(w, [moveCmd(0, [h], 30, 20)]);
    runChecked(w, 400);
    const u = unitInfo(w, h)!;
    expect(u.moving).toBe(false);
    // Nearest passable cell of the unit's component (both banks, connected by the ford) to the
    // target cell (30, 20): x = 24 on the west bank (6 cells; the east bank x = 39 is 9 away),
    // its centre is the new slot; the unit stands there, at most 0.5 WU deep.
    expect(u.targetX).toBe(24 * FX_ONE + 2048);
    expect(u.targetZ).toBe(20 * FX_ONE + 2048);
    expect(Math.hypot(u.x - u.targetX, u.z - u.targetZ)).toBeLessThan(0.5 * FX_ONE);
    expect(waterDepth(w, u.x, u.z)).toBeLessThanOrEqual(LAND_MAX_WATER_DEPTH_RAW);
  });

  it('shallow water is passable: a unit crosses the 0.25 WU ford and the exact-0.5 WU strip', () => {
    for (const z of [44, 54]) {
      const w = channelWorld();
      const h = one(w, 12, z);
      step(w, [moveCmd(0, [h], 52, z)]);
      let maxDepth = -Infinity;
      runChecked(w, 300, () => {
        const u = unitInfo(w, h)!;
        maxDepth = Math.max(maxDepth, waterDepth(w, u.x, u.z));
      });
      const u = unitInfo(w, h)!;
      expect(u.moving, `z ${z}`).toBe(false);
      expect(Math.abs(u.x - 52 * FX_ONE)).toBeLessThanOrEqual(0.35 * FX_ONE);
      // It really waded through water (up to 0.25 resp. exactly 0.5 WU deep).
      expect(maxDepth).toBeGreaterThan(0);
      expect(maxDepth).toBeLessThanOrEqual(z === 44 ? 0.25 * FX_ONE : LAND_MAX_WATER_DEPTH_RAW);
      if (z === 54) expect(maxDepth).toBeGreaterThan(0.45 * FX_ONE);
    }
  });

  it('cheat spawns into deep water are rejected and counted; dry spawns are not', () => {
    const w = channelWorld();
    step(w, [spawnCmd(0, 10, 32, 10, 0)]);
    expect(unitCount(w)).toBe(0);
    expect(spawnRejectedCount(w)).toBe(10);
    step(w, [spawnCmd(0, 8, 12, 10, 2)]);
    expect(unitCount(w)).toBe(8);
    expect(spawnRejectedCount(w)).toBe(10);
    // A disc across the bank: some points are deep, the rest are spawned.
    step(w, [spawnCmd(1, 100, 25, 20, 3)]);
    const rejected = spawnRejectedCount(w) - 10;
    expect(rejected).toBeGreaterThan(10);
    expect(rejected).toBeLessThan(90);
    expect(unitHandles(w, 1).length).toBe(100 - rejected);
    for (const hh of unitHandles(w, 1)) {
      const u = unitInfo(w, hh)!;
      expect(isDeepWaterForLand(channel, channel.waterLevelRaw, u.x, u.z)).toBe(false);
    }
    // The rejection counter is rule state: a world with the same commands matches.
    const w2 = channelWorld();
    step(w2, [spawnCmd(0, 10, 32, 10, 0)]);
    step(w2, [spawnCmd(0, 8, 12, 10, 2)]);
    step(w2, [spawnCmd(1, 100, 25, 20, 3)]);
    expect(spawnRejectedCount(w2)).toBe(spawnRejectedCount(w));
  });

  it('collisions never push a land unit into deep water or onto a blocked cell', () => {
    const w = channelWorld();
    step(w, [spawnCmd(0, 80, 23, 20, 2)]);
    const n = unitCount(w);
    expect(n).toBeGreaterThan(40);
    // A dense idle crowd at the bank plus a group driving into it from the dry side.
    const hs = unitHandles(w, 0);
    step(w, hs.slice(0, 20).map((h) => moveCmd(0, [h], 24.5, 20)));
    runChecked(w, 200);
    expect(unitCount(w)).toBe(n);
    step(w, [stopCmd(0, hs)]);
    runChecked(w, 20);
  });

  it('a whole group ordered across crosses at the ford and arrives (one path request)', () => {
    const w = channelWorld();
    step(w, [spawnCmd(0, 30, 12, 20, 4)]);
    const hs = unitHandles(w, 0);
    step(w, [moveCmd(0, hs, 52, 20)]);
    expect(pathStats(w).requestsIssued).toBe(1);
    runChecked(w, 900);
    for (const h of hs) {
      const u = unitInfo(w, h)!;
      expect(u.moving).toBe(false);
      expect(u.x).toBeGreaterThan(40 * FX_ONE);
      expect(w.movers.col.state[w.units.col.mover[u.slot]!]).toBe(MoverState.Idle);
    }
  });
});

describe('height on a dry map', () => {
  it('y == sampleHeightRaw after every tick on slopes (gentle slopes: nothing is blocked)', () => {
    const slopes = mapSimData(slopeMap());
    const w = createWorld({ bpTable: gameTable(), seed: 9, armyCount: 1, map: slopes });
    expect(w.hasWater).toBe(false);
    step(w, [spawnCmd(0, 60, 10, 10, 6)]);
    step(w, [moveCmd(0, unitHandles(w, 0), 54, 50)]);
    const U = w.units.col;
    let maxY = 0;
    for (let t = 0; t < 300; t++) {
      step(w);
      for (let i = 0; i < w.units.highWater; i++) {
        if (w.units.alive[i] !== 1) continue;
        expect(U.y[i]).toBe(sampleHeightRaw(slopes, U.x[i]!, U.z[i]!));
        if (U.y[i]! > maxY) maxY = U.y[i]!;
      }
    }
    expect(maxY).toBeGreaterThan(15 * FX_ONE);
    expect(spawnRejectedCount(w)).toBe(0);
  });
});
