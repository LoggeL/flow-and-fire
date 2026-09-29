/**
 * Prop impostor ring (SPK4 fallback): props beyond the impostor distance are drawn as camera-facing
 * (cylindrical) billboards – ONE draw for all meshes – textured from an atlas that is baked at start
 * (and after a context restore) by rendering every prop mesh (LOD 0) with an orthographic side view
 * into its atlas cell. The instances come from the PropPass ring (impostor bucket), so culling and
 * sorting stay in one place.
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME, SLOT_PASS, Std140Writer, std140Layout, vf } from '@faf/render';
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, TexH, VertexStreamBinding } from '@faf/render';
import { PROP_LODS, PROP_MESHES } from '../meshes.ts';
import { IMPOSTOR_BUCKET, PROP_INSTANCE_STRIDE } from '../prop-grid.ts';
import { PROP_INSTANCE_STREAM, PROP_VERTEX_STREAM, propVertexShader } from './props.ts';
import type { PropMeshBuffers, PropPass } from './props.ts';

export const IMPOSTOR_CELL = 128;
const UNIT_ATLAS = 0;

const BAKE_LAYOUT = std140Layout([{ name: 'mat', type: 'mat4' }]);
const BAKE_BLOCK = /* glsl */ `
layout(std140) uniform Bake {
  mat4 u_bakeMat; // mesh space (scaled, yaw 0) -> clip of the atlas cell
};
`;

const BAKE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_pos;
in vec3 v_normal;
in vec3 v_color;
out vec4 o_color;
void main() {
  vec3 n = normalize(v_normal);
  // Fixed studio light: sun from the upper front-left, sky fill. Matches the scene's brightness.
  float ndl = max(dot(n, normalize(vec3(-0.35, 0.8, 0.5))), 0.0);
  vec3 hemi = mix(vec3(0.19, 0.18, 0.16), vec3(0.4, 0.45, 0.55), n.y * 0.5 + 0.5);
  o_color = vec4(v_color * (hemi + vec3(0.85, 0.8, 0.72) * ndl), 1.0);
}
`;

const IMP_LAYOUT = std140Layout([{ name: 'dims', type: 'vec4', count: PROP_MESHES }]);
const IMP_BLOCK = /* glsl */ `
layout(std140) uniform Impostor {
  vec4 u_dims[${PROP_MESHES}]; // x: half width (WU, scale 1), y: height (WU), z: atlas u0, w: cell width (u)
};
`;

const IMP_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${IMP_BLOCK}
layout(location = 0) in uvec2 a_corner;
layout(location = 3) in ivec3 a_pos;
layout(location = 4) in uint a_yaw;
layout(location = 5) in uvec2 a_sm;
out vec3 v_pos;
out vec2 v_uv;
out float v_tint;
void main() {
  uint mesh = min(a_sm.y >> 6u, ${PROP_MESHES - 1}u);
  vec4 d = u_dims[mesh];
  float scale = float(a_sm.x) / 64.0;
  vec3 base = vec3(a_pos - u_camPosInt.xyz) / 4096.0;
  vec2 f = u_camFrac.xz - base.xz;
  float fl = length(f);
  f = fl > 1e-4 ? f / fl : vec2(0.0, 1.0);
  vec3 right = vec3(f.y, 0.0, -f.x);
  vec2 c = vec2(a_corner);
  vec3 rel = base + right * ((c.x * 2.0 - 1.0) * d.x * scale) + vec3(0.0, c.y * d.y * scale, 0.0);
  v_pos = rel;
  v_uv = vec2(d.z + c.x * d.w, c.y);
  v_tint = 0.82 + 0.36 * float(a_sm.y & 63u) / 63.0;
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;

const IMP_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
uniform highp sampler2D u_atlas;
in vec3 v_pos;
in vec2 v_uv;
in float v_tint;
out vec4 o_color;
void main() {
  vec4 t = texture(u_atlas, v_uv);
  if (t.a < 0.5) discard;
  vec3 color = t.rgb / max(t.a, 1e-3) * v_tint;
  float dist = length(v_pos - u_camFrac.xyz);
  float fog = clamp((dist - u_fog.w) / max(u_fog.w, 1.0), 0.0, 0.85);
  o_color = vec4(mix(color, u_fog.rgb, fog), 1.0);
}
`;

