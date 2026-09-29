/**
 * Terrain description and the CPU mirror of the height formula (PLAN §3.7 "identisch zur Sim", M1).
 *
 * The heightfield is structurally compatible with `@faf/formats` (`mapSimData()`) and the rules
 * `Heightfield` without importing them (render may only depend on protocol/fixed/gl-matrix):
 * `dim = sizeWu + 1` samples per side, one sample per WU, row-major (`index = z * dim + x`), heights
 * as u16 steps of `heightScaleRaw` Q20.12 raw units.
 *
 * Height formula (bit-identical in rules/CPU, this mirror and TERRAIN_HEIGHT_GLSL):
 *   xr = clamp(xRaw, 0, sizeWu·4096 − 16), zr analog; cx = xr >> 12; fx = (xr >> 4) & 255 (cz, fz analog)
 *   a = h00·(256 − fx) + h10·fx; b = h01·(256 − fx) + h11·fx; c = a·(256 − fz) + b·fz   (0 ≤ c < 2³²)
 *   height = (c >>> 16)·s + (((c & 0xffff)·s) >>> 16)   (= floor(c·s / 65536), s = heightScaleRaw)
 */

/** Lighting parameters of a map (formats META `light`): angles in degrees, colors 0..255. */
export interface TerrainLight {
  /** Direction towards the sun on the ground plane, degrees from +x towards +z (Ang16 convention). */
  readonly azimuthDeg: number;
  /** Sun elevation above the horizon in degrees. */
  readonly elevationDeg: number;
  readonly sun: readonly [number, number, number];
  readonly ambient: readonly [number, number, number];
}

/** Optional painted splat weights (formats SPLT, codec raw RGBA8): one RGBA8 plane per 4 layers. */
export interface TerrainSplat {
  readonly layers: 4 | 8;
  /** Texels per side of every plane (covers the whole map). */
  readonly resolution: number;
  /** `layers / 4` planes of `resolution² × 4` bytes (RGBA = weights of layers 4p..4p+3). */
  readonly planes: readonly Uint8Array[];
}

export interface TerrainDesc {
  /** Map size in WU (power of two, 32..4096; MS2 maps: 512). */
  readonly sizeWu: number;
  /** Samples per side = sizeWu + 1. */
  readonly dim: number;
  /** `dim × dim` u16 height steps, index `z * dim + x`. */
  readonly heights: Uint16Array;
  /** Q20.12 raw units per u16 step (1..32; hollow-ridge: 32 = 1/128 WU). */
  readonly heightScaleRaw: number;
  /** Water level in Q20.12 raw, or null (no water surface). */
  readonly waterLevelRaw: number | null;
  readonly splat?: TerrainSplat;
  readonly light?: TerrainLight;
}

/** Minimal heightfield view for {@link sampleTerrainHeightRaw}. */
export interface HeightfieldLike {
  readonly sizeWu: number;
  readonly dim: number;
  readonly heights: Uint16Array;
  readonly heightScaleRaw: number;
}

/** Patch/chunk edge in WU (PLAN §3.1 "Grids in 32×32-Chunks"; CDLOD patch = 33×33 vertices). */
export const TERRAIN_PATCH_WU = 32;
/** Vertices per patch side. */
export const TERRAIN_PATCH_VERTS = TERRAIN_PATCH_WU + 1;
/** Raw units per WU (Q20.12). */
const RAW = 4096;
/** Land units must not enter points deeper than this (0.5 WU, M2) – informational for water shading. */
export const LAND_MAX_WATER_DEPTH_RAW = 2048;

/** Throws with a descriptive message if the description is inconsistent. */
/** Map edge limits (WU), equal to formats MAP_MIN/MAX_SIZE_WU and the sim's MIN/MAX_MAP_SIZE_WU. */
export const TERRAIN_MIN_SIZE_WU = 64;
export const TERRAIN_MAX_SIZE_WU = 4096;

