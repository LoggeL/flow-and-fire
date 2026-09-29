/**
 * Cascaded shadow maps with 2 cascades (SPK4 prototype, PLAN §3.7 "CSM: Terrain und Props statisch
 * gecacht, pro Frame nur Units mit reduziertem LOD").
 *
 * - Cascades are fitted to view-depth slices of the camera frustum (bounding sphere, practical split
 *   λ = 0.55) up to a shadow distance that follows the zoom.
 * - Each cascade has a CACHED light box (center snapped to its texel grid, radius with headroom). The
 *   box – and with it the static layer (terrain + props, depth-only, LOD 1 props) – is re-rendered only
 *   when the needed sphere leaves the cached box or its size changes by more than the headroom.
 * - The DYNAMIC layer (units) uses the same light matrix and is re-rendered every frame (interpolated
 *   positions, merged-part angles) with a reduced LOD (camera LOD + 1, at least 1); unit culling
 *   against the cascade (sphere over prev and cur) runs only on a new unit frame or cache refresh.
 * - Casters work in integers relative to the cascade anchor (`ivec3(pos) − anchor`), receivers get a
 *   matrix from camera-relative space, so precision is independent of the map position.
 * - Terrain casters reuse `TERRAIN_HEIGHT_GLSL` (same heights as the visible terrain and the sim).
 */
import { mat4 } from 'gl-matrix';
import {
  Frustum,
  KEY_CULLED,
  MAX_MESH_PARTS,
  MESH_VERTEX_STRIDE,
  PART_TEXTURE_WIDTH,
  PatchCuller,
  SLOT_PASS,
  SLOT_TERRAIN_HEIGHT,
  Std140Writer,
  TERRAIN_HEIGHT_GLSL,
  TERRAIN_PATCH_WU,
  UNIT_FLAG_NO_INTERP,
  UNIT_HEIGHTMAP,
  UNIT_INSTANCE_OFF_CUR_POS,
  UNIT_INSTANCE_OFF_PART_BASE,
  UNIT_INSTANCE_OFF_PREV_POS,
  UNIT_INSTANCE_OFF_PREV_YAW,
  UNIT_INSTANCE_OFF_VISUAL,
  UNIT_INSTANCE_STRIDE,
  VisualBuckets,
  mergeMeshes,
  std140Layout,
  vf,
} from '@faf/render';
import type {
  BindGroupH,
  BufH,
  GpuDevice,
  IndexFormat,
  MeshData,
  PipeH,
  RtsCamera,
  TerrainHeightResources,
  TexH,
  UnitPartsView,
  VertexStreamBinding,
} from '@faf/render';
import { PROP_LODS, PROP_MESHES } from '../meshes.ts';
import { PROP_INSTANCE_STRIDE, PropSelection } from '../prop-grid.ts';
import type { PropGrid } from '../prop-grid.ts';
import { PROP_INSTANCE_STREAM, PROP_VERTEX_STREAM, propVertexShader } from './props.ts';
import type { PropMeshBuffers } from './props.ts';
import { MAX_CASCADES, SHADOW_RECV_LAYOUT, SLOT_SHADOW, UNIT_SHADOW_DYNAMIC, UNIT_SHADOW_STATIC } from './shadow-glsl.ts';
import { PATCH_INDEX_COUNT, TerrainPatchMesh, writeChunkInstances } from './terrain.ts';

const RAW = 4096;
const INV_RAW = 1 / RAW;
/** Shadow LODs: bucket = visual · 2 + (lod − 1). */
const SHADOW_LODS = 2;
const RING_REGIONS = 3;

// -------------------------------------------------------------------------------------------------
// Cascade fitting (CPU math, float64)
// -------------------------------------------------------------------------------------------------

export interface Cascade {
  valid: boolean;
  /** Needed sphere radius at the last refresh × headroom (WU). */
  radius: number;
  /** Half extent of the cached light box (WU). */
  half: number;
  /** Light-space center (WU) of the cached box. */
  cx: number;
  cy: number;
  /** Anchor (raw ints, world). */
  readonly anchor: Int32Array;
  /** Anchor-relative WU → light clip. */
  readonly lightVP: Float64Array;
  readonly lightVP32: Float32Array;
  readonly frustum: Frustum;
  /** Incremented on each refresh. */
  version: number;
  /** Texel size in WU. */
  texelWU: number;
}

export interface CascadeFrame {
  /** View depth (WU) of the split between cascade 0 and 1. */
  split: number;
  /** View depth where shadows end. */
  end: number;
  /** Cascades refreshed this frame (bit c). */
  refreshed: number;
}

export class CascadeFitter {
  readonly cascades: Cascade[] = [];
  /** Light travel direction (from the sun), light-space x/y axes. */
  readonly dir = new Float64Array(3);
  readonly lx = new Float64Array(3);
  readonly ly = new Float64Array(3);
  readonly frame: CascadeFrame = { split: 0, end: 0, refreshed: 0 };
  /** Total cache refreshes (all cascades). */
  refreshes = 0;
  private readonly corners = new Float64Array(24);
  private readonly tmp = new Float64Array(16);
  private readonly view = new Float64Array(16);
  private readonly proj = new Float64Array(16);

