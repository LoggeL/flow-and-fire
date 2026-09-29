/**
 * MS2 map in the arena (PLAN §3.5 "Bereich statisch"): static regions, hashes, snapshot/restore,
 * map queries, y from the heightmap on hollow-ridge.
 */
import { describe, expect, it } from 'vitest';
import { FX_ONE, xxHash32 } from '@faf/fixed';
import { isDeepWaterForLand, sampleHeightRaw } from '@faf/rules';
import {
  createWorld,
  fullHash,
  isBlockedFor,
  mapSpot,
  mapSpotCount,
  mapSpotCountOf,
  mapStart,
  mapStartCount,
  mapStartOfArmy,
  MT_DIM,
  MT_HEIGHT_SCALE_RAW,
  MT_SIZE_WU,
  MT_WATER_FLAG,
  MT_WATER_LEVEL_RAW,
  restore,
  ruleHash,
  snapshot,
  SpotKind,
  step,
  terrainHeight,
  unitHandles,
  waterDepth,
  type MapPointOut,
  type World,
} from '../src/index.ts';
import { gameTable, moveCmd, spawnCmd } from './support/fixtures.ts';
import { hollowRidge, hollowRidgeSim } from './support/maps.ts';
import { createRtsMap, mapSimData } from '@faf/formats';

function ridgeWorld(seed = 7): World {
  return createWorld({ bpTable: gameTable(), seed, armyCount: 2, map: hollowRidgeSim() });
}

/** xxHash32 over the whole static area (map data). */
function staticBytesHash(w: World): number {
  const a = w.arena;
  return xxHash32(a.bytes, a.staticStart, a.staticEnd - a.staticStart, 0);
}

