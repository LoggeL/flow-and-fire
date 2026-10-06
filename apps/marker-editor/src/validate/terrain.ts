/**
 * Terrain analysis for marker validation: built once per heightfield (heights, heightScaleRaw,
 * waterLevelRaw, sizeWu) and shared by every validation run on that terrain.
 *
 * The cell model and the passability rule are the game's (PLAN §3.8, MS3 nav), not an editor
 * variant, so "reachable" in the editor means reachable for the pathfinder:
 * - grid of sizeWu × sizeWu cells of 1 WU; cell (x, z) covers [x, x+1) × [z, z+1) WU, index z·sizeWu + x;
 * - a cell is blocked for land units iff @faf/rules isLandCellBlocked: map border, slope
 *   (max − min of its 4 corner heights) > LAND_MAX_CELL_SLOPE_RAW (0.75), or deep water at the cell
 *   centre — the same function and threshold as nav's static terrain;
 * - clearance = Chebyshev distance to the nearest blocked cell (two-pass chamfer, as nav), capped
 *   at NAV_CLASS_MAX; a cell is passable for size class c iff clearance ≥ c (class 1 = not blocked);
 * - components per class: 8-neighbourhood without corner cutting (a diagonal step needs both
 *   orthogonal neighbours passable), the moves of nav's fine search. Labels are numbered in scan
 *   order of their smallest cell (z, then x), i.e. editor label + 1 == nav component label.
 *
 * packages/nav is not a dependency of the editor (MS3 runs in parallel); test/validate/nav-parity
 * compares this analysis with nav's components on the four maps whenever nav is available.
 *
 * Tool code (not sim): plain JS numbers, but no randomness or time; integer arithmetic only.
 */

import type { RtsMap } from '@faf/formats';
import { isLandCellBlocked, landCellSlopeRaw, LAND_MAX_CELL_SLOPE_RAW, type Heightfield } from '@faf/rules';

const FX_ONE = 4096;
const FX_SHIFT = 12;
const HALF_CELL = FX_ONE >> 1;

/** Smallest nav size class (engineers, commanders; nav maps blueprint size class 0 to it). */
export const DEFAULT_NAV_CLASS = 1;
/** Largest nav size class (MS3 NAV_CLASSES). */
export const NAV_CLASS_MAX = 3;
/** Slope limit of land cells in 1/1000 (LAND_MAX_CELL_SLOPE_RAW = 0.75 WU per WU). */
export const LAND_MAX_SLOPE_PERMILLE = Math.floor((LAND_MAX_CELL_SLOPE_RAW * 1000) / FX_ONE);
/** Label of an impassable cell. */
export const NO_COMPONENT = -1;

export interface TerrainAnalysisOptions {
  /** Nav size class whose passability and components are analysed (1..3). Default 1. */
  readonly navClass?: number;
}

export interface TerrainAnalysis {
  readonly sizeWu: number;
  readonly heightScaleRaw: number;
  readonly waterLevelRaw: number | null;
  /** The heights array the analysis was built from (identity is the cache key). */
  readonly heights: Uint16Array;
  /** Heightfield view for @faf/rules (sampleHeightRaw, waterDepthRaw). */
  readonly hf: Heightfield;
  readonly navClass: number;
  /** Cell slope in 1/1000: floor(landCellSlopeRaw·1000/4096), saturated at 65535. */
  readonly slopePermille: Uint16Array;
  /** Clearance per cell (0 = blocked), capped at NAV_CLASS_MAX. */
  readonly clearance: Uint8Array;
  /** 1 = passable for `navClass` (clearance ≥ navClass). */
  readonly passable: Uint8Array;
  readonly passableCount: number;
  /** Component id per cell, NO_COMPONENT for impassable cells. */
  readonly labels: Int32Array;
  /** Cell count per component id. */
  readonly componentSizes: Int32Array;
  readonly componentCount: number;
  /** Index (z·sizeWu + x) of the cell containing a position in Fx raw (clamped to the map). */
  cellIndexAt(xRaw: number, zRaw: number): number;
  /** True if the cell containing the position is passable for `navClass`. */
  isPassableAt(xRaw: number, zRaw: number): boolean;
  /**
   * Component of the cell containing (xRaw, zRaw), or else of the passable cell whose centre is
   * nearest within `searchRadiusRaw` (Fx raw; default 0 = only the containing cell). Ties are
   * resolved in scan order (z, then x). NO_COMPONENT if there is none.
   */
  componentAt(xRaw: number, zRaw: number, searchRadiusRaw?: number): number;
}

