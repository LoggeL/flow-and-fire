/**
 * Terrain decals (PLAN §3.7 "Decals im Terrain-Fragment-Shader", M4 + G19): SDF rings, discs and
 * rectangles evaluated in the terrain FS, so they follow the CDLOD surface exactly (no floating, no
 * z-fighting). Two layers, each binned per 32 × 32 WU chunk:
 *
 * - STATIC (`setTerrainDecals`, e.g. mass/hydro spots): binned only when it changes.
 * - DYNAMIC (G19, `setDynamicDecals` with a preallocated {@link DynamicDecals} buffer: selection rings,
 *   range rings (optionally dashed), waypoints/targets, placement footprints): re-binned only when the
 *   buffer's `version` changes; binning allocates nothing and never touches the static layer.
 *
 * GPU layout per layer (built by {@link DecalLayer}):
 * - decal data, RGBA32I, 2 texels per decal, {@link DECALS_PER_ROW} decals per row:
 *   texel 0 = (xRaw, zRaw, a, b), texel 1 = (kind | dashes << 8, rgba8 packed little endian, lineRaw or minimum radius in 1/16 px, maximum radius raw)
 *   ring: a = radius, b = line width; disc: a = radius, b = soft edge; rect: a/b = half extents x/z,
 *   lineRaw = outline width (all raw Q20.12);
 * - chunk index, R32UI, one texel per chunk: `(listStart << 6) | count` (count ≤ 32)
 * - decal list, R32UI, {@link DECAL_LIST_WIDTH} entries per row: decal indices per chunk in input order
 *   (later decals are drawn on top; the dynamic layer over the static one).
 *
 * Limits (both layers together): {@link MAX_TERRAIN_DECALS} decals and {@link MAX_DECALS_PER_CHUNK} per
 * chunk – the dynamic layer gets what the static layer leaves. Everything beyond is dropped and counted
 * (`droppedDecals`, `chunkOverflow`).
 */
import { TERRAIN_PATCH_WU } from './heightfield.ts';

export type TerrainDecalKind = 'ring' | 'disc' | 'diamond' | 'rect';

export interface TerrainDecal {
  readonly kind: TerrainDecalKind;
  /** Center (Q20.12 raw). */
  readonly x: number;
  readonly z: number;
  /** Ring: center-line radius; disc: outer radius (WU). Rect: unused (see halfX/halfZ). */
  readonly radiusWU: number;
  /** Ring line width in WU (default 0.3); discs use it as a soft edge (default 0.3); rect outline width. */
  readonly widthWU?: number;
  /** 0xRRGGBB. */
  readonly color: number;
  /** Opacity 0..1, default 0.9. */
  readonly alpha?: number;
  /** Ring only: number of dashes around the circle (0 = solid). */
  readonly dashes?: number;
  /** Rect only: half extents along x and z (WU). */
  readonly halfXWU?: number;
  readonly halfZWU?: number;
  /** Minimum screen-space radius, bounded for chunk binning. */
  readonly minRadiusPx?: number;
  readonly maxRadiusWU?: number;
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
const RAW = 4096;

export const DECAL_KIND_RING = 0;
export const DECAL_KIND_DISC = 1;
export const DECAL_KIND_DIAMOND = 2;
export const DECAL_KIND_RECT = 3;
export const DECAL_MAX_WIDTH_FRACTION = 0.45;
/** Default line width of dynamic rings (WU). */
export const DYNAMIC_RING_WIDTH_WU = 0.12;

export interface DecalBinStats {
  /** Decals stored in the data texture. */
  decals: number;
  /** Decals beyond the capacity (not drawn). */
  droppedDecals: number;
  /** (decal, chunk) pairs beyond {@link MAX_DECALS_PER_CHUNK} (not drawn in that chunk). */
  chunkOverflow: number;
  /** Used entries of the list texture. */
  listEntries: number;
}

/**
 * Preallocated structure-of-arrays decal buffer (dynamic layer, G19). The client owns one, fills it
 * with `clear()` + `ring()/disc()/rect()` whenever selection/orders change (each call bumps
 * `version`) and hands it to `renderer.setDynamicDecals` every frame – the renderer re-bins only when
 * the version (or the buffer) changed. No method allocates.
 */
export class DynamicDecals {
  readonly capacity: number;
  readonly kind: Uint8Array;
  readonly dashes: Uint8Array;
  readonly x: Int32Array;
  readonly z: Int32Array;
  /** Ring/disc radius or rect half extent x (WU). */
  readonly a: Float32Array;
  /** Ring line width, disc soft edge or rect half extent z (WU). */
  readonly b: Float32Array;
  /** Rect outline width (WU). */
  readonly line: Float32Array;
  /** 0xAARRGGBB (alpha in the top byte). */
  readonly argb: Uint32Array;
  readonly minRadiusPx: Float32Array;
  readonly maxRadiusWU: Float32Array;
  count = 0;
  /** Content version: bumped by every mutating call (or `touch()` after direct array writes). */
  version = 0;
  /** Pushes rejected because the buffer was full (since the last `clear`). */
  overflow = 0;

