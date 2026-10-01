import { createRtsMap } from '@faf/formats';
import { isDeepWaterForLand, LAND_MAX_WATER_DEPTH_RAW } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { createTerrainAnalysis, NO_COMPONENT, type TerrainAnalysis } from '../../src/validate/index.ts';
import { GROUND, loadMap, MAP_NAMES, ONE, STEPS_PER_WU, testMap, wu } from './helpers.ts';

/** Independent float reference of the passability rule (as packages/formats/test/tessera.test.ts). */
function referencePassable(a: TerrainAnalysis, maxSlope: number): Uint8Array {
  const D = a.dim;
  const s = a.heightScaleRaw / ONE;
  const sample = (x: number, z: number): number => a.heights[z * D + x]! * s;
  const out = new Uint8Array(D * D);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < D; x++) {
      const xl = Math.max(0, x - 1);
      const xr = Math.min(D - 1, x + 1);
      const zl = Math.max(0, z - 1);
      const zr = Math.min(D - 1, z + 1);
      const slope = Math.hypot((sample(xr, z) - sample(xl, z)) / (xr - xl), (sample(x, zr) - sample(x, zl)) / (zr - zl));
      out[z * D + x] = !isDeepWaterForLand(a.hf, a.waterLevelRaw, x * ONE, z * ONE) && slope <= maxSlope ? 1 : 0;
    }
  }
  return out;
}

/** Independent component check: every 4-neighbour pair of passable samples shares its label. */
function checkLabels(a: TerrainAnalysis): void {
  const D = a.dim;
  const sizes = new Int32Array(a.componentCount);
  let bad = 0;
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < D; x++) {
      const i = z * D + x;
      const l = a.labels[i]!;
      if (a.passable[i] === 0) {
        if (l !== NO_COMPONENT) bad++;
        continue;
      }
      if (l < 0 || l >= a.componentCount) {
        bad++;
        continue;
      }
      sizes[l]!++;
      if (x + 1 < D && a.passable[i + 1] === 1 && a.labels[i + 1] !== l) bad++;
      if (z + 1 < D && a.passable[i + D] === 1 && a.labels[i + D] !== l) bad++;
    }
  }
  expect(bad).toBe(0);
  expect(Array.from(sizes)).toEqual(Array.from(a.componentSizes));
}

describe('createTerrainAnalysis', () => {
  it.each(MAP_NAMES)('%s: passability equals the float reference, labels are consistent', (name) => {
    const map = loadMap(name);
    const a = createTerrainAnalysis(map);
    expect(a.dim).toBe(map.meta.sizeWu + 1);
    const ref = referencePassable(a, 0.6);
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

  it('slope per sample: flat = 0, a linear ramp gives its gradient (central and border differences)', () => {
    const flat = createTerrainAnalysis(testMap());
    expect(flat.slopePermille.every((v) => v === 0)).toBe(true);
    expect(flat.passableCount).toBe(257 * 257);
    expect(flat.componentCount).toBe(1);
    // 0.5 WU per WU along x: 64 steps per sample.
    const ramp = createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (x) => 1000 + x * 64 }));
    for (const i of [0, 5, 128, 256, 257 * 100 + 256]) expect(ramp.slopePermille[i]).toBe(500);
    expect(ramp.passableCount).toBe(257 * 257);
    // 0.75 WU per WU: impassable everywhere.
    const steep = createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (_x, z) => 1000 + z * 96 }));
    expect(steep.slopePermille[300]).toBe(750);
    expect(steep.passableCount).toBe(0);
    expect(steep.componentCount).toBe(0);
  });

  it('passability threshold is exact at 0.6 and configurable', () => {
    // 0.6 WU per WU = 76.8 steps: not representable; 77 steps = 0.6016 (> 0.6), 76 = 0.59375.
    expect(createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (x) => x * 76 })).passableCount).toBe(257 * 257);
    expect(createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (x) => x * 77 })).passableCount).toBe(0);
    expect(createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (x) => x * 77 }), { maxSlopePermille: 700 }).passableCount).toBe(257 * 257);
    // Exactly on the threshold: 0.5 = 64 steps/WU passes with maxSlopePermille 500.
    expect(createTerrainAnalysis(testMap({ waterLevelRaw: null, heights: (x) => x * 64 }), { maxSlopePermille: 500 }).passableCount).toBe(257 * 257);
    expect(() => createTerrainAnalysis(testMap(), { maxSlopePermille: -1 })).toThrow(RangeError);
    expect(() => createTerrainAnalysis(testMap(), { maxSlopePermille: 10001 })).toThrow(RangeError);
    expect(() => createTerrainAnalysis(testMap(), { maxSlopePermille: 0.5 })).toThrow(RangeError);
  });

  it('deep water blocks land units, shallow water does not', () => {
    // Water at 30 WU over a 0.25-WU-deep flat (passable); a gentle trench (slope 0.25) around
    // x = 110 gets deeper than 0.5 WU for |x − 110| < 19 and blocks by depth alone.
    const base = 30 * STEPS_PER_WU - 32;
    const map = testMap({ heights: (x) => base - 32 * Math.max(0, 20 - Math.abs(x - 110)) });
    const a = createTerrainAnalysis(map);
    expect(a.slopePermille.every((v) => v <= 250)).toBe(true);
    expect(a.isPassableAt(wu(30), wu(128))).toBe(true);
    expect(a.isPassableAt(wu(91), wu(128))).toBe(true); // exactly 0.5 WU deep
    expect(a.isPassableAt(wu(92), wu(128))).toBe(false);
    expect(a.isPassableAt(wu(110), wu(128))).toBe(false);
    expect(a.componentCount).toBe(2);
    expect(a.componentAt(wu(10), wu(50))).toBe(a.componentAt(wu(60), wu(50)));
    expect(a.componentAt(wu(60), wu(50))).not.toBe(a.componentAt(wu(200), wu(50)));
    expect(LAND_MAX_WATER_DEPTH_RAW).toBe(2048);
  });

  it('a cliff ring separates its inside; componentAt snaps to the nearest passable sample', () => {
    // Ring 20..24 WU around (128, 128): 10 WU high, sides far steeper than 0.6.
    const map = createRtsMap({
      sizeWu: 256,
      heights: (x, z) => {
        const d2 = (x - 128) ** 2 + (z - 128) ** 2;
        return d2 >= 400 && d2 <= 576 ? GROUND + 10 * STEPS_PER_WU : GROUND;
      },
    });
    const a = createTerrainAnalysis(map);
    // Inside, the flat ring top (4 WU wide) and the outside.
    expect(a.componentCount).toBe(3);
    const inside = a.componentAt(wu(128), wu(128));
    const outside = a.componentAt(wu(10), wu(10));
    expect(inside).not.toBe(outside);
    expect(inside).not.toBe(NO_COMPONENT);
    // The inner ring edge sample (148, 128) is a cliff: impassable.
    expect(a.isPassableAt(wu(148), wu(128))).toBe(false);
    expect(a.componentAt(wu(148), wu(128))).toBe(NO_COMPONENT);
    // Snap: nearest passable sample of (148, 128) within 4 WU is inside (146/147) or on the ring top.
    expect(a.componentAt(wu(147.9), wu(128), wu(4))).not.toBe(NO_COMPONENT);
    // Rounding to the nearest sample (clamped at the map border).
    expect(a.sampleIndexAt(wu(0.49), wu(0.51))).toBe(1 * 257 + 0);
    expect(a.sampleIndexAt(-5 * ONE, 999 * ONE)).toBe(256 * 257 + 0);
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