/** Two triangles (u8 corner x, y). */
const QUAD = Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0);

export class ImpostorPass {
  readonly atlas: TexH;
  private readonly atlasDepth: TexH;
  private readonly bakePipeline: PipeH;
  private readonly bakeUbo: BufH;
  private readonly bakeGroup: BindGroupH;
  private readonly bakeData = new Std140Writer(BAKE_LAYOUT);
  private readonly pipeline: PipeH;
  private readonly quad: BufH;
  private readonly ubo: BufH;
  private readonly group: BindGroupH;
  private readonly streams: VertexStreamBinding[];
  private readonly offRestored: () => void;
  /** Bakes done (1 at start, +1 per context restore). */
  bakes = 0;

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    private readonly meshes: PropMeshBuffers,
    private readonly props: PropPass,
  ) {
    const w = IMPOSTOR_CELL * PROP_MESHES;
    const h = IMPOSTOR_CELL;
    this.atlas = dev.createTexture({ label: 'bench.impostor.atlas', width: w, height: h, format: 'rgba8', mipLevels: Math.log2(IMPOSTOR_CELL) + 1, filter: 'linear', wrap: 'clamp' });
    this.atlasDepth = dev.createTexture({ label: 'bench.impostor.depth', width: w, height: h, format: 'depth24' });

    this.bakePipeline = dev.createPipeline({
      label: 'bench.impostor.bake',
      vertex: propVertexShader('ivec3(0)', 'u_bakeMat', BAKE_BLOCK),
      fragment: BAKE_FS,
      streams: [PROP_VERTEX_STREAM, PROP_INSTANCE_STREAM],
      uniformBlocks: [{ name: 'Bake', slot: SLOT_PASS }],
      cullMode: 'back',
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less',
    });
    this.bakeUbo = dev.createBuffer({ label: 'bench.impostor.bake.ubo', usage: 'uniform', size: BAKE_LAYOUT.size, dynamic: true });
    this.bakeGroup = dev.createBindGroup({ label: 'bench.impostor.bake', buffers: [{ slot: SLOT_PASS, buffer: this.bakeUbo }] });

    this.pipeline = dev.createPipeline({
      label: 'bench.impostor',
      vertex: IMP_VS,
      fragment: IMP_FS,
      streams: [
        { stepMode: 'vertex', stride: 4, attributes: [{ location: 0, format: vf('u8', 2, 'int'), offset: 0 }] },
        PROP_INSTANCE_STREAM,
      ],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'Impostor', slot: SLOT_PASS },
      ],
      samplers: [{ name: 'u_atlas', unit: UNIT_ATLAS }],
      cullMode: 'none',
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less',
    });
    this.quad = dev.createBuffer({ label: 'bench.impostor.quad', usage: 'vertex', size: QUAD.byteLength, restore: (b) => dev.writeBuffer(b, 0, QUAD) });
    dev.writeBuffer(this.quad, 0, QUAD);
    const dims = new Std140Writer(IMP_LAYOUT);
    for (let m = 0; m < PROP_MESHES; m++) {
      dims.vec4(IMP_LAYOUT.offsetOf('dims') + m * 16, meshes.radii[m]!, meshes.heights[m]!, m / PROP_MESHES, 1 / PROP_MESHES);
    }
    this.ubo = dev.createBuffer({ label: 'bench.impostor.ubo', usage: 'uniform', size: IMP_LAYOUT.size, restore: (b) => dev.writeBuffer(b, 0, dims.bytes) });
    dev.writeBuffer(this.ubo, 0, dims.bytes);
    this.group = dev.createBindGroup({ label: 'bench.impostor', buffers: [{ slot: SLOT_PASS, buffer: this.ubo }], textures: [{ unit: UNIT_ATLAS, texture: this.atlas }] });
    this.streams = [
      { buffer: this.quad, offset: 0 },
      { buffer: props.ring, offset: 0 },
    ];
    this.bake();
    this.offRestored = dev.onRestored(() => this.bake());
  }

  /** Renders every prop mesh (LOD 0, yaw 0, scale 1) into its atlas cell, then builds the mips. */
  bake(): void {
    const dev = this.dev;
    const m = this.meshes;
    // One zero instance at the origin, scale 1 (64), meta 0: reuse a tiny buffer.
    const inst = new Uint32Array([0, 0, 0, 64 << 16]);
    const instBuf = dev.createBuffer({ label: 'bench.impostor.bake.inst', usage: 'vertex', size: inst.byteLength });
    dev.writeBuffer(instBuf, 0, inst);
    const clear = dev.beginPass({ label: 'impostor.clear', colorAttachments: [{ texture: this.atlas }], depthAttachment: { texture: this.atlasDepth }, clearColor: [0, 0, 0, 0], clearDepth: 1 });
    clear.end();
    const streams: VertexStreamBinding[] = [
      { buffer: m.vbo, offset: 0 },
      { buffer: instBuf, offset: 0 },
    ];
    for (let mesh = 0; mesh < PROP_MESHES; mesh++) {
      const r = m.radii[mesh]!;
      const h = m.heights[mesh]!;
      // Orthographic side view along −z: x ∈ [−r, r] → [−1, 1], y ∈ [0, h] → [−1, 1], z ∈ [r, −r] → depth.
      const mat = new Float32Array(16);
      mat[0] = 1 / r;
      mat[5] = 2 / h;
      mat[13] = -1;
      mat[10] = -1 / r;
      mat[15] = 1;
      this.bakeData.mat4(0, mat);
      dev.writeBuffer(this.bakeUbo, 0, this.bakeData.bytes);
      const enc = dev.beginPass({
        label: `impostor.bake${mesh}`,
        colorAttachments: [{ texture: this.atlas }],
        depthAttachment: { texture: this.atlasDepth },
        viewport: { x: mesh * IMPOSTOR_CELL, y: 0, width: IMPOSTOR_CELL, height: IMPOSTOR_CELL },
      });
      enc.setPipeline(this.bakePipeline);
      enc.setBindGroup(this.bakeGroup);
      enc.setVertexStreams(streams);
      enc.setIndexBuffer(m.ibo, 'uint16');
      enc.drawIndexedInstanced(m.indexCount[mesh * PROP_LODS]!, 1, m.firstIndex[mesh * PROP_LODS]!);
      enc.end();
    }
    dev.generateMipmaps(this.atlas);
    dev.destroyBuffer(instBuf);
    this.bakes++;
  }

  /** Impostor instances of the current prop selection. */
  instances(): number {
    return this.props.selection.bucketCount[IMPOSTOR_BUCKET]!;
  }

  draw(enc: PassEncoder): void {
    const n = this.instances();
    if (n === 0) return;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.group);
    this.streams[1]!.offset = this.props.regionOffset + this.props.selection.bucketStart[IMPOSTOR_BUCKET]! * PROP_INSTANCE_STRIDE;
    enc.setVertexStreams(this.streams);
    enc.drawInstanced(6, n);
  }

  dispose(): void {
    this.offRestored();
    const dev = this.dev;
    dev.destroyBindGroup(this.group);
    dev.destroyBindGroup(this.bakeGroup);
    dev.destroyBuffer(this.ubo);
    dev.destroyBuffer(this.bakeUbo);
    dev.destroyBuffer(this.quad);
    dev.destroyPipeline(this.pipeline);
    dev.destroyPipeline(this.bakePipeline);
    dev.destroyTexture(this.atlas);
    dev.destroyTexture(this.atlasDepth);
  }
}
