/**
 * UnitPass (PLAN §3.7 "Units", G14): one instanced draw per visual.
 *
 * - Instance data are the sim's UnitRecords (48 B) unchanged; they are bucket-sorted by `visual`
 *   into a staging buffer and uploaded into a 3-region instance ring (no per-frame allocation).
 * - VS interpolation: `rel = ivec3(pos) − camPosInt` in integers for prev and cur, then
 *   `vec3(rel)/4096.0` and `mix(prev, cur, alpha)`; yaw on the shortest arc; `noInterp` ⇒ cur.
 * - Team color from the army palette (UBO, 16 entries), Lambert sun + hemisphere light.
 * - Second instance stream: u8 highlight per unit (selection), stride 4 (Metal/ANGLE alignment).
 * - The mesh vertex format already carries `partId` (merged-part meshes). MS1 draws only part 0;
 *   the PartStream (per-part yaw/pitch) is not evaluated yet.
 */
import type { MeshData } from '../mesh/placeholder.ts';
import type { BindGroupH, BufH, GpuDevice, IndexFormat, PassEncoder, PipeH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import {
  UNIT_FLAG_NO_INTERP,
  UNIT_INSTANCE_OFF_CUR_POS,
  UNIT_INSTANCE_OFF_PREV_POS,
  UNIT_INSTANCE_OFF_PREV_YAW,
  UNIT_INSTANCE_OFF_VISUAL,
  UNIT_INSTANCE_STRIDE,
  VisualBuckets,
} from '../instance-layout.ts';
import { FRAME_BLOCK_GLSL, MAX_VISUALS, PALETTE_BLOCK_GLSL, SLOT_FRAME, SLOT_PALETTE } from './shared.ts';

/** Mesh vertex: position f32×3 | normal snorm8×4 | partId u8 | pad ×3. */
export const MESH_VERTEX_STRIDE = 20;
/** Highlight stream stride (one u8 used). */
export const HIGHLIGHT_STRIDE = 4;
const RING_REGIONS = 3;

export const UNIT_ATTR = {
  position: 0,
  normal: 1,
  partId: 2,
  prevPos: 3,
  curPos: 4,
  yaw: 5,
  meta: 6,
  highlight: 7,
} as const;

const UNIT_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${PALETTE_BLOCK_GLSL}
layout(location = ${UNIT_ATTR.position}) in vec3 a_position;
layout(location = ${UNIT_ATTR.normal}) in vec4 a_normal;
layout(location = ${UNIT_ATTR.partId}) in uint a_partId;
layout(location = ${UNIT_ATTR.prevPos}) in ivec3 a_prevPos;
layout(location = ${UNIT_ATTR.curPos}) in ivec3 a_curPos;
layout(location = ${UNIT_ATTR.yaw}) in uvec2 a_yaw;     // prevYaw, curYaw (Ang16)
layout(location = ${UNIT_ATTR.meta}) in uvec4 a_meta;   // visual | army+hp<<8 | build+bank<<8 | flags
layout(location = ${UNIT_ATTR.highlight}) in uint a_highlight;

out vec3 v_normal;
out vec3 v_albedo;
out vec3 v_rel;
flat out uint v_highlight;

const float ANG16_TO_RAD = 6.283185307179586 / 65536.0;

void main() {
  float alpha = u_camFrac.w;
  bool noInterp = (a_meta.w & ${UNIT_FLAG_NO_INTERP}u) != 0u;
  // Exact integer difference first, then to float (precision independent of map position).
  vec3 relCur = vec3(a_curPos - u_camPosInt.xyz) / 4096.0;
  vec3 relPrev = vec3(a_prevPos - u_camPosInt.xyz) / 4096.0;
  vec3 base = noInterp ? relCur : mix(relPrev, relCur, alpha);

  // Shortest-arc yaw interpolation on the 16-bit circle.
  uint d = (a_yaw.y - a_yaw.x) & 65535u;
  float delta = float(int(d) - (d >= 32768u ? 65536 : 0));
  float yaw = noInterp ? float(a_yaw.y) : float(a_yaw.x) + delta * alpha;
  float ang = yaw * ANG16_TO_RAD;
  float c = cos(ang);
  float s = sin(ang);

  // MS1: only part 0 (PartStream not evaluated); other parts share the hull transform.
  vec3 p = a_position;
  vec3 n = a_normal.xyz;
  vec3 world = base + vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  v_normal = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  v_rel = world - u_camFrac.xyz;

  uint visual = min(a_meta.x, ${MAX_VISUALS - 1}u);
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

export class UnitPass {
  readonly pipeline: PipeH;
  private vbo: BufH | null = null;
  private ibo: BufH | null = null;
  private mesh: MergedMeshes | null = null;
  private visualCount = 0;

  private ring: BufH | null = null;
  private hlRing: BufH | null = null;
  private capacity = 0;
  private region = 0;
  private hlStaging = new Uint8Array(0);
  readonly buckets = new VisualBuckets();

  private lastVersion = Number.NaN;
  private lastHighlightVersion = Number.NaN;
  private lastBytes: Uint8Array | null = null;
  private dirty = true;

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
      cullMode: 'back',
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less',
    });
    // Instance rings are not restored by callbacks: force a re-upload on the next frame.
    this.offRestored = dev.onRestored(() => {
      this.dirty = true;
    });
  }

  /** Replaces all meshes; index k is visual k. */
  setMeshes(meshes: readonly MeshData[]): void {
    if (meshes.length > MAX_VISUALS) throw new Error(`UnitPass: at most ${MAX_VISUALS} visuals`);
    const merged = mergeMeshes(meshes);
    this.mesh = merged;
    this.visualCount = meshes.length;
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
    this.buckets.ensure(Math.max(this.capacity, 1), this.visualCount);
    this.dirty = true;
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
    this.buckets.ensure(cap, this.visualCount);
    this.dirty = true;
  }

  /**
   * Sorts and uploads the unit records (only if `version` / `highlightVersion` changed or unknown).
   * Returns true when new data was uploaded.
   */
  prepare(
    bytes: Uint8Array,
    count: number,
    highlight: Uint8Array | undefined,
    version: number | undefined,
    highlightVersion: number | undefined,
  ): boolean {
    if (this.mesh === null) return false;
    this.ensureCapacity(Math.max(count, 1));
    const unchanged =
      !this.dirty &&
      version !== undefined &&
      version === this.lastVersion &&
      bytes === this.lastBytes &&
      (highlight === undefined || (highlightVersion !== undefined && highlightVersion === this.lastHighlightVersion));
    if (unchanged) return false;
    this.lastVersion = version ?? Number.NaN;
    this.lastHighlightVersion = highlightVersion ?? Number.NaN;
    this.lastBytes = bytes;
    this.dirty = false;

    const b = this.buckets;
    b.sort(bytes, count, highlight);
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

  /** Records one draw per visual with at least one instance. */
  draw(enc: PassEncoder): void {
    const mesh = this.mesh;
    if (mesh === null || this.ring === null || this.hlRing === null || this.buckets.total === 0) return;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.paletteGroup);
    enc.setIndexBuffer(this.ibo!, mesh.indexFormat);
    const s = this.streams;
    s[0]!.buffer = this.vbo!;
    s[0]!.offset = 0;
    s[1]!.buffer = this.ring;
    s[2]!.buffer = this.hlRing;
    const instBase = this.region * this.capacity * UNIT_INSTANCE_STRIDE;
    const hlBase = this.region * this.capacity * HIGHLIGHT_STRIDE;
    const b = this.buckets;
    for (let v = 0; v < this.visualCount; v++) {
      const n = b.count[v]!;
      if (n === 0) continue;
      const start = b.start[v]!;
      s[1]!.offset = instBase + start * UNIT_INSTANCE_STRIDE;
      s[2]!.offset = hlBase + start * HIGHLIGHT_STRIDE;
      enc.setVertexStreams(s);
      enc.drawIndexedInstanced(mesh.indexCount[v]!, n, mesh.firstIndex[v]!);
    }
  }

  /** Number of visuals that will be drawn (non-empty buckets). */
  activeVisuals(): number {
    let n = 0;
    for (let v = 0; v < this.visualCount; v++) if (this.buckets.count[v]! > 0) n++;
    return n;
  }

  dispose(): void {
    this.offRestored();
    for (const h of [this.vbo, this.ibo, this.ring, this.hlRing]) if (h !== null) this.dev.destroyBuffer(h);
    this.vbo = this.ibo = this.ring = this.hlRing = null;
    this.dev.destroyPipeline(this.pipeline);
  }
}
