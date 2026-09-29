/**
 * M2 deep water in the sim (MS2 minimal form until passability/HPA* in MS3): land units never
 * enter water deeper than 0.5 WU, slide axis-separated along the bank, end their order after
 * STUCK_TICKS blocked ticks without progress, cross shallow fords, and cheat spawns into deep
 * water are rejected and counted. Test map: support/maps.ts `channelMap()`.
 */
import { describe, expect, it } from 'vitest';
import { FX_ONE, type Handle } from '@faf/fixed';
import { mapSimData } from '@faf/formats';
import { isDeepWaterForLand, LAND_MAX_WATER_DEPTH_RAW, sampleHeightRaw } from '@faf/rules';
import {
  createWorld,
  MoverState,
  spawnRejectedCount,
  step,
  STUCK_TICKS,
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

/** Steps `n` ticks and checks after each that no unit stands in deep water and y is the terrain. */
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

describe('deep water blocks land units (M2)', () => {
  it('a unit driving straight at the channel stops at the bank and becomes idle after the stuck timeout', () => {
    const w = channelWorld();
    const h = one(w, 20, 10);
    step(w, [moveCmd(0, [h], 44, 10)]);
    let idleAt = -1;
    let firstBlocked = -1;
    runChecked(w, 400, () => {
      const u = unitInfo(w, h)!;
      if (firstBlocked < 0 && u.x > 29 * FX_ONE) firstBlocked = w.tick;
      if (idleAt < 0 && !u.moving) idleAt = w.tick;
    });
    const u = unitInfo(w, h)!;
    expect(idleAt).toBeGreaterThan(0);
    expect(u.state).toBe(UnitState.Idle);
    expect(u.moving).toBe(false);
    // Stopped at the bank: deep water starts at x > 29.5 WU (bilinear between 10 and 5 WU).
    expect(u.x).toBeGreaterThan(29 * FX_ONE);
    expect(u.x).toBeLessThanOrEqual(29.5 * FX_ONE);
    expect(waterDepth(w, u.x, u.z)).toBeLessThanOrEqual(LAND_MAX_WATER_DEPTH_RAW);
    // The order ended like a Stop (target = own position), shortly after the unit hit the bank.
    expect(u.targetX).toBe(u.x);
    expect(u.targetZ).toBe(u.z);
    expect(idleAt - firstBlocked).toBeGreaterThanOrEqual(STUCK_TICKS);
    expect(idleAt - firstBlocked).toBeLessThan(STUCK_TICKS + 60);
    // A new order works again (away from the water).
    step(w, [moveCmd(0, [h], 10, 10)]);
    runChecked(w, 150);
    expect(unitInfo(w, h)!.x).toBeLessThan(11 * FX_ONE);
  });

  it('a unit approaching the bank at an angle slides along it (only z is taken)', () => {
    const w = channelWorld();
    const h = one(w, 20, 20);
    step(w, [moveCmd(0, [h], 44, 36)]);
    let slid = 0;
    let lastZ = unitInfo(w, h)!.z;
    runChecked(w, 400, () => {
      const u = unitInfo(w, h)!;
      if (u.x > 29 * FX_ONE && u.z > lastZ) slid += u.z - lastZ;
      lastZ = u.z;
    });
    const u = unitInfo(w, h)!;
    // It slid several WU along the bank towards the target's z, then got stuck (target across).
    expect(slid).toBeGreaterThan(5 * FX_ONE);
    expect(u.z).toBeGreaterThan(33 * FX_ONE);
    expect(u.x).toBeLessThanOrEqual(29.5 * FX_ONE);
    expect(u.moving).toBe(false);
  });

  it('shallow water is passable: a unit crosses the 0.25 WU ford and the exact-0.5 WU strip', () => {
    for (const z of [44, 54]) {
      const w = channelWorld();
      const h = one(w, 20, z);
      step(w, [moveCmd(0, [h], 44, z)]);
      let maxDepth = -Infinity;
      runChecked(w, 300, () => {
        const u = unitInfo(w, h)!;
        maxDepth = Math.max(maxDepth, waterDepth(w, u.x, u.z));
      });
      const u = unitInfo(w, h)!;
      expect(u.moving, `z ${z}`).toBe(false);
      expect(Math.abs(u.x - 44 * FX_ONE)).toBeLessThanOrEqual(FX_ONE >> 2);
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
    step(w, [spawnCmd(0, 8, 20, 10, 2)]);
    expect(unitCount(w)).toBe(8);
    expect(spawnRejectedCount(w)).toBe(10);
    // A disc across the bank: some points are deep, the rest are spawned.
    step(w, [spawnCmd(1, 100, 30, 20, 3)]);
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
    step(w2, [spawnCmd(0, 8, 20, 10, 2)]);
    step(w2, [spawnCmd(1, 100, 30, 20, 3)]);
    expect(spawnRejectedCount(w2)).toBe(spawnRejectedCount(w));
  });

  it('separation never pushes a land unit into deep water', () => {
    const w = channelWorld();
    step(w, [spawnCmd(0, 80, 29, 20, 1.5)]);
    const n = unitCount(w);
    expect(n).toBeGreaterThan(40);
    // A dense idle crowd at the bank plus a group driving into it from the dry side.
    const hs = unitHandles(w, 0);
    step(w, [moveCmd(0, hs.slice(0, 20), 29.4, 20)]);
    runChecked(w, 200);
    expect(unitCount(w)).toBe(n);
    step(w, [stopCmd(0, hs)]);
    runChecked(w, 20);
  });

  it('a whole group ordered across ends idle on its own bank', () => {
    const w = channelWorld();
    step(w, [spawnCmd(0, 40, 22, 20, 4)]);
    const hs = unitHandles(w, 0);
    step(w, [moveCmd(0, hs, 44, 20)]);
    runChecked(w, 600);
    for (const h of hs) {
      const u = unitInfo(w, h)!;
      expect(u.moving).toBe(false);
      expect(u.x).toBeLessThan(30 * FX_ONE);
      expect(w.movers.col.state[w.units.col.mover[u.slot]!]).toBe(MoverState.Idle);
    }
  });
});

describe('height on a dry map', () => {
  it('y == sampleHeightRaw after every tick on slopes (no water: nothing is blocked)', () => {
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
    expect(maxY).toBeGreaterThan(20 * FX_ONE);
    expect(spawnRejectedCount(w)).toBe(0);
  });
});