  constructor(capacity = MAX_TERRAIN_DECALS) {
    if (!(Number.isInteger(capacity) && capacity >= 0 && capacity <= MAX_TERRAIN_DECALS)) {
      throw new Error(`DynamicDecals: capacity must be 0..${MAX_TERRAIN_DECALS}`);
    }
    this.capacity = capacity;
    this.kind = new Uint8Array(capacity);
    this.dashes = new Uint8Array(capacity);
    this.x = new Int32Array(capacity);
    this.z = new Int32Array(capacity);
    this.a = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
    this.line = new Float32Array(capacity);
    this.argb = new Uint32Array(capacity);
    this.minRadiusPx = new Float32Array(capacity);
    this.maxRadiusWU = new Float32Array(capacity);
  }

  clear(): void {
    this.count = 0;
    this.overflow = 0;
    this.version++;
  }

  /** Marks direct array edits as a new version. */
  touch(): void {
    this.version++;
  }

  private push(kind: number, x: number, z: number, a: number, b: number, line: number, color: number, alpha: number, dashes: number): number {
    this.version++;
    if (this.count >= this.capacity) {
      this.overflow++;
      return -1;
    }
    const i = this.count++;
    this.kind[i] = kind;
    this.minRadiusPx[i] = 0;
    this.maxRadiusWU[i] = a;
    this.x[i] = x;
    this.z[i] = z;
    this.a[i] = a;
    this.b[i] = b;
    this.line[i] = line;
    const al = Math.round((alpha < 0 ? 0 : alpha > 1 ? 1 : alpha) * 255);
    this.argb[i] = ((al << 24) | (color & 0xffffff)) >>> 0;
    this.dashes[i] = dashes < 0 ? 0 : dashes > 255 ? 255 : dashes | 0;
    return i;
  }

  /** Ring (selection or range ring); `dashes` > 0 draws a dashed ring. Returns the index or −1 if full. */
  ring(xRaw: number, zRaw: number, radiusWU: number, color: number, alpha = 0.9, widthWU = DYNAMIC_RING_WIDTH_WU, dashes = 0): number {
    return this.push(DECAL_KIND_RING, xRaw, zRaw, radiusWU, widthWU, 0, color, alpha, dashes);
  }

  /** Filled disc (waypoint/target) with a soft edge. */
  disc(xRaw: number, zRaw: number, radiusWU: number, color: number, alpha = 0.9, softWU = 0.15): number {
    return this.push(DECAL_KIND_DISC, xRaw, zRaw, radiusWU, softWU, 0, color, alpha, 0);
  }

  /** Axis-aligned rectangle (placement footprint): outline plus a translucent fill. */
  rect(xRaw: number, zRaw: number, halfXWU: number, halfZWU: number, color: number, alpha = 0.9, lineWU = 0.15): number {
    return this.push(DECAL_KIND_RECT, xRaw, zRaw, halfXWU, halfZWU, lineWU, color, alpha, 0);
  }

  /** Appends a {@link TerrainDecal} (static-layer input format). */
  add(d: TerrainDecal): number {
    const alpha = d.alpha ?? 0.9;
    const i = d.kind === 'rect'
      ? this.rect(d.x, d.z, d.halfXWU ?? d.radiusWU, d.halfZWU ?? d.radiusWU, d.color, alpha, d.widthWU ?? 0.15)
      : d.kind === 'disc'
        ? this.disc(d.x, d.z, d.radiusWU, d.color, alpha, d.widthWU ?? 0.3)
        : this.push(d.kind === 'diamond' ? DECAL_KIND_DIAMOND : DECAL_KIND_RING, d.x, d.z, d.radiusWU, d.widthWU ?? 0.3, 0, d.color, alpha, d.dashes ?? 0);
    if (i >= 0) {
      this.minRadiusPx[i] = d.minRadiusPx ?? 0;
      this.maxRadiusWU[i] = Math.max(d.radiusWU, d.maxRadiusWU ?? 0);
    }
    return i;
  }
}

/** One binned decal layer: data/chunk-index/list arrays mirrored 1:1 into three textures. */
export class DecalLayer {
  /** RGBA32I data texture content ({@link DECAL_DATA_WIDTH} × {@link DECAL_DATA_HEIGHT} texels). */
  readonly data = new Int32Array(DECAL_DATA_WIDTH * DECAL_DATA_HEIGHT * 4);
  /** R32UI chunk index texture content (chunks × chunks). */
  readonly chunkIndex: Uint32Array;
  /** R32UI list texture content ({@link DECAL_LIST_WIDTH} × {@link listRows}). */
  readonly list: Uint32Array;
  readonly listRows: number;
  readonly stats: DecalBinStats = { decals: 0, droppedDecals: 0, chunkOverflow: 0, listEntries: 0 };
  /** Decals per chunk after the per-chunk limit (valid after `bin`). */
  readonly counts: Uint32Array;
  /** Rows of {@link data} holding decals (upload range). */
  dataRows = 0;
  private readonly cursor: Uint32Array;
  private readonly cover = new Int32Array(MAX_TERRAIN_DECALS * 4);

