/**
 * Terrain analysis for marker validation: built once per heightfield (heights, heightScaleRaw,
 * waterLevelRaw, sizeWu) and shared by every validation run on that terrain.
 *
 * - Slope per sample from central differences (one-sided at the border, scaled ×2 so that every
 *   gradient refers to 2 samples = 8192 raw; the same convention as the prop field expansion in
 *   @faf/formats/propfields.ts and packages/formats/test/tessera.test.ts):
 *     gx = (h[x+1] − h[x−1])·s, gz likewise, G² = gx² + gz²  (raw over 8192 raw)
 *     slope = √G² / 8192, slopePermille = floor(isqrt(G²)·1000 / 8192)
 * - Land passability (PLAN §3.9): !isDeepWaterForLand(@faf/rules) && slope ≤ maxSlopePermille/1000
 *   (default 600 = 0.6). The slope test is exact: G²·10⁶ ≤ m²·8192² (both sides < 2^53 near the
 *   threshold for m ≤ 10000).
 * - Connected components of the passable samples (4-neighbourhood, iterative flood fill with one
 *   Int32Array stack, no recursion) as Int32Array labels (NO_COMPONENT = impassable) and sizes.
 *   Components are numbered in scan order (z, then x), so labels are deterministic.
 *
 * Tool code (not sim): plain JS numbers, but no randomness or time; results are identical on
 * every engine (only integer arithmetic and the correctly rounded Math.sqrt).
 */

import type { RtsMap } from '@faf/formats';
import { isDeepWaterForLand, type Heightfield } from '@faf/rules';

const FX_ONE = 4096;
const FX_SHIFT = 12;
/** Gradients are normalized to a distance of two samples (2 WU). */
const GRAD_DIST_RAW = 2 * FX_ONE;

/** PLAN §3.9 maxSlope 0.6 in 1/1000. */
export const DEFAULT_MAX_SLOPE_PERMILLE = 600;
/** Upper bound of maxSlopePermille (keeps the exact passability test below 2^53). */
export const MAX_SLOPE_PERMILLE_LIMIT = 10000;
/** Label of an impassable sample. */
export const NO_COMPONENT = -1;

export interface TerrainAnalysisOptions {
  /** Land passability threshold in 1/1000 (slope = height change per horizontal distance). Default 600. */
  readonly maxSlopePermille?: number;
}

export interface TerrainAnalysis {
  readonly sizeWu: number;
  /** sizeWu + 1 samples per edge (index z·dim + x). */
  readonly dim: number;
  readonly heightScaleRaw: number;
  readonly waterLevelRaw: number | null;
  /** The heights array the analysis was built from (identity is the cache key). */
  readonly heights: Uint16Array;
  /** Heightfield view for @faf/rules (sampleHeightRaw, waterDepthRaw). */
  readonly hf: Heightfield;
  readonly maxSlopePermille: number;
  /** Slope per sample in 1/1000, floor(isqrt(G²)·1000/8192), saturated at 65535. */
  readonly slopePermille: Uint16Array;
  /** 1 = passable for land units. */
  readonly passable: Uint8Array;
  readonly passableCount: number;
  /** Component id per sample, NO_COMPONENT for impassable samples. */
  readonly labels: Int32Array;
  /** Sample count per component id. */
  readonly componentSizes: Int32Array;
  readonly componentCount: number;
  /** Nearest sample index (z·dim + x) to a position in Fx raw (clamped to the map). */
  sampleIndexAt(xRaw: number, zRaw: number): number;
  /** True if the nearest sample is passable for land units. */
  isPassableAt(xRaw: number, zRaw: number): boolean;
  /**
   * Component of the passable sample nearest to (xRaw, zRaw) within `searchRadiusRaw` (Fx raw;
   * default 0 = only the nearest sample). Ties are resolved in scan order (z, then x).
   * NO_COMPONENT if no passable sample lies within the radius.
   */
  componentAt(xRaw: number, zRaw: number, searchRadiusRaw?: number): number;
}

/** Heightfield view of a map for @faf/rules. */
export function heightfieldOf(map: RtsMap): Heightfield {
  return { sizeWu: map.meta.sizeWu, dim: map.meta.sizeWu + 1, heights: map.heights, heightScaleRaw: map.meta.heightScaleRaw };
}