/** Heightfield view of a map for @faf/rules. */
export function heightfieldOf(map: RtsMap): Heightfield {
  return { sizeWu: map.meta.sizeWu, dim: map.meta.sizeWu + 1, heights: map.heights, heightScaleRaw: map.meta.heightScaleRaw };
}

function clampCell(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/** Two-pass chamfer transform (unit weights, 8-neighbourhood) = Chebyshev distance to a blocked cell. */
function chamfer(c: Uint8Array, size: number, cap: number): void {
  for (let z = 0; z < size; z++) {
    const row = z * size;
    for (let x = 0; x < size; x++) {
      const i = row + x;
      if (c[i] === 0) continue;
      let m = cap - 1;
      if (x > 0) m = Math.min(m, c[i - 1]!);
      if (z > 0) {
        m = Math.min(m, c[i - size]!);
        if (x > 0) m = Math.min(m, c[i - size - 1]!);
        if (x < size - 1) m = Math.min(m, c[i - size + 1]!);
      }
      c[i] = m + 1;
    }
  }
  for (let z = size - 1; z >= 0; z--) {
    const row = z * size;
    for (let x = size - 1; x >= 0; x--) {
      const i = row + x;
      const v = c[i]!;
      if (v === 0) continue;
      let m = v - 1;
      if (x < size - 1) m = Math.min(m, c[i + 1]!);
      if (z < size - 1) {
        m = Math.min(m, c[i + size]!);
        if (x < size - 1) m = Math.min(m, c[i + size + 1]!);
        if (x > 0) m = Math.min(m, c[i + size - 1]!);
      }
      c[i] = m + 1;
    }
  }
}

/** 8-neighbourhood offsets: 4 orthogonal first, then the diagonals (as nav's DIR_X / DIR_Z). */
const DX = [1, -1, 0, 0, 1, -1, 1, -1] as const;
const DZ = [0, 0, 1, -1, 1, 1, -1, -1] as const;

class Analysis implements TerrainAnalysis {
  readonly sizeWu: number;
  readonly heightScaleRaw: number;
  readonly waterLevelRaw: number | null;
  readonly heights: Uint16Array;
  readonly hf: Heightfield;
  readonly navClass: number;
  readonly slopePermille: Uint16Array;
  readonly clearance: Uint8Array;
  readonly passable: Uint8Array;
  readonly passableCount: number;
  readonly labels: Int32Array;
  readonly componentSizes: Int32Array;
  readonly componentCount: number;

  constructor(map: RtsMap, navClass: number) {
    const size = map.meta.sizeWu;
    const dim = size + 1;
    const n = size * size;
    const water = map.meta.waterLevelRaw;
    if (map.heights.length !== dim * dim) throw new RangeError(`heights must hold ${dim}×${dim} samples, got ${map.heights.length}`);
    this.sizeWu = size;
    this.heightScaleRaw = map.meta.heightScaleRaw;
    this.waterLevelRaw = water;
    this.heights = map.heights;
    const hf = heightfieldOf(map);
    this.hf = hf;
    this.navClass = navClass;

    const slope = new Uint16Array(n);
    const clear = new Uint8Array(n);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = z * size + x;
        const pm = Math.floor((landCellSlopeRaw(hf, x, z) * 1000) / FX_ONE);
        slope[i] = pm > 0xffff ? 0xffff : pm;
        clear[i] = isLandCellBlocked(hf, water, x, z) ? 0 : 1;
      }
    }
    chamfer(clear, size, NAV_CLASS_MAX);
    const passable = new Uint8Array(n);
    let passableCount = 0;
    for (let i = 0; i < n; i++) {
      if (clear[i]! >= navClass) {
        passable[i] = 1;
        passableCount++;
      }
    }
    this.slopePermille = slope;
    this.clearance = clear;
    this.passable = passable;
    this.passableCount = passableCount;

    const labels = new Int32Array(n).fill(NO_COMPONENT);
    const stack = new Int32Array(n);
    const sizes: number[] = [];
    for (let seed = 0; seed < n; seed++) {
      if (passable[seed] === 0 || labels[seed] !== NO_COMPONENT) continue;
      const id = sizes.length;
      let count = 0;
      let sp = 0;
      labels[seed] = id;
      stack[sp++] = seed;
      while (sp > 0) {
        const c = stack[--sp]!;
        count++;
        const x = c % size;
        const z = (c - x) / size;
        for (let d = 0; d < 8; d++) {
          const nx = x + DX[d]!;
          const nz = z + DZ[d]!;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
          const j = nz * size + nx;
          if (passable[j] === 0 || labels[j] !== NO_COMPONENT) continue;
          // No corner cutting: a diagonal step needs both orthogonal neighbours.
          if (d >= 4 && (passable[c + DX[d]!] === 0 || passable[c + DZ[d]! * size] === 0)) continue;
          labels[j] = id;
          stack[sp++] = j;
        }
      }
      sizes.push(count);
    }
    this.labels = labels;
    this.componentSizes = Int32Array.from(sizes);
    this.componentCount = sizes.length;
  }

  cellIndexAt(xRaw: number, zRaw: number): number {
    const max = this.sizeWu - 1;
    return clampCell(zRaw >> FX_SHIFT, max) * this.sizeWu + clampCell(xRaw >> FX_SHIFT, max);
  }

  isPassableAt(xRaw: number, zRaw: number): boolean {
    return this.passable[this.cellIndexAt(xRaw, zRaw)] === 1;
  }

  componentAt(xRaw: number, zRaw: number, searchRadiusRaw = 0): number {
    const near = this.labels[this.cellIndexAt(xRaw, zRaw)]!;
    if (near !== NO_COMPONENT || searchRadiusRaw <= 0) return near;
    const size = this.sizeWu;
    const max = size - 1;
    const x0 = clampCell((xRaw - searchRadiusRaw - HALF_CELL) >> FX_SHIFT, max);
    const x1 = clampCell((xRaw + searchRadiusRaw) >> FX_SHIFT, max);
    const z0 = clampCell((zRaw - searchRadiusRaw - HALF_CELL) >> FX_SHIFT, max);
    const z1 = clampCell((zRaw + searchRadiusRaw) >> FX_SHIFT, max);
    const r2 = searchRadiusRaw * searchRadiusRaw;
    let best = NO_COMPONENT;
    let bestD2 = Infinity;
    for (let z = z0; z <= z1; z++) {
      const dz = z * FX_ONE + HALF_CELL - zRaw;
      for (let x = x0; x <= x1; x++) {
        const label = this.labels[z * size + x]!;
        if (label === NO_COMPONENT) continue;
        const dx = x * FX_ONE + HALF_CELL - xRaw;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2 && d2 < bestD2) {
          bestD2 = d2;
          best = label;
        }
      }
    }
    return best;
  }
}

/**
 * Builds the terrain analysis of `map` (cell slope, land passability for a nav size class,
 * connected components). Cost ≈ linear in the cell count (Setons 1024²: see docs/status/track-editor.md).
 */
export function createTerrainAnalysis(map: RtsMap, options: TerrainAnalysisOptions = {}): TerrainAnalysis {
  const c = options.navClass ?? DEFAULT_NAV_CLASS;
  if (!Number.isInteger(c) || c < 1 || c > NAV_CLASS_MAX) {
    throw new RangeError(`navClass must be an integer in [1, ${NAV_CLASS_MAX}], got ${String(c)}`);
  }
  return new Analysis(map, c);
}
