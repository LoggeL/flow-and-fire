/**
 * Unit pass: every lab unit (all kinds) as lit, instanced box bodies in ONE draw. Shape per kind from
 * the LAB_UNIT_SHAPES table (GLSL const arrays), team color on the upper body, a glowing seam around the
 * hull as HDR emissive (strength = instance glow; the bloom makes it visible), wrecks rusty and cold.
 * Positions/yaw are interpolated between the previous and current fixed step with the Frame block's
 * alpha (`u_camFrac.w`). Shadow casters use the reduced geometry (hull + upper body, no barrel) in the
 * DYNAMIC layer.
 */
import { vf } from '@faf/render';
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding, VertexStreamLayout } from '@faf/render';
import { SHADOW_CASTER_GLSL, SHADOW_CASTER_PIPELINE, SHADOW_CASTER_UNIFORM_BLOCKS } from '@faf/render-fx';
import { LAB_NOISE_GLSL, LAB_VS_HEADER, RECEIVER_BLOCKS, RECEIVER_SAMPLERS, armyColorsGlsl, receiverFsHeader } from './glsl.ts';
import { BOX_VERTS, MESH_STREAM, unitBoxesMesh } from './mesh.ts';
import { LAB_UNIT_KINDS, LAB_UNIT_SHAPES, LAB_UNIT_STRIDE, labUnitKindId } from './units.ts';
import type { LabUnitList } from './units.ts';

const INSTANCE_STREAM: VertexStreamLayout = {
  stepMode: 'instance',
  stride: LAB_UNIT_STRIDE,
  attributes: [
    { location: 3, format: vf('i32', 3, 'int'), offset: 0 },
    { location: 4, format: vf('i32', 3, 'int'), offset: 12 },
    { location: 5, format: vf('f32', 2, 'float'), offset: 24 },
    { location: 6, format: vf('u8', 4, 'float'), offset: 32 },
  ],
};