  constructor(
    sunDir: readonly number[],
    private readonly mapSizeWu: number,
    private readonly minHeightWU: number,
    private readonly maxHeightWU: number,
    readonly size: number,
    count = MAX_CASCADES,
  ) {
    const l = Math.hypot(sunDir[0]!, sunDir[1]!, sunDir[2]!) || 1;
    this.dir[0] = -sunDir[0]! / l;
    this.dir[1] = -sunDir[1]! / l;
    this.dir[2] = -sunDir[2]! / l;
    // lx = normalize(cross(dir, up)), ly = cross(lx, dir)
    const d = this.dir;
    const up = Math.abs(d[1]!) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    let x0 = d[1]! * up[2]! - d[2]! * up[1]!;
    let x1 = d[2]! * up[0]! - d[0]! * up[2]!;
    let x2 = d[0]! * up[1]! - d[1]! * up[0]!;
    const xl = Math.hypot(x0, x1, x2) || 1;
    x0 /= xl;
    x1 /= xl;
    x2 /= xl;
    this.lx[0] = x0;
    this.lx[1] = x1;
    this.lx[2] = x2;
    this.ly[0] = x1 * d[2]! - x2 * d[1]!;
    this.ly[1] = x2 * d[0]! - x0 * d[2]!;
    this.ly[2] = x0 * d[1]! - x1 * d[0]!;
    for (let c = 0; c < count; c++) {
      this.cascades.push({
        valid: false,
        radius: 0,
        half: 0,
        cx: 0,
        cy: 0,
        anchor: new Int32Array(3),
        lightVP: new Float64Array(16),
        lightVP32: new Float32Array(16),
        frustum: new Frustum(),
        version: 0,
        texelWU: 1,
      });
    }
  }

  /** Split scheme: returns the view depth range of the shadowed part of the frustum. */
  static shadowRange(cam: RtsCamera): { near: number; split: number; end: number } {
    const near = Math.max(0.05, cam.near);
    const end = Math.max(near * 2, Math.min(cam.far, cam.distance * 2.4 + 30));
    const lambda = 0.55;
    const split = lambda * near * Math.sqrt(end / near) + (1 - lambda) * (near + (end - near) * 0.5);
    return { near, split, end };
  }

