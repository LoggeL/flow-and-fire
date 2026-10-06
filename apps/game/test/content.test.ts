import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { ClientMap, RAW_PER_WU, landCellBlocked, type MeshData } from '@faf/client';
import { describe, expect, it } from 'vitest';
import {
  FLIGHT_CLUSTER_UNITS,
  discIsLand,
  flightClusters,
  spawnSpreadWU,
  startLayout,
  TANK_MIX,
  tankSpawnPlan,
  visualsFromViewJson,
} from '../src/content.ts';

const repo = resolve(import.meta.dirname, '../../..');
const generated = resolve(repo, 'content/generated');
const ridge = ClientMap.fromBytes(new Uint8Array(readFileSync(resolve(repo, 'content/maps/hollow-ridge.rtsmap'))));

describe('content glue', () => {
  it('view.json → one visual per blueprint sim id (placeholder spec + view.lod)', () => {
    const visuals = visualsFromViewJson(readFileSync(resolve(generated, 'view.json'), 'utf8'));
    const bp = decodeSimBin(new Uint8Array(readFileSync(resolve(generated, 'sim.bin'))));
    expect(visuals).toHaveLength(bp.ids.length);
    const cube = bp.indexOf('core:cube');
    expect(cube).toBeGreaterThanOrEqual(0);
    const v = visuals[cube]!;
    expect(v.spec.hull).toBe('box');
    expect(v.spec.size.every((s) => s > 0)).toBe(true);
    expect(v.meshes).toBeUndefined();
    expect(v.lodDistancesWU).toEqual([60, 180]);
  });

  it('visuals with view.mesh take the pipeline LOD meshes when the model is loaded', () => {
    const lods = [3, 2, 1].map((n) => ({ tag: n }) as unknown as MeshData);
    const visuals = visualsFromViewJson(readFileSync(resolve(generated, 'view.json'), 'utf8'), new Map([['units/cube_bot', { lods }]]));
    const bp = decodeSimBin(new Uint8Array(readFileSync(resolve(generated, 'sim.bin'))));
    expect(visuals[bp.indexOf('core:cube')]!.meshes).toEqual(lods);
  });

  it('spawn spread leaves ≈ 4.5 WU² per cube, at least 3 WU', () => {
    expect(spawnSpreadWU(1)).toBe(3);
    const r = spawnSpreadWU(1000);
    expect((Math.PI * r * r) / 1000).toBeGreaterThan(4);
    expect((Math.PI * r * r) / 1000).toBeLessThan(5);
  });
});

describe('start layout', () => {
  it('map starts: own = army 0 (NW plateau), enemy = army 1 (SE plateau)', () => {
    const l = startLayout(ridge, 0, 1);
    expect([l.own.x / RAW_PER_WU, l.own.z / RAW_PER_WU]).toEqual([96, 96]);
    expect([l.enemy.x / RAW_PER_WU, l.enemy.z / RAW_PER_WU]).toEqual([416, 416]);
  });

  it('land discs avoid nav-blocked cells (MS3 slope rule) when the source has the replica', () => {
    const flat = { sizeWu: 64, waterDepthRaw: () => -1 };
    expect(discIsLand(flat, 32, 32, 4)).toBe(true);
    const wall = { ...flat, landBlockedAtRaw: (x: number) => Math.floor(x / RAW_PER_WU) === 37 };
    expect(discIsLand(wall, 32, 32, 4)).toBe(false);
    expect(discIsLand(wall, 20, 32, 4)).toBe(true);
  });

  it('test plane keeps the MS1 layout; a missing enemy start is the point mirror', () => {
    // The generated test plane map carries the MS1 start layout (256, 256) / (312, 214) as its starts.
    const t = startLayout(ClientMap.testPlane(), 0, 1);
    expect(t.own).toEqual({ x: 256 * RAW_PER_WU, z: 256 * RAW_PER_WU });
    expect(t.enemy).toEqual({ x: 312 * RAW_PER_WU, z: 214 * RAW_PER_WU });
    const one = { sizeWu: 512, startOf: (a: number) => (a === 0 ? { x: 100 * RAW_PER_WU, z: 50 * RAW_PER_WU } : null) };
    expect(startLayout(one, 0, 1).enemy).toEqual({ x: 412 * RAW_PER_WU, z: 462 * RAW_PER_WU });
  });

  it('the start armies spawn on dry land: 1,000 cubes around the own start, 24 around the enemy start', () => {
    const l = startLayout(ridge, 0, 1);
    expect(discIsLand(ridge, l.own.x / RAW_PER_WU, l.own.z / RAW_PER_WU, spawnSpreadWU(1000))).toBe(true);
    expect(discIsLand(ridge, l.enemy.x / RAW_PER_WU, l.enemy.z / RAW_PER_WU, spawnSpreadWU(24))).toBe(true);
    // The lake centre is deep water.
    expect(discIsLand(ridge, 256, 256, 3)).toBe(false);
  });
});