export function validateTerrain(d: TerrainDesc): void {
  const n = d.sizeWu;
  // Same map size rule as the .rtsmap format and the sim (powers of two in 64..4096).
  if (!Number.isInteger(n) || n < TERRAIN_MIN_SIZE_WU || n > TERRAIN_MAX_SIZE_WU || (n & (n - 1)) !== 0) {
    throw new Error(`terrain: sizeWu ${n} must be a power of two in ${TERRAIN_MIN_SIZE_WU}..${TERRAIN_MAX_SIZE_WU}`);
  }
  if (d.dim !== n + 1) throw new Error(`terrain: dim ${d.dim} must be sizeWu + 1 = ${n + 1}`);
  if (d.heights.length !== d.dim * d.dim) throw new Error(`terrain: heights has ${d.heights.length} samples, expected ${d.dim * d.dim}`);
  if (!Number.isInteger(d.heightScaleRaw) || d.heightScaleRaw < 1 || d.heightScaleRaw > 32) {
    throw new Error(`terrain: heightScaleRaw ${d.heightScaleRaw} must be an integer in 1..32`);
  }
  if (d.waterLevelRaw !== null && (!Number.isInteger(d.waterLevelRaw) || Math.abs(d.waterLevelRaw) > 0x7fffffff)) {
    throw new Error(`terrain: waterLevelRaw ${d.waterLevelRaw} must be an int32 or null`);
  }
  const sp = d.splat;
  if (sp !== undefined) {
    if (sp.layers !== 4 && sp.layers !== 8) throw new Error(`terrain: splat layers ${String(sp.layers)} must be 4 or 8`);
    if (!Number.isInteger(sp.resolution) || sp.resolution < 1 || sp.resolution > 8192) {
      throw new Error(`terrain: splat resolution ${sp.resolution} out of range`);
    }
    if (sp.planes.length !== sp.layers / 4) throw new Error(`terrain: splat needs ${sp.layers / 4} planes, got ${sp.planes.length}`);
    for (const p of sp.planes) {
      if (p.length !== sp.resolution * sp.resolution * 4) throw new Error('terrain: splat plane size does not match resolution² × 4');
    }
  }
}

/**
 * CPU mirror of TERRAIN_HEIGHT_GLSL (integer only, exact): height in Q20.12 raw at (xRaw, zRaw).
 * Used by the demo/smoke reference, tests and the chunk bounds; the sim uses `@faf/rules`.
 */
export function sampleTerrainHeightRaw(t: HeightfieldLike, xRaw: number, zRaw: number): number {
  const max = t.sizeWu * RAW - 16;
  const xr = xRaw < 0 ? 0 : xRaw > max ? max : xRaw;
  const zr = zRaw < 0 ? 0 : zRaw > max ? max : zRaw;
  const cx = xr >> 12;
  const cz = zr >> 12;
  const fx = (xr >> 4) & 255;
  const fz = (zr >> 4) & 255;
  const dim = t.dim;
  const H = t.heights;
  const i = cz * dim + cx;
  const h00 = H[i]!;
  const h10 = H[i + 1]!;
  const h01 = H[i + dim]!;
  const h11 = H[i + dim + 1]!;
  const a = h00 * (256 - fx) + h10 * fx;
  const b = h01 * (256 - fx) + h11 * fx;
  const c = a * (256 - fz) + b * fz; // < 2^32, exact in float64
  const s = t.heightScaleRaw;
  return (c >>> 16) * s + (((c & 0xffff) * s) >>> 16);
}

/**
 * Per-chunk (32 × 32 WU) height bounds in raw units. Bilinear interpolation never leaves the range of
 * its four samples and `floor(c·s/65536)` of a convex combination lies in [min·s, max·s], so the
 * bounds over the chunk's 33 × 33 samples are exact for every point of the chunk.
 */
export interface ChunkBounds {
  /** Chunks per side (= sizeWu / 32). */
  readonly chunks: number;
  /** `chunks²` values, index `cz * chunks + cx`. */
  readonly minRaw: Int32Array;
  readonly maxRaw: Int32Array;
  /** Whole-map bounds. */
  readonly mapMinRaw: number;
  readonly mapMaxRaw: number;
}

export function computeChunkBounds(t: HeightfieldLike): ChunkBounds {
  const chunks = t.sizeWu / TERRAIN_PATCH_WU;
  const minRaw = new Int32Array(chunks * chunks);
  const maxRaw = new Int32Array(chunks * chunks);
  const dim = t.dim;
  const H = t.heights;
  const s = t.heightScaleRaw;
  let mapMin = 0x7fffffff;
  let mapMax = -0x80000000;
  for (let cz = 0; cz < chunks; cz++) {
    for (let cx = 0; cx < chunks; cx++) {
      let lo = 65535;
      let hi = 0;
      for (let z = cz * TERRAIN_PATCH_WU; z <= (cz + 1) * TERRAIN_PATCH_WU; z++) {
        const row = z * dim;
        for (let x = cx * TERRAIN_PATCH_WU; x <= (cx + 1) * TERRAIN_PATCH_WU; x++) {
          const h = H[row + x]!;
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      const k = cz * chunks + cx;
      minRaw[k] = lo * s;
      maxRaw[k] = hi * s;
      if (lo * s < mapMin) mapMin = lo * s;
      if (hi * s > mapMax) mapMax = hi * s;
    }
  }
  return { chunks, minRaw, maxRaw, mapMinRaw: mapMin, mapMaxRaw: mapMax };
}
