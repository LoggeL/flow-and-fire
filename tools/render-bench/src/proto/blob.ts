/**
 * Blob shadows (SPK4 fallback for Medium without CSM): one soft dark disc per unit, ONE instanced draw.
 * The disc is a 4 × 4-quad grid whose vertices sample the terrain with the shared
 * `TERRAIN_HEIGHT_GLSL` (bit-identical heights), so it hugs slopes instead of cutting into them; a
 * small lift plus polygon offset avoids z-fighting. Instances are the UnitRecords unchanged
 * (interpolated prev → cur like the unit pass), uploaded only on a new frame version; the GPU clips
 * off-screen discs (2,000 × 32 triangles).
 */
import {
  FRAME_BLOCK_GLSL,
  SLOT_FRAME,
  SLOT_PASS,
  SLOT_TERRAIN_HEIGHT,
  Std140Writer,
  TERRAIN_HEIGHT_GLSL,
  UNIT_HEIGHTMAP,
  UNIT_INSTANCE_OFF_CUR_POS,
  UNIT_INSTANCE_OFF_PREV_POS,
  UNIT_INSTANCE_OFF_VISUAL,
  UNIT_INSTANCE_STRIDE,
  std140Layout,
  vf,
} from '@faf/render';
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, TerrainHeightResources, VertexStreamBinding } from '@faf/render';

export const BLOB_GRID = 4;
const MAX_BLOB_VISUALS = 32;

const LAYOUT = std140Layout([
  { name: 'radius', type: 'vec4', count: MAX_BLOB_VISUALS },
  { name: 'params', type: 'vec4' },
]);

const BLOCK = /* glsl */ `
layout(std140) uniform Blob {
  vec4 u_blobRadius[${MAX_BLOB_VISUALS}]; // x: radius (WU) per visual
  vec4 u_blobParams;                      // x: strength, y: lift (WU)
};
`;

const VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${TERRAIN_HEIGHT_GLSL}
${BLOCK}
layout(location = 0) in uvec2 a_local;   // 0..${BLOB_GRID}
layout(location = 1) in ivec3 a_prevPos;
layout(location = 2) in ivec3 a_curPos;
layout(location = 3) in uint a_visual;
out vec2 v_uv;
void main() {
  float alpha = u_camFrac.w;
  // Camera-relative interpolation in exact integers first (like the unit pass).
  vec3 relPrev = vec3(a_prevPos - u_camPosInt.xyz);
  vec3 relCur = vec3(a_curPos - u_camPosInt.xyz);
  vec3 rel = mix(relPrev, relCur, alpha);
  float r = u_blobRadius[min(a_visual, ${MAX_BLOB_VISUALS - 1}u)].x;
  vec2 uv = vec2(a_local) * (2.0 / ${BLOB_GRID}.0) - 1.0;
  ivec2 xz = u_camPosInt.xz + ivec2(round(rel.xz + uv * r * 4096.0));
  int h = terrainHeightRaw(xz);
  vec3 p = vec3(ivec3(xz.x, h, xz.y) - u_camPosInt.xyz) / 4096.0 + vec3(0.0, u_blobParams.y, 0.0);
  v_uv = uv;
  gl_Position = u_viewProj * vec4(p, 1.0);
}
`;

const FS = /* glsl */ `#version 300 es
precision highp float;
${BLOCK}
in vec2 v_uv;
out vec4 o_color;
void main() {
  float d = length(v_uv);
  float a = u_blobParams.x * (1.0 - smoothstep(0.3, 1.0, d));
  o_color = vec4(0.0, 0.0, 0.0, a);
}
`;

export class BlobShadowPass {
  private readonly pipeline: PipeH;
  private readonly grid: BufH;
  private readonly ibo: BufH;
  private readonly indexCount: number;
  private readonly instances: BufH;
  private readonly ubo: BufH;
  private readonly group: BindGroupH;
  private readonly streams: VertexStreamBinding[];
  private count = 0;
  private lastVersion = -1;
  private readonly capacity: number;

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    private readonly heights: TerrainHeightResources,
    radii: readonly number[],
    capacity: number,
    strength = 0.55,
  ) {
    if (radii.length > MAX_BLOB_VISUALS) throw new Error(`blob: at most ${MAX_BLOB_VISUALS} visuals`);
    this.pipeline = dev.createPipeline({
      label: 'bench.blob',
      vertex: VS,
      fragment: FS,
      streams: [
        { stepMode: 'vertex', stride: 4, attributes: [{ location: 0, format: vf('u8', 2, 'int'), offset: 0 }] },
        {
          stepMode: 'instance',
          stride: UNIT_INSTANCE_STRIDE,
          attributes: [
            { location: 1, format: vf('i32', 3, 'int'), offset: UNIT_INSTANCE_OFF_PREV_POS },
            { location: 2, format: vf('i32', 3, 'int'), offset: UNIT_INSTANCE_OFF_CUR_POS },
            { location: 3, format: vf('u16', 1, 'int'), offset: UNIT_INSTANCE_OFF_VISUAL },
          ],
        },
      ],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'TerrainHeight', slot: SLOT_TERRAIN_HEIGHT },
        { name: 'Blob', slot: SLOT_PASS },
      ],
      samplers: [{ name: 'u_heightmap', unit: UNIT_HEIGHTMAP }],
      cullMode: 'none',
      depthTest: true,
      depthWrite: false,
      depthCompare: 'lequal',
      blend: 'alpha',
      depthBias: { constant: -4, slopeScale: -2 },
    });
    const n = BLOB_GRID + 1;
    const verts = new Uint8Array(n * n * 4);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      verts[(z * n + x) * 4] = x;
      verts[(z * n + x) * 4 + 1] = z;
    }
    const idx = new Uint16Array(BLOB_GRID * BLOB_GRID * 6);
    let k = 0;
    for (let z = 0; z < BLOB_GRID; z++) for (let x = 0; x < BLOB_GRID; x++) {
      const i = z * n + x;
      idx.set([i, i + n, i + 1, i + 1, i + n, i + n + 1], k);
      k += 6;
    }
    this.indexCount = idx.length;
    this.grid = dev.createBuffer({ label: 'bench.blob.grid', usage: 'vertex', size: verts.byteLength, restore: (b) => dev.writeBuffer(b, 0, verts) });
    dev.writeBuffer(this.grid, 0, verts);
    this.ibo = dev.createBuffer({ label: 'bench.blob.ibo', usage: 'index', size: idx.byteLength, restore: (b) => dev.writeBuffer(b, 0, idx) });
    dev.writeBuffer(this.ibo, 0, idx);
    this.capacity = Math.max(1, capacity);
    this.instances = dev.createBuffer({ label: 'bench.blob.instances', usage: 'vertex', size: this.capacity * UNIT_INSTANCE_STRIDE, dynamic: true });
    const data = new Std140Writer(LAYOUT);
    radii.forEach((r, v) => data.vec4(LAYOUT.offsetOf('radius') + v * 16, r, 0, 0, 0));
    data.vec4(LAYOUT.offsetOf('params'), strength, 0.03, 0, 0);
    this.ubo = dev.createBuffer({ label: 'bench.blob.ubo', usage: 'uniform', size: LAYOUT.size, restore: (b) => dev.writeBuffer(b, 0, data.bytes) });
    dev.writeBuffer(this.ubo, 0, data.bytes);
    this.group = dev.createBindGroup({ label: 'bench.blob', buffers: [{ slot: SLOT_PASS, buffer: this.ubo }] });
    this.streams = [
      { buffer: this.grid, offset: 0 },
      { buffer: this.instances, offset: 0 },
    ];
    dev.onRestored(() => {
      this.lastVersion = -1;
    });
  }

  /** Uploads the UnitRecords when their version changed. */
  prepare(bytes: Uint8Array, count: number, version: number): void {
    if (version === this.lastVersion) return;
    this.lastVersion = version;
    this.count = Math.min(count, this.capacity);
    this.dev.writeBuffer(this.instances, 0, bytes, 0, this.count * UNIT_INSTANCE_STRIDE);
  }

  draw(enc: PassEncoder): void {
    if (this.count === 0) return;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.heights.group);
    enc.setBindGroup(this.group);
    enc.setVertexStreams(this.streams);
    enc.setIndexBuffer(this.ibo, 'uint16');
    enc.drawIndexedInstanced(this.indexCount, this.count);
  }

  dispose(): void {
    const dev = this.dev;
    dev.destroyBindGroup(this.group);
    dev.destroyBuffer(this.ubo);
    dev.destroyBuffer(this.grid);
    dev.destroyBuffer(this.ibo);
    dev.destroyBuffer(this.instances);
    dev.destroyPipeline(this.pipeline);
  }
}
