import { createRtsMap } from '@faf/formats';
import { isDeepWaterForLand, LAND_MAX_CELL_SLOPE_RAW, LAND_MAX_WATER_DEPTH_RAW } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { createTerrainAnalysis, LAND_MAX_SLOPE_PERMILLE, NO_COMPONENT, type TerrainAnalysis } from '../../src/validate/index.ts';
import { GROUND, loadMap, MAP_NAMES, ONE, STEPS_PER_WU, testMap, wu } from './helpers.ts';

/** Independent reference of the cell rule (written out, not via isLandCellBlocked). */
function referenceOpen(a: TerrainAnalysis): Uint8Array {
  const S = a.sizeWu;
  const D = S + 1;
  const h = (x: number, z: number): number => a.heights[z * D + x]!;
  const out = new Uint8Array(S * S);
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const c = [h(x, z), h(x + 1, z), h(x, z + 1), h(x + 1, z + 1)];
      const slope = (Math.max(...c) - Math.min(...c)) * a.heightScaleRaw;
      const border = x === 0 || z === 0 || x === S - 1 || z === S - 1;
      const deep = isDeepWaterForLand(a.hf, a.waterLevelRaw, x * ONE + ONE / 2, z * ONE + ONE / 2);
      out[z * S + x] = !border && slope <= LAND_MAX_CELL_SLOPE_RAW && !deep ? 1 : 0;
    }
  }
  return out;
}

/**
 * Independent component check (8-neighbourhood without corner cutting): every allowed step joins
 * equal labels, and a union-find over the allowed steps gives exactly as many components.
 */
function checkLabels(a: TerrainAnalysis): void {
  const S = a.sizeWu;
  const n = S * S;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const P = a.passable;
  let bad = 0;
  const step = (i: number, j: number): void => {
    if (a.labels[i] !== a.labels[j]) bad++;
    parent[find(i)] = find(j);
  };
  const sizes = new Int32Array(a.componentCount);
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      const l = a.labels[i]!;
      if (P[i] === 0) {
        if (l !== NO_COMPONENT) bad++;
        continue;
      }
      if (l < 0 || l >= a.componentCount) bad++;
      else sizes[l]!++;
      if (x + 1 < S && P[i + 1] === 1) step(i, i + 1);
      if (z + 1 < S && P[i + S] === 1) step(i, i + S);
      if (x + 1 < S && z + 1 < S && P[i + S + 1] === 1 && P[i + 1] === 1 && P[i + S] === 1) step(i, i + S + 1);
      if (x > 0 && z + 1 < S && P[i + S - 1] === 1 && P[i - 1] === 1 && P[i + S] === 1) step(i, i + S - 1);
    }
  }
  let roots = 0;
  for (let i = 0; i < n; i++) if (P[i] === 1 && find(i) === i) roots++;
  expect(bad).toBe(0);
  expect(roots).toBe(a.componentCount);
  expect(Array.from(sizes)).toEqual(Array.from(a.componentSizes));
}

