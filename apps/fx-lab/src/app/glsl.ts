/**
 * Shared shading setup of the lab's opaque passes (ground, props, units): light, fog, noise and the
 * common shader header with render's Frame block, the CSM receiver and the render-fx lighting GLSL.
 */
import { DEFAULT_ARMY_COLORS, FRAME_BLOCK_GLSL, MAX_ARMY_COLORS, SLOT_FRAME } from '@faf/render';
import type { SamplerBinding, UniformBlockBinding } from '@faf/render';
import {
  SHADOW_RECEIVE_GLSL,
  SHADOW_RECV_SAMPLERS,
  SHADOW_RECV_UNIFORM_BLOCKS,
  VARKAN_GLOW,
  glowTintForArmyColor,
  lightingGlsl,
} from '@faf/render-fx';

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Direction towards the sun: low and from the side (≈ 33° elevation) so shadows are long and readable. */
export const LAB_SUN: readonly [number, number, number] = norm3(0.72, 0.58, 0.42);

/** Lab light (display-referred like render's terrain). */
export const LAB_LIGHT = {
  sunColor: [1.08, 0.99, 0.86] as const,
  skyColor: [0.34, 0.39, 0.46] as const,
  groundColor: [0.16, 0.14, 0.12] as const,
  fog: [0.5, 0.56, 0.62] as const,
} as const;

/** Clear color of the scene target (= fog color). */
export const LAB_CLEAR: readonly [number, number, number, number] = [LAB_LIGHT.fog[0], LAB_LIGHT.fog[1], LAB_LIGHT.fog[2], 1];

/** Uniform blocks every lab receiver pipeline declares. */
export const RECEIVER_BLOCKS: readonly UniformBlockBinding[] = [{ name: 'Frame', slot: SLOT_FRAME }, ...SHADOW_RECV_UNIFORM_BLOCKS];
export const RECEIVER_SAMPLERS: readonly SamplerBinding[] = SHADOW_RECV_SAMPLERS;

function vec3Lit(c: readonly number[]): string {
  return `vec3(${c[0]!.toFixed(4)}, ${c[1]!.toFixed(4)}, ${c[2]!.toFixed(4)})`;
}

/** GLSL const arrays of the team colors and their glow colors (faction.md §4.3: red/orange → white-hot). */
export function armyColorsGlsl(): string {
  const team: string[] = [];
  const glow: string[] = [];
  for (let i = 0; i < MAX_ARMY_COLORS; i++) {
    const c = DEFAULT_ARMY_COLORS[i] ?? [0.5, 0.5, 0.5];
    team.push(vec3Lit(c));
    glow.push(vec3Lit(glowTintForArmyColor(c).core));
  }
  return `const vec3 LAB_TEAM[${MAX_ARMY_COLORS}] = vec3[${MAX_ARMY_COLORS}](${team.join(', ')});
const vec3 LAB_GLOW[${MAX_ARMY_COLORS}] = vec3[${MAX_ARMY_COLORS}](${glow.join(', ')});
const float LAB_GLOW_INTENSITY = ${VARKAN_GLOW.intensity.toFixed(2)};
`;
}

/** Hash-based value noise (GPU only; the albedo has no CPU mirror). */
export const LAB_NOISE_GLSL = /* glsl */ `
float labHash(ivec2 p) {
  uint h = uint(p.x) * 0x8da6b343u ^ uint(p.y) * 0xd8163841u;
  h ^= h >> 15u; h *= 0x2c1b3c6du; h ^= h >> 12u; h *= 0x297a2d39u; h ^= h >> 15u;
  return float(h & 0xffffu) / 65535.0;
}
float labNoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = x - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = labHash(c);
  float b = labHash(c + ivec2(1, 0));
  float d = labHash(c + ivec2(0, 1));
  float e = labHash(c + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
float labFbm(vec2 x) {
  return 0.55 * labNoise(x) + 0.28 * labNoise(x * 2.07 + 17.3) + 0.17 * labNoise(x * 4.31 - 5.1);
}
`;

/** Distance fog towards the Frame block's fog color. */
export const LAB_FOG_GLSL = /* glsl */ `
vec3 labFog(vec3 c, vec3 rel) {
  float d = length(rel);
  float f = smoothstep(u_fog.w, u_fog.w * 2.4, d);
  return mix(c, u_fog.rgb, f * 0.85);
}
`;

/** Header of every opaque lab fragment shader (Frame block, CSM receiver, lighting for the scene format). */
export function receiverFsHeader(hdr: boolean): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${SHADOW_RECEIVE_GLSL}
${lightingGlsl(hdr)}
${LAB_FOG_GLSL}
`;
}

/** Header of the opaque vertex shaders. */
export const LAB_VS_HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
`;
