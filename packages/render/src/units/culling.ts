/**
 * Per-instance frustum culling and LOD selection of the unit pass (P2, PLAN §3.7 "CPU pro Frame":
 * only on a new frame version or camera change).
 *
 * - Culling: one sphere per record that contains the unit at every interpolation alpha – the
 *   enclosing sphere of the visual's bounding sphere at `prev` and at `cur`
 *   (center = midpoint, radius = r + |cur − prev| / 2).
 * - LOD: distance eye → cur position against the visual's two switch distances × LOD bias:
 *   `d < d0` → LOD 0, `d < d1` → LOD 1, else LOD 2.
 * - Output: one bucket key per record, `visual × LOD_LEVELS + lod`; culled records get
 *   {@link KEY_CULLED}, records with a visual outside the table {@link KEY_DROPPED}.
 */
import type { Frustum } from '../frustum.ts';
import { UNIT_INSTANCE_OFF_VISUAL, UNIT_INSTANCE_STRIDE } from '../instance-layout.ts';

export const LOD_LEVELS = 3;
/** Default LOD switch distances in WU (PLAN §3.9 `view.lod: [60, 180]`). */
export const DEFAULT_LOD_DISTANCES: readonly [number, number] = [60, 180];
export const KEY_CULLED = 0xffff;
export const KEY_DROPPED = 0xfffe;

const WORDS = UNIT_INSTANCE_STRIDE >> 2;
const INV_RAW = 1 / 4096;

export interface CullStats {
  visible: number;
  culled: number;
  dropped: number;
  /** Visible instances per LOD level. */
  readonly perLod: Uint32Array;
}

export class InstanceCuller {
  keys = new Uint16Array(0);
  readonly stats: CullStats = { visible: 0, culled: 0, dropped: 0, perLod: new Uint32Array(LOD_LEVELS) };
  private src32: Int32Array<ArrayBufferLike> = new Int32Array(0);
  private srcBuffer: ArrayBufferLike | null = null;
  private srcOffset = -1;
  private dv: DataView<ArrayBufferLike> | null = null;

  /**
   * Computes a bucket key per record.
   * @param radii bounding radius (WU) per visual
   * @param lodDist switch distances per visual (2 values each, WU, before bias)
   */
  cull(
    bytes: Uint8Array,
    count: number,
    visualCount: number,
    frustum: Frustum,
    camPosInt: ArrayLike<number>,
    camFrac: ArrayLike<number>,
    radii: Float64Array,
    lodDist: Float64Array,
    lodBias: number,
  ): CullStats {
    if (this.keys.length < count) this.keys = new Uint16Array(Math.max(64, count * 2));
    const keys = this.keys;
    const st = this.stats;
    st.visible = st.culled = st.dropped = 0;
    st.perLod.fill(0);
    const aligned = bytes.byteOffset % 4 === 0;
    let s32 = this.src32;
    if (aligned && (this.srcBuffer !== bytes.buffer || this.srcOffset !== bytes.byteOffset || s32.length < count * WORDS)) {
      s32 = this.src32 = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
      this.srcBuffer = bytes.buffer;
      this.srcOffset = bytes.byteOffset;
    }
    let dv = this.dv;
    if (!aligned && (dv === null || dv.buffer !== bytes.buffer || dv.byteOffset !== bytes.byteOffset)) {
      dv = this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    const cx = camPosInt[0]!;
    const cy = camPosInt[1]!;
    const cz = camPosInt[2]!;
    const ex = camFrac[0]!;
    const ey = camFrac[1]!;
    const ez = camFrac[2]!;
    const bias = lodBias > 0 ? lodBias : 1;
    for (let i = 0; i < count; i++) {
      let px: number;
      let py: number;
      let pz: number;
      let qx: number;
      let qy: number;
      let qz: number;
      let visual: number;
      if (aligned) {
        const w = i * WORDS;
        px = s32[w]!;
        py = s32[w + 1]!;
        pz = s32[w + 2]!;
        qx = s32[w + 3]!;
        qy = s32[w + 4]!;
        qz = s32[w + 5]!;
        visual = s32[w + (UNIT_INSTANCE_OFF_VISUAL >> 2)]! & 0xffff;
      } else {
        const o = i * UNIT_INSTANCE_STRIDE;
        const d = dv!;
        px = d.getInt32(o, true);
        py = d.getInt32(o + 4, true);
        pz = d.getInt32(o + 8, true);
        qx = d.getInt32(o + 12, true);
        qy = d.getInt32(o + 16, true);
        qz = d.getInt32(o + 20, true);
        visual = d.getUint16(o + UNIT_INSTANCE_OFF_VISUAL, true);
      }
      if (visual >= visualCount) {
        keys[i] = KEY_DROPPED;
        st.dropped++;
        continue;
      }
      // Camera-relative positions in WU (integer difference first, like the shader).
      const cxr = (qx - cx) * INV_RAW;
      const cyr = (qy - cy) * INV_RAW;
      const czr = (qz - cz) * INV_RAW;
      const pxr = (px - cx) * INV_RAW;
      const pyr = (py - cy) * INV_RAW;
      const pzr = (pz - cz) * INV_RAW;
      const half = 0.5 * Math.hypot(cxr - pxr, cyr - pyr, czr - pzr);
      const r = radii[visual]! + half;
      if (!frustum.sphereVisible((cxr + pxr) * 0.5, (cyr + pyr) * 0.5, (czr + pzr) * 0.5, r)) {
        keys[i] = KEY_CULLED;
        st.culled++;
        continue;
      }
      const dist = Math.hypot(cxr - ex, cyr - ey, czr - ez);
      const lod = dist < lodDist[visual * 2]! * bias ? 0 : dist < lodDist[visual * 2 + 1]! * bias ? 1 : 2;
      keys[i] = visual * LOD_LEVELS + lod;
      st.perLod[lod]!++;
      st.visible++;
    }
    return st;
  }
}