describe('map in the static arena area', () => {
  it('copies the map into static regions; size, heights, water and parameters come from the map', () => {
    const map = hollowRidge();
    const w = ridgeWorld();
    expect(w.mapSizeWu).toBe(512);
    expect(w.mapMax).toBe(512 * FX_ONE);
    expect(w.hasWater).toBe(true);
    expect(w.waterLevel).toBe(40_960);
    expect(w.terrain.dim).toBe(513);
    expect(w.terrain.heightScaleRaw).toBe(32);
    expect(w.terrain.heights).toEqual(map.heights);
    expect(w.terrain.heights.buffer).toBe(w.arena.memory.buffer);
    const t = w.mapTerrain.i32;
    expect([t[MT_SIZE_WU], t[MT_DIM], t[MT_HEIGHT_SCALE_RAW], t[MT_WATER_FLAG], t[MT_WATER_LEVEL_RAW]]).toEqual([512, 513, 32, 1, 40_960]);
    for (const name of ['map.terrain', 'map.heights', 'map.starts', 'map.spots']) {
      const r = w.arena.regions.find((x) => x.name === name)!;
      expect(r.area, name).toBe('static');
      expect(r.byteOffset, name).toBeGreaterThanOrEqual(w.arena.dynamicEnd);
      expect(w.arena.ruleRegions.some((x) => x.name === name)).toBe(false);
      expect(w.arena.fullRegions.some((x) => x.name === name)).toBe(false);
    }
    // The dynamic area (snapshot) does not grow with the map.
    const plane = createWorld({ bpTable: gameTable(), seed: 7, armyCount: 2 });
    expect(w.snapshotByteLength).toBe(plane.snapshotByteLength);
    expect(w.layoutHash).not.toBe(plane.layoutHash);
    // Without a map the world runs on the generated flat test plane map (same static regions).
    expect(plane.mapTerrain.i32[MT_SIZE_WU]).toBe(512);
    expect(plane.hasWater).toBe(false);
    expect(terrainHeight(plane, 123 * FX_ONE, 77 * FX_ONE)).toBe(0);
  });

  it('static map data is in neither the rule nor the full hash', () => {
    const w = ridgeWorld();
    step(w, [spawnCmd(0, 50, 100, 100, 10)]);
    const rule = ruleHash(w);
    const full = fullHash(w);
    const h = w.terrain.heights;
    const old = h[1000]!;
    h[1000] = old ^ 0x5555;
    w.mapSpots.i32[1] = 12345;
    expect(ruleHash(w)).toBe(rule);
    expect(fullHash(w)).toBe(full);
    h[1000] = old;
  });

  it('snapshot/restore copy only the dynamic area and leave the static map untouched', () => {
    const w = ridgeWorld();
    const before = staticBytesHash(w);
    step(w, [spawnCmd(0, 200, 110, 110, 20)]);
    step(w, [moveCmd(0, unitHandles(w, 0), 200, 96)]);
    for (let i = 0; i < 20; i++) step(w);
    const snap = snapshot(w);
    expect(snap.length).toBe(w.arena.dynamicEnd - w.arena.dynamicStart);
    const rule = ruleHash(w);
    const full = fullHash(w);
    for (let i = 0; i < 50; i++) step(w);
    restore(w, snap);
    expect(ruleHash(w)).toBe(rule);
    expect(fullHash(w)).toBe(full);
    expect(staticBytesHash(w)).toBe(before);
    // Restore into a fresh world of the same map: same state, its own (identical) static area.
    const fresh = ridgeWorld(99);
    const freshStatic = staticBytesHash(fresh);
    restore(fresh, snap);
    expect(fullHash(fresh)).toBe(full);
    expect(staticBytesHash(fresh)).toBe(freshStatic);
    expect(freshStatic).toBe(before);
  });

  it('starts and spots are queryable (MS4 mex placement)', () => {
    const map = hollowRidge();
    const w = ridgeWorld();
    const out: MapPointOut = { tag: 0, x: 0, z: 0 };
    expect(mapStartCount(w)).toBe(map.meta.starts.length);
    expect(mapStart(w, 0, out)).toBe(true);
    expect(out).toEqual({ tag: 0, x: 96 * FX_ONE, z: 96 * FX_ONE });
    expect(mapStartOfArmy(w, 1, out)).toBe(true);
    expect(out).toEqual({ tag: 1, x: 416 * FX_ONE, z: 416 * FX_ONE });
    expect(mapStartOfArmy(w, 5, out)).toBe(false);
    expect(mapStart(w, 2, out)).toBe(false);
    expect(mapSpotCount(w)).toBe(18);
    expect(mapSpotCountOf(w, SpotKind.Mass)).toBe(16);
    expect(mapSpotCountOf(w, SpotKind.Hydro)).toBe(2);
    for (let i = 0; i < map.meta.spots.length; i++) {
      const s = map.meta.spots[i]!;
      expect(mapSpot(w, i, out)).toBe(true);
      expect(out).toEqual({ tag: s.kind === 'mass' ? SpotKind.Mass : SpotKind.Hydro, x: s.x, z: s.z });
      // Every spot is dry land (mapc contract), so land units may stand on it.
      expect(isBlockedFor(w, 0, s.x, s.z)).toBe(false);
    }
    expect(mapSpot(w, 18, out)).toBe(false);
    const plane = createWorld({ bpTable: gameTable(), seed: 1, armyCount: 2 });
    expect(mapStartCount(plane)).toBe(2);
    expect(mapStartOfArmy(plane, 1, out)).toBe(true);
    expect(out).toEqual({ tag: 1, x: 312 * FX_ONE, z: 214 * FX_ONE });
    expect(mapSpotCount(plane)).toBe(0);
  });

  it('terrain queries equal @faf/rules on the map (height, water depth, deep water)', () => {
    const w = ridgeWorld();
    const hf = hollowRidgeSim();
    for (let i = 0; i < 5000; i++) {
      const x = (Math.imul(i, 0x9e3779b1) >>> 0) % (513 * FX_ONE);
      const z = (Math.imul(i + 17, 0x85ebca6b) >>> 0) % (513 * FX_ONE);
      const g = sampleHeightRaw(hf, x, z);
      expect(terrainHeight(w, x, z)).toBe(g);
      expect(waterDepth(w, x, z)).toBe(40_960 - g);
      expect(isBlockedFor(w, 0, x, z)).toBe(isDeepWaterForLand(hf, hf.waterLevelRaw, x, z));
    }
    // Deep water sample points of the map contract (3.5 WU deep).
    expect(waterDepth(w, 256 * FX_ONE, 256 * FX_ONE)).toBe(3.5 * FX_ONE);
    expect(isBlockedFor(w, 0, 300 * FX_ONE, 212 * FX_ONE)).toBe(true);
    // Only land units are blocked (air, hover … are not in MS2).
    expect(isBlockedFor(w, 5, 256 * FX_ONE, 256 * FX_ONE)).toBe(false);
  });

  it('rejects inconsistent maps', () => {
    const good = hollowRidgeSim();
    const t = gameTable();
    expect(() => createWorld({ bpTable: t, seed: 1, armyCount: 2, map: { ...good, dim: 512 } })).toThrow(/dim/);
    expect(() => createWorld({ bpTable: t, seed: 1, armyCount: 2, map: { ...good, heights: good.heights.subarray(1) } })).toThrow(/heights/);
    expect(() => createWorld({ bpTable: t, seed: 1, armyCount: 2, map: { ...good, heightScaleRaw: 0 } })).toThrow(/heightScaleRaw/);
    expect(() => createWorld({ bpTable: t, seed: 1, armyCount: 2, map: good, mapSizeWu: 1024 })).toThrow(/mapSizeWu/);
    expect(() => createWorld({ bpTable: t, seed: 1, armyCount: 2, map: { ...good, spots: [{ kind: 'mass', x: -1, z: 0 }] } })).toThrow(/spot/);
    expect(() => createWorld({ bpTable: t, seed: 1, armyCount: 2, map: { ...good, starts: [{ army: 16, x: 0, z: 0 }] } })).toThrow(/start/);
    expect(createWorld({ bpTable: t, seed: 1, armyCount: 2, map: good, mapSizeWu: 512 }).mapSizeWu).toBe(512);
  });
});

