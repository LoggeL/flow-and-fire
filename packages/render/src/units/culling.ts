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
 * - Strategic zoom (C2, optional {@link StrategicCull}): records whose mesh is invisible for EVERY
 *   interpolation alpha (icon fade ≥ 1 even at the closest possible distance `|cur − eye| − |cur − prev|`)
 *   get the icon-only bucket `visualCount × LOD_LEVELS` (not drawn by the unit pass, drawn with full
 *   opacity by the IconPass). The cull sphere grows by the icon's screen footprint
 *   (`marginPerWU × distance`) so icons at the frustum edge do not pop.
 */
import type { Frustum } from '../frustum.ts';
import { UnitFlags } from '@faf/protocol';
import { UNIT_INSTANCE_OFF_FLAGS, UNIT_INSTANCE_OFF_VISUAL, UNIT_INSTANCE_STRIDE } from '../instance-layout.ts';

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
  /** Visible instances per LOD level (mesh buckets only). */
  readonly perLod: Uint32Array;
  /** Visible records in the icon-only bucket (no mesh draw). */
  iconOnly: number;
  /** Visible records whose icon is visible at the current position (fade > 0). */
  iconVisible: number;
  /** Visible records inside the crossfade band at the current position (0 < fade < 1). */
  faded: number;
  /** Visible records whose icon may be visible at some interpolation alpha. */
  iconPossible: number;
}

/** Strategic-zoom inputs of the culler (per frame; arrays indexed by visual). */
export interface StrategicCull {
  /** Projection scale (CSS px of 1 WU at 1 WU distance); ≤ 0 disables the classification. */
  projK: number;
  /** Zoom icon force 0..1. */
  iconForce: number;
  /** Extra cull radius per WU of eye distance (icon footprint). */
  marginPerWU: number;
  readonly selectionRadius: Float64Array;
  readonly iconThreshold: Float64Array;
}

/** Icon fade (see strategic.ts `iconFade`), inlined for the per-record loop. */
function fadeAt(selR: number, thr: number, dist: number, projK: number, force: number): number {
  let f = 0;
  if (thr > 0) {
    const px = (2 * selR * projK) / (dist > 1e-4 ? dist : 1e-4);
    f = (1.5 * thr - px) / (0.5 * thr);
    f = f < 0 ? 0 : f > 1 ? 1 : f;
  }
  return f > force ? f : force;
}

export class InstanceCuller {
  keys = new Uint16Array(0);
  readonly stats: CullStats = {
    visible: 0,
    culled: 0,
    dropped: 0,
    perLod: new Uint32Array(LOD_LEVELS),
    iconOnly: 0,
    iconVisible: 0,
    faded: 0,
    iconPossible: 0,
  };
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
    strategic?: StrategicCull,
  ): CullStats {
    if (this.keys.length < count) this.keys = new Uint16Array(Math.max(64, count * 2));
    const keys = this.keys;
    const st = this.stats;
    st.visible = st.culled = st.dropped = 0;
    st.iconOnly = st.iconVisible = st.faded = st.iconPossible = 0;
    st.perLod.fill(0);
    const sc = strategic !== undefined && strategic.projK > 0 ? strategic : null;
    const iconKey = visualCount * LOD_LEVELS;
    const margin = sc === null ? 0 : sc.marginPerWU;
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
      const move = Math.hypot(cxr - pxr, cyr - pyr, czr - pzr);
      const mx = (cxr + pxr) * 0.5;
      const my = (cyr + pyr) * 0.5;
      const mz = (czr + pzr) * 0.5;
      let r = radii[visual]! + 0.5 * move;
      if (margin > 0) r += margin * Math.hypot(mx - ex, my - ey, mz - ez);
      if (!frustum.sphereVisible(mx, my, mz, r)) {
        keys[i] = KEY_CULLED;
        st.culled++;
        continue;
      }
      const dist = Math.hypot(cxr - ex, cyr - ey, czr - ez);
      st.visible++;
      // Radar blips never show a model: they always go to the icon-only bucket (blip glyph).
      const flagsAt = i * UNIT_INSTANCE_STRIDE + UNIT_INSTANCE_OFF_FLAGS;
      if (((bytes[flagsAt]! | (bytes[flagsAt + 1]! << 8)) & UnitFlags.Blip) !== 0) {
        keys[i] = iconKey;
        st.iconOnly++;
        continue;
      }
      if (sc !== null) {
        const selR = sc.selectionRadius[visual]!;
        const thr = sc.iconThreshold[visual]!;
        const force = sc.iconForce;
        const fCur = fadeAt(selR, thr, dist, sc.projK, force);
        if (fCur > 0) st.iconVisible++;
        if (fCur > 0 && fCur < 1) st.faded++;
        if (fadeAt(selR, thr, dist + move, sc.projK, force) > 0) st.iconPossible++;
        if (fadeAt(selR, thr, dist - move, sc.projK, force) >= 1) {
          keys[i] = iconKey;
          st.iconOnly++;
          continue;
        }
      }
      const lod = dist < lodDist[visual * 2]! * bias ? 0 : dist < lodDist[visual * 2 + 1]! * bias ? 1 : 2;
      keys[i] = visual * LOD_LEVELS + lod;
      st.perLod[lod]!++;
    }
    return st;
  }
}
