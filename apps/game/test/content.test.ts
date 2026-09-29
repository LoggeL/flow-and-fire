import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { ClientMap, RAW_PER_WU, type MeshData } from '@faf/client';
import { describe, expect, it } from 'vitest';
import {
  FLIGHT_CLUSTER_UNITS,
  discIsLand,
  flightClusters,
  spawnSpreadWU,
  startLayout,
  visualsFromViewJson,
} from '../src/content.ts';

const repo = resolve(import.meta.dirname, '../../..');
const generated = resolve(repo, 'content/generated');
const ridge = ClientMap.fromBytes(new Uint8Array(readFileSync(resolve(repo, 'content/maps/hollow-ridge.rtsmap'))));
const setons = ClientMap.fromBytes(new Uint8Array(readFileSync(resolve(repo, 'content/maps/setons.rtsmap'))));

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

describe('start layout on Setons (default map)', () => {
  it('own = army 0 (SW mid), enemy = army 1 (NO mid, across the land bridge); both spawn discs are dry land', () => {
    const l = startLayout(setons, 0, 1);
    expect([l.own.x / RAW_PER_WU, l.own.z / RAW_PER_WU]).toEqual([354, 678]);
    expect([l.enemy.x / RAW_PER_WU, l.enemy.z / RAW_PER_WU]).toEqual([670, 346]);
    expect(discIsLand(setons, 354, 678, spawnSpreadWU(1000))).toBe(true);
    expect(discIsLand(setons, 670, 346, spawnSpreadWU(1000))).toBe(true);
    // Lake centres are deep water.
    expect(discIsLand(setons, 250, 250, 3)).toBe(false);
    expect(discIsLand(setons, 774, 774, 3)).toBe(false);
  });

  it('flight clusters find land on Setons', () => {
    const cl = flightClusters(setons, 2000, [0, 1], 1);
    expect(cl.reduce((n, c) => n + c.count, 0)).toBe(2000);
    for (const c of cl) expect(discIsLand(setons, c.x / RAW_PER_WU, c.z / RAW_PER_WU, c.spread / RAW_PER_WU)).toBe(true);
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

describe('start layout on Braidwater (?map=braidwater)', () => {
  const braidwater = ClientMap.fromBytes(new Uint8Array(readFileSync(resolve(repo, 'content/maps/braidwater.rtsmap'))));

  it('own = army 0 (south base plateau), enemy = army 1 (north, across the river); spawn discs are dry land, the river is not', () => {
    const l = startLayout(braidwater, 0, 1);
    expect([l.own.x / RAW_PER_WU, l.own.z / RAW_PER_WU]).toEqual([154, 446]);
    expect([l.enemy.x / RAW_PER_WU, l.enemy.z / RAW_PER_WU]).toEqual([154, 66]);
    expect(discIsLand(braidwater, 154, 446, spawnSpreadWU(1000))).toBe(true);
    expect(discIsLand(braidwater, 154, 66, spawnSpreadWU(1000))).toBe(true);
    // Middle river section and estuary are deep water; the west ford is not.
    expect(discIsLand(braidwater, 208, 256, 3)).toBe(false);
    expect(discIsLand(braidwater, 490, 256, 3)).toBe(false);
    expect(discIsLand(braidwater, 80, 256, 3)).toBe(true);
  });

  it('flight clusters find land on Braidwater', () => {
    const cl = flightClusters(braidwater, 2000, [0, 1], 1);
    expect(cl.reduce((n, c) => n + c.count, 0)).toBe(2000);
    for (const c of cl) expect(discIsLand(braidwater, c.x / RAW_PER_WU, c.z / RAW_PER_WU, c.spread / RAW_PER_WU)).toBe(true);
  });
});
