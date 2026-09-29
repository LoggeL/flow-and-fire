/**
 * PropPass (SPK4 prototype): 30,000 instanced props, ONE draw per (mesh, LOD) with at least one
 * visible instance (3 meshes × 2 LODs ⇒ ≤ 6 draws), chunk frustum culling and chunk LOD on the CPU
 * ({@link PropGrid}) only on camera changes, instances in a 3-region ring. Optionally receives CSM
 * shadows. Instances beyond the impostor distance land in the impostor bucket, drawn by
 * `ImpostorPass` from the same ring.
 *
 * Vertex (20 B): position f32×3 | normal snorm8×4 | color unorm8×4.
 * Instance (16 B): position i32×3 (raw) | yaw u16 | scale u8 (×64) | meta u8 (mesh << 6 | tint).
 * The VS positions camera-relative in integers first (`ivec3(pos) − camPosInt`), like units/terrain.
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME, vf } from '@faf/render';
import type { BindGroupH, BufH, Frustum, GpuDevice, PassEncoder, PipeH, VertexStreamBinding, VertexStreamLayout } from '@faf/render';
import type { PropMesh } from '../meshes.ts';
import { PROP_LODS, PROP_MESHES } from '../meshes.ts';
import { IMPOSTOR_BUCKET, PROP_INSTANCE_STRIDE, PropSelection } from '../prop-grid.ts';
import type { PropGrid } from '../prop-grid.ts';
import { SHADOW_RECEIVE_GLSL, SHADOW_SAMPLERS, SLOT_SHADOW } from './shadow-glsl.ts';

export const PROP_VERTEX_STRIDE = 20;
const RING_REGIONS = 3;

export const PROP_VERTEX_STREAM: VertexStreamLayout = {
  stepMode: 'vertex',
  stride: PROP_VERTEX_STRIDE,
  attributes: [
    { location: 0, format: vf('f32', 3, 'float'), offset: 0 },
    { location: 1, format: vf('i8', 4, 'norm'), offset: 12 },
    { location: 2, format: vf('u8', 4, 'norm'), offset: 16 },
  ],
};

export const PROP_INSTANCE_STREAM: VertexStreamLayout = {
  stepMode: 'instance',
  stride: PROP_INSTANCE_STRIDE,
  attributes: [
    { location: 3, format: vf('i32', 3, 'int'), offset: 0 },
    { location: 4, format: vf('u16', 1, 'int'), offset: 12 },
    { location: 5, format: vf('u8', 2, 'int'), offset: 14 },
  ],
};

/**
 * Prop VS body shared by the main pass and the shadow caster: `origin` is the integer reference
 * (camera or light anchor) and `viewProj` the matrix of that space.
 */
export function propVertexShader(originExpr: string, viewProjExpr: string, header: string): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${header}
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_normal;
layout(location = 2) in vec4 a_color;
layout(location = 3) in ivec3 a_pos;
layout(location = 4) in uint a_yaw;
layout(location = 5) in uvec2 a_sm;
out vec3 v_pos;
out vec3 v_normal;
out vec3 v_color;

void main() {
  float ang = float(a_yaw) * (6.283185307179586 / 65536.0);
  float c = cos(ang);
  float s = sin(ang);
  vec3 p = a_position * (float(a_sm.x) / 64.0);
  vec3 local = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  vec3 rel = vec3(a_pos - ${originExpr}) / 4096.0 + local;
  vec3 n = a_normal.xyz;
  v_pos = rel;
  v_normal = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  v_color = a_color.rgb * (0.82 + 0.36 * float(a_sm.y & 63u) / 63.0);
  gl_Position = ${viewProjExpr} * vec4(rel, 1.0);
}
`;
}

function fragment(csm: boolean): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${csm ? SHADOW_RECEIVE_GLSL : ''}
in vec3 v_pos;
in vec3 v_normal;
in vec3 v_color;
out vec4 o_color;

void main() {
  vec3 n = normalize(v_normal);
  float ndl = max(dot(n, u_sunDir.xyz), 0.0);
  ${csm ? 'ndl *= shadowFactor(v_pos, n);' : ''}
  vec3 hemi = mix(u_groundColor.rgb, u_skyColor.rgb, n.y * 0.5 + 0.5);
  vec3 color = v_color * (hemi + u_sunColor.rgb * ndl);
  float dist = length(v_pos - u_camFrac.xyz);
  float fog = clamp((dist - u_fog.w) / max(u_fog.w, 1.0), 0.0, 0.85);
  o_color = vec4(mix(color, u_fog.rgb, fog), 1.0);
}
`;
}