  constructor(readonly chunks: number) {
    this.chunkIndex = new Uint32Array(chunks * chunks);
    this.counts = new Uint32Array(chunks * chunks);
    this.cursor = new Uint32Array(chunks * chunks);
    this.listRows = Math.max(1, Math.ceil((chunks * chunks * MAX_DECALS_PER_CHUNK) / DECAL_LIST_WIDTH));
    this.list = new Uint32Array(DECAL_LIST_WIDTH * this.listRows);
  }

  /** Chunk range covered by decal i: [cx0, cz0, cx1, cz1] (inclusive), cx0 > cx1 when off-map. */
  private coverage(src: DynamicDecals, i: number, o: number): void {
    const kind = src.kind[i]!;
    let rx: number;
    let rz: number;
    if (kind === DECAL_KIND_RECT) {
      rx = (src.a[i]! + src.line[i]! + BIN_MARGIN_WU) * RAW;
      rz = (src.b[i]! + src.line[i]! + BIN_MARGIN_WU) * RAW;
    } else {
      const r = Math.max(src.a[i]!, src.maxRadiusWU[i]!);
      const width = src.minRadiusPx[i]! > 0 ? Math.max(src.b[i]!, DECAL_MAX_WIDTH_FRACTION * r) : src.b[i]!;
      rx = rz = (r + width * 0.5 + BIN_MARGIN_WU) * RAW;
    }
    const span = TERRAIN_PATCH_WU * RAW;
    const last = this.chunks - 1;
    const x = src.x[i]!;
    const z = src.z[i]!;
    const c = this.cover;
    c[o] = Math.max(0, Math.floor((x - rx) / span));
    c[o + 1] = Math.max(0, Math.floor((z - rz) / span));
    c[o + 2] = Math.min(last, Math.floor((x + rx) / span));
    c[o + 3] = Math.min(last, Math.floor((z + rz) / span));
  }

