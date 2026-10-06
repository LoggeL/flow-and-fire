/**
 * ClientMap (MS2: M1–M4 client side): the static map replica of the main thread (PLAN §3.6
 * "Client-Replikate: statische Heightmap").
 *
 * - Built from `.rtsmap` bytes or a parsed `RtsMap` (@faf/formats).
 * - `heightfield` is a `rules.Heightfield`; `heightAtRaw` runs `rules.sampleHeightRaw`, so the
 *   client height is bit-identical to the sim (and to the GPU, TERRAIN_HEIGHT_GLSL) by construction.
 * - `heightWU` is the continuous float64 bilinear surface of the same samples for camera and
 *   picking math (differs from the integer formula by < 1/256 WU · slope + 1/4096 WU).
 * - `toTerrainDesc()` feeds `renderer.setTerrain`, `spotDecals()` the terrain decals (M4).
 * - Per 32 × 32 WU chunk: exact min/max height (raw) for picking (coarse skip) — the very bounds
 *   the renderer culls with (render `computeChunkBounds`), so pick and draw never disagree.
 * - `ClientMap.testPlane()` is the flat MS1 test plane as a generated map (formats
 *   `createTestPlaneMap`): every client path (camera, picking, renderer) runs on a real map.
 */
import { createTestPlaneMap, readRtsMap, type MapSpot, type MapStart, type RtsMap } from '@faf/formats';
import { computeChunkBounds, RAW_PER_WU, TERRAIN_PATCH_WU, type TerrainDecal, type TerrainDesc } from '@faf/render';
import { isDeepWaterForLand, sampleHeightRaw, waterDepthRaw, type Heightfield } from '@faf/rules';
import type { MapBounds } from './picking.ts';

/** Chunk edge in WU (PLAN §3.1 "Grids in 32×32-Chunks", = render terrain patch). */
export const MAP_CHUNK_WU = TERRAIN_PATCH_WU;

/** Mass spot decal (M4): green ring. Radius/width in WU. */
export const MASS_SPOT_DECAL = { radiusWU: 1.6, widthWU: 0.35, color: 0x40ff50, alpha: 0.95 } as const;
/** Hydrocarbon spot decal (M4): cyan ring, larger (hydro plants are 3×3). */
export const HYDRO_SPOT_DECAL = { radiusWU: 2.6, widthWU: 0.45, color: 0x20e0ff, alpha: 0.95 } as const;

/**
 * Replica of the nav's land slope limit (`@faf/nav` NAV_LAND_MAX_SLOPE_RAW, Fx raw per WU; the
 * client may not import sim packages). A test pins it against the nav constant.
 */
export const NAV_LAND_MAX_SLOPE_RAW_REPLICA = 3072;

/**
 * Static land passability of cell (x, z) (1 cell = 1 WU) like the nav's M5 rule (`@faf/nav`
 * `terrainCell` = 0): map border, slope of the 4 corner samples above the limit, or deep water at
 * the cell centre. Footprints and size-class clearance are not part of it.
 */
export function landCellBlocked(hf: Heightfield, waterLevelRaw: number | null, x: number, z: number): boolean {
  const size = hf.sizeWu;
  if (!(x >= 0 && z >= 0 && x < size && z < size)) return true;
  if (x === 0 || z === 0 || x === size - 1 || z === size - 1) return true;
  const dim = hf.dim;
  const h = hf.heights;
  const i = z * dim + x;
  const a = h[i]!;
  const b = h[i + 1]!;
  const c = h[i + dim]!;
  const d = h[i + dim + 1]!;
  const slope = (Math.max(Math.max(a, b), Math.max(c, d)) - Math.min(Math.min(a, b), Math.min(c, d))) * hf.heightScaleRaw;
  if (slope > NAV_LAND_MAX_SLOPE_RAW_REPLICA) return true;
  return waterLevelRaw !== null && isDeepWaterForLand(hf, waterLevelRaw, x * 4096 + 2048, z * 4096 + 2048);
}

