/**
 * CPU side of the instanced prop pass (GL-free, testable): 30,000 static props binned into 32-WU
 * chunks. Per camera change: chunk frustum test (AABB over terrain + prop heights), one LOD class per
 * chunk by the distance eye → chunk box (LOD 0 / LOD 1 / impostor), then a counting sort of the
 * visible chunk ranges into (mesh, LOD) buckets – memcpy-like copies of the pre-sorted instance words,
 * no per-prop work and no allocation.
 *
 * Instance format (16 B): i32 x, i32 y, i32 z (raw), u16 yaw (Ang16), u8 scale (×64), u8 meta
 * (mesh << 6 | tint 0..63).
 */
import { OUTSIDE } from '@faf/render';
import type { Frustum } from '@faf/render';
import { PROP_LODS, PROP_MESHES } from './meshes.ts';
import type { SceneProps } from './scene.ts';

export const PROP_INSTANCE_STRIDE = 16;
const WORDS = PROP_INSTANCE_STRIDE >> 2;
export const PROP_CHUNK_WU = 32;
/** Buckets: mesh × LOD, then one impostor bucket for all meshes. */
export const IMPOSTOR_BUCKET = PROP_MESHES * PROP_LODS;
export const PROP_BUCKETS = IMPOSTOR_BUCKET + 1;
const RAW = 4096;
const INV_RAW = 1 / RAW;

export interface PropSelectOptions {
  /** Eye position relative to `origin` in WU, or null (shadow casters: fixed LOD). */
  readonly eye: ArrayLike<number> | null;
  /** LOD 0 → 1 distance (WU, bias applied by the caller). */
  readonly lod0Distance: number;
  /** Impostor distance (WU); Infinity = no impostors. */
  readonly impostorDistance: number;
  /** LOD used when `eye` is null. */
  readonly fixedLod: number;
}

/** Result of {@link PropGrid.select}: instance words bucket by bucket (one per consumer). */
export class PropSelection {
  readonly staging: Uint32Array;
  readonly bucketStart = new Uint32Array(PROP_BUCKETS);
  readonly bucketCount = new Uint32Array(PROP_BUCKETS);
  visibleChunks = 0;
  total = 0;
  constructor(capacity: number) {
    this.staging = new Uint32Array(Math.max(1, capacity) * WORDS);
  }
}

export class PropGrid {
  readonly chunks: number;
  readonly count: number;
  /** Instance words sorted by (mesh, chunk). */
  readonly words: Uint32Array;
  /** First instance / count of (mesh, chunk): index mesh · chunks² + chunk. */
  readonly rangeStart: Uint32Array;
  readonly rangeCount: Uint32Array;
  /** Per chunk: AABB y range (raw) of its props, and whether it has any. */
  readonly chunkMinY: Int32Array;
  readonly chunkMaxY: Int32Array;
  readonly chunkHasProps: Uint8Array;

  private readonly visChunk: Uint32Array;
  private readonly visClass: Uint8Array;
  private readonly cursor = new Uint32Array(PROP_BUCKETS);

  /**
   * @param meshHeights height (WU, scale 1) of every prop mesh – the chunk boxes must contain every
   *   prop at any yaw; `meshRadii` likewise for the xz extent.
   */
  constructor(
    props: SceneProps,
    readonly sizeWu: number,
    meshHeights: readonly number[],
    meshRadii: readonly number[],
  ) {
    const chunks = Math.ceil(sizeWu / PROP_CHUNK_WU);
    const nc = chunks * chunks;
    this.chunks = chunks;
    this.count = props.count;
    this.rangeStart = new Uint32Array(PROP_MESHES * nc);
    this.rangeCount = new Uint32Array(PROP_MESHES * nc);
    this.chunkMinY = new Int32Array(nc).fill(0x7fffffff);
    this.chunkMaxY = new Int32Array(nc).fill(-0x80000000);
    this.chunkHasProps = new Uint8Array(nc);
    this.words = new Uint32Array(props.count * WORDS);
    this.visChunk = new Uint32Array(nc);
    this.visClass = new Uint8Array(nc);

    const chunkOf = new Uint32Array(props.count);
    let maxRadius = 0;
    for (const r of meshRadii) maxRadius = Math.max(maxRadius, r);
    this.maxRadiusWU = (maxRadius * 255) / 64;
    for (let i = 0; i < props.count; i++) {
      const cx = Math.min(chunks - 1, Math.max(0, Math.floor(props.x[i]! / (PROP_CHUNK_WU * RAW))));
      const cz = Math.min(chunks - 1, Math.max(0, Math.floor(props.z[i]! / (PROP_CHUNK_WU * RAW))));
      const c = cz * chunks + cx;
      chunkOf[i] = c;
      const m = props.mesh[i]!;
      this.rangeCount[m * nc + c]!++;
      const top = props.y[i]! + Math.ceil(((meshHeights[m] ?? 2) * props.scale[i]! * RAW) / 64);
      if (props.y[i]! < this.chunkMinY[c]!) this.chunkMinY[c] = props.y[i]!;
      if (top > this.chunkMaxY[c]!) this.chunkMaxY[c] = top;
      this.chunkHasProps[c] = 1;
    }
    let acc = 0;
    for (let k = 0; k < PROP_MESHES * nc; k++) {
      this.rangeStart[k] = acc;
      acc += this.rangeCount[k]!;
    }
    const fill = new Uint32Array(PROP_MESHES * nc);
    const w = this.words;
    for (let i = 0; i < props.count; i++) {
      const k = props.mesh[i]! * nc + chunkOf[i]!;
      const j = this.rangeStart[k]! + fill[k]!++;
      const o = j * WORDS;
      w[o] = props.x[i]! >>> 0;
      w[o + 1] = props.y[i]! >>> 0;
      w[o + 2] = props.z[i]! >>> 0;
      w[o + 3] = (props.yaw[i]! | (props.scale[i]! << 16) | (((props.mesh[i]! << 6) | (props.tint[i]! & 63)) << 24)) >>> 0;
    }
  }