function clampSample(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

class Analysis implements TerrainAnalysis {
  readonly sizeWu: number;
  readonly dim: number;
  readonly heightScaleRaw: number;
  readonly waterLevelRaw: number | null;
  readonly heights: Uint16Array;
  readonly hf: Heightfield;
  readonly maxSlopePermille: number;
  readonly slopePermille: Uint16Array;
  readonly passable: Uint8Array;
  readonly passableCount: number;
  readonly labels: Int32Array;
  readonly componentSizes: Int32Array;
  readonly componentCount: number;

  constructor(map: RtsMap, maxSlopePermille: number) {
    const size = map.meta.sizeWu;
    const dim = size + 1;
    const n = dim * dim;
    const s = map.meta.heightScaleRaw;
    const water = map.meta.waterLevelRaw;
    const h = map.heights;
    if (h.length !== n) throw new RangeError(`heights must hold ${dim}×${dim} samples, got ${h.length}`);
    this.sizeWu = size;
    this.dim = dim;
    this.heightScaleRaw = s;
    this.waterLevelRaw = water;
    this.heights = h;
    this.hf = heightfieldOf(map);
    this.maxSlopePermille = maxSlopePermille;

    // Exact passability test: G²·10⁶ ≤ m²·8192².
    const slopeLimit = maxSlopePermille * maxSlopePermille * GRAD_DIST_RAW * GRAD_DIST_RAW;
    const slope = new Uint16Array(n);
    const passable = new Uint8Array(n);
    let passableCount = 0;
    const last = dim - 1;
    for (let z = 0; z < dim; z++) {
      const row = z * dim;
      const zl = z > 0 ? z - 1 : 0;
      const zr = z < last ? z + 1 : last;
      const zMul = (zr - zl === 2 ? 1 : 2) * s;
      for (let x = 0; x < dim; x++) {
        const xl = x > 0 ? x - 1 : 0;
        const xr = x < last ? x + 1 : last;
        const gx = (h[row + xr]! - h[row + xl]!) * (xr - xl === 2 ? 1 : 2) * s;
        const gz = (h[zr * dim + x]! - h[zl * dim + x]!) * zMul;
        const g2 = gx * gx + gz * gz;
        const pm = Math.floor((Math.floor(Math.sqrt(g2)) * 1000) / GRAD_DIST_RAW);
        const i = row + x;
        slope[i] = pm > 0xffff ? 0xffff : pm;
        if (g2 * 1_000_000 <= slopeLimit && (water === null || !isDeepWaterForLand(this.hf, water, x << FX_SHIFT, z << FX_SHIFT))) {
          passable[i] = 1;
          passableCount++;
        }
      }
    }
    this.slopePermille = slope;
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
        const i = stack[--sp]!;
        count++;
        const x = i % dim;
        if (x < last) {
          const j = i + 1;
          if (passable[j] === 1 && labels[j] === NO_COMPONENT) {
            labels[j] = id;
            stack[sp++] = j;
          }
        }
        if (x > 0) {
          const j = i - 1;
          if (passable[j] === 1 && labels[j] === NO_COMPONENT) {
            labels[j] = id;
            stack[sp++] = j;
          }
        }
        if (i + dim < n) {
          const j = i + dim;
          if (passable[j] === 1 && labels[j] === NO_COMPONENT) {
            labels[j] = id;
            stack[sp++] = j;
          }
        }
        if (i >= dim) {
          const j = i - dim;
          if (passable[j] === 1 && labels[j] === NO_COMPONENT) {
            labels[j] = id;
            stack[sp++] = j;
          }
        }
      }
      sizes.push(count);
    }
    this.labels = labels;
    this.componentSizes = Int32Array.from(sizes);
    this.componentCount = sizes.length;
  }

  sampleIndexAt(xRaw: number, zRaw: number): number {
    const max = this.sizeWu;
    const x = clampSample((xRaw + (FX_ONE >> 1)) >> FX_SHIFT, max);
    const z = clampSample((zRaw + (FX_ONE >> 1)) >> FX_SHIFT, max);
    return z * this.dim + x;
  }

  isPassableAt(xRaw: number, zRaw: number): boolean {
    return this.passable[this.sampleIndexAt(xRaw, zRaw)] === 1;
  }

  componentAt(xRaw: number, zRaw: number, searchRadiusRaw = 0): number {
    const near = this.labels[this.sampleIndexAt(xRaw, zRaw)]!;
    if (near !== NO_COMPONENT || searchRadiusRaw <= 0) return near;
    const dim = this.dim;
    const max = this.sizeWu;
    const x0 = clampSample((xRaw - searchRadiusRaw) >> FX_SHIFT, max);
    const x1 = clampSample((xRaw + searchRadiusRaw + FX_ONE - 1) >> FX_SHIFT, max);
    const z0 = clampSample((zRaw - searchRadiusRaw) >> FX_SHIFT, max);
    const z1 = clampSample((zRaw + searchRadiusRaw + FX_ONE - 1) >> FX_SHIFT, max);
    const r2 = searchRadiusRaw * searchRadiusRaw;
    let best = NO_COMPONENT;
    let bestD2 = Infinity;
    for (let z = z0; z <= z1; z++) {
      const dz = z * FX_ONE - zRaw;
      for (let x = x0; x <= x1; x++) {
        const label = this.labels[z * dim + x]!;
        if (label === NO_COMPONENT) continue;
        const dx = x * FX_ONE - xRaw;
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
 * Builds the terrain analysis of `map` (slope, land passability, connected components).
 * Cost ≈ linear in the sample count (Setons 1025²: see docs/status/track-editor-p3.md).
 */
export function createTerrainAnalysis(map: RtsMap, options: TerrainAnalysisOptions = {}): TerrainAnalysis {
  const m = options.maxSlopePermille ?? DEFAULT_MAX_SLOPE_PERMILLE;
  if (!Number.isInteger(m) || m < 0 || m > MAX_SLOPE_PERMILLE_LIMIT) {
    throw new RangeError(`maxSlopePermille must be an integer in [0, ${MAX_SLOPE_PERMILLE_LIMIT}], got ${String(m)}`);
  }
  return new Analysis(map, m);
}