describe('units stand on the terrain (M1/Sim)', () => {
  it('1,000 cubes crossing slopes of hollow-ridge: y == sampleHeightRaw every 10 ticks, never in deep water', () => {
    const hf = hollowRidgeSim();
    const w = ridgeWorld(3);
    step(w, [spawnCmd(0, 600, 110, 110, 30), spawnCmd(1, 400, 402, 402, 25)]);
    expect(unitHandles(w).length).toBe(1000);
    const a0 = unitHandles(w, 0);
    const a1 = unitHandles(w, 1);
    // Down the NW plateau cliffs/ramps and up the mesa; SE army down its plateau.
    step(w, [
      moveCmd(0, a0.slice(0, 300), 200, 96),
      moveCmd(0, a0.slice(300), 120, 240),
      moveCmd(1, a1.slice(0, 200), 330, 416),
      moveCmd(1, a1.slice(200), 392, 262),
    ]);
    const U = w.units.col;
    const y0 = new Map<number, number>();
    for (const h of unitHandles(w)) y0.set(h, U.y[w.units.resolve(h)]!);
    let checks = 0;
    for (let t = 0; t < 600; t++) {
      step(w);
      const hw = w.units.highWater;
      for (let i = 0; i < hw; i++) {
        if (w.units.alive[i] !== 1) continue;
        expect(isDeepWaterForLand(hf, hf.waterLevelRaw, U.x[i]!, U.z[i]!)).toBe(false);
        if (w.tick % 10 === 0) {
          expect(U.y[i]).toBe(sampleHeightRaw(hf, U.x[i]!, U.z[i]!));
          checks++;
        }
      }
    }
    expect(checks).toBe(60_000);
    // y actually follows the terrain: most cubes changed height by more than 2 WU.
    let changed = 0;
    for (const h of unitHandles(w)) if (Math.abs(U.y[w.units.resolve(h)]! - y0.get(h)!) > 2 * FX_ONE) changed++;
    expect(changed).toBeGreaterThan(700);
    // prev/cur of the frame: after a step, py is the y of the previous tick.
    const ys = Int32Array.from(U.y.subarray(0, w.units.highWater));
    step(w, [moveCmd(0, a0, 150, 150)]);
    for (let k = 0; k < 3; k++) step(w);
    const before = Int32Array.from(U.y.subarray(0, w.units.highWater));
    step(w);
    for (let s = 0; s < w.units.highWater; s++) if (w.units.alive[s] === 1) expect(U.py[s]).toBe(before[s]);
    expect(ys.length).toBe(w.units.highWater);
  });
});