  /** Largest xz reach of a prop (WU) – chunk boxes are widened by it. */
  readonly maxRadiusWU: number;

  /**
   * Selects the visible props for a frustum whose planes are relative to `origin` (raw ints), sorted
   * into buckets `mesh · PROP_LODS + lod` and {@link IMPOSTOR_BUCKET}. Returns the instance total.
   */
  select(frustum: Frustum, origin: ArrayLike<number>, opts: PropSelectOptions, out: PropSelection): number {
    const chunks = this.chunks;
    const nc = chunks * chunks;
    const ox = origin[0]!;
    const oy = origin[1]!;
    const oz = origin[2]!;
    const pad = this.maxRadiusWU;
    const eye = opts.eye;
    let nv = 0;
    for (let c = 0; c < nc; c++) {
      if (this.chunkHasProps[c] === 0) continue;
      const cx = c % chunks;
      const cz = (c / chunks) | 0;
      const minX = (cx * PROP_CHUNK_WU * RAW - ox) * INV_RAW - pad;
      const maxX = ((cx + 1) * PROP_CHUNK_WU * RAW - ox) * INV_RAW + pad;
      const minZ = (cz * PROP_CHUNK_WU * RAW - oz) * INV_RAW - pad;
      const maxZ = ((cz + 1) * PROP_CHUNK_WU * RAW - oz) * INV_RAW + pad;
      const minY = (this.chunkMinY[c]! - oy) * INV_RAW;
      const maxY = (this.chunkMaxY[c]! - oy) * INV_RAW;
      if (frustum.testAabb(minX, minY, minZ, maxX, maxY, maxZ) === OUTSIDE) continue;
      let cls = opts.fixedLod;
      if (eye !== null) {
        const ex = eye[0]!;
        const ey = eye[1]!;
        const ez = eye[2]!;
        const dx = ex < minX ? minX - ex : ex > maxX ? ex - maxX : 0;
        const dy = ey < minY ? minY - ey : ey > maxY ? ey - maxY : 0;
        const dz = ez < minZ ? minZ - ez : ez > maxZ ? ez - maxZ : 0;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        cls = d < opts.lod0Distance ? 0 : d < opts.impostorDistance ? 1 : 2;
      }
      this.visChunk[nv] = c;
      this.visClass[nv] = cls;
      nv++;
    }
    out.visibleChunks = nv;

    const bc = out.bucketCount;
    bc.fill(0);
    for (let k = 0; k < nv; k++) {
      const c = this.visChunk[k]!;
      const cls = this.visClass[k]!;
      for (let m = 0; m < PROP_MESHES; m++) {
        const b = cls === 2 ? IMPOSTOR_BUCKET : m * PROP_LODS + cls;
        bc[b]! += this.rangeCount[m * nc + c]!;
      }
    }
    let acc = 0;
    for (let b = 0; b < PROP_BUCKETS; b++) {
      out.bucketStart[b] = acc;
      this.cursor[b] = acc;
      acc += bc[b]!;
    }
    out.total = acc;
    const src = this.words;
    const dst = out.staging;
    for (let k = 0; k < nv; k++) {
      const c = this.visChunk[k]!;
      const cls = this.visClass[k]!;
      for (let m = 0; m < PROP_MESHES; m++) {
        const n = this.rangeCount[m * nc + c]!;
        if (n === 0) continue;
        const b = cls === 2 ? IMPOSTOR_BUCKET : m * PROP_LODS + cls;
        let s = this.rangeStart[m * nc + c]! * WORDS;
        let d = this.cursor[b]! * WORDS;
        const end = s + n * WORDS;
        while (s < end) dst[d++] = src[s++]!;
        this.cursor[b]! += n;
      }
    }
    return acc;
  }
}