/** Anything that answers terrain heights (ClientMap, or a fake in tests). */
export interface TerrainHeightSource {
  /** Map edge length in WU (square map from 0 to sizeWu). */
  readonly sizeWu: number;
  /** Continuous surface height in WU at (x, z) WU (positions outside are clamped to the edge). */
  heightWU(xWU: number, zWU: number): number;
  /** Sim-exact height (raw) at (x, z) raw. */
  heightAtRaw(xRaw: number, zRaw: number): number;
  /** Highest point of the map in WU. */
  readonly maxHeightWU: number;
  /** Lowest point of the map in WU. */
  readonly minHeightWU: number;
}

export class ClientMap implements TerrainHeightSource {
  readonly map: RtsMap;
  readonly name: string;
  readonly sizeWu: number;
  readonly dim: number;
  readonly heightScaleRaw: number;
  readonly waterLevelRaw: number | null;
  /** `rules.Heightfield` view (shares `heights`). */
  readonly heightfield: Heightfield;
  /** Map rectangle in raw units: [0, sizeWu·4096]². */
  readonly bounds: MapBounds;
  readonly starts: readonly MapStart[];
  readonly spots: readonly MapSpot[];
  /** Chunks per side. */
  readonly chunksPerSide: number;
  /** Max / min terrain height (raw) per chunk, index cz·chunksPerSide + cx (exact bounds of the formula). */
  readonly chunkMaxRaw: Int32Array;
  readonly chunkMinRaw: Int32Array;
  readonly maxHeightRaw: number;
  readonly minHeightRaw: number;
  readonly maxHeightWU: number;
  readonly minHeightWU: number;
  /** Bytes the map was read from (if built from bytes). */
  readonly bytes: Uint8Array | null;

  private readonly scaleWU: number;

  constructor(map: RtsMap, bytes: Uint8Array | null = null) {
    const m = map.meta;
    this.map = map;
    this.bytes = bytes;
    this.name = m.name;
    this.sizeWu = m.sizeWu;
    this.dim = m.sizeWu + 1;
    this.heightScaleRaw = m.heightScaleRaw;
    this.waterLevelRaw = m.waterLevelRaw;
    if (map.heights.length !== this.dim * this.dim) throw new RangeError(`ClientMap: ${map.heights.length} height samples, expected ${this.dim ** 2}`);
    this.heightfield = { sizeWu: this.sizeWu, dim: this.dim, heights: map.heights, heightScaleRaw: this.heightScaleRaw };
    const edge = this.sizeWu * RAW_PER_WU;
    this.bounds = { minX: 0, minZ: 0, maxX: edge, maxZ: edge };
    this.starts = m.starts;
    this.spots = m.spots;
    this.scaleWU = this.heightScaleRaw / RAW_PER_WU;

    // Exact per-chunk bounds, shared with the renderer's patch culling (one implementation).
    const cb = computeChunkBounds(this.heightfield);
    this.chunksPerSide = cb.chunks;
    this.chunkMaxRaw = cb.maxRaw;
    this.chunkMinRaw = cb.minRaw;
    this.maxHeightRaw = cb.mapMaxRaw;
    this.minHeightRaw = cb.mapMinRaw;
    this.maxHeightWU = this.maxHeightRaw / RAW_PER_WU;
    this.minHeightWU = this.minHeightRaw / RAW_PER_WU;
  }

  /** The flat test plane (`?map=testplane`) as a generated map of `sizeWu` (default 512). */
  static testPlane(sizeWu?: number): ClientMap {
    return new ClientMap(createTestPlaneMap(sizeWu));
  }

  /** Parses `.rtsmap` bytes (throws `FormatError`). */
  static fromBytes(bytes: Uint8Array): ClientMap {
    return new ClientMap(readRtsMap(bytes), bytes);
  }

  /** Sim-exact terrain height (raw) — `rules.sampleHeightRaw`. Allocation-free. */
  heightAtRaw(xRaw: number, zRaw: number): number {
    return sampleHeightRaw(this.heightfield, xRaw, zRaw);
  }