describe('1,024 WU map (PLAN §3.1: tested up to 1,024 WU; next standard size)', () => {
  /** 1,024 WU terrain with slopes and ridges up to ≈ 500 WU high near the far edge (integer heights). */
  function bigMap() {
    return mapSimData(
      createRtsMap({
        sizeWu: 1024,
        name: 'big',
        waterLevelRaw: null,
        heights: (x, z) => Math.min(0xffff, ((x * 37 + z * 11) & 1023) * 8 + ((x + z) >> 1) * 40 + (x === 1024 || z === 1024 ? 3000 : 0)),
      }),
    );
  }

  it('units at all four edges and corners: y == sampleHeightRaw, positions clamped to [0, 1,024 WU]; snapshot/restore', () => {
    const map = bigMap();
    const w = createWorld({ bpTable: gameTable(), seed: 11, armyCount: 2, map });
    expect(w.mapSizeWu).toBe(1024);
    expect(w.mapMax).toBe(1024 * FX_ONE);
    expect(w.terrain.dim).toBe(1025);
    expect(w.terrain.heights).toEqual(map.heights);
    // Static heightmap (1,025² u16 ≈ 2.1 MB) lives in the static area, not in the snapshot.
    const r = w.arena.regions.find((x) => x.name === 'map.heights')!;
    expect(r.byteLength).toBeGreaterThanOrEqual(1025 * 1025 * 2);
    const small = createWorld({ bpTable: gameTable(), seed: 11, armyCount: 2 });
    expect(w.snapshotByteLength).toBeGreaterThan(small.snapshotByteLength); // grids grow with the map …
    expect(w.snapshotByteLength).toBeLessThan(small.snapshotByteLength + 1025 * 1025 * 2); // … the heightmap does not
    step(w, [spawnCmd(0, 200, 4, 4, 3), spawnCmd(0, 200, 1020, 1020, 3), spawnCmd(1, 200, 1020, 4, 3), spawnCmd(1, 200, 4, 1020, 3)]);
    const a0 = unitHandles(w, 0);
    const a1 = unitHandles(w, 1);
    expect(a0.length + a1.length).toBe(800);
    // Everyone drives beyond the opposite/own edge (targets are clamped into the map).
    step(w, [moveCmd(0, a0.slice(0, 200), 1100, 1100), moveCmd(0, a0.slice(200), -50, 2000), moveCmd(1, a1.slice(0, 200), 2000, -50), moveCmd(1, a1.slice(200), 1024, 1024)]);
    const U = w.units.col;
    const check = (): void => {
      for (let i = 0; i < w.units.highWater; i++) {
        if (w.units.alive[i] !== 1) continue;
        const x = U.x[i]!;
        const z = U.z[i]!;
        expect(x >= 0 && z >= 0 && x <= w.mapMax && z <= w.mapMax).toBe(true);
        expect(U.y[i]).toBe(sampleHeightRaw(w.terrain, x, z));
        expect(terrainHeight(w, x, z)).toBe(U.y[i]);
      }
    };
    for (let t = 0; t < 120; t++) {
      step(w);
      if (w.tick % 20 === 0) check();
    }
    const snap = snapshot(w);
    const rule = ruleHash(w);
    const full = fullHash(w);
    for (let t = 0; t < 300; t++) step(w);
    check();
    // Some units reached the far corner (1,024, 1,024) — the edge sample row/column is used.
    let atEdge = 0;
    for (let i = 0; i < w.units.highWater; i++) if (w.units.alive[i] === 1 && (U.x[i] === w.mapMax || U.z[i] === w.mapMax)) atEdge++;
    expect(atEdge).toBeGreaterThan(0);
    const later = fullHash(w);
    restore(w, snap);
    expect(ruleHash(w)).toBe(rule);
    expect(fullHash(w)).toBe(full);
    for (let t = 0; t < 300; t++) step(w);
    expect(fullHash(w)).toBe(later);
    // Height formula at the extreme corner: positions clamp to 1/256 WU inside the last cell, the
    // result stays within its four samples (no overflow of the u32 bilinear sum at 1,024 WU).
    const corner = sampleHeightRaw(w.terrain, w.mapMax, w.mapMax);
    expect(sampleHeightRaw(w.terrain, w.mapMax + 12345, w.mapMax + 999)).toBe(corner);
    const H = map.heights;
    const cell = [H[1023 * 1025 + 1023]!, H[1023 * 1025 + 1024]!, H[1024 * 1025 + 1023]!, H[1024 * 1025 + 1024]!].map((v) => v * map.heightScaleRaw);
    expect(corner).toBeGreaterThanOrEqual(Math.min(...cell));
    expect(corner).toBeLessThanOrEqual(Math.max(...cell));
    expect(Math.abs(corner - cell[3]!)).toBeLessThan(Math.max(...cell) - Math.min(...cell));
  });
});
