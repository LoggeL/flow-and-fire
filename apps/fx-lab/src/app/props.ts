/**
 * Static props of the lab world: ≈ 300 rocks and iron pillars, instanced in 1 draw and cast into the
 * STATIC shadow layer (cached by CascadedShadows, re-rendered only on refits/restores).
 * Placement is deterministic (fixed seed, independent of the scene seed) and leaves a clearing of
 * {@link PROP_CLEARING_WU} around the map centre where the scenes stage their action.
 */
import { vf } from '@faf/render';
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding } from '@faf/render';
import { DynamicInstanceBuffer, FxRng, SHADOW_CASTER_GLSL, SHADOW_CASTER_PIPELINE, SHADOW_CASTER_UNIFORM_BLOCKS, wuToRaw } from '@faf/render-fx';
import { LAB_WORLD_WU } from './context.ts';
import { labGroundHeight } from './ground.ts';
import { LAB_NOISE_GLSL, LAB_VS_HEADER, RECEIVER_BLOCKS, RECEIVER_SAMPLERS, receiverFsHeader } from './glsl.ts';
import { MESH_STREAM, MESH_STREAM_POS, meshVertexCount, propMesh } from './mesh.ts';

export const PROP_COUNT = 300;
export const PROP_ROCKS = 220;
export const PROP_SEED = 0x70a95;
export const PROP_CLEARING_WU = 36;
/** i32×3 base position (raw), f32×4 (yaw, scale x/y/z), u8×4 albedo. */
export const PROP_STRIDE = 32;

export interface PropInstance {
  readonly xWu: number;
  readonly yWu: number;
  readonly zWu: number;
  readonly yaw: number;
  readonly scale: readonly [number, number, number];
  readonly rgb: readonly [number, number, number];
  readonly pillar: boolean;
}

/** Deterministic prop layout: rock clusters plus scattered pillars, none inside the centre clearing. */
export function generateProps(seed = PROP_SEED): PropInstance[] {
  const rng = new FxRng(seed);
  const out: PropInstance[] = [];
  const c = LAB_WORLD_WU / 2;
  const accept = (x: number, z: number, r: number): boolean =>
    x > r + 4 && z > r + 4 && x < LAB_WORLD_WU - r - 4 && z < LAB_WORLD_WU - r - 4 && Math.hypot(x - c, z - c) > PROP_CLEARING_WU + r;
  // Rock clusters.
  while (out.length < PROP_ROCKS) {
    const cx = rng.range(20, LAB_WORLD_WU - 20);
    const cz = rng.range(20, LAB_WORLD_WU - 20);
    const n = rng.int(4, 10);
    for (let i = 0; i < n && out.length < PROP_ROCKS; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, 11);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const r = rng.range(0.7, 3.1);
      if (!accept(x, z, r)) continue;
      const h = r * rng.range(0.55, 1.2);
      const grey = rng.range(0.3, 0.44);
      out.push({
        xWu: x,
        yWu: labGroundHeight(x, z) - 0.3 * r,
        zWu: z,
        yaw: rng.range(0, Math.PI * 2),
        scale: [r, h + 0.3 * r, r * rng.range(0.7, 1.1)],
        rgb: [grey * 1.04, grey * 0.97, grey * 0.9],
        pillar: false,
      });
    }
  }
  // Iron pillars.
  while (out.length < PROP_COUNT) {
    const x = rng.range(16, LAB_WORLD_WU - 16);
    const z = rng.range(16, LAB_WORLD_WU - 16);
    const r = rng.range(0.7, 1.4);
    if (!accept(x, z, r)) continue;
    const iron = rng.range(0.2, 0.27);
    out.push({
      xWu: x,
      yWu: labGroundHeight(x, z) - 0.4,
      zWu: z,
      yaw: rng.range(0, Math.PI * 2),
      scale: [r, rng.range(5, 12), r],
      rgb: [iron * 1.02, iron, iron * 1.05],
      pillar: true,
    });
  }
  return out;
}

const INSTANCE_STREAM = {
  stepMode: 'instance' as const,
  stride: PROP_STRIDE,
  attributes: [
    { location: 3, format: vf('i32', 3, 'int'), offset: 0 },
    { location: 4, format: vf('f32', 4, 'float'), offset: 12 },
    { location: 5, format: vf('u8', 4, 'norm'), offset: 28 },
  ],
};

const PROP_LOCAL_GLSL = /* glsl */ `
vec3 labPropLocal(vec3 p, vec4 ys) {
  vec3 s = p * ys.yzw;
  float c = cos(ys.x);
  float n = sin(ys.x);
  return vec3(s.x * c - s.z * n, s.y, s.x * n + s.z * c);
}
`;

const PROP_VS = /* glsl */ `${LAB_VS_HEADER}
${PROP_LOCAL_GLSL}
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in float a_part;
layout(location = 3) in ivec3 a_base;
layout(location = 4) in vec4 a_yawScale;
layout(location = 5) in vec4 a_albedo;
out vec3 v_rel;
out vec3 v_normal;
out vec3 v_albedo;
out float v_top;
out vec3 v_local;
void main() {
  v_rel = vec3(a_base - u_camPosInt.xyz) / 4096.0 + labPropLocal(a_pos, a_yawScale);
  vec3 n = a_normal / a_yawScale.yzw;
  float c = cos(a_yawScale.x);
  float s = sin(a_yawScale.x);
  v_normal = normalize(vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c));
  v_albedo = a_albedo.rgb;
  v_top = a_part;
  v_local = a_pos * a_yawScale.yzw;
  gl_Position = u_viewProj * vec4(v_rel, 1.0);
}
`;