/** All prop meshes and LODs in one VBO/IBO (indices pre-offset: WebGL2 has no base vertex). */
export class PropMeshBuffers {
  readonly vbo: BufH;
  readonly ibo: BufH;
  /** Per (mesh · PROP_LODS + lod). */
  readonly firstIndex = new Uint32Array(PROP_MESHES * PROP_LODS);
  readonly indexCount = new Uint32Array(PROP_MESHES * PROP_LODS);
  readonly heights: number[] = [];
  readonly radii: number[] = [];

  constructor(
    private readonly dev: GpuDevice,
    readonly meshes: readonly (readonly PropMesh[])[],
  ) {
    let vtx = 0;
    let idx = 0;
    for (const lods of meshes) for (const m of lods) {
      vtx += m.vertexCount;
      idx += m.indexCount;
    }
    if (vtx > 65535) throw new Error('prop meshes exceed 16-bit indices');
    const vbytes = new ArrayBuffer(vtx * PROP_VERTEX_STRIDE);
    const f32 = new Float32Array(vbytes);
    const i8 = new Int8Array(vbytes);
    const u8 = new Uint8Array(vbytes);
    const indices = new Uint16Array(idx);
    let v0 = 0;
    let i0 = 0;
    meshes.forEach((lods, mi) => {
      let h = 0;
      let r = 0;
      lods.forEach((m, l) => {
        for (let v = 0; v < m.vertexCount; v++) {
          const o = (v0 + v) * PROP_VERTEX_STRIDE;
          f32[o >> 2] = m.positions[v * 3]!;
          f32[(o >> 2) + 1] = m.positions[v * 3 + 1]!;
          f32[(o >> 2) + 2] = m.positions[v * 3 + 2]!;
          i8[o + 12] = Math.round(m.normals[v * 3]! * 127);
          i8[o + 13] = Math.round(m.normals[v * 3 + 1]! * 127);
          i8[o + 14] = Math.round(m.normals[v * 3 + 2]! * 127);
          u8[o + 16] = m.colors[v * 4]!;
          u8[o + 17] = m.colors[v * 4 + 1]!;
          u8[o + 18] = m.colors[v * 4 + 2]!;
          u8[o + 19] = m.colors[v * 4 + 3]!;
        }
        for (let i = 0; i < m.indexCount; i++) indices[i0 + i] = m.indices[i]! + v0;
        this.firstIndex[mi * PROP_LODS + l] = i0;
        this.indexCount[mi * PROP_LODS + l] = m.indexCount;
        v0 += m.vertexCount;
        i0 += m.indexCount;
        h = Math.max(h, m.height);
        r = Math.max(r, m.radius);
      });
      this.heights.push(h);
      this.radii.push(r);
    });
    const vb = new Uint8Array(vbytes);
    this.vbo = dev.createBuffer({ label: 'bench.props.vbo', usage: 'vertex', size: vb.byteLength, restore: (b) => dev.writeBuffer(b, 0, vb) });
    dev.writeBuffer(this.vbo, 0, vb);
    this.ibo = dev.createBuffer({ label: 'bench.props.ibo', usage: 'index', size: indices.byteLength, restore: (b) => dev.writeBuffer(b, 0, indices) });
    dev.writeBuffer(this.ibo, 0, indices);
  }

  dispose(): void {
    this.dev.destroyBuffer(this.vbo);
    this.dev.destroyBuffer(this.ibo);
  }
}

export interface PropPassOptions {
  readonly csm: boolean;
  readonly lod0DistanceWU: number;
  readonly impostorDistanceWU: number;
}