describe('flight-test clusters (?units=)', () => {
  it('2,000 units in clusters of ≤ 32 over the land of the whole map, both armies', () => {
    const cl = flightClusters(ridge, 2000, [0, 1], 1);
    expect(cl.reduce((n, c) => n + c.count, 0)).toBe(2000);
    expect(cl.every((c) => c.count > 0 && c.count <= FLIGHT_CLUSTER_UNITS)).toBe(true);
    const perArmy = [0, 0];
    for (const c of cl) perArmy[c.army]! += c.count;
    expect(perArmy[0]).toBeGreaterThan(900);
    expect(perArmy[1]).toBeGreaterThan(900);
    // Every disc is land (no cheat spawn gets rejected in deep water).
    for (const c of cl) expect(discIsLand(ridge, c.x / RAW_PER_WU, c.z / RAW_PER_WU, c.spread / RAW_PER_WU)).toBe(true);
    // MS3: no cell of a disc is blocked by the nav rule (slope/cliff) – the sim would reject the spawn.
    for (const c of cl) {
      const r = c.spread / RAW_PER_WU;
      for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          if (dx * dx + dz * dz > r * r) continue;
          expect(ridge.landBlockedAtRaw(c.x + dx * RAW_PER_WU, c.z + dz * RAW_PER_WU)).toBe(false);
        }
      }
    }
    // Spread over the whole map: every quadrant has clusters.
    const quads = new Set(cl.map((c) => (c.x < 256 * RAW_PER_WU ? 0 : 1) + (c.z < 256 * RAW_PER_WU ? 0 : 2)));
    expect(quads.size).toBe(4);
    // Deterministic.
    expect(flightClusters(ridge, 2000, [0, 1], 1)).toEqual(cl);
  });

  it('test plane (no water) and edge cases', () => {
    const flat = { sizeWu: 512, waterDepthRaw: () => -1 };
    expect(flightClusters(flat, 0, [0, 1])).toEqual([]);
    const one = flightClusters(flat, 5, [1]);
    expect(one).toHaveLength(1);
    expect(one[0]!.army).toBe(1);
    expect(one[0]!.count).toBe(5);
    const flooded = { sizeWu: 64, waterDepthRaw: () => 1 << 20 };
    expect(() => flightClusters(flooded, 10, [0])).toThrow(/no land/);
  });
});

describe('MS3 default scene: placeholder tanks (?spawn=tanks)', () => {
  const bp = decodeSimBin(new Uint8Array(readFileSync(resolve(generated, 'sim.bin'))));

  it('150 tanks per army: every core:lnd_* type, largest-remainder split, one disc per army', () => {
    const l = startLayout(ridge, 0, 1);
    const plan = tankSpawnPlan(bp, 150, 0, l.own.x, l.own.z);
    expect(plan.reduce((n, t) => n + t.count, 0)).toBe(150);
    expect(plan.map((t) => bp.ids[t.bp])).toEqual(TANK_MIX.map(([id]) => id));
    expect(plan.map((t) => t.count)).toEqual([63, 25, 25, 25, 12]);
    for (const t of plan) {
      expect([t.army, t.x, t.z, t.spread]).toEqual([0, l.own.x, l.own.z, plan[0]!.spread]);
    }
    const spreadWU = plan[0]!.spread / RAW_PER_WU;
    expect(spreadWU).toBeGreaterThan(8);
    expect(spreadWU).toBeLessThan(30);
    // Both start discs lie on land that is passable for land units (nav rule replica) in ≥ 95 % of the cells.
    for (const c of [l.own, l.enemy]) {
      let cells = 0;
      let free = 0;
      const cx = c.x / RAW_PER_WU;
      const cz = c.z / RAW_PER_WU;
      for (let z = Math.floor(cz - spreadWU); z <= cz + spreadWU; z++) {
        for (let x = Math.floor(cx - spreadWU); x <= cx + spreadWU; x++) {
          if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 > spreadWU * spreadWU) continue;
          cells++;
          if (!landCellBlocked(ridge.heightfield, ridge.waterLevelRaw, x, z)) free++;
        }
      }
      expect(free / cells).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('small counts, missing blueprints, zero', () => {
    expect(tankSpawnPlan(bp, 0, 0, 0, 0)).toEqual([]);
    const one = tankSpawnPlan(bp, 1, 1, 5, 6);
    expect(one).toHaveLength(1);
    expect(bp.ids[one[0]!.bp]).toBe('core:lnd_t1_tank');
    const onlyTank = { indexOf: (id: string) => (id === 'core:lnd_t1_tank' ? 4 : -1), radius: () => 0.45 * RAW_PER_WU };
    expect(tankSpawnPlan(onlyTank, 10, 0, 0, 0)).toEqual([{ bp: 4, army: 0, count: 10, x: 0, z: 0, spread: expect.any(Number) }]);
    expect(tankSpawnPlan({ indexOf: () => -1, radius: () => 0 }, 10, 0, 0, 0)).toEqual([]);
  });
});
