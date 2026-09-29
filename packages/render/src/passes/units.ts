/**
 * UnitPass (PLAN §3.7 "Units", G14, P2): one instanced draw per (visual, LOD).
 *
 * - Instance data are the sim's UnitRecords (48 B) unchanged. On a new frame version or camera change
 *   every record is frustum-culled (sphere over prev and cur) and assigned a LOD (camera distance vs.
 *   the visual's switch distances × preset LOD bias); visible records are bucket-sorted by
 *   (visual, LOD) into a staging buffer and uploaded into a 3-region instance ring.
 * - Meshes: 3 LODs per visual (placeholder LODs or `VisualEntry.meshes` from the asset pipeline), all
 *   in one VBO/IBO; identical meshes are stored once.
 * - VS interpolation: `rel = ivec3(pos) − camPosInt` in integers for prev and cur, then
 *   `vec3(rel)/4096.0` and `mix(prev, cur, alpha)`; yaw on the shortest arc; `noInterp` ⇒ cur.
 * - Merged-part (PLAN §3.7): vertex `partId` k ≥ 1 reads PartStream entry `partBase + k − 1` (if
 *   `k ≤ partCount`) from an RGBA16UI data texture (prevYaw, curYaw, prevPitch, curPitch), interpolates
 *   it like the hull and rotates the vertex around the part pivot (pitch about the side axis, then
 *   yaw), then follows the parent chain (pivot/parent per (visual, part) in an RGBA32F texture).
 *   `partCount = 0` ⇒ rigid.
 * - Team color from the army palette (UBO, 16 entries), Lambert sun + hemisphere light.
 * - Second instance stream: u8 highlight per unit (selection), stride 4 (Metal/ANGLE alignment).
 */