describe('createTerrainAnalysis (cell model of @faf/rules / MS3 nav)', () => {
  it.each(MAP_NAMES)('%s: class-1 passability equals the written-out cell rule, labels are consistent', (name) => {
    const map = loadMap(name);
    const a = createTerrainAnalysis(map);
    expect(a.passable.length).toBe(map.meta.sizeWu * map.meta.sizeWu);
    const ref = referenceOpen(a);
    let diff = 0;
    for (let i = 0; i < ref.length; i++) if (ref[i] !== a.passable[i]) diff++;
    expect(diff).toBe(0);
    let count = 0;
    for (let i = 0; i < a.passable.length; i++) count += a.passable[i]!;
    expect(a.passableCount).toBe(count);
    checkLabels(a);
  });

  it('components are numbered in scan order and sum to the passable count', () => {
    const a = createTerrainAnalysis(loadMap('setons'));
    let sum = 0;
    for (let c = 0; c < a.componentCount; c++) sum += a.componentSizes[c]!;
    expect(sum).toBe(a.passableCount);
    let next = 0;
    let bad = 0;
    for (let i = 0; i < a.labels.length; i++) {
      const l = a.labels[i]!;
      if (l === NO_COMPONENT) continue;
      if (l > next) bad++;
      if (l === next) next++;
    }
    expect(bad).toBe(0);
    expect(next).toBe(a.componentCount);
  });

  it('cell slope: flat = 0, a linear ramp gives its gradient; the limit is 0.75 inclusive', () => {
    expect(LAND_MAX_SLOPE_PERMILLE).toBe(750);
    const flat = createTerrainAnalysis(testMap());
    expect(flat.slopePermille.every((v) => v === 0)).toBe(true);
    // Border cells are blocked (nav rule): 254² passable cells on a 256-WU map.
    expect(flat.passableCount).toBe(254 * 254);
    expect(flat.componentCount).toBe(1);
    // 0.5 WU per WU along x: 64 steps per sample.
    const ramp = createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (x) => 1000 + x * 64 }));
    for (const i of [0, 5, 128, 255, 256 * 100 + 255]) expect(ramp.slopePermille[i]).toBe(500);
    expect(ramp.passableCount).toBe(254 * 254);
    // Exactly 0.75 (96 steps · 32 = 3072) passes, 97 steps (0.7578) block everything.
    expect(createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (_x, z) => 1000 + z * 96 })).passableCount).toBe(254 * 254);
    const steep = createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (_x, z) => 1000 + z * 97 }));
    expect(steep.slopePermille[300]).toBe(757);
    expect(steep.passableCount).toBe(0);
    expect(steep.componentCount).toBe(0);
  });

  it('size classes need clearance (Chebyshev distance to a blocked cell)', () => {
    const map = testMap();
    const c1 = createTerrainAnalysis(map);
    const c2 = createTerrainAnalysis(map, { navClass: 2 });
    const c3 = createTerrainAnalysis(map, { navClass: 3 });
    expect([c1.navClass, c2.navClass, c3.navClass]).toEqual([1, 2, 3]);
    expect(c2.passableCount).toBe(252 * 252);
    expect(c3.passableCount).toBe(250 * 250);
    expect(c1.clearance[1 * 256 + 1]).toBe(1);
    expect(c1.clearance[2 * 256 + 5]).toBe(2);
    expect(c1.clearance[100 * 256 + 100]).toBe(3);
    // A 1-cell gap between two cliffs is passable for class 1 only.
    const gap = testMap({ heights: (x, z) => (z === 128 && (x < 126 || x > 128) ? GROUND + 10 * STEPS_PER_WU : GROUND) });
    expect(createTerrainAnalysis(gap).componentCount).toBe(1);
    expect(createTerrainAnalysis(gap, { navClass: 2 }).componentCount).toBe(2);
    for (const bad of [0, 4, 1.5]) expect(() => createTerrainAnalysis(map, { navClass: bad })).toThrow(RangeError);
  });

  it('no corner cutting: a diagonal between two blocked cells does not connect', () => {
    // Raised samples (k, k) for even k block 2×2 cell blocks that touch only at their corners; the
    // free cells (k+1, k) and (k, k+1) are diagonal neighbours across that corner.
    const wall = testMap({ heights: (x, z) => (x === z && x % 2 === 0 ? GROUND + 10 * STEPS_PER_WU : GROUND) });
    const a = createTerrainAnalysis(wall);
    expect(a.componentCount).toBe(2);
    expect(a.componentAt(wu(200.5), wu(20.5))).not.toBe(a.componentAt(wu(20.5), wu(200.5)));
  });

  it('deep water at the cell centre blocks land units, shallow water does not', () => {
    // Water at 30 WU over a 0.25-WU-deep flat; a gentle trench (slope 0.25) around x = 110.
    const base = 30 * STEPS_PER_WU - 32;
    const map = testMap({ heights: (x) => base - 32 * Math.max(0, 20 - Math.abs(x - 110)) });
    const a = createTerrainAnalysis(map);
    expect(a.slopePermille.every((v) => v <= 250)).toBe(true);
    expect(a.isPassableAt(wu(30.5), wu(128))).toBe(true);
    expect(a.isPassableAt(wu(90.5), wu(128))).toBe(true); // centre 0.375 WU deep
    expect(a.isPassableAt(wu(91.5), wu(128))).toBe(false); // centre 0.625 WU deep
    expect(a.isPassableAt(wu(110), wu(128))).toBe(false);
    expect(a.isPassableAt(wu(129.5), wu(128))).toBe(true);
    expect(a.componentCount).toBe(2);
    expect(a.componentAt(wu(10), wu(50))).toBe(a.componentAt(wu(60), wu(50)));
    expect(a.componentAt(wu(60), wu(50))).not.toBe(a.componentAt(wu(200), wu(50)));
    expect(LAND_MAX_WATER_DEPTH_RAW).toBe(2048);
  });

  it('a cliff ring separates its inside; componentAt snaps to the nearest passable cell', () => {
    // Ring 20..24 WU around (128, 128): 10 WU high, sides far steeper than 0.75.
    const map = createRtsMap({
      sizeWu: 256,
      heights: (x, z) => {
        const d2 = (x - 128) ** 2 + (z - 128) ** 2;
        return d2 >= 400 && d2 <= 576 ? GROUND + 10 * STEPS_PER_WU : GROUND;
      },
    });
    const a = createTerrainAnalysis(map);
    // Inside, the flat ring top and the outside.
    expect(a.componentCount).toBe(3);
    const inside = a.componentAt(wu(128), wu(128));
    const outside = a.componentAt(wu(10), wu(10));
    expect(inside).not.toBe(outside);
    expect(inside).not.toBe(NO_COMPONENT);
    // Cell 147 (corners at 147 and 148) holds the inner cliff: impassable.
    expect(a.isPassableAt(wu(147.5), wu(128.5))).toBe(false);
    expect(a.componentAt(wu(147.5), wu(128.5))).toBe(NO_COMPONENT);
    expect(a.componentAt(wu(147.5), wu(128.5), wu(4))).not.toBe(NO_COMPONENT);
    // Cell of a position (floor), clamped at the map border.
    expect(a.cellIndexAt(wu(0.99), wu(1.01))).toBe(1 * 256 + 0);
    expect(a.cellIndexAt(-5 * ONE, 999 * ONE)).toBe(255 * 256 + 0);
  });

  it('is deterministic', () => {
    const map = loadMap('braidwater');
    const a = createTerrainAnalysis(map);
    const b = createTerrainAnalysis(map);
    expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
    expect(Array.from(a.slopePermille)).toEqual(Array.from(b.slopePermille));
    expect(a.componentCount).toBe(b.componentCount);
  });
});