function f(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/** GLSL const arrays LAB_PART_SIZE / LAB_PART_OFF indexed by kind·3 + part. */
export function unitShapesGlsl(): string {
  const size: string[] = [];
  const off: string[] = [];
  for (const k of LAB_UNIT_KINDS) {
    for (const p of LAB_UNIT_SHAPES[k]) {
      size.push(`vec3(${p.size.map(f).join(', ')})`);
      off.push(`vec3(${p.offset.map(f).join(', ')})`);
    }
  }
  const n = LAB_UNIT_KINDS.length * 3;
  return `const vec3 LAB_PART_SIZE[${n}] = vec3[${n}](${size.join(', ')});
const vec3 LAB_PART_OFF[${n}] = vec3[${n}](${off.join(', ')});
`;
}

const UNIT_LOCAL_GLSL = /* glsl */ `
${unitShapesGlsl()}
vec3 labUnitLocal(vec3 p, int kind, int part) {
  int k = kind * 3 + part;
  return LAB_PART_OFF[k] + p * LAB_PART_SIZE[k];
}
vec3 labRotY(vec3 v, float yaw) {
  float c = cos(yaw);
  float s = sin(yaw);
  return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
}
`;

/** Units sink this far into the ground so they sit on slopes without floating edges. */
const SINK_WU = 0.12;

const UNIT_VS = /* glsl */ `${LAB_VS_HEADER}
${UNIT_LOCAL_GLSL}
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in float a_part;
layout(location = 3) in ivec3 a_prev;
layout(location = 4) in ivec3 a_cur;
layout(location = 5) in vec2 a_yaw;
layout(location = 6) in vec4 a_info;
out vec3 v_rel;
out vec3 v_normal;
out vec3 v_box;
flat out ivec4 v_info;
flat out vec2 v_hpGlow;
void main() {
  int kind = int(a_info.x + 0.5);
  int part = int(a_part + 0.5);
  float alpha = u_camFrac.w;
  float yaw = mix(a_yaw.x, a_yaw.y, alpha);
  vec3 base = mix(vec3(a_prev - u_camPosInt.xyz), vec3(a_cur - u_camPosInt.xyz), alpha) / 4096.0;
  v_rel = base + labRotY(labUnitLocal(a_pos, kind, part), yaw) - vec3(0.0, ${f(SINK_WU)}, 0.0);
  v_normal = labRotY(a_normal, yaw);
  v_box = a_pos;
  v_info = ivec4(kind, int(a_info.y + 0.5), part, 0);
  v_hpGlow = vec2(a_info.z / 255.0, a_info.w / 63.75);
  gl_Position = u_viewProj * vec4(v_rel, 1.0);
}
`;

const WRECK = labUnitKindId('wreck');
const SHIELDGEN = labUnitKindId('shieldgen');
const STRUCTURE = labUnitKindId('structure');

function unitFs(hdr: boolean): string {
  return /* glsl */ `${receiverFsHeader(hdr)}
${LAB_NOISE_GLSL}
${armyColorsGlsl()}
in vec3 v_rel;
in vec3 v_normal;
in vec3 v_box;
flat in ivec4 v_info;
flat in vec2 v_hpGlow;
out vec4 o_color;
void main() {
  int kind = v_info.x;
  int army = v_info.y;
  int part = v_info.z;
  float hp = v_hpGlow.x;
  float glow = v_hpGlow.y;
  vec3 n = normalize(v_normal);
  vec3 iron = vec3(0.2, 0.19, 0.185);
  vec3 team = LAB_TEAM[army];
  vec3 albedo;
  bool wreck = kind == ${WRECK};
  if (wreck) {
    float r = labNoise(v_box.xz * 3.1 + v_box.y * 5.3);
    albedo = mix(vec3(0.3, 0.17, 0.1), vec3(0.13, 0.115, 0.105), r);
  } else if (part == 1) {
    albedo = mix(iron, team, 0.72);
  } else if (part == 2) {
    albedo = iron * 0.72;
  } else {
    albedo = mix(iron, team, 0.16);
  }
  // Panel edges: darken where two box coordinates reach the border.
  vec3 q = abs(vec3(v_box.x, v_box.y * 2.0 - 1.0, v_box.z));
  vec3 e = step(vec3(0.9), q);
  albedo *= 1.0 - 0.32 * step(1.5, e.x + e.y + e.z);
  albedo *= 0.72 + 0.28 * hp;
  vec3 c = fxLight(albedo, n, fxShadow(v_rel, n));
  if (!wreck && glow > 0.0) {
    float heat = glow * (0.45 + 0.55 * hp) * LAB_GLOW_INTENSITY;
    float m = 0.0;
    if (part == 0 && abs(n.y) < 0.5) {
      // Glowing seam around the hull (Varkan cast joints).
      float d = abs(v_box.y - 0.78);
      m = 1.0 - smoothstep(0.035, 0.07, d);
    } else if ((kind == ${SHIELDGEN} || kind == ${STRUCTURE}) && part == 2 && n.y > 0.5) {
      m = 0.9; // emitter / stack mouth
    }
    if (m > 0.0) c += fxEmissive(LAB_GLOW[army], heat * m * 0.8);
  }
  o_color = vec4(labFog(c, v_rel), 1.0);
}
`;
}

const UNIT_CASTER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${SHADOW_CASTER_GLSL}
${UNIT_LOCAL_GLSL}
layout(location = 0) in vec3 a_pos;
layout(location = 2) in float a_part;
layout(location = 4) in ivec3 a_cur;
layout(location = 5) in vec2 a_yaw;
layout(location = 6) in vec4 a_info;
void main() {
  vec3 local = labRotY(labUnitLocal(a_pos, int(a_info.x + 0.5), int(a_part + 0.5)), a_yaw.y);
  gl_Position = fxShadowCasterPos(a_cur, local - vec3(0.0, ${f(SINK_WU)}, 0.0));
}
`;

/** Vertices drawn per unit: all three parts in the scene, hull + upper body in the shadow. */
export const UNIT_SCENE_VERTS = BOX_VERTS * 3;
export const UNIT_SHADOW_VERTS = BOX_VERTS * 2;

export class UnitPass {
  private readonly mesh: BufH;
  private pipe: PipeH;
  private readonly caster: PipeH;
  private hdr: boolean;
  private readonly streams: VertexStreamBinding[];

  constructor(
    private readonly dev: GpuDevice,
    private readonly units: LabUnitList,
    hdr: boolean,
  ) {
    const inst = units.instances;
    if (inst === null) throw new Error('UnitPass: the unit list has no GPU instance buffer');
    const mesh = unitBoxesMesh();
    this.mesh = dev.createBuffer({ label: 'lab.units.mesh', usage: 'vertex', size: mesh.byteLength, restore: (b) => dev.writeBuffer(b, 0, mesh) });
    dev.writeBuffer(this.mesh, 0, mesh);
    this.streams = [
      { buffer: this.mesh, offset: 0 },
      { buffer: inst.buffer, offset: 0 },
    ];
    this.hdr = hdr;
    this.pipe = this.createPipeline(hdr);
    this.caster = dev.createPipeline({
      ...SHADOW_CASTER_PIPELINE,
      label: 'lab.units.caster',
      vertex: UNIT_CASTER_VS,
      streams: [MESH_STREAM, INSTANCE_STREAM],
      uniformBlocks: SHADOW_CASTER_UNIFORM_BLOCKS,
    });
  }

  private createPipeline(hdr: boolean): PipeH {
    return this.dev.createPipeline({
      label: 'lab.units',
      vertex: UNIT_VS,
      fragment: unitFs(hdr),
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
    const n = this.units.instanceCount;
    if (n === 0) return 0;
    enc.setPipeline(this.pipe);
    enc.setVertexStreams(this.streams);
    enc.drawInstanced(UNIT_SCENE_VERTS, n);
    return 1;
  }

  encodeShadow(enc: PassEncoder, casterGroup: BindGroupH): number {
    const n = this.units.instanceCount;
    if (n === 0) return 0;
    enc.setPipeline(this.caster);
    enc.setBindGroup(casterGroup);
    enc.setVertexStreams(this.streams);
    enc.drawInstanced(UNIT_SHADOW_VERTS, n);
    return 1;
  }

  destroy(): void {
    this.dev.destroyPipeline(this.pipe);
    this.dev.destroyPipeline(this.caster);
    this.dev.destroyBuffer(this.mesh);
  }
}
