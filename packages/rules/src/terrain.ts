/**
 * Terrain height and water queries shared by sim, client and AI (PLAN §3.7 "identisch zur Sim").
 *
 * HEIGHT FORMULA — binding contract, bit-identical on CPU (here) and GPU:
 * `TERRAIN_HEIGHT_GLSL` in @faf/render mirrors this function exactly (R16UI + texelFetch + manual
 * bilinear filtering with the same integer weights). rules must not import render, so the two are
 * kept in sync by tests on both sides (render: JS mirror vs. BigInt reference; E2E: GPU probe vs.
 * sampleHeightRaw in 10,000 points). Any change here is a sim change (SIM_BUILD bump) AND a
 * shader change.
 *
 *   xr = clamp(xRaw, 0, sizeWu·4096 − 16), zr likewise
 *   cx = xr >> 12, cz = zr >> 12                   (sample cell, 1 sample per WU)
 *   fx = (xr >> 4) & 255, fz = (zr >> 4) & 255     (8-bit fraction, HEIGHT_FRAC_BITS)
 *   a = h00·(256 − fx) + h10·fx,  b = h01·(256 − fx) + h11·fx
 *   c = a·(256 − fz) + b·fz                        (0 ≤ c < 2^32; GLSL: highp uint)
 *   height = (c >>> 16)·s + (((c & 0xffff)·s) >>> 16)   == floor(c·s / 65536), s = heightScaleRaw
 *
 * At a sample point (fx = fz = 0) the height is exactly h·s. The result is Fx raw (< 2^31).
 *
 * Determinism contract (PLAN §3.12): integers only, allocation-free.
 */

/** Heightfield of a map: `dim = sizeWu + 1` samples per edge, row-major (index z·dim + x). */
export interface Heightfield {
  /** Power of two (MS2 maps: 512). */
  readonly sizeWu: number;
  /** sizeWu + 1. */
  readonly dim: number;
  /** dim² u16 height steps. */
  readonly heights: Uint16Array;
  /** Fx raw per height step, integer 1..32 (32 = 1/128 WU). */
  readonly heightScaleRaw: number;
}

/** Bits of the bilinear weight (fraction of a sample cell = 1/256 WU). */
export const HEIGHT_FRAC_BITS = 8;

/** Deepest water (Fx raw, 0.5 WU) a land unit may stand in; deeper water blocks land units (M2). */
export const LAND_MAX_WATER_DEPTH_RAW = 2048;

/**
 * Terrain height (Fx raw) at world position (xRaw, zRaw) in Fx raw; positions outside the map are
 * clamped to its edge. Allocation-free.
 */
export function sampleHeightRaw(hf: Heightfield, xRaw: number, zRaw: number): number {
  const max = hf.sizeWu * 4096 - 16;
  const xr = xRaw < 0 ? 0 : xRaw > max ? max : xRaw;
  const zr = zRaw < 0 ? 0 : zRaw > max ? max : zRaw;
  const cx = xr >> 12;
  const cz = zr >> 12;
  const fx = (xr >> 4) & 255;
  const fz = (zr >> 4) & 255;
  const dim = hf.dim;
  const h = hf.heights;
  const i = cz * dim + cx;
  const a = h[i]! * (256 - fx) + h[i + 1]! * fx;
  const b = h[i + dim]! * (256 - fx) + h[i + dim + 1]! * fx;
  const c = a * (256 - fz) + b * fz;
  const s = hf.heightScaleRaw;
  return (c >>> 16) * s + (((c & 0xffff) * s) >>> 16);
}

/**
 * Water depth (Fx raw) at (xRaw, zRaw): waterLevelRaw − terrain height. ≤ 0 means dry; a map
 * without water (null) is dry everywhere (returns the negated terrain height).
 */
export function waterDepthRaw(hf: Heightfield, waterLevelRaw: number | null, xRaw: number, zRaw: number): number {
  const ground = sampleHeightRaw(hf, xRaw, zRaw);
  return waterLevelRaw === null ? -ground : waterLevelRaw - ground;
}

/** True if land units must not enter (xRaw, zRaw): water deeper than LAND_MAX_WATER_DEPTH_RAW. */
export function isDeepWaterForLand(hf: Heightfield, waterLevelRaw: number | null, xRaw: number, zRaw: number): boolean {
  if (waterLevelRaw === null) return false;
  return waterLevelRaw - sampleHeightRaw(hf, xRaw, zRaw) > LAND_MAX_WATER_DEPTH_RAW;
}

// ---------------------------------------------------------------------------------------------
// Static land passability of a cell (PLAN §3.8: 1 cell = 1 WU). Canonical definition shared by the
// navigation (MS3 packages/nav static.ts, identical rule and threshold) and the marker editor's
// reachability check (TRACK-EDITOR). Any change here changes nav (SIM_BUILD bump) AND the editor.

/**
 * Steepest cell a land unit may enter: max − min of the cell's 4 corner heights in Fx raw per WU.
 * 3072 = 0.75 WU per WU (≈ 37°): ramps stay passable, plateau and mesa cliffs are blocked.
 * Equal to NAV_LAND_MAX_SLOPE_RAW of MS3's nav.
 */
export const LAND_MAX_CELL_SLOPE_RAW = 3072;

/**
 * Slope of cell (x, z) (0 <= x, z < sizeWu), covering [x, x+1) × [z, z+1) WU: max − min of its
 * corner samples (x, z), (x+1, z), (x, z+1), (x+1, z+1), in Fx raw per WU. Allocation-free.
 */
export function landCellSlopeRaw(hf: Heightfield, x: number, z: number): number {
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

/**
 * True if land units can never enter cell (x, z): it lies on the map border (x or z is 0 or
 * sizeWu − 1), its slope exceeds LAND_MAX_CELL_SLOPE_RAW, or the water at the cell centre is deeper
 * than LAND_MAX_WATER_DEPTH_RAW (isDeepWaterForLand at (x + ½, z + ½)).
 */
export function isLandCellBlocked(hf: Heightfield, waterLevelRaw: number | null, x: number, z: number): boolean {
  const last = hf.sizeWu - 1;
  if (x <= 0 || z <= 0 || x >= last || z >= last) return true;
  if (landCellSlopeRaw(hf, x, z) > LAND_MAX_CELL_SLOPE_RAW) return true;
  return waterLevelRaw !== null && isDeepWaterForLand(hf, waterLevelRaw, x * 4096 + 2048, z * 4096 + 2048);
}
