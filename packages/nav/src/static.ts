/**
 * M5 static passability of the Land layer (area 'static', identity via mapSimHash).
 *
 * A cell (x, z) covers [x, x+1) × [z, z+1) WU; its corner samples are the heightfield samples
 * (x, z), (x+1, z), (x, z+1), (x+1, z+1). The cell is blocked for land units if
 *  - it lies on the map border (x or z is 0 or size − 1),
 *  - the water at the cell centre is deeper than rules.LAND_MAX_WATER_DEPTH_RAW (identical to
 *    rules.isDeepWaterForLand at (x + ½, z + ½)), or
 *  - its slope (max − min of the 4 corner heights, Fx raw per WU) exceeds NAV_LAND_MAX_SLOPE_RAW.
 * Otherwise terrain = 1 + cost level: slope ≤ ½·max → 0, ≤ ⅔·max → 1, ≤ ⅚·max → 2, else 3
 * (gentle terrain costs nothing extra; steep ramps cost up to +60 %).
 */

import { isDeepWaterForLand, type Heightfield } from '@faf/rules';
import { NAV_COST_LEVELS, NAV_LAND_MAX_SLOPE_RAW } from './constants.ts';
import type { NavState } from './state.ts';

/** Map input of the nav: a rules heightfield plus the water level (Fx raw, null = no water). */
export interface NavMapInput extends Heightfield {
  readonly waterLevelRaw: number | null;
}

/** Slope (Fx raw per WU) of cell (x, z): max − min of its four corner heights. */
export function cellSlopeRaw(hf: Heightfield, x: number, z: number): number {
  const dim = hf.dim;
  const h = hf.heights;
  const i = z * dim + x;
  const a = h[i]!;
  const b = h[i + 1]!;
  const c = h[i + dim]!;
  const d = h[i + dim + 1]!;
  const mx = Math.max(Math.max(a, b), Math.max(c, d));
  const mn = Math.min(Math.min(a, b), Math.min(c, d));
  return (mx - mn) * hf.heightScaleRaw;
}

/** Terrain byte of a cell (0 = blocked, else 1 + cost level). */
export function terrainCell(map: NavMapInput, x: number, z: number): number {
  const size = map.sizeWu;
  if (x === 0 || z === 0 || x === size - 1 || z === size - 1) return 0;
  const slope = cellSlopeRaw(map, x, z);
  if (slope > NAV_LAND_MAX_SLOPE_RAW) return 0;
  if (map.waterLevelRaw !== null && isDeepWaterForLand(map, map.waterLevelRaw, x * 4096 + 2048, z * 4096 + 2048)) return 0;
  const m = NAV_LAND_MAX_SLOPE_RAW;
  // cost levels: ≤ ½ max → 0, ≤ ⅔ → 1, ≤ ⅚ → 2, else 3
  const level = slope * 2 <= m ? 0 : slope * 3 <= 2 * m ? 1 : slope * 6 <= 5 * m ? 2 : NAV_COST_LEVELS - 1;
  return 1 + level;
}

/** Fills the static terrain region from the map. */
export function precomputeTerrain(st: NavState, map: NavMapInput): void {
  if (map.sizeWu !== st.size) throw new RangeError(`nav: map size ${map.sizeWu} != nav size ${st.size}`);
  if (map.dim !== map.sizeWu + 1 || map.heights.length !== map.dim * map.dim) {
    throw new RangeError('nav: heightfield dim/heights do not match sizeWu');
  }
  const size = st.size;
  const t = st.terrain;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) t[z * size + x] = terrainCell(map, x, z);
  }
}
