/**
 * Terrain decals (PLAN §3.7 "Decals im Terrain-Fragment-Shader"): SDF rings and discs evaluated in
 * the terrain FS, so they follow the CDLOD surface exactly (no floating, no z-fighting).
 *
 * GPU layout (built by {@link DecalBinner}):
 * - decal data, RGBA32I, 2 texels per decal, {@link DECALS_PER_ROW} decals per row:
 *   texel 0 = (xRaw, zRaw, radiusRaw, widthRaw), texel 1 = (kind, rgba8 packed little endian, 0, 0)
 * - chunk index, R32UI, one texel per 32 × 32 WU chunk: `(listStart << 6) | count` (count ≤ 32)
 * - decal list, R32UI, {@link DECAL_LIST_WIDTH} entries per row: decal indices per chunk, in input order
 *   (later decals are drawn on top).
 *
 * Limits: {@link MAX_TERRAIN_DECALS} decals (more are dropped and counted) and
 * {@link MAX_DECALS_PER_CHUNK} per chunk (further (decal, chunk) pairs are dropped and counted).
 */
import { TERRAIN_PATCH_WU } from './heightfield.ts';

export type TerrainDecalKind = 'ring' | 'disc';

export interface TerrainDecal {
  readonly kind: TerrainDecalKind;
  /** Center (Q20.12 raw). */
  readonly x: number;
  readonly z: number;
  /** Ring: center-line radius; disc: outer radius (WU). */
  readonly radiusWU: number;
  /** Ring line width in WU (default 0.3); discs use it as a soft edge (default 0.3). */
  readonly widthWU?: number;
  /** 0xRRGGBB. */
  readonly color: number;
  /** Opacity 0..1, default 0.9. */
  readonly alpha?: number;
}

export const MAX_TERRAIN_DECALS = 4096;
export const MAX_DECALS_PER_CHUNK = 32;
/** Decals per row of the data texture (2 texels each). */
export const DECALS_PER_ROW = 64;
export const DECAL_DATA_WIDTH = DECALS_PER_ROW * 2;
export const DECAL_DATA_HEIGHT = MAX_TERRAIN_DECALS / DECALS_PER_ROW;
export const DECAL_LIST_WIDTH = 1024;
/** Extra coverage for anti-aliasing when binning (WU). */
const BIN_MARGIN_WU = 0.5;

export const DECAL_KIND_RING = 0;
export const DECAL_KIND_DISC = 1;

export interface DecalBinStats {
  /** Decals stored in the data texture. */
  decals: number;
  /** Decals beyond {@link MAX_TERRAIN_DECALS} (not drawn). */
  droppedDecals: number;
  /** (decal, chunk) pairs beyond {@link MAX_DECALS_PER_CHUNK} (not drawn in that chunk). */
  chunkOverflow: number;
  /** Used entries of the list texture. */
  listEntries: number;
}

export class DecalBinner {
  readonly chunks: number;
  /** RGBA32I data texture content ({@link DECAL_DATA_WIDTH} × {@link DECAL_DATA_HEIGHT} texels). */
  readonly data = new Int32Array(DECAL_DATA_WIDTH * DECAL_DATA_HEIGHT * 4);
  /** R32UI chunk index texture content (chunks × chunks). */
  readonly chunkIndex: Uint32Array;
  /** R32UI list texture content ({@link DECAL_LIST_WIDTH} × {@link listRows}). */
  readonly list: Uint32Array;
  readonly listRows: number;
  readonly stats: DecalBinStats = { decals: 0, droppedDecals: 0, chunkOverflow: 0, listEntries: 0 };
  private readonly counts: Uint32Array;
  private readonly cover: Int32Array;

  constructor(readonly sizeWu: number) {
    const chunks = sizeWu / TERRAIN_PATCH_WU;
    if (!Number.isInteger(chunks) || chunks < 1) throw new Error(`decals: sizeWu ${sizeWu} not a multiple of ${TERRAIN_PATCH_WU}`);
    this.chunks = chunks;
    this.chunkIndex = new Uint32Array(chunks * chunks);
    this.counts = new Uint32Array(chunks * chunks);
    this.listRows = Math.max(1, Math.ceil((chunks * chunks * MAX_DECALS_PER_CHUNK) / DECAL_LIST_WIDTH));
    this.list = new Uint32Array(DECAL_LIST_WIDTH * this.listRows);
    this.cover = new Int32Array(MAX_TERRAIN_DECALS * 4);
  }