import type { Frustum } from '../frustum.ts';
import type { MeshData } from '../mesh/placeholder.ts';
import { MAX_MESH_PARTS, meshBoundingRadius } from '../mesh/placeholder.ts';
import type { BindGroupH, BufH, GpuDevice, IndexFormat, PassEncoder, PipeH, TexH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import {
  UNIT_FLAG_NO_INTERP,
  UNIT_INSTANCE_OFF_CUR_POS,
  UNIT_INSTANCE_OFF_PART_BASE,
  UNIT_INSTANCE_OFF_PREV_POS,
  UNIT_INSTANCE_OFF_PREV_YAW,
  UNIT_INSTANCE_OFF_VISUAL,
  UNIT_INSTANCE_STRIDE,
  VisualBuckets,
} from '../instance-layout.ts';
import { DEFAULT_LOD_DISTANCES, InstanceCuller, LOD_LEVELS } from '../units/culling.ts';
import type { CullStats } from '../units/culling.ts';
import { FRAME_BLOCK_GLSL, MAX_VISUALS, PALETTE_BLOCK_GLSL, SLOT_FRAME, SLOT_PALETTE } from './shared.ts';

/** Mesh vertex: position f32×3 | normal snorm8×4 | partId u8 | pad ×3. */
export const MESH_VERTEX_STRIDE = 20;
/** Highlight stream stride (one u8 used). */
export const HIGHLIGHT_STRIDE = 4;
const RING_REGIONS = 3;
/** Parts per row of the PartStream texture. */
export const PART_TEXTURE_WIDTH = 1024;
/** Bytes per PartStream record (@faf/protocol PART_RECORD_BYTES). */
export const PART_STRIDE = 8;
const UNIT_TEX_PARTS = 0;
const UNIT_TEX_PIVOTS = 1;

export const UNIT_ATTR = {
  position: 0,
  normal: 1,
  partId: 2,
  prevPos: 3,
  curPos: 4,
  yaw: 5,
  meta: 6,
  highlight: 7,
  parts: 8,
} as const;

const UNIT_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${PALETTE_BLOCK_GLSL}
uniform highp usampler2D u_parts;     // PartStream: (prevYaw, curYaw, prevPitch, curPitch) per part
uniform highp sampler2D u_partPivots; // (pivot xyz, parent) at (partId, visual)
layout(location = ${UNIT_ATTR.position}) in vec3 a_position;
layout(location = ${UNIT_ATTR.normal}) in vec4 a_normal;
layout(location = ${UNIT_ATTR.partId}) in uint a_partId;
layout(location = ${UNIT_ATTR.prevPos}) in ivec3 a_prevPos;
layout(location = ${UNIT_ATTR.curPos}) in ivec3 a_curPos;
layout(location = ${UNIT_ATTR.yaw}) in uvec2 a_yaw;     // prevYaw, curYaw (Ang16)
layout(location = ${UNIT_ATTR.meta}) in uvec4 a_meta;   // visual | army+hp<<8 | build+bank<<8 | flags
layout(location = ${UNIT_ATTR.highlight}) in uint a_highlight;
layout(location = ${UNIT_ATTR.parts}) in uvec2 a_parts; // partBase | partCount (+ reserved << 8)

out vec3 v_normal;
out vec3 v_albedo;
out vec3 v_rel;
flat out uint v_highlight;

const float ANG16_TO_RAD = 6.283185307179586 / 65536.0;

float s16(uint v) {
  return float(int(v) - (v >= 32768u ? 65536 : 0));
}

// Interpolated (yaw, pitch) in radians of part k (identity if the unit has no such part).
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

// Pitch about the side axis (+x nose up), then yaw about +y (Ang16 convention: +x towards +z).
vec3 rotatePart(vec3 v, vec2 yp) {
  float cp = cos(yp.y);
  float sp = sin(yp.y);
  v = vec3(v.x * cp - v.y * sp, v.x * sp + v.y * cp, v.z);
  float cy = cos(yp.x);
  float sy = sin(yp.x);
  return vec3(v.x * cy - v.z * sy, v.y, v.x * sy + v.z * cy);
}

void main() {
  float alpha = u_camFrac.w;
  bool noInterp = (a_meta.w & ${UNIT_FLAG_NO_INTERP}u) != 0u;
  // Exact integer difference first, then to float (precision independent of map position).
  vec3 relCur = vec3(a_curPos - u_camPosInt.xyz) / 4096.0;
  vec3 relPrev = vec3(a_prevPos - u_camPosInt.xyz) / 4096.0;
  vec3 base = noInterp ? relCur : mix(relPrev, relCur, alpha);
  uint visual = min(a_meta.x, ${MAX_VISUALS - 1}u);

  // Merged-part: rotate around the part pivot, then follow the parent chain up to the hull.
  vec3 p = a_position;
  vec3 n = a_normal.xyz;
  uint k = a_partId;
  for (int it = 0; it < ${MAX_MESH_PARTS}; ++it) {
    if (k == 0u) break;
    vec4 piv = texelFetch(u_partPivots, ivec2(int(min(k, ${MAX_MESH_PARTS - 1}u)), int(visual)), 0);
    vec2 yp = partAngles(k, alpha, noInterp);
    p = piv.xyz + rotatePart(p - piv.xyz, yp);
    n = rotatePart(n, yp);
    uint parent = uint(piv.w);
    k = parent < k ? parent : 0u;
  }

  // Shortest-arc hull yaw interpolation on the 16-bit circle.
  uint d = (a_yaw.y - a_yaw.x) & 65535u;
  float yaw = noInterp ? float(a_yaw.y) : float(a_yaw.x) + s16(d) * alpha;
  float ang = yaw * ANG16_TO_RAD;
  float c = cos(ang);
  float s = sin(ang);
  vec3 world = base + vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  v_normal = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  v_rel = world - u_camFrac.xyz;

  uint army = a_meta.y & 15u;
  vec4 vc = u_visual[visual];
  vec3 albedo = mix(u_army[army].rgb, vc.rgb, vc.a);
  v_albedo = a_partId == 0u ? albedo : albedo * 0.85;
  v_highlight = a_highlight;
  gl_Position = u_viewProj * vec4(world, 1.0);
}
`;

const UNIT_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
in vec3 v_normal;
in vec3 v_albedo;
in vec3 v_rel;
flat in uint v_highlight;
out vec4 o_color;

void main() {
  vec3 n = normalize(v_normal);
  float ndl = max(dot(n, u_sunDir.xyz), 0.0);
  vec3 hemi = mix(u_groundColor.rgb, u_skyColor.rgb, n.y * 0.5 + 0.5);
  vec3 color = v_albedo * (hemi + u_sunColor.rgb * ndl);
  if (v_highlight != 0u) {
    vec3 viewDir = normalize(-v_rel);
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.0);
    float pulse = 0.75 + 0.25 * sin(u_camMod.w * 6.0);
    color = mix(color, vec3(0.55, 1.0, 0.55), 0.25) + vec3(0.35, 1.0, 0.35) * rim * pulse;
  }
  float dist = length(v_rel);
  float fog = clamp((dist - u_fog.w) / max(u_fog.w, 1.0), 0.0, 0.85);
  o_color = vec4(mix(color, u_fog.rgb, fog), 1.0);
}
`;

interface MergedMeshes {
  vertices: ArrayBuffer;
  indices: Uint16Array | Uint32Array;
  indexFormat: IndexFormat;
  firstIndex: Uint32Array;
  indexCount: Uint32Array;
}

/** Interleaves meshes into one vertex/index buffer; indices are pre-offset (no baseVertex in WebGL2). */
export function mergeMeshes(meshes: readonly MeshData[]): MergedMeshes {
  let vtx = 0;
  let idx = 0;
  for (const m of meshes) {
    vtx += m.vertexCount;
    idx += m.indexCount;
  }
  const vertices = new ArrayBuffer(Math.max(vtx, 1) * MESH_VERTEX_STRIDE);
  const f32 = new Float32Array(vertices);
  const i8 = new Int8Array(vertices);
  const u8 = new Uint8Array(vertices);
  const wide = vtx > 65535;
  const indices = wide ? new Uint32Array(Math.max(idx, 1)) : new Uint16Array(Math.max(idx, 1));
  const firstIndex = new Uint32Array(meshes.length);
  const indexCount = new Uint32Array(meshes.length);
  let v0 = 0;
  let i0 = 0;
  meshes.forEach((m, k) => {
    for (let v = 0; v < m.vertexCount; v++) {
      const o = (v0 + v) * MESH_VERTEX_STRIDE;
      f32[o >> 2] = m.positions[v * 3]!;
      f32[(o >> 2) + 1] = m.positions[v * 3 + 1]!;
      f32[(o >> 2) + 2] = m.positions[v * 3 + 2]!;
      i8[o + 12] = Math.round(m.normals[v * 3]! * 127);
      i8[o + 13] = Math.round(m.normals[v * 3 + 1]! * 127);
      i8[o + 14] = Math.round(m.normals[v * 3 + 2]! * 127);
      i8[o + 15] = 0;
      u8[o + 16] = m.partIds[v]!;
    }
    firstIndex[k] = i0;
    indexCount[k] = m.indexCount;
    for (let i = 0; i < m.indexCount; i++) indices[i0 + i] = m.indices[i]! + v0;
    v0 += m.vertexCount;
    i0 += m.indexCount;
  });
  return { vertices, indices, indexFormat: wide ? 'uint32' : 'uint16', firstIndex, indexCount };
}

/** Everything the unit pass needs about one visual. */
export interface UnitVisualMeshes {
  /** 1–3 LOD meshes (fewer ⇒ the last one is reused for the coarser levels). */
  readonly lods: readonly MeshData[];
  /** LOD switch distances in WU; default {@link DEFAULT_LOD_DISTANCES}. */
  readonly lodDistancesWU?: readonly [number, number];
}

export interface UnitPartsView {
  /** PartStream bytes, 8 B per part (@faf/protocol PART_*: prevYaw, curYaw, prevPitch, curPitch). */
  readonly bytes: Uint8Array;
  readonly count: number;
  /** Content version; equal ⇒ no re-upload. Omit to upload every frame. */
  readonly version?: number;
}

export class UnitPass {
  readonly pipeline: PipeH;
  private vbo: BufH | null = null;
  private ibo: BufH | null = null;
  private mesh: MergedMeshes | null = null;
  private visualCount = 0;
  /** firstIndex/indexCount per bucket (visual × 3 + lod). */
  private bucketFirst = new Uint32Array(0);
  private bucketCount = new Uint32Array(0);
  private radii = new Float64Array(0);
  private lodDist = new Float64Array(0);
  private lodBias = 1;

  private ring: BufH | null = null;
  private hlRing: BufH | null = null;
  private capacity = 0;
  private region = 0;
  private hlStaging = new Uint8Array(0);
  readonly buckets = new VisualBuckets();
  readonly culler = new InstanceCuller();

  // merged-part textures
  private partsTex: TexH;
  private partsRows = 0;
  private partsStaging = new Uint16Array(4);
  private lastPartsVersion = Number.NaN;
  private lastPartsBytes: Uint8Array | null = null;
  private partsDirty = true;
  private pivotTex: TexH | null = null;
  private pivotData = new Float32Array(0);
  private textureGroup: BindGroupH | null = null;
  /** Cached u16 view of the last PartStream source buffer (no allocation per frame). */
  private partsSrc16: Uint16Array<ArrayBufferLike> = new Uint16Array(0);
  private partsSrcBuffer: ArrayBufferLike | null = null;
  private partsSrcOffset = -1;

  private lastVersion = Number.NaN;
  private lastHighlightVersion = Number.NaN;
  private lastBytes: Uint8Array | null = null;
  private lastHighlight: Uint8Array | undefined = undefined;
  private lastCamVersion = -1;
  private dirty = true;
  /** Visible, culled and dropped records of the last sort. */
  lastCull: Readonly<CullStats> = this.culler.stats;

  private readonly streams: VertexStreamBinding[] = [
    { buffer: 0 as BufH, offset: 0 },
    { buffer: 0 as BufH, offset: 0 },
    { buffer: 0 as BufH, offset: 0 },
  ];
  private readonly offRestored: () => void;

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    private readonly paletteGroup: BindGroupH,
  ) {
    this.pipeline = dev.createPipeline({
      label: 'units',
      vertex: UNIT_VS,
      fragment: UNIT_FS,
      streams: [
        {
          stepMode: 'vertex',
          stride: MESH_VERTEX_STRIDE,
          attributes: [
            { location: UNIT_ATTR.position, format: vf('f32', 3, 'float'), offset: 0 },
            { location: UNIT_ATTR.normal, format: vf('i8', 4, 'norm'), offset: 12 },
            { location: UNIT_ATTR.partId, format: vf('u8', 1, 'int'), offset: 16 },
          ],
        },
        {
          stepMode: 'instance',
          stride: UNIT_INSTANCE_STRIDE,
          attributes: [
            { location: UNIT_ATTR.prevPos, format: vf('i32', 3, 'int'), offset: UNIT_INSTANCE_OFF_PREV_POS },
            { location: UNIT_ATTR.curPos, format: vf('i32', 3, 'int'), offset: UNIT_INSTANCE_OFF_CUR_POS },
            { location: UNIT_ATTR.yaw, format: vf('u16', 2, 'int'), offset: UNIT_INSTANCE_OFF_PREV_YAW },
            { location: UNIT_ATTR.meta, format: vf('u16', 4, 'int'), offset: UNIT_INSTANCE_OFF_VISUAL },
            { location: UNIT_ATTR.parts, format: vf('u32', 2, 'int'), offset: UNIT_INSTANCE_OFF_PART_BASE },
          ],
        },
        {
          stepMode: 'instance',
          stride: HIGHLIGHT_STRIDE,
          attributes: [{ location: UNIT_ATTR.highlight, format: vf('u8', 1, 'int'), offset: 0 }],
        },
      ],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'Palette', slot: SLOT_PALETTE },
      ],
      samplers: [
        { name: 'u_parts', unit: UNIT_TEX_PARTS },
        { name: 'u_partPivots', unit: UNIT_TEX_PIVOTS },
      ],
      cullMode: 'back',
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less',
    });
    this.partsTex = this.createPartsTexture(1);
    // Instance rings and the PartStream texture are not restored by callbacks: re-upload next frame.
    this.offRestored = dev.onRestored(() => {
      this.dirty = true;
      this.partsDirty = true;
    });
  }

  private createPartsTexture(rows: number): TexH {
    this.partsRows = rows;
    this.partsStaging = new Uint16Array(PART_TEXTURE_WIDTH * rows * 4);
    const staging = this.partsStaging;
    return this.dev.createTexture({
      label: 'unit-parts.tex',
      width: PART_TEXTURE_WIDTH,
      height: rows,
      format: 'rgba16ui',
      // Zero parts = identity rotation; real content is re-uploaded on the next frame after a restore.
      restore: (h) => this.dev.writeTexture(h, { x: 0, y: 0, width: PART_TEXTURE_WIDTH, height: rows }, staging),
    });
  }

  /** Replaces all meshes with one LOD each; index k is visual k (MS1 API). */
  setMeshes(meshes: readonly MeshData[]): void {
    this.setVisualMeshes(meshes.map((m) => ({ lods: [m] })));
  }

  /** Replaces all visuals: index k is visual k, each with 1–3 LODs and optional switch distances. */
  setVisualMeshes(visuals: readonly UnitVisualMeshes[]): void {
    if (visuals.length > MAX_VISUALS) throw new Error(`UnitPass: at most ${MAX_VISUALS} visuals`);
    const unique: MeshData[] = [];
    const meshOf = new Int32Array(visuals.length * LOD_LEVELS);
    const radii = new Float64Array(visuals.length);
    const lodDist = new Float64Array(visuals.length * 2);
    const pivots = new Float32Array(Math.max(1, visuals.length) * MAX_MESH_PARTS * 4);
    visuals.forEach((v, vi) => {
      if (v.lods.length < 1 || v.lods.length > LOD_LEVELS) throw new Error(`UnitPass: visual ${vi} needs 1–3 LOD meshes`);
      for (let l = 0; l < LOD_LEVELS; l++) {
        const m = v.lods[Math.min(l, v.lods.length - 1)]!;
        let k = unique.indexOf(m);
        if (k < 0) {
          k = unique.length;
          unique.push(m);
        }
        meshOf[vi * LOD_LEVELS + l] = k;
      }
      let r = 0;
      for (const m of v.lods) r = Math.max(r, meshBoundingRadius(m));
      radii[vi] = r;
      const [d0, d1] = v.lodDistancesWU ?? DEFAULT_LOD_DISTANCES;
      if (!(d0 >= 0 && d1 >= d0)) throw new Error(`UnitPass: visual ${vi}: LOD distances must satisfy 0 ≤ d0 ≤ d1`);
      lodDist[vi * 2] = d0;
      lodDist[vi * 2 + 1] = d1;
      const m0 = v.lods[0]!;
      const pp = m0.partPivots;
      const par = m0.partParents;
      for (let k = 1; k < MAX_MESH_PARTS; k++) {
        const o = (vi * MAX_MESH_PARTS + k) * 4;
        pivots[o] = pp?.[k * 3] ?? 0;
        pivots[o + 1] = pp?.[k * 3 + 1] ?? 0;
        pivots[o + 2] = pp?.[k * 3 + 2] ?? 0;
        const parent = par?.[k] ?? 0;
        if (parent >= k) throw new Error(`UnitPass: visual ${vi}: parent of part ${k} must be smaller`);
        pivots[o + 3] = parent;
      }
    });
    const merged = mergeMeshes(unique);
    this.mesh = merged;
    this.visualCount = visuals.length;
    const buckets = visuals.length * LOD_LEVELS;
    this.bucketFirst = new Uint32Array(buckets);
    this.bucketCount = new Uint32Array(buckets);
    for (let b = 0; b < buckets; b++) {
      this.bucketFirst[b] = merged.firstIndex[meshOf[b]!]!;
      this.bucketCount[b] = merged.indexCount[meshOf[b]!]!;
    }
    this.radii = radii;
    this.lodDist = lodDist;
    if (this.vbo !== null) this.dev.destroyBuffer(this.vbo);
    if (this.ibo !== null) this.dev.destroyBuffer(this.ibo);
    const vbytes = new Uint8Array(merged.vertices);
    this.vbo = this.dev.createBuffer({
      label: 'unit-meshes.vbo',
      usage: 'vertex',
      size: vbytes.byteLength,
      restore: (h) => this.dev.writeBuffer(h, 0, vbytes),
    });
    this.dev.writeBuffer(this.vbo, 0, vbytes);
    const indices = merged.indices;
    this.ibo = this.dev.createBuffer({
      label: 'unit-meshes.ibo',
      usage: 'index',
      size: indices.byteLength,
      restore: (h) => this.dev.writeBuffer(h, 0, indices),
    });
    this.dev.writeBuffer(this.ibo, 0, indices);

    // Pivot table: RGBA32F, MAX_MESH_PARTS × visuals.
    if (this.pivotTex !== null) this.dev.destroyTexture(this.pivotTex);
    this.pivotData = pivots;
    const rows = Math.max(1, visuals.length);
    this.pivotTex = this.dev.createTexture({
      label: 'unit-part-pivots.tex',
      width: MAX_MESH_PARTS,
      height: rows,
      format: 'rgba32f',
      restore: (h) => this.dev.writeTexture(h, { x: 0, y: 0, width: MAX_MESH_PARTS, height: rows }, pivots),
    });
    this.dev.writeTexture(this.pivotTex, { x: 0, y: 0, width: MAX_MESH_PARTS, height: rows }, pivots);
    this.rebuildTextureGroup();

    this.buckets.ensure(Math.max(this.capacity, 1), buckets);
    this.dirty = true;
  }

  private rebuildTextureGroup(): void {
    if (this.textureGroup !== null) this.dev.destroyBindGroup(this.textureGroup);
    const textures = [{ unit: UNIT_TEX_PARTS, texture: this.partsTex }];
    if (this.pivotTex !== null) textures.push({ unit: UNIT_TEX_PIVOTS, texture: this.pivotTex });
    this.textureGroup = this.dev.createBindGroup({ label: 'units.textures', textures });
  }

  /** LOD distance multiplier (render preset). */
  setLodBias(bias: number): void {
    if (!(bias > 0)) throw new Error(`UnitPass: LOD bias must be > 0, got ${bias}`);
    if (bias !== this.lodBias) {
      this.lodBias = bias;
      this.dirty = true;
    }
  }

  /** Bounding radius (WU) of a visual (for tests/diagnostics). */
  radiusOf(visual: number): number {
    return this.radii[visual] ?? 0;
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity && this.ring !== null) return;
    let cap = Math.max(256, this.capacity);
    while (cap < n) cap *= 2;
    if (this.ring !== null) this.dev.destroyBuffer(this.ring);
    if (this.hlRing !== null) this.dev.destroyBuffer(this.hlRing);
    this.ring = this.dev.createBuffer({
      label: 'unit-instances.ring',
      usage: 'vertex',
      size: cap * UNIT_INSTANCE_STRIDE * RING_REGIONS,
      dynamic: true,
    });
    this.hlRing = this.dev.createBuffer({
      label: 'unit-highlight.ring',
      usage: 'vertex',
      size: cap * HIGHLIGHT_STRIDE * RING_REGIONS,
      dynamic: true,
    });
    this.hlStaging = new Uint8Array(cap * HIGHLIGHT_STRIDE);
    this.capacity = cap;
    this.buckets.ensure(cap, this.visualCount * LOD_LEVELS);
    this.dirty = true;
  }

  /** Uploads the PartStream (only on a new version); grows the texture by powers of two rows. */
  prepareParts(parts: UnitPartsView | undefined): void {
    if (parts === undefined || parts.count <= 0) return;
    const unchanged = !this.partsDirty && parts.version !== undefined && parts.version === this.lastPartsVersion && parts.bytes === this.lastPartsBytes;
    if (unchanged) return;
    if (parts.count * PART_STRIDE > parts.bytes.byteLength) throw new Error('UnitPass: parts.count exceeds parts.bytes');
    const rows = Math.ceil(parts.count / PART_TEXTURE_WIDTH);
    if (rows > this.partsRows) {
      let r = Math.max(1, this.partsRows);
      while (r < rows) r *= 2;
      this.dev.destroyTexture(this.partsTex);
      this.partsTex = this.createPartsTexture(r);
      this.rebuildTextureGroup();
    }
    const st = this.partsStaging;
    const b = parts.bytes;
    const n = parts.count * 4;
    if (b.byteOffset % 2 === 0) {
      let src = this.partsSrc16;
      if (this.partsSrcBuffer !== b.buffer || this.partsSrcOffset !== b.byteOffset || src.length < n) {
        src = this.partsSrc16 = new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
        this.partsSrcBuffer = b.buffer;
        this.partsSrcOffset = b.byteOffset;
      }
      for (let i = 0; i < n; i++) st[i] = src[i]!;
    } else {
      for (let i = 0; i < n; i++) st[i] = b[i * 2]! | (b[i * 2 + 1]! << 8);
    }
    this.dev.writeTexture(this.partsTex, { x: 0, y: 0, width: PART_TEXTURE_WIDTH, height: rows }, st);
    this.lastPartsVersion = parts.version ?? Number.NaN;
    this.lastPartsBytes = b;
    this.partsDirty = false;
  }

  /**
   * Culls, sorts and uploads the unit records (only if `version` / `highlightVersion` / the camera
   * changed or unknown). Returns true when new data was uploaded.
   */
  prepare(
    bytes: Uint8Array,
    count: number,
    highlight: Uint8Array | undefined,
    version: number | undefined,
    highlightVersion: number | undefined,
    frustum: Frustum,
    camPosInt: ArrayLike<number>,
    camFrac: ArrayLike<number>,
    cameraVersion: number,
  ): boolean {
    if (this.mesh === null) return false;
    this.ensureCapacity(Math.max(count, 1));
    const unchanged =
      !this.dirty &&
      version !== undefined &&
      version === this.lastVersion &&
      cameraVersion === this.lastCamVersion &&
      bytes === this.lastBytes &&
      highlight === this.lastHighlight &&
      (highlight === undefined || (highlightVersion !== undefined && highlightVersion === this.lastHighlightVersion));
    if (unchanged) return false;
    this.lastVersion = version ?? Number.NaN;
    this.lastHighlightVersion = highlightVersion ?? Number.NaN;
    this.lastBytes = bytes;
    this.lastHighlight = highlight;
    this.lastCamVersion = cameraVersion;
    this.dirty = false;

    this.lastCull = this.culler.cull(bytes, count, this.visualCount, frustum, camPosInt, camFrac, this.radii, this.lodDist, this.lodBias);
    const b = this.buckets;
    b.sortByKeys(bytes, count, this.culler.keys, this.visualCount * LOD_LEVELS, highlight);
    b.dropped = this.lastCull.dropped;
    const total = b.total;
    const hs = this.hlStaging;
    const hl = b.highlight;
    for (let j = 0; j < total; j++) hs[j * HIGHLIGHT_STRIDE] = hl[j]!;
    this.region = (this.region + 1) % RING_REGIONS;
    if (total > 0) {
      this.dev.writeBuffer(this.ring!, this.region * this.capacity * UNIT_INSTANCE_STRIDE, b.sorted, 0, total * UNIT_INSTANCE_STRIDE);
      this.dev.writeBuffer(this.hlRing!, this.region * this.capacity * HIGHLIGHT_STRIDE, hs, 0, total * HIGHLIGHT_STRIDE);
    }
    return true;
  }

  /** Records one draw per (visual, LOD) with at least one visible instance. */
  draw(enc: PassEncoder): void {
    const mesh = this.mesh;
    if (mesh === null || this.ring === null || this.hlRing === null || this.buckets.total === 0) return;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.paletteGroup);
    enc.setBindGroup(this.textureGroup!);
    enc.setIndexBuffer(this.ibo!, mesh.indexFormat);
    const s = this.streams;
    s[0]!.buffer = this.vbo!;
    s[0]!.offset = 0;
    s[1]!.buffer = this.ring;
    s[2]!.buffer = this.hlRing;
    const instBase = this.region * this.capacity * UNIT_INSTANCE_STRIDE;
    const hlBase = this.region * this.capacity * HIGHLIGHT_STRIDE;
    const b = this.buckets;
    const buckets = this.visualCount * LOD_LEVELS;
    for (let k = 0; k < buckets; k++) {
      const n = b.count[k]!;
      if (n === 0) continue;
      const start = b.start[k]!;
      s[1]!.offset = instBase + start * UNIT_INSTANCE_STRIDE;
      s[2]!.offset = hlBase + start * HIGHLIGHT_STRIDE;
      enc.setVertexStreams(s);
      enc.drawIndexedInstanced(this.bucketCount[k]!, n, this.bucketFirst[k]!);
    }
  }

  /** Number of visuals with at least one visible instance (any LOD). */
  activeVisuals(): number {
    let n = 0;
    for (let v = 0; v < this.visualCount; v++) {
      let c = 0;
      for (let l = 0; l < LOD_LEVELS; l++) c += this.buckets.count[v * LOD_LEVELS + l] ?? 0;
      if (c > 0) n++;
    }
    return n;
  }

  /** Number of non-empty (visual, LOD) buckets = unit draw calls. */
  activeBuckets(): number {
    let n = 0;
    const buckets = this.visualCount * LOD_LEVELS;
    for (let k = 0; k < buckets; k++) if (this.buckets.count[k]! > 0) n++;
    return n;
  }

  /** Visible instances per (visual, LOD) bucket of the last sort. */
  bucketInstances(visual: number, lod: number): number {
    return this.buckets.count[visual * LOD_LEVELS + lod] ?? 0;
  }

  /** CPU copy of the pivot table (tests). */
  pivotTable(): Float32Array {
    return this.pivotData;
  }

  dispose(): void {
    this.offRestored();
    for (const h of [this.vbo, this.ibo, this.ring, this.hlRing]) if (h !== null) this.dev.destroyBuffer(h);
    this.vbo = this.ibo = this.ring = this.hlRing = null;
    if (this.textureGroup !== null) this.dev.destroyBindGroup(this.textureGroup);
    this.textureGroup = null;
    this.dev.destroyTexture(this.partsTex);
    if (this.pivotTex !== null) this.dev.destroyTexture(this.pivotTex);
    this.pivotTex = null;
    this.dev.destroyPipeline(this.pipeline);
  }
}