  /** Fits the cascades to the camera; refreshes cached boxes where needed. */
  update(cam: RtsCamera): CascadeFrame {
    const { near, split, end } = CascadeFitter.shadowRange(cam);
    const f = this.frame;
    f.split = split;
    f.end = end;
    f.refreshed = 0;
    const bounds = [near, split, end];
    for (let c = 0; c < this.cascades.length; c++) {
      const cas = this.cascades[c]!;
      // Sphere of the slice [bounds[c], bounds[c + 1]] in world WU.
      this.sliceCorners(cam, bounds[c]!, bounds[c + 1]!);
      const k = this.corners;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let i = 0; i < 8; i++) {
        mx += k[i * 3]!;
        my += k[i * 3 + 1]!;
        mz += k[i * 3 + 2]!;
      }
      mx /= 8;
      my /= 8;
      mz /= 8;
      let r = 0;
      for (let i = 0; i < 8; i++) r = Math.max(r, Math.hypot(k[i * 3]! - mx, k[i * 3 + 1]! - my, k[i * 3 + 2]! - mz));
      const wx = cam.camPosInt[0]! * INV_RAW + mx;
      const wy = cam.camPosInt[1]! * INV_RAW + my;
      const wz = cam.camPosInt[2]! * INV_RAW + mz;
      const cx = wx * this.lx[0]! + wy * this.lx[1]! + wz * this.lx[2]!;
      const cy = wx * this.ly[0]! + wy * this.ly[1]! + wz * this.ly[2]!;
      const inside = cas.valid && Math.max(Math.abs(cx - cas.cx), Math.abs(cy - cas.cy)) + r <= cas.half;
      const sizeOk = cas.valid && r <= cas.radius && r >= cas.radius * 0.55;
      if (inside && sizeOk) continue;
      this.refresh(cas, cx, cy, wx * this.dir[0]! + wy * this.dir[1]! + wz * this.dir[2]!, r);
      f.refreshed |= 1 << c;
      this.refreshes++;
    }
    return f;
  }

  private sliceCorners(cam: RtsCamera, d0: number, d1: number): void {
    const fw = cam.forward;
    const fx = fw[0]!;
    const fy = fw[1]!;
    const fz = fw[2]!;
    let rx = -fz;
    let rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    // up = cross(right, forward) with right = (rx, 0, rz)
    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;
    const tanY = Math.tan(cam.fovY / 2);
    const tanX = tanY * (cam.viewportWidth / cam.viewportHeight);
    const e = cam.camFrac;
    let i = 0;
    for (const d of [d0, d1]) {
      for (const sy of [-1, 1]) {
        for (const sx of [-1, 1]) {
          this.corners[i++] = e[0]! + d * (fx + rx * sx * tanX + ux * sy * tanY);
          this.corners[i++] = e[1]! + d * (fy + uy * sy * tanY);
          this.corners[i++] = e[2]! + d * (fz + rz * sx * tanX + uz * sy * tanY);
        }
      }
    }
  }

  private refresh(cas: Cascade, cx: number, cy: number, cz: number, r: number): void {
    const radius = Math.max(r * 1.15, 4);
    const half = radius * 1.25;
    const texel = (2 * half) / this.size;
    const sx = Math.round(cx / texel) * texel;
    const sy = Math.round(cy / texel) * texel;
    cas.valid = true;
    cas.radius = radius;
    cas.half = half;
    cas.cx = sx;
    cas.cy = sy;
    cas.texelWU = texel;
    const lx = this.lx;
    const ly = this.ly;
    const d = this.dir;
    const ax = sx * lx[0]! + sy * ly[0]! + cz * d[0]!;
    const ay = sx * lx[1]! + sy * ly[1]! + cz * d[1]!;
    const az = sx * lx[2]! + sy * ly[2]! + cz * d[2]!;
    cas.anchor[0] = Math.round(ax * RAW);
    cas.anchor[1] = Math.round(ay * RAW);
    cas.anchor[2] = Math.round(az * RAW);
    const oax = cas.anchor[0]! * INV_RAW;
    const oay = cas.anchor[1]! * INV_RAW;
    const oaz = cas.anchor[2]! * INV_RAW;
    // Depth range: every caster of the map (terrain, props, units up to +6 WU).
    let zmin = Infinity;
    let zmax = -Infinity;
    const s = this.mapSizeWu;
    for (let i = 0; i < 8; i++) {
      const px = (i & 1 ? s : 0) - oax;
      const py = (i & 2 ? this.maxHeightWU + 6 : this.minHeightWU - 1) - oay;
      const pz = (i & 4 ? s : 0) - oaz;
      const depth = px * d[0]! + py * d[1]! + pz * d[2]!;
      zmin = Math.min(zmin, depth);
      zmax = Math.max(zmax, depth);
    }
    const v = this.view;
    v.fill(0);
    v[0] = lx[0]!;
    v[4] = lx[1]!;
    v[8] = lx[2]!;
    v[1] = ly[0]!;
    v[5] = ly[1]!;
    v[9] = ly[2]!;
    v[2] = -d[0]!;
    v[6] = -d[1]!;
    v[10] = -d[2]!;
    v[15] = 1;
    mat4.ortho(this.proj, -half, half, -half, half, zmin - 2, zmax + 2);
    mat4.multiply(cas.lightVP, this.proj, v);
    for (let i = 0; i < 16; i++) cas.lightVP32[i] = cas.lightVP[i]!;
    cas.frustum.setFromViewProj(cas.lightVP);
    cas.version++;
  }

  /**
   * Receiver matrix of cascade c: camera-relative WU → shadow texture space [0, 1]³
   * (translation to anchor-relative space, light view-projection, bias).
   */
  receiverMatrix(c: number, camPosInt: ArrayLike<number>, out: Float32Array, offset = 0): void {
    const cas = this.cascades[c]!;
    const m = this.tmp;
    m.set(cas.lightVP);
    const ox = (camPosInt[0]! - cas.anchor[0]!) * INV_RAW;
    const oy = (camPosInt[1]! - cas.anchor[1]!) * INV_RAW;
    const oz = (camPosInt[2]! - cas.anchor[2]!) * INV_RAW;
    for (let i = 0; i < 4; i++) m[12 + i] = m[i]! * ox + m[4 + i]! * oy + m[8 + i]! * oz + m[12 + i]!;
    for (let col = 0; col < 4; col++) {
      const w = m[col * 4 + 3]!;
      for (let i = 0; i < 3; i++) out[offset + col * 4 + i] = 0.5 * m[col * 4 + i]! + 0.5 * w;
      out[offset + col * 4 + 3] = w;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Unit caster culling (CPU, GL-free)
// -------------------------------------------------------------------------------------------------

/**
 * Culls UnitRecords against a cascade (sphere over prev and cur, anchor-relative) and assigns the
 * reduced shadow LOD from the camera distance: bucket = visual · 2 + (min(2, cameraLod + 1) − 1).
 */
export class ShadowUnitCuller {
  keys = new Uint16Array(0);
  readonly buckets = new VisualBuckets();
  visible = 0;
  culled = 0;
  private src32: Int32Array<ArrayBufferLike> = new Int32Array(0);
  private srcBuffer: ArrayBufferLike | null = null;

  cull(
    bytes: Uint8Array,
    count: number,
    visualCount: number,
    frustum: Frustum,
    anchor: ArrayLike<number>,
    camPosInt: ArrayLike<number>,
    camFrac: ArrayLike<number>,
    radii: Float64Array,
    lodDist: Float64Array,
    lodBias: number,
  ): number {
    if (bytes.byteOffset % 4 !== 0) throw new Error('ShadowUnitCuller: records must be 4-byte aligned');
    if (this.keys.length < count) this.keys = new Uint16Array(Math.max(64, count));
    if (this.srcBuffer !== bytes.buffer || this.src32.byteOffset !== bytes.byteOffset) {
      this.src32 = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
      this.srcBuffer = bytes.buffer;
    }
    const s = this.src32;
    const words = UNIT_INSTANCE_STRIDE >> 2;
    const vw = UNIT_INSTANCE_OFF_VISUAL >> 2;
    const ax = anchor[0]!;
    const ay = anchor[1]!;
    const az = anchor[2]!;
    const cx = camPosInt[0]!;
    const cy = camPosInt[1]!;
    const cz = camPosInt[2]!;
    const ex = camFrac[0]!;
    const ey = camFrac[1]!;
    const ez = camFrac[2]!;
    const keys = this.keys;
    let visible = 0;
    let culled = 0;
    for (let i = 0; i < count; i++) {
      const w = i * words;
      const visual = s[w + vw]! & 0xffff;
      if (visual >= visualCount) {
        keys[i] = KEY_CULLED;
        culled++;
        continue;
      }
      const px = s[w]!;
      const py = s[w + 1]!;
      const pz = s[w + 2]!;
      const qx = s[w + 3]!;
      const qy = s[w + 4]!;
      const qz = s[w + 5]!;
      const half = 0.5 * Math.hypot(qx - px, qy - py, qz - pz) * INV_RAW;
      const mx = ((px + qx) * 0.5 - ax) * INV_RAW;
      const my = ((py + qy) * 0.5 - ay) * INV_RAW;
      const mz = ((pz + qz) * 0.5 - az) * INV_RAW;
      if (!frustum.sphereVisible(mx, my, mz, radii[visual]! + half)) {
        keys[i] = KEY_CULLED;
        culled++;
        continue;
      }
      const dist = Math.hypot((qx - cx) * INV_RAW - ex, (qy - cy) * INV_RAW - ey, (qz - cz) * INV_RAW - ez);
      const camLod = dist < lodDist[visual * 2]! * lodBias ? 0 : dist < lodDist[visual * 2 + 1]! * lodBias ? 1 : 2;
      const lod = Math.min(2, camLod + 1);
      keys[i] = visual * SHADOW_LODS + (lod - 1);
      visible++;
    }
    this.buckets.sortByKeys(bytes, count, keys, visualCount * SHADOW_LODS);
    this.visible = visible;
    this.culled = culled;
    return visible;
  }
}

// -------------------------------------------------------------------------------------------------
// GPU part
// -------------------------------------------------------------------------------------------------

const CASTER_LAYOUT = std140Layout([
  { name: 'lightVP', type: 'mat4' },
  { name: 'anchor', type: 'ivec4' },
  { name: 'misc', type: 'vec4' },
]);

const CASTER_BLOCK = /* glsl */ `
layout(std140) uniform ShadowCaster {
  mat4 u_lightViewProj; // anchor-relative WU -> light clip
  ivec4 u_anchor;       // raw
  vec4 u_casterMisc;    // x: interpolation alpha
};
`;

const DEPTH_FS = /* glsl */ `#version 300 es
precision highp float;
void main() {}
`;

const TERRAIN_CASTER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${CASTER_BLOCK}
${TERRAIN_HEIGHT_GLSL}
layout(location = 0) in uvec2 a_local;
layout(location = 1) in uvec2 a_chunk;
void main() {
  ivec2 xz = (ivec2(a_chunk) * ${TERRAIN_PATCH_WU} + ivec2(a_local)) * 4096;
  int h = terrainHeightRaw(xz);
  vec3 rel = vec3(ivec3(xz.x, h, xz.y) - u_anchor.xyz) / 4096.0;
  gl_Position = u_lightViewProj * vec4(rel, 1.0);
}
`;

const UNIT_CASTER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${CASTER_BLOCK}
uniform highp usampler2D u_parts;
uniform highp sampler2D u_partPivots;
layout(location = 0) in vec3 a_position;
layout(location = 2) in uint a_partId;
layout(location = 3) in ivec3 a_prevPos;
layout(location = 4) in ivec3 a_curPos;
layout(location = 5) in uvec2 a_yaw;
layout(location = 6) in uvec4 a_meta;
layout(location = 8) in uvec2 a_parts;
const float ANG16_TO_RAD = 6.283185307179586 / 65536.0;
float s16(uint v) { return float(int(v) - (v >= 32768u ? 65536 : 0)); }
vec2 partAngles(uint k, float alpha, bool noInterp) {
  uint partCount = a_parts.y & 255u;
  if (k == 0u || k > partCount) return vec2(0.0);
  uint idx = a_parts.x + k - 1u;
  ivec2 size = textureSize(u_parts, 0);
  uint w = uint(size.x);
  if (idx >= w * uint(size.y)) return vec2(0.0);
  uvec4 t = texelFetch(u_parts, ivec2(int(idx % w), int(idx / w)), 0);
  uint d = (t.y - t.x) & 65535u;
  float yaw = noInterp ? float(t.y) : float(t.x) + s16(d) * alpha;
  float pitch = noInterp ? s16(t.w) : mix(s16(t.z), s16(t.w), alpha);
  return vec2(yaw, pitch) * ANG16_TO_RAD;
}
vec3 rotatePart(vec3 v, vec2 yp) {
  float cp = cos(yp.y);
  float sp = sin(yp.y);
  v = vec3(v.x * cp - v.y * sp, v.x * sp + v.y * cp, v.z);
  float cy = cos(yp.x);
  float sy = sin(yp.x);
  return vec3(v.x * cy - v.z * sy, v.y, v.x * sy + v.z * cy);
}
void main() {
  float alpha = u_casterMisc.x;
  bool noInterp = (a_meta.w & ${UNIT_FLAG_NO_INTERP}u) != 0u;
  vec3 relCur = vec3(a_curPos - u_anchor.xyz) / 4096.0;
  vec3 relPrev = vec3(a_prevPos - u_anchor.xyz) / 4096.0;
  vec3 base = noInterp ? relCur : mix(relPrev, relCur, alpha);
  uint visual = a_meta.x;
  vec3 p = a_position;
  uint k = a_partId;
  for (int it = 0; it < ${MAX_MESH_PARTS}; ++it) {
    if (k == 0u) break;
    vec4 piv = texelFetch(u_partPivots, ivec2(int(min(k, ${MAX_MESH_PARTS - 1}u)), int(visual)), 0);
    p = piv.xyz + rotatePart(p - piv.xyz, partAngles(k, alpha, noInterp));
    uint parent = uint(piv.w);
    k = parent < k ? parent : 0u;
  }
  uint d = (a_yaw.y - a_yaw.x) & 65535u;
  float yaw = (noInterp ? float(a_yaw.y) : float(a_yaw.x) + s16(d) * alpha) * ANG16_TO_RAD;
  float c = cos(yaw);
  float s = sin(yaw);
  vec3 world = base + vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  gl_Position = u_lightViewProj * vec4(world, 1.0);
}
`;

export interface CsmOptions {
  readonly size: number;
  readonly cascades: number;
  readonly sunDir: readonly number[];
  readonly minHeightWU: number;
  readonly maxHeightWU: number;
  /** Shadow darkness 0..1. */
  readonly strength: number;
}

/** Unit visual info for the caster: LOD meshes, bounding radius and LOD distances. */
export interface CasterVisual {
  readonly lods: readonly MeshData[];
  readonly radius: number;
  readonly lodDistancesWU: readonly [number, number];
}

interface CascadeGpu {
  ubo: BufH;
  data: Std140Writer;
  group: BindGroupH;
  terrainInst: BufH;
  terrainCount: number;
  propInst: BufH;
  props: PropSelection;
  unitRing: BufH;
  unitRegion: number;
  culler: ShadowUnitCuller;
  terrainCuller: PatchCuller;
}

export interface ShadowStats {
  refreshes: number;
  staticDraws: number;
  dynamicDraws: number;
  casterUnits: number;
}

export class CsmShadows {
  readonly fitter: CascadeFitter;
  readonly staticTex: TexH;
  readonly dynamicTex: TexH;
  readonly recvGroup: BindGroupH;
  readonly stats: ShadowStats = { refreshes: 0, staticDraws: 0, dynamicDraws: 0, casterUnits: 0 };
  private readonly recvUbo: BufH;
  private readonly recvData = new Std140Writer(SHADOW_RECV_LAYOUT);
  private readonly mats = new Float32Array(16 * MAX_CASCADES);
  private readonly terrainPipe: PipeH;
  private readonly propPipe: PipeH;
  private readonly unitPipe: PipeH;
  private readonly gpu: CascadeGpu[] = [];
  private readonly chunkStaging: Uint16Array;
  private readonly visualCount: number;
  private readonly radii: Float64Array;
  private readonly lodDist: Float64Array;
  private readonly unitVbo: BufH;
  private readonly unitIbo: BufH;
  private readonly unitIndexFormat: IndexFormat;
  private readonly bucketFirst: Uint32Array;
  private readonly bucketCount: Uint32Array;
  private readonly pivotTex: TexH;
  private partsTex: TexH;
  private partsRows = 0;
  private partsStaging = new Uint16Array(0);
  private lastPartsVersion = -1;
  private unitGroup: BindGroupH;
  private lastUnitVersion = -1;
  private lastLodBias = -1;
  private pendingStatic = 0;
  private unitCapacity = 0;
  private readonly streams3: VertexStreamBinding[] = [
    { buffer: 0 as BufH, offset: 0 },
    { buffer: 0 as BufH, offset: 0 },
  ];

  constructor(
    private readonly dev: GpuDevice,
    private readonly heights: TerrainHeightResources,
    private readonly patch: TerrainPatchMesh,
    private readonly propMeshes: PropMeshBuffers | null,
    private readonly propGrid: PropGrid | null,
    visuals: readonly CasterVisual[],
    unitCapacity: number,
    private readonly opts: CsmOptions,
  ) {
    const desc = heights.desc;
    this.fitter = new CascadeFitter(opts.sunDir, desc.sizeWu, opts.minHeightWU, opts.maxHeightWU, opts.size, opts.cascades);
    const texDesc = {
      width: opts.size,
      height: opts.size,
      format: 'depth24' as const,
      dimension: '2d-array' as const,
      layers: MAX_CASCADES,
      compare: 'lequal' as const,
      filter: 'linear' as const,
      wrap: 'clamp' as const,
    };
    this.staticTex = dev.createTexture({ ...texDesc, label: 'csm.static' });
    this.dynamicTex = dev.createTexture({ ...texDesc, label: 'csm.dynamic' });
    this.recvUbo = dev.createBuffer({ label: 'csm.recv.ubo', usage: 'uniform', size: SHADOW_RECV_LAYOUT.size, dynamic: true });
    this.recvGroup = dev.createBindGroup({
      label: 'csm.recv',
      buffers: [{ slot: SLOT_SHADOW, buffer: this.recvUbo }],
      textures: [
        { unit: UNIT_SHADOW_STATIC, texture: this.staticTex },
        { unit: UNIT_SHADOW_DYNAMIC, texture: this.dynamicTex },
      ],
    });
    const depthOnly = {
      fragment: DEPTH_FS,
      colorWrite: false,
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less' as const,
      cullMode: 'none' as const,
      depthBias: { constant: 2, slopeScale: 2.5 },
    };
    this.terrainPipe = dev.createPipeline({
      ...depthOnly,
      label: 'csm.caster.terrain',
      vertex: TERRAIN_CASTER_VS,
      streams: [TerrainPatchMesh.vertexStream, TerrainPatchMesh.instanceStream],
      uniformBlocks: [
        { name: 'ShadowCaster', slot: SLOT_PASS },
        { name: 'TerrainHeight', slot: SLOT_TERRAIN_HEIGHT },
      ],
      samplers: [{ name: 'u_heightmap', unit: UNIT_HEIGHTMAP }],
    });
    this.propPipe = dev.createPipeline({
      ...depthOnly,
      label: 'csm.caster.props',
      vertex: propVertexShader('u_anchor.xyz', 'u_lightViewProj', CASTER_BLOCK),
      streams: [PROP_VERTEX_STREAM, PROP_INSTANCE_STREAM],
      uniformBlocks: [{ name: 'ShadowCaster', slot: SLOT_PASS }],
    });
    this.unitPipe = dev.createPipeline({
      ...depthOnly,
      label: 'csm.caster.units',
      vertex: UNIT_CASTER_VS,
      streams: [
        {
          stepMode: 'vertex',
          stride: MESH_VERTEX_STRIDE,
          attributes: [
            { location: 0, format: vf('f32', 3, 'float'), offset: 0 },
            { location: 2, format: vf('u8', 1, 'int'), offset: 16 },
          ],
        },
        {
          stepMode: 'instance',
          stride: UNIT_INSTANCE_STRIDE,
          attributes: [
            { location: 3, format: vf('i32', 3, 'int'), offset: UNIT_INSTANCE_OFF_PREV_POS },
            { location: 4, format: vf('i32', 3, 'int'), offset: UNIT_INSTANCE_OFF_CUR_POS },
            { location: 5, format: vf('u16', 2, 'int'), offset: UNIT_INSTANCE_OFF_PREV_YAW },
            { location: 6, format: vf('u16', 4, 'int'), offset: UNIT_INSTANCE_OFF_VISUAL },
            { location: 8, format: vf('u32', 2, 'int'), offset: UNIT_INSTANCE_OFF_PART_BASE },
          ],
        },
      ],
      uniformBlocks: [{ name: 'ShadowCaster', slot: SLOT_PASS }],
      samplers: [
        { name: 'u_parts', unit: 0 },
        { name: 'u_partPivots', unit: 1 },
      ],
    });

    // Unit caster meshes: LOD 1 and LOD 2 of every visual (reduced LOD).
    this.visualCount = visuals.length;
    this.radii = new Float64Array(visuals.map((v) => v.radius));
    this.lodDist = new Float64Array(visuals.flatMap((v) => [v.lodDistancesWU[0], v.lodDistancesWU[1]]));
    const unique: MeshData[] = [];
    const meshOf: number[] = [];
    for (const v of visuals) {
      for (let l = 1; l <= SHADOW_LODS; l++) {
        const m = v.lods[Math.min(l, v.lods.length - 1)]!;
        let k = unique.indexOf(m);
        if (k < 0) {
          k = unique.length;
          unique.push(m);
        }
        meshOf.push(k);
      }
    }
    const merged = mergeMeshes(unique);
    this.bucketFirst = new Uint32Array(meshOf.map((k) => merged.firstIndex[k]!));
    this.bucketCount = new Uint32Array(meshOf.map((k) => merged.indexCount[k]!));
    const vbytes = new Uint8Array(merged.vertices);
    this.unitVbo = dev.createBuffer({ label: 'csm.units.vbo', usage: 'vertex', size: vbytes.byteLength, restore: (b) => dev.writeBuffer(b, 0, vbytes) });
    dev.writeBuffer(this.unitVbo, 0, vbytes);
    const idx = merged.indices;
    this.unitIbo = dev.createBuffer({ label: 'csm.units.ibo', usage: 'index', size: idx.byteLength, restore: (b) => dev.writeBuffer(b, 0, idx) });
    dev.writeBuffer(this.unitIbo, 0, idx);
    this.unitIndexFormat = merged.indexFormat;
    const pivots = new Float32Array(Math.max(1, visuals.length) * MAX_MESH_PARTS * 4);
    visuals.forEach((v, vi) => {
      const m0 = v.lods[0]!;
      for (let k = 1; k < MAX_MESH_PARTS; k++) {
        const o = (vi * MAX_MESH_PARTS + k) * 4;
        pivots[o] = m0.partPivots?.[k * 3] ?? 0;
        pivots[o + 1] = m0.partPivots?.[k * 3 + 1] ?? 0;
        pivots[o + 2] = m0.partPivots?.[k * 3 + 2] ?? 0;
        pivots[o + 3] = m0.partParents?.[k] ?? 0;
      }
    });
    const pivotRect = { x: 0, y: 0, width: MAX_MESH_PARTS, height: Math.max(1, visuals.length) };
    this.pivotTex = dev.createTexture({ label: 'csm.pivots', ...pivotRect, format: 'rgba32f', restore: (h) => dev.writeTexture(h, pivotRect, pivots) });
    dev.writeTexture(this.pivotTex, pivotRect, pivots);
    this.partsTex = this.createPartsTexture(1);
    this.unitGroup = dev.createBindGroup({ label: 'csm.units', textures: [{ unit: 0, texture: this.partsTex }, { unit: 1, texture: this.pivotTex }] });

    const chunks = heights.bounds.chunks;
    this.chunkStaging = new Uint16Array(chunks * chunks * 2);
    this.unitCapacity = Math.max(1, unitCapacity);
    for (let c = 0; c < opts.cascades; c++) {
      const data = new Std140Writer(CASTER_LAYOUT);
      const ubo = dev.createBuffer({ label: `csm.caster${c}.ubo`, usage: 'uniform', size: CASTER_LAYOUT.size, dynamic: true });
      const group = dev.createBindGroup({ label: `csm.caster${c}`, buffers: [{ slot: SLOT_PASS, buffer: ubo }] });
      this.gpu.push({
        ubo,
        data,
        group,
        terrainInst: dev.createBuffer({ label: `csm.terrain${c}.inst`, usage: 'vertex', size: chunks * chunks * 4 }),
        terrainCount: 0,
        propInst: dev.createBuffer({ label: `csm.props${c}.inst`, usage: 'vertex', size: Math.max(1, propGrid?.count ?? 1) * PROP_INSTANCE_STRIDE }),
        props: new PropSelection(propGrid?.count ?? 1),
        unitRing: dev.createBuffer({ label: `csm.units${c}.ring`, usage: 'vertex', size: this.unitCapacity * UNIT_INSTANCE_STRIDE * RING_REGIONS, dynamic: true }),
        unitRegion: 0,
        culler: new ShadowUnitCuller(),
        terrainCuller: new PatchCuller(heights.bounds),
      });
    }
    // Everything cached is lost with the context: re-render the static layers and re-upload.
    dev.onRestored(() => {
      for (const cas of this.fitter.cascades) cas.valid = false;
      this.lastUnitVersion = -1;
      this.lastPartsVersion = -1;
    });
  }

  private createPartsTexture(rows: number): TexH {
    this.partsRows = rows;
    this.partsStaging = new Uint16Array(PART_TEXTURE_WIDTH * rows * 4);
    const staging = this.partsStaging;
    return this.dev.createTexture({
      label: 'csm.parts',
      width: PART_TEXTURE_WIDTH,
      height: rows,
      format: 'rgba16ui',
      restore: (h) => this.dev.writeTexture(h, { x: 0, y: 0, width: PART_TEXTURE_WIDTH, height: rows }, staging),
    });
  }

  private uploadParts(parts: UnitPartsView): void {
    const version = parts.version ?? -2;
    if (version === this.lastPartsVersion && version !== -2) return;
    this.lastPartsVersion = version;
    const rows = Math.max(1, Math.ceil(parts.count / PART_TEXTURE_WIDTH));
    if (rows > this.partsRows) {
      this.dev.destroyTexture(this.partsTex);
      this.partsTex = this.createPartsTexture(rows);
      this.dev.destroyBindGroup(this.unitGroup);
      this.unitGroup = this.dev.createBindGroup({ label: 'csm.units', textures: [{ unit: 0, texture: this.partsTex }, { unit: 1, texture: this.pivotTex }] });
    }
    const src = new Uint16Array(parts.bytes.buffer, parts.bytes.byteOffset, (parts.count * 8) >> 1);
    this.partsStaging.set(src);
    this.dev.writeTexture(this.partsTex, { x: 0, y: 0, width: PART_TEXTURE_WIDTH, height: this.partsRows }, this.partsStaging);
  }

  /**
   * CPU part of a frame: fits the cascades, refreshes the cached static caster lists, re-culls the unit
   * casters on a new unit frame, writes the receiver and caster uniforms.
   */
  prepare(cam: RtsCamera, units: { bytes: Uint8Array; count: number; version: number }, parts: UnitPartsView, lodBias: number, alpha: number): void {
    const frame = this.fitter.update(cam);
    this.pendingStatic |= frame.refreshed;
    const refreshed = frame.refreshed;
    const recullUnits = refreshed !== 0 || units.version !== this.lastUnitVersion || lodBias !== this.lastLodBias;
    this.lastUnitVersion = units.version;
    this.lastLodBias = lodBias;
    this.uploadParts(parts);
    let casterUnits = 0;
    for (let c = 0; c < this.gpu.length; c++) {
      const g = this.gpu[c]!;
      const cas = this.fitter.cascades[c]!;
      if ((refreshed >> c) & 1) {
        g.terrainCuller.cull(cas.frustum, cas.anchor);
        g.terrainCount = writeChunkInstances(g.terrainCuller, this.heights.bounds.chunks, this.chunkStaging);
        if (g.terrainCount > 0) this.dev.writeBuffer(g.terrainInst, 0, this.chunkStaging, 0, g.terrainCount * 2);
        if (this.propGrid !== null) {
          const total = this.propGrid.select(cas.frustum, cas.anchor, { eye: null, lod0Distance: 0, impostorDistance: Infinity, fixedLod: 1 }, g.props);
          if (total > 0) this.dev.writeBuffer(g.propInst, 0, g.props.staging, 0, total * (PROP_INSTANCE_STRIDE >> 2));
        }
        g.data.mat4(CASTER_LAYOUT.offsetOf('lightVP'), cas.lightVP32);
        g.data.ivec4(CASTER_LAYOUT.offsetOf('anchor'), cas.anchor[0]!, cas.anchor[1]!, cas.anchor[2]!, 0);
      }
      if (recullUnits) {
        if (units.count > this.unitCapacity) throw new Error('CsmShadows: unit capacity exceeded');
        g.culler.cull(units.bytes, units.count, this.visualCount, cas.frustum, cas.anchor, cam.camPosInt, cam.camFrac, this.radii, this.lodDist, lodBias);
        g.unitRegion = (g.unitRegion + 1) % RING_REGIONS;
        const b = g.culler.buckets;
        if (b.total > 0) this.dev.writeBuffer(g.unitRing, g.unitRegion * this.unitCapacity * UNIT_INSTANCE_STRIDE, b.sorted, 0, b.total * UNIT_INSTANCE_STRIDE);
      }
      casterUnits += g.culler.buckets.total;
      g.data.vec4(CASTER_LAYOUT.offsetOf('misc'), alpha, 0, 0, 0);
      this.dev.writeBuffer(g.ubo, 0, g.data.bytes);
      this.fitter.receiverMatrix(c, cam.camPosInt, this.mats, c * 16);
    }
    const r = this.recvData;
    const L = SHADOW_RECV_LAYOUT;
    for (let c = 0; c < this.gpu.length; c++) r.mat4(L.offsetOf('mat') + c * 64, this.mats.subarray(c * 16, c * 16 + 16));
    r.vec4(L.offsetOf('fwd'), cam.forward[0]!, cam.forward[1]!, cam.forward[2]!, 1);
    const c0 = this.fitter.cascades[0]!;
    r.vec4(L.offsetOf('split'), frame.split, frame.end, frame.end * 0.1, 0.75 / this.opts.size);
    const c1 = this.fitter.cascades[Math.min(1, this.gpu.length - 1)]!;
    r.vec4(L.offsetOf('params'), this.opts.strength, c0.texelWU * 1.2, c1.texelWU * 1.2, 0);
    this.dev.writeBuffer(this.recvUbo, 0, r.bytes);
    this.stats.refreshes = this.fitter.refreshes;
    this.stats.casterUnits = casterUnits;
  }

  /** Re-renders the static layer of every cascade whose cache was refreshed. Returns the draws. */
  renderStatic(): number {
    let draws = 0;
    const dev = this.dev;
    for (let c = 0; c < this.gpu.length; c++) {
      if (((this.pendingStatic >> c) & 1) === 0) continue;
      const g = this.gpu[c]!;
      const enc = dev.beginPass({ label: `csm.static${c}`, depthAttachment: { texture: this.staticTex, layer: c }, clearDepth: 1 });
      if (g.terrainCount > 0) {
        enc.setPipeline(this.terrainPipe);
        enc.setBindGroup(g.group);
        enc.setBindGroup(this.heights.group);
        const s = this.streams3;
        s[0]!.buffer = this.patch.vbo;
        s[0]!.offset = 0;
        s[1]!.buffer = g.terrainInst;
        s[1]!.offset = 0;
        enc.setVertexStreams(s);
        enc.setIndexBuffer(this.patch.ibo, 'uint16');
        enc.drawIndexedInstanced(PATCH_INDEX_COUNT, g.terrainCount);
        draws++;
      }
      const pm = this.propMeshes;
      if (pm !== null && g.props.total > 0) {
        enc.setPipeline(this.propPipe);
        enc.setBindGroup(g.group);
        enc.setIndexBuffer(pm.ibo, 'uint16');
        const s = this.streams3;
        s[0]!.buffer = pm.vbo;
        s[0]!.offset = 0;
        s[1]!.buffer = g.propInst;
        for (let m = 0; m < PROP_MESHES; m++) {
          const b = m * PROP_LODS + 1;
          const n = g.props.bucketCount[b]!;
          if (n === 0) continue;
          s[1]!.offset = g.props.bucketStart[b]! * PROP_INSTANCE_STRIDE;
          enc.setVertexStreams(s);
          enc.drawIndexedInstanced(pm.indexCount[b]!, n, pm.firstIndex[b]!);
          draws++;
        }
      }
      enc.end();
    }
    this.pendingStatic = 0;
    this.stats.staticDraws = draws;
    return draws;
  }

  /** Renders the unit casters of every cascade (every frame). Returns the draws. */
  renderDynamic(): number {
    let draws = 0;
    const dev = this.dev;
    for (let c = 0; c < this.gpu.length; c++) {
      const g = this.gpu[c]!;
      const enc = dev.beginPass({ label: `csm.dynamic${c}`, depthAttachment: { texture: this.dynamicTex, layer: c }, clearDepth: 1 });
      const b = g.culler.buckets;
      if (b.total > 0) {
        enc.setPipeline(this.unitPipe);
        enc.setBindGroup(g.group);
        enc.setBindGroup(this.unitGroup);
        enc.setIndexBuffer(this.unitIbo, this.unitIndexFormat);
        const s = this.streams3;
        s[0]!.buffer = this.unitVbo;
        s[0]!.offset = 0;
        s[1]!.buffer = g.unitRing;
        const base = g.unitRegion * this.unitCapacity * UNIT_INSTANCE_STRIDE;
        const buckets = this.visualCount * SHADOW_LODS;
        for (let k = 0; k < buckets; k++) {
          const n = b.count[k]!;
          if (n === 0) continue;
          s[1]!.offset = base + b.start[k]! * UNIT_INSTANCE_STRIDE;
          enc.setVertexStreams(s);
          enc.drawIndexedInstanced(this.bucketCount[k]!, n, this.bucketFirst[k]!);
          draws++;
        }
      }
      enc.end();
    }
    this.stats.dynamicDraws = draws;
    return draws;
  }

  dispose(): void {
    const dev = this.dev;
    for (const g of this.gpu) {
      dev.destroyBindGroup(g.group);
      dev.destroyBuffer(g.ubo);
      dev.destroyBuffer(g.terrainInst);
      dev.destroyBuffer(g.propInst);
      dev.destroyBuffer(g.unitRing);
    }
    dev.destroyBindGroup(this.unitGroup);
    dev.destroyBindGroup(this.recvGroup);
    dev.destroyBuffer(this.recvUbo);
    dev.destroyBuffer(this.unitVbo);
    dev.destroyBuffer(this.unitIbo);
    dev.destroyTexture(this.pivotTex);
    dev.destroyTexture(this.partsTex);
    dev.destroyTexture(this.staticTex);
    dev.destroyTexture(this.dynamicTex);
    for (const p of [this.terrainPipe, this.propPipe, this.unitPipe]) dev.destroyPipeline(p);
  }
}