  /**
   * Packs and bins the first `min(src.count, capacity)` decals. `used` (optional): decals per chunk
   * already taken by another layer (their per-chunk room is `MAX_DECALS_PER_CHUNK − used[k]`).
   * Allocation-free.
   */
  bin(src: DynamicDecals, capacity: number, used: Uint32Array | null): DecalBinStats {
    const n = Math.min(src.count, Math.max(0, capacity), MAX_TERRAIN_DECALS);
    const st = this.stats;
    st.decals = n;
    st.droppedDecals = src.count - n;
    st.chunkOverflow = 0;
    const data = this.data;
    const prevRows = this.dataRows;
    this.dataRows = Math.ceil(n / DECALS_PER_ROW);
    // Clear only the rows that held decals before and hold none now.
    if (prevRows > this.dataRows) data.fill(0, this.dataRows * DECAL_DATA_WIDTH * 4, prevRows * DECAL_DATA_WIDTH * 4);
    for (let i = 0; i < n; i++) {
      const a = src.a[i]!;
      const b = src.b[i]!;
      const x = src.x[i]!;
      const z = src.z[i]!;
      if (!(a >= 0) || !(b >= 0)) throw new Error(`decal ${i}: invalid radius/extent`);
      const o = (Math.floor(i / DECALS_PER_ROW) * DECAL_DATA_WIDTH + (i % DECALS_PER_ROW) * 2) * 4;
      const kind = src.kind[i]!;
      data[o] = x;
      data[o + 1] = z;
      data[o + 2] = Math.round(a * RAW);
      data[o + 3] = kind === DECAL_KIND_RECT ? Math.round(b * RAW) : Math.max(1, Math.round(b * RAW));
      data[o + 4] = kind | (src.dashes[i]! << 8);
      const c = src.argb[i]!;
      // rgba8 little endian: r | g << 8 | b << 16 | a << 24
      data[o + 5] = (((c >>> 16) & 255) | (((c >>> 8) & 255) << 8) | ((c & 255) << 16) | ((c >>> 24) << 24)) | 0;
      data[o + 6] = kind === DECAL_KIND_RECT ? Math.round(src.line[i]! * RAW) : Math.max(0, Math.min(0xffff, Math.round(src.minRadiusPx[i]! * 16)));
      data[o + 7] = Math.round(src.maxRadiusWU[i]! * RAW);
      this.coverage(src, i, i * 4);
    }
    if (n < this.dataRows * DECALS_PER_ROW) {
      data.fill(0, (Math.floor(n / DECALS_PER_ROW) * DECAL_DATA_WIDTH + (n % DECALS_PER_ROW) * 2) * 4, this.dataRows * DECAL_DATA_WIDTH * 4);
    }
    // Pass 1: per-chunk counts (capped); pass 2: prefix sums; pass 3: scatter in input order.
    const counts = this.counts;
    counts.fill(0);
    const chunks = this.chunks;
    const cover = this.cover;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (let cz = cover[o + 1]!; cz <= cover[o + 3]!; cz++) {
        for (let cx = cover[o]!; cx <= cover[o + 2]!; cx++) {
          const k = cz * chunks + cx;
          const room = used === null ? MAX_DECALS_PER_CHUNK : MAX_DECALS_PER_CHUNK - used[k]!;
          if (counts[k]! < room) counts[k]!++;
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
    const fill = this.cursor;
    fill.fill(0);
    const list = this.list;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (let cz = cover[o + 1]!; cz <= cover[o + 3]!; cz++) {
        for (let cx = cover[o]!; cx <= cover[o + 2]!; cx++) {
          const k = cz * chunks + cx;
          const usedK = fill[k]!;
          if (usedK >= counts[k]!) continue;
          list[(idx[k]! >>> 6) + usedK] = i;
          fill[k] = usedK + 1;
        }
      }
    }
    return st;
  }

  /** Rows of {@link list} holding entries (upload range). */
  listRowsUsed(): number {
    return Math.max(1, Math.ceil(this.stats.listEntries / DECAL_LIST_WIDTH));
  }
}

/**
 * Both decal layers of one terrain. `bin(decals)` (static layer, MS2 API) and `binDynamic(buf)`
 * (G19). The static layer is never re-binned by a dynamic change.
 */
export class DecalBinner {
  readonly chunks: number;
  readonly static: DecalLayer;
  readonly dynamic: DecalLayer;
  private staticSrc = new DynamicDecals(0);

  constructor(readonly sizeWu: number) {
    const chunks = sizeWu / TERRAIN_PATCH_WU;
    if (!Number.isInteger(chunks) || chunks < 1) throw new Error(`decals: sizeWu ${sizeWu} not a multiple of ${TERRAIN_PATCH_WU}`);
    this.chunks = chunks;
    this.static = new DecalLayer(chunks);
    this.dynamic = new DecalLayer(chunks);
  }

  /** Static layer: data texture content (MS2 names). */
  get data(): Int32Array {
    return this.static.data;
  }
  get chunkIndex(): Uint32Array {
    return this.static.chunkIndex;
  }
  get list(): Uint32Array {
    return this.static.list;
  }
  get listRows(): number {
    return this.static.listRows;
  }
  get stats(): DecalBinStats {
    return this.static.stats;
  }

  /** Packs and bins the static decals (the dynamic layer must be re-binned afterwards). */
  bin(decals: readonly TerrainDecal[]): DecalBinStats {
    for (let i = 0; i < Math.min(decals.length, MAX_TERRAIN_DECALS); i++) {
      const d = decals[i]!;
      if (!Number.isFinite(d.x) || !Number.isFinite(d.z) || !(d.radiusWU >= 0)) throw new Error(`decal ${i}: invalid position/radius`);
    }
    const need = Math.min(decals.length, MAX_TERRAIN_DECALS);
    if (this.staticSrc.capacity < need) this.staticSrc = new DynamicDecals(need);
    const src = this.staticSrc;
    src.clear();
    for (let i = 0; i < need; i++) src.add(decals[i]!);
    const st = this.static.bin(src, MAX_TERRAIN_DECALS, null);
    st.droppedDecals = decals.length - st.decals;
    return st;
  }

  /** Bins the dynamic layer into what the static layer leaves (capacity and per-chunk room). */
  binDynamic(buf: DynamicDecals): DecalBinStats {
    return this.dynamic.bin(buf, MAX_TERRAIN_DECALS - this.static.stats.decals, this.static.counts);
  }
}
