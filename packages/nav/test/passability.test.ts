import { isDeepWaterForLand } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import {
  NAV_LAND_MAX_SLOPE_RAW,
  cellSlopeRaw,
  createStandaloneNav,
  fineSearch,
  navMemoryBytes,
  terrainCell,
} from '../src/index.ts';
import { hollowRidge } from './helpers.ts';

// M5 on content/maps/hollow-ridge.rtsmap (512 WU): see packages/formats/scripts/mapgen.ts for the
// layout (plateaus NW (96, 96) / SE (416, 416), mesas (120, 250) / (392, 262), fords (356, 156) /
// (156, 356), lake in the centre).

const map = hollowRidge();
const { nav } = createStandaloneNav(map);
const size = map.sizeWu;

function passable(cls: number, x: number, z: number): boolean {
  return nav.isPassable(cls, x, z);
}

describe('M5 passability on hollow-ridge', () => {
  it('blocks the border, deep water and slopes above NAV_LAND_MAX_SLOPE_RAW — nothing else', () => {
    let deep = 0;
    let steep = 0;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const border = x === 0 || z === 0 || x === size - 1 || z === size - 1;
        const isDeep = isDeepWaterForLand(map, map.waterLevelRaw, x * 4096 + 2048, z * 4096 + 2048);
        const isSteep = cellSlopeRaw(map, x, z) > NAV_LAND_MAX_SLOPE_RAW;
        if (!border && isDeep) deep++;
        if (!border && isSteep) steep++;
        const t = nav.terrainAt(x, z);
        expect(t === 0).toBe(border || isDeep || isSteep);
        expect(t).toBe(terrainCell(map, x, z));
      }
    }
    // the map really has deep water and cliffs
    expect(deep).toBeGreaterThan(10_000);
    expect(steep).toBeGreaterThan(1_000);
  });

  it('plateau and mesa ramps are passable for all classes', () => {
    for (let x = 96; x <= 190; x++) expect(passable(3, x, 96), `NW east ramp x=${x}`).toBe(true);
    for (let z = 96; z <= 190; z++) expect(passable(3, 96, z), `NW south ramp z=${z}`).toBe(true);
    for (let x = 322; x <= 416; x++) expect(passable(3, x, 416), `SE west ramp x=${x}`).toBe(true);
    for (let z = 180; z <= 250; z++) expect(passable(3, 120, z), `NW mesa ramp z=${z}`).toBe(true);
    for (let z = 262; z <= 332; z++) expect(passable(3, 392, z), `SE mesa ramp z=${z}`).toBe(true);
  });

  it('cliffs around plateaus and mesas are blocked', () => {
    // rays away from the ramps must cross a blocked cell in the cliff ring
    const rays: [number, number][] = [
      [-1, 0],
      [0, -1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ];
    for (const [dx, dz] of rays) {
      let hit = false;
      for (let r = 48; r <= 62; r++) {
        const x = 96 + Math.trunc((dx * r * 70) / 99);
        const z = 96 + Math.trunc((dz * r * 70) / 99);
        const xx = dx !== 0 && dz !== 0 ? x : 96 + dx * r;
        const zz = dx !== 0 && dz !== 0 ? z : 96 + dz * r;
        if (!passable(1, xx, zz)) hit = true;
      }
      expect(hit, `NW plateau ray (${dx}, ${dz})`).toBe(true);
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
    ] as const) {
      let hit = false;
      for (let r = 20; r <= 29; r++) if (!passable(1, 120 + dx * r, 250 + dz * r)) hit = true;
      expect(hit, `NW mesa ray (${dx}, ${dz})`).toBe(true);
    }
    // down the northern cliff: 8 WU straight, but the route has to use a ramp
    const top = (44 << 9) | 96;
    const below = (36 << 9) | 96;
    expect(passable(1, 96, 44) && passable(1, 96, 36)).toBe(true);
    const cost = fineSearch(nav.st, 1, top, below, 0, 0, size, size, 0);
    expect(cost).toBeGreaterThan(10 * 80);
  });

  it('deep water blocks, both fords are passable for all classes', () => {
    expect(passable(1, 256, 256)).toBe(false);
    for (const [fx, fz] of [
      [356, 156],
      [156, 356],
    ] as const) {
      for (let d = -3; d <= 3; d++) expect(passable(3, fx + d, fz + d), `ford (${fx + d}, ${fz + d})`).toBe(true);
    }
    // a straight line across the lake is blocked
    let blocked = false;
    for (let t = 200; t <= 312; t++) if (!passable(1, t, t)) blocked = true;
    expect(blocked).toBe(true);
  });

  it('the start plateaus are connected (ramps + ford) for all classes', () => {
    for (let c = 1; c <= 3; c++) {
      const a = nav.componentAt(c, 96, 96);
      expect(a).toBeGreaterThan(0);
      expect(nav.componentAt(c, 416, 416)).toBe(a);
      expect(nav.componentAt(c, 120, 250)).toBe(a); // mesa top via its ramp
      const cost = fineSearch(nav.st, c, (96 << 9) | 96, (416 << 9) | 416, 0, 0, size, size, 0);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('memory of the nav regions: ≤ 12 MiB at 1,024 WU', () => {
    expect(navMemoryBytes(1024).total).toBeLessThanOrEqual(12 * 1024 * 1024);
    expect(navMemoryBytes(512).total).toBeLessThan(5 * 1024 * 1024);
  });
});
