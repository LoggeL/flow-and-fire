/**
 * GLSL building blocks of the CSM prototype (receivers and casters). Kept apart from `shadows.ts` so
 * the terrain and prop passes can include them without a module cycle.
 *
 * Receivers sample two depth arrays with hardware PCF (`sampler2DArrayShadow`, linear compare =
 * 2 × 2 bilinear PCF per tap, 4 taps): the STATIC layer (terrain + props, cached, re-rendered only
 * when a cascade leaves its cached coverage) and the DYNAMIC layer (units, every frame). Both layers
 * of cascade c share one light matrix, so a texel is lit only if both are lit (min).
 */
import { std140Layout } from '@faf/render';
import type { SamplerBinding } from '@faf/render';

/** Uniform-block slot of `ShadowRecv` (Frame 0, Palette 1, pass 2, TerrainHeight 3). */
export const SLOT_SHADOW = 4;
export const UNIT_SHADOW_STATIC = 7;
export const UNIT_SHADOW_DYNAMIC = 8;
export const MAX_CASCADES = 2;

export const SHADOW_SAMPLERS: readonly SamplerBinding[] = [
  { name: 'u_shadowStatic', unit: UNIT_SHADOW_STATIC },
  { name: 'u_shadowDynamic', unit: UNIT_SHADOW_DYNAMIC },
];

export const SHADOW_RECV_LAYOUT = std140Layout([
  { name: 'mat', type: 'mat4', count: MAX_CASCADES },
  { name: 'fwd', type: 'vec4' },
  { name: 'split', type: 'vec4' },
  { name: 'params', type: 'vec4' },
]);

/**
 * Declares the samplers and the `ShadowRecv` block and provides `float shadowFactor(vec3 relPos,
 * vec3 n)` (1 = lit) for camera-relative positions (WU). Needs the Frame block (`u_camFrac`).
 */
export const SHADOW_RECEIVE_GLSL = /* glsl */ `
uniform highp sampler2DArrayShadow u_shadowStatic;
uniform highp sampler2DArrayShadow u_shadowDynamic;
layout(std140) uniform ShadowRecv {
  mat4 u_shadowMat[${MAX_CASCADES}]; // camera-relative WU -> shadow texture space [0,1]^3
  vec4 u_shadowFwd;    // xyz: camera forward, w: 1 = shadows on
  vec4 u_shadowSplit;  // x: split view depth c0|c1, y: shadow end depth, z: fade width, w: PCF offset (uv)
  vec4 u_shadowParams; // x: strength, y: normal offset c0 (WU), z: normal offset c1 (WU), w: 0
};

float shadowTap(vec3 uvz, float layer, vec2 off) {
  vec4 c = vec4(uvz.xy + off, layer, uvz.z);
  return min(texture(u_shadowStatic, c), texture(u_shadowDynamic, c));
}

float shadowFactor(vec3 relPos, vec3 n) {
  if (u_shadowFwd.w < 0.5) return 1.0;
  float depth = dot(relPos - u_camFrac.xyz, u_shadowFwd.xyz);
  if (depth > u_shadowSplit.y) return 1.0;
  bool inNear = depth < u_shadowSplit.x;
  vec3 p = relPos + n * (inNear ? u_shadowParams.y : u_shadowParams.z);
  vec3 uvz = ((inNear ? u_shadowMat[0] : u_shadowMat[1]) * vec4(p, 1.0)).xyz;
  if (uvz.x <= 0.0 || uvz.y <= 0.0 || uvz.x >= 1.0 || uvz.y >= 1.0 || uvz.z >= 1.0) return 1.0;
  float layer = inNear ? 0.0 : 1.0;
  float t = u_shadowSplit.w;
  float s = shadowTap(uvz, layer, vec2(-t, -t)) + shadowTap(uvz, layer, vec2(t, -t))
          + shadowTap(uvz, layer, vec2(-t, t)) + shadowTap(uvz, layer, vec2(t, t));
  s *= 0.25;
  float fade = smoothstep(u_shadowSplit.y - u_shadowSplit.z, u_shadowSplit.y, depth);
  return mix(mix(1.0, s, u_shadowParams.x), 1.0, fade);
}
`;