function propFs(hdr: boolean): string {
  return /* glsl */ `${receiverFsHeader(hdr)}
${LAB_NOISE_GLSL}
in vec3 v_rel;
in vec3 v_normal;
in vec3 v_albedo;
in float v_top;
in vec3 v_local;
out vec4 o_color;
void main() {
  vec3 n = normalize(v_normal);
  float grain = labNoise(v_local.xz * 2.3 + v_local.y * 1.7);
  vec3 albedo = v_albedo * (0.82 + 0.3 * grain);
  // Dust settles on top faces.
  albedo = mix(albedo, vec3(0.42, 0.37, 0.3), v_top * 0.45);
  vec3 c = fxLight(albedo, n, fxShadow(v_rel, n));
  o_color = vec4(labFog(c, v_rel), 1.0);
}
`;
}

const PROP_CASTER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${SHADOW_CASTER_GLSL}
${PROP_LOCAL_GLSL}
layout(location = 0) in vec3 a_pos;
layout(location = 3) in ivec3 a_base;
layout(location = 4) in vec4 a_yawScale;
void main() {
  gl_Position = fxShadowCasterPos(a_base, labPropLocal(a_pos, a_yawScale));
}
`;

export class PropsPass {
  readonly count: number;
  readonly props: readonly PropInstance[];
  private readonly mesh: BufH;
  private readonly vertexCount: number;
  private readonly inst: DynamicInstanceBuffer;
  private pipe: PipeH;
  private readonly caster: PipeH;
  private hdr: boolean;
  private readonly streams: VertexStreamBinding[];

  constructor(
    private readonly dev: GpuDevice,
    hdr: boolean,
    props: readonly PropInstance[] = generateProps(),
  ) {
    this.props = props;
    this.count = props.length;
    const mesh = propMesh();
    this.vertexCount = meshVertexCount(mesh);
    this.mesh = dev.createBuffer({ label: 'lab.props.mesh', usage: 'vertex', size: mesh.byteLength, restore: (b) => dev.writeBuffer(b, 0, mesh) });
    dev.writeBuffer(this.mesh, 0, mesh);
    this.inst = new DynamicInstanceBuffer(dev, { label: 'lab.props.inst', stride: PROP_STRIDE, capacity: Math.max(1, props.length) });
    const w = this.inst;
    props.forEach((p, i) => {
      const o = (i * PROP_STRIDE) >> 2;
      w.i32[o] = wuToRaw(p.xWu);
      w.i32[o + 1] = wuToRaw(p.yWu);
      w.i32[o + 2] = wuToRaw(p.zWu);
      w.f32[o + 3] = p.yaw;
      w.f32[o + 4] = p.scale[0];
      w.f32[o + 5] = p.scale[1];
      w.f32[o + 6] = p.scale[2];
      const b = i * PROP_STRIDE + 28;
      w.u8[b] = Math.round(Math.min(1, p.rgb[0]) * 255);
      w.u8[b + 1] = Math.round(Math.min(1, p.rgb[1]) * 255);
      w.u8[b + 2] = Math.round(Math.min(1, p.rgb[2]) * 255);
      w.u8[b + 3] = p.pillar ? 255 : 0;
    });
    // Static data: uploaded once, DynamicInstanceBuffer restores it after a context loss.
    w.upload(props.length);
    this.streams = [
      { buffer: this.mesh, offset: 0 },
      { buffer: w.buffer, offset: 0 },
    ];
    this.hdr = hdr;
    this.pipe = this.createPipeline(hdr);
    this.caster = dev.createPipeline({
      ...SHADOW_CASTER_PIPELINE,
      label: 'lab.props.caster',
      vertex: PROP_CASTER_VS,
      streams: [MESH_STREAM_POS, INSTANCE_STREAM],
      uniformBlocks: SHADOW_CASTER_UNIFORM_BLOCKS,
    });
  }

  private createPipeline(hdr: boolean): PipeH {
    return this.dev.createPipeline({
      label: 'lab.props',
      vertex: PROP_VS,
      fragment: propFs(hdr),
      streams: [MESH_STREAM, INSTANCE_STREAM],
      uniformBlocks: RECEIVER_BLOCKS,
      samplers: RECEIVER_SAMPLERS,
      depthTest: true,
      depthWrite: true,
      cullMode: 'back',
    });
  }

  setHdr(hdr: boolean): void {
    if (hdr === this.hdr) return;
    this.dev.destroyPipeline(this.pipe);
    this.pipe = this.createPipeline(hdr);
    this.hdr = hdr;
  }

  encode(enc: PassEncoder): number {
    if (this.count === 0) return 0;
    enc.setPipeline(this.pipe);
    enc.setVertexStreams(this.streams);
    enc.drawInstanced(this.vertexCount, this.count);
    return 1;
  }

  encodeShadow(enc: PassEncoder, casterGroup: BindGroupH): number {
    if (this.count === 0) return 0;
    enc.setPipeline(this.caster);
    enc.setBindGroup(casterGroup);
    enc.setVertexStreams(this.streams);
    enc.drawInstanced(this.vertexCount, this.count);
    return 1;
  }

  destroy(): void {
    this.dev.destroyPipeline(this.pipe);
    this.dev.destroyPipeline(this.caster);
    this.inst.destroy();
    this.dev.destroyBuffer(this.mesh);
  }
}