export class PropPass {
  readonly pipeline: PipeH;
  readonly ring: BufH;
  private readonly capacity: number;
  private region = 0;
  private lastCamVersion = -1;
  private lodBias = 1;
  private readonly streams: VertexStreamBinding[];
  private readonly shadow: BindGroupH | null;
  private readonly eye = new Float64Array(3);
  readonly selection: PropSelection;

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    readonly grid: PropGrid,
    readonly meshes: PropMeshBuffers,
    shadowGroup: BindGroupH | null,
    private readonly opts: PropPassOptions,
  ) {
    const csm = opts.csm && shadowGroup !== null;
    this.shadow = csm ? shadowGroup : null;
    this.pipeline = dev.createPipeline({
      label: `bench.props${csm ? '.csm' : ''}`,
      vertex: propVertexShader('u_camPosInt.xyz', 'u_viewProj', FRAME_BLOCK_GLSL),
      fragment: fragment(csm),
      streams: [PROP_VERTEX_STREAM, PROP_INSTANCE_STREAM],
      uniformBlocks: [{ name: 'Frame', slot: SLOT_FRAME }, ...(csm ? [{ name: 'ShadowRecv', slot: SLOT_SHADOW }] : [])],
      samplers: csm ? SHADOW_SAMPLERS : [],
      cullMode: 'back',
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less',
    });
    this.capacity = Math.max(1, grid.count);
    this.selection = new PropSelection(grid.count);
    this.ring = dev.createBuffer({ label: 'bench.props.ring', usage: 'vertex', size: this.capacity * PROP_INSTANCE_STRIDE * RING_REGIONS, dynamic: true });
    this.streams = [
      { buffer: meshes.vbo, offset: 0 },
      { buffer: this.ring, offset: 0 },
    ];
    dev.onRestored(() => {
      this.lastCamVersion = -1;
    });
  }

  setLodBias(bias: number): void {
    if (bias !== this.lodBias) {
      this.lodBias = bias;
      this.lastCamVersion = -1;
    }
  }

  /** Byte offset of the current ring region (impostor pass reads the same ring). */
  get regionOffset(): number {
    return this.region * this.capacity * PROP_INSTANCE_STRIDE;
  }

  /** Culls/sorts/uploads on camera changes; returns the visible instance total. */
  prepare(frustum: Frustum, camPosInt: ArrayLike<number>, camFrac: ArrayLike<number>, cameraVersion: number): number {
    const sel = this.selection;
    if (cameraVersion === this.lastCamVersion) return sel.total;
    this.lastCamVersion = cameraVersion;
    this.eye[0] = camFrac[0]!;
    this.eye[1] = camFrac[1]!;
    this.eye[2] = camFrac[2]!;
    const total = this.grid.select(frustum, camPosInt, {
      eye: this.eye,
      lod0Distance: this.opts.lod0DistanceWU * this.lodBias,
      impostorDistance: this.opts.impostorDistanceWU * this.lodBias,
      fixedLod: 1,
    }, sel);
    this.region = (this.region + 1) % RING_REGIONS;
    if (total > 0) this.dev.writeBuffer(this.ring, this.regionOffset, sel.staging, 0, total * (PROP_INSTANCE_STRIDE >> 2));
    return total;
  }

  /** Instances drawn as meshes (all mesh buckets) in the last prepare. */
  meshInstances(): number {
    return this.selection.total - this.selection.bucketCount[IMPOSTOR_BUCKET]!;
  }

  draw(enc: PassEncoder): void {
    const g = this.selection;
    if (g.total === 0) return;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    if (this.shadow !== null) enc.setBindGroup(this.shadow);
    enc.setIndexBuffer(this.meshes.ibo, 'uint16');
    const base = this.regionOffset;
    for (let b = 0; b < IMPOSTOR_BUCKET; b++) {
      const n = g.bucketCount[b]!;
      if (n === 0) continue;
      this.streams[1]!.offset = base + g.bucketStart[b]! * PROP_INSTANCE_STRIDE;
      enc.setVertexStreams(this.streams);
      enc.drawIndexedInstanced(this.meshes.indexCount[b]!, n, this.meshes.firstIndex[b]!);
    }
  }

  dispose(): void {
    this.dev.destroyBuffer(this.ring);
    this.dev.destroyPipeline(this.pipeline);
  }
}
