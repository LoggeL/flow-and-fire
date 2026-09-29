/**
 * CDLOD patch selection with one level (PLAN §3.7, MS2): every 32 × 32 WU chunk is one 33 × 33-vertex
 * patch. Visible chunks are found by a quadtree walk over a min/max-height pyramid built once per
 * terrain (`setTerrain`); fully visible nodes emit all their chunks without further tests. The result
 * equals testing every chunk AABB individually (see the brute-force reference used by the tests).
 */
import type { Frustum } from '../frustum.ts';
import { INSIDE, OUTSIDE } from '../frustum.ts';
import type { ChunkBounds } from './heightfield.ts';
import { TERRAIN_PATCH_WU } from './heightfield.ts';

const INV_RAW = 1 / 4096;

/** Camera-relative AABB of chunk (cx, cz) in WU (origin = camPosInt). */
function chunkBox(
  bounds: ChunkBounds,
  cx: number,
  cz: number,
  cam: ArrayLike<number>,
  out: Float64Array,
): void {
  const k = cz * bounds.chunks + cx;
  out[0] = (cx * TERRAIN_PATCH_WU * 4096 - cam[0]!) * INV_RAW;
  out[1] = (bounds.minRaw[k]! - cam[1]!) * INV_RAW;
  out[2] = (cz * TERRAIN_PATCH_WU * 4096 - cam[2]!) * INV_RAW;
  out[3] = ((cx + 1) * TERRAIN_PATCH_WU * 4096 - cam[0]!) * INV_RAW;
  out[4] = (bounds.maxRaw[k]! - cam[1]!) * INV_RAW;
  out[5] = ((cz + 1) * TERRAIN_PATCH_WU * 4096 - cam[2]!) * INV_RAW;
}

/**
 * Reference: tests every chunk. Writes visible chunk indices (`cz * chunks + cx`) into `out` and
 * returns their count.
 */
export function cullChunksBruteForce(bounds: ChunkBounds, frustum: Frustum, camPosInt: ArrayLike<number>, out: Uint32Array): number {
  const box = new Float64Array(6);
  let n = 0;
  for (let cz = 0; cz < bounds.chunks; cz++) {
    for (let cx = 0; cx < bounds.chunks; cx++) {
      chunkBox(bounds, cx, cz, camPosInt, box);
      if (frustum.testAabb(box[0]!, box[1]!, box[2]!, box[3]!, box[4]!, box[5]!) !== OUTSIDE) out[n++] = cz * bounds.chunks + cx;
    }
  }
  return n;
}

/** Quadtree culler over the chunk grid (allocation-free per call). */
export class PatchCuller {
  /** Level l has `chunks >> l` nodes per side; min/max heights (raw) per node. */
  private readonly levelMin: Int32Array[] = [];
  private readonly levelMax: Int32Array[] = [];
  private readonly levels: number;
  private readonly stack: Int32Array;
  private readonly box = new Float64Array(6);
  /** Visible chunk indices of the last `cull` (`cz * chunks + cx`). */
  readonly visible: Uint32Array;
  /** Number of valid entries in {@link visible}. */
  count = 0;

  constructor(readonly bounds: ChunkBounds) {
    const n = bounds.chunks;
    this.visible = new Uint32Array(n * n);
    let size = n;
    let min = bounds.minRaw;
    let max = bounds.maxRaw;
    this.levelMin.push(min);
    this.levelMax.push(max);
    while (size > 1) {
      const half = size >> 1;
      const nmin = new Int32Array(half * half);
      const nmax = new Int32Array(half * half);
      for (let z = 0; z < half; z++) {
        for (let x = 0; x < half; x++) {
          const a = 2 * z * size + 2 * x;
          const b = a + size;
          nmin[z * half + x] = Math.min(min[a]!, min[a + 1]!, min[b]!, min[b + 1]!);
          nmax[z * half + x] = Math.max(max[a]!, max[a + 1]!, max[b]!, max[b + 1]!);
        }
      }
      this.levelMin.push(nmin);
      this.levelMax.push(nmax);
      min = nmin;
      max = nmax;
      size = half;
    }
    this.levels = this.levelMin.length;
    // Depth-first stack of (level, x, z) triples: at most 3 siblings per level + the root.
    this.stack = new Int32Array((this.levels * 3 + 4) * 3);
  }

  /** Recomputes {@link visible}; returns the number of visible patches. */
  cull(frustum: Frustum, camPosInt: ArrayLike<number>): number {
    const st = this.stack;
    const box = this.box;
    const chunks = this.bounds.chunks;
    const vis = this.visible;
    let n = 0;
    let sp = 0;
    st[sp++] = this.levels - 1;
    st[sp++] = 0;
    st[sp++] = 0;
    while (sp > 0) {
      const z = st[--sp]!;
      const x = st[--sp]!;
      const l = st[--sp]!;
      if (l === 0) {
        chunkBox(this.bounds, x, z, camPosInt, box);
        if (frustum.testAabb(box[0]!, box[1]!, box[2]!, box[3]!, box[4]!, box[5]!) !== OUTSIDE) vis[n++] = z * chunks + x;
        continue;
      }
      const side = chunks >> l;
      const span = TERRAIN_PATCH_WU * 4096 * (1 << l);
      const k = z * side + x;
      box[0] = (x * span - camPosInt[0]!) * INV_RAW;
      box[1] = (this.levelMin[l]![k]! - camPosInt[1]!) * INV_RAW;
      box[2] = (z * span - camPosInt[2]!) * INV_RAW;
      box[3] = ((x + 1) * span - camPosInt[0]!) * INV_RAW;
      box[4] = (this.levelMax[l]![k]! - camPosInt[1]!) * INV_RAW;
      box[5] = ((z + 1) * span - camPosInt[2]!) * INV_RAW;
      const r = frustum.testAabb(box[0]!, box[1]!, box[2]!, box[3]!, box[4]!, box[5]!);
      if (r === OUTSIDE) continue;
      if (r === INSIDE) {
        // Every chunk of the node is inside (contained boxes pass every plane as well).
        const c = 1 << l;
        for (let dz = 0; dz < c; dz++) {
          const row = (z * c + dz) * chunks + x * c;
          for (let dx = 0; dx < c; dx++) vis[n++] = row + dx;
        }
        continue;
      }
      // Push children in reverse so they pop in row order.
      for (let q = 3; q >= 0; q--) {
        st[sp++] = l - 1;
        st[sp++] = 2 * x + (q & 1);
        st[sp++] = 2 * z + (q >> 1);
      }
    }
    this.count = n;
    return n;
  }
}