  /** Chunk range covered by a decal: [cx0, cz0, cx1, cz1] (inclusive), or cx0 > cx1 when off-map. */
  coverage(d: TerrainDecal, out: Int32Array, o = 0): void {
    const reach = (d.radiusWU + (d.widthWU ?? 0.3) * 0.5 + BIN_MARGIN_WU) * 4096;
    const span = TERRAIN_PATCH_WU * 4096;
    const last = this.chunks - 1;
    out[o] = Math.max(0, Math.floor((d.x - reach) / span));
    out[o + 1] = Math.max(0, Math.floor((d.z - reach) / span));
    out[o + 2] = Math.min(last, Math.floor((d.x + reach) / span));
    out[o + 3] = Math.min(last, Math.floor((d.z + reach) / span));
  }

  /** Packs and bins the decals; afterwards upload {@link data}, {@link chunkIndex} and {@link list}. */
  bin(decals: readonly TerrainDecal[]): DecalBinStats {
    const n = Math.min(decals.length, MAX_TERRAIN_DECALS);
    const st = this.stats;
    st.decals = n;
    st.droppedDecals = decals.length - n;
    st.chunkOverflow = 0;
    const data = this.data;
    data.fill(0);
    const cover = this.cover;
    for (let i = 0; i < n; i++) {
      const d = decals[i]!;
      if (!(d.radiusWU >= 0) || !Number.isFinite(d.x) || !Number.isFinite(d.z)) {
        throw new Error(`decal ${i}: invalid position/radius`);
      }
      const o = ((Math.floor(i / DECALS_PER_ROW) * DECAL_DATA_WIDTH) + (i % DECALS_PER_ROW) * 2) * 4;
      data[o] = Math.round(d.x);
      data[o + 1] = Math.round(d.z);
      data[o + 2] = Math.round(d.radiusWU * 4096);
      data[o + 3] = Math.max(1, Math.round((d.widthWU ?? 0.3) * 4096));
      data[o + 4] = d.kind === 'disc' ? DECAL_KIND_DISC : DECAL_KIND_RING;
      const a = Math.round(Math.min(1, Math.max(0, d.alpha ?? 0.9)) * 255);
      const c = d.color;
      data[o + 5] = (((c >> 16) & 255) | (((c >> 8) & 255) << 8) | ((c & 255) << 16) | (a << 24)) | 0;
      this.coverage(d, cover, i * 4);
    }
    // Pass 1: per-chunk counts (capped); pass 2: prefix sums; pass 3: scatter in input order.
    const counts = this.counts;
    counts.fill(0);
    const chunks = this.chunks;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (let cz = cover[o + 1]!; cz <= cover[o + 3]!; cz++) {
        for (let cx = cover[o]!; cx <= cover[o + 2]!; cx++) {
          const k = cz * chunks + cx;
          if (counts[k]! < MAX_DECALS_PER_CHUNK) counts[k]!++;
          else st.chunkOverflow++;
        }
      }
    }
    let acc = 0;
    const idx = this.chunkIndex;
    for (let k = 0; k < chunks * chunks; k++) {
      idx[k] = ((acc << 6) | counts[k]!) >>> 0;
      acc += counts[k]!;
    }
    st.listEntries = acc;
    const fill = counts; // reused as per-chunk cursor
    fill.fill(0);
    const list = this.list;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (let cz = cover[o + 1]!; cz <= cover[o + 3]!; cz++) {
        for (let cx = cover[o]!; cx <= cover[o + 2]!; cx++) {
          const k = cz * chunks + cx;
          const used = fill[k]!;
          if (used >= (idx[k]! & 63)) continue;
          list[(idx[k]! >>> 6) + used] = i;
          fill[k] = used + 1;
        }
      }
    }
    return st;
  }
}