  /** Water depth (raw) at a point; ≤ 0 = dry (`rules.waterDepthRaw`). */
  waterDepthRaw(xRaw: number, zRaw: number): number {
    return waterDepthRaw(this.heightfield, this.waterLevelRaw, xRaw, zRaw);
  }

  /** True if land units may not enter (deep water, M2). */
  isDeepWaterForLand(xRaw: number, zRaw: number): boolean {
    return isDeepWaterForLand(this.heightfield, this.waterLevelRaw, xRaw, zRaw);
  }

  /** Static land passability (nav rule replica, {@link landCellBlocked}) of the cell containing (x, z) raw. */
  landBlockedAtRaw(xRaw: number, zRaw: number): boolean {
    return landCellBlocked(this.heightfield, this.waterLevelRaw, Math.floor(xRaw / RAW_PER_WU), Math.floor(zRaw / RAW_PER_WU));
  }

  /**
   * Continuous bilinear surface height in WU (float64) at (x, z) WU, clamped to the map. Same
   * samples and cell layout as the sim formula; used by camera and ray picking.
   */
  heightWU(xWU: number, zWU: number): number {
    const size = this.sizeWu;
    const x = xWU < 0 ? 0 : xWU > size ? size : xWU;
    const z = zWU < 0 ? 0 : zWU > size ? size : zWU;
    let cx = Math.floor(x);
    let cz = Math.floor(z);
    if (cx >= size) cx = size - 1;
    if (cz >= size) cz = size - 1;
    const fx = x - cx;
    const fz = z - cz;
    const dim = this.dim;
    const h = this.map.heights;
    const i = cz * dim + cx;
    const a = h[i]! + (h[i + 1]! - h[i]!) * fx;
    const b = h[i + dim]! + (h[i + dim + 1]! - h[i + dim]!) * fx;
    return (a + (b - a) * fz) * this.scaleWU;
  }

  /** Max terrain height (WU) of the chunk containing (x, z) WU. */
  chunkMaxWU(cx: number, cz: number): number {
    return this.chunkMaxRaw[cz * this.chunksPerSide + cx]! / RAW_PER_WU;
  }

  /** Start position (raw) of `army`, or null. */
  startOf(army: number): MapStart | null {
    for (const s of this.starts) if (s.army === army) return s;
    return null;
  }

  /** Map centre (raw). */
  center(): { x: number; z: number } {
    const c = (this.sizeWu * RAW_PER_WU) / 2;
    return { x: c, z: c };
  }

  /** Terrain description for `renderer.setTerrain` (shares the height array). */
  toTerrainDesc(): TerrainDesc {
    const m = this.map;
    const l = m.meta.light;
    const base = {
      sizeWu: this.sizeWu,
      dim: this.dim,
      heights: m.heights,
      heightScaleRaw: this.heightScaleRaw,
      waterLevelRaw: this.waterLevelRaw,
      light: { azimuthDeg: l.azimuthDeg, elevationDeg: l.elevationDeg, sun: l.sun, ambient: l.ambient },
    };
    const s = m.splat;
    // SPLT codec 1 (KTX2) is decoded from MS9 on; until then the renderer auto-splats.
    if (s !== null && s.codec === 0) return { ...base, splat: { layers: s.layers, resolution: s.resolution, planes: s.planes } };
    return base;
  }

  /**
   * Terrain decals of the resource spots (M4): mass = green ring r 1.6 WU (line 0.35 WU),
   * hydrocarbon = cyan ring r 2.6 WU (line 0.45 WU), both α 0.95.
   */
  spotDecals(): TerrainDecal[] {
    return this.spots.map((s) => {
      const d = s.kind === 'mass' ? MASS_SPOT_DECAL : HYDRO_SPOT_DECAL;
      return { kind: 'ring', x: s.x, z: s.z, radiusWU: d.radiusWU, widthWU: d.widthWU, color: d.color, alpha: d.alpha };
    });
  }
}
