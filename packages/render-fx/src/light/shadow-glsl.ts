/**
 * GLSL building blocks of the cascaded shadow maps (casters and receivers), ported from the SPK4
 * prototype (tools/render-bench/src/proto/shadow-glsl.ts) onto the render-fx slot table.
 *
 * Receivers sample two depth arrays with hardware PCF (`sampler2DArrayShadow`, linear compare =
 * 2 × 2 bilinear PCF per tap, 4 taps): the STATIC layer (terrain + props, cached, re-rendered only
 * when a cascade leaves its cached coverage or on `invalidateStatic()`) and the DYNAMIC layer (units,
 * every frame). Both layers of cascade c share one light matrix: a texel is lit only if both are lit
 * (min).
 */
import { SLOT_PASS, std140Layout } from '@faf/render';
import type { PipelineDesc, SamplerBinding, UniformBlockBinding } from '@faf/render';
import { SLOT_FX_SHADOW, UNIT_FX_SHADOW_DYNAMIC, UNIT_FX_SHADOW_STATIC } from '../core/slots.ts';
import { MAX_CASCADES } from './cascades.ts';

// -------------------------------------------------------------------------------------------------
// Receivers
// -------------------------------------------------------------------------------------------------

export const SHADOW_RECV_BLOCK_NAME = 'FxShadowRecv';

export const SHADOW_RECV_LAYOUT = std140Layout([
  { name: 'mat', type: 'mat4', count: MAX_CASCADES },
  { name: 'fwd', type: 'vec4' },
  { name: 'split', type: 'vec4' },
  { name: 'params', type: 'vec4' },
  { name: 'info', type: 'vec4' },
]);

/** Uniform-block binding of the receiver block (for `PipelineDesc.uniformBlocks`). */
export const SHADOW_RECV_UNIFORM_BLOCKS: readonly UniformBlockBinding[] = [{ name: SHADOW_RECV_BLOCK_NAME, slot: SLOT_FX_SHADOW }];

/** Sampler bindings of the receiver (for `PipelineDesc.samplers`). */
export const SHADOW_RECV_SAMPLERS: readonly SamplerBinding[] = [
  { name: 'u_fxShadowStatic', unit: UNIT_FX_SHADOW_STATIC },
  { name: 'u_fxShadowDynamic', unit: UNIT_FX_SHADOW_DYNAMIC },
];

/** GLSL of the receiver block alone (the layout test compares it with {@link SHADOW_RECV_LAYOUT}). */
export const SHADOW_RECV_BLOCK_GLSL = /* glsl */ `
layout(std140) uniform ${SHADOW_RECV_BLOCK_NAME} {
  mat4 u_fxShadowMat[${MAX_CASCADES}]; // camera-relative WU (origin camPosInt) -> shadow texture space [0,1]^3
  vec4 u_fxShadowFwd;    // xyz: camera forward, w: 1 = shadows on
  vec4 u_fxShadowSplit;  // x: split view depth c0|c1, y: shadow end depth, z: end fade width, w: cascade blend width
  vec4 u_fxShadowParams; // x: strength, y: normal offset c0 (WU), z: normal offset c1 (WU), w: PCF tap offset (uv)
  vec4 u_fxShadowInfo;   // x: cascade count, y: 1 / map size, zw: 0
};
`;

/**
 * Declares the shadow samplers and the receiver block and provides `float fxShadow(vec3 relPos,
 * vec3 normal)` (1 = lit, 0 = fully shadowed × strength). `relPos` is the camera-relative position
 * in WU (origin = `u_camPosInt`, i.e. `vec3(ivec3(posRaw) − u_camPosInt.xyz) / 4096.0`), the space
 * `u_viewProj` takes. Needs render's FRAME_BLOCK_GLSL (`u_camFrac`) declared before.
 * Outside all cascades → 1.
 */
export const SHADOW_RECEIVE_GLSL = /* glsl */ `
uniform highp sampler2DArrayShadow u_fxShadowStatic;
uniform highp sampler2DArrayShadow u_fxShadowDynamic;
${SHADOW_RECV_BLOCK_GLSL}
float fxShadowTap(vec3 uvz, float layer, vec2 off) {
  vec4 c = vec4(uvz.xy + off, layer, uvz.z);
  return min(texture(u_fxShadowStatic, c), texture(u_fxShadowDynamic, c));
}

// PCF of cascade c at camera-relative position p; -1 when p lies outside the cascade box.
float fxShadowCascade(int c, vec3 p) {
  vec3 uvz = (u_fxShadowMat[c] * vec4(p, 1.0)).xyz;
  if (uvz.x <= 0.0 || uvz.y <= 0.0 || uvz.x >= 1.0 || uvz.y >= 1.0 || uvz.z >= 1.0) return -1.0;
  float layer = float(c);
  float t = u_fxShadowParams.w;
  float s = fxShadowTap(uvz, layer, vec2(-t, -t)) + fxShadowTap(uvz, layer, vec2(t, -t))
          + fxShadowTap(uvz, layer, vec2(-t, t)) + fxShadowTap(uvz, layer, vec2(t, t));
  return s * 0.25;
}

float fxShadow(vec3 relPos, vec3 normal) {
  if (u_fxShadowFwd.w < 0.5) return 1.0;
  float depth = dot(relPos - u_camFrac.xyz, u_fxShadowFwd.xyz);
  if (depth >= u_fxShadowSplit.y) return 1.0;
  bool two = u_fxShadowInfo.x > 1.5;
  vec3 n = normal;
  float s;
  if (!two || depth < u_fxShadowSplit.x) {
    float s0 = fxShadowCascade(0, relPos + n * u_fxShadowParams.y);
    float blend = two ? smoothstep(u_fxShadowSplit.x - u_fxShadowSplit.w, u_fxShadowSplit.x, depth) : 0.0;
    if (two && (s0 < 0.0 || blend > 0.0)) {
      float s1 = fxShadowCascade(1, relPos + n * u_fxShadowParams.z);
      if (s0 < 0.0) s = s1 < 0.0 ? 1.0 : s1;
      else s = s1 < 0.0 ? s0 : mix(s0, s1, blend);
    } else {
      s = s0 < 0.0 ? 1.0 : s0;
    }
  } else {
    float s1 = fxShadowCascade(1, relPos + n * u_fxShadowParams.z);
    s = s1 < 0.0 ? 1.0 : s1;
  }
  float fade = smoothstep(u_fxShadowSplit.y - u_fxShadowSplit.z, u_fxShadowSplit.y, depth);
  return mix(mix(1.0, s, u_fxShadowParams.x), 1.0, fade);
}
`;

// -------------------------------------------------------------------------------------------------
// Casters
// -------------------------------------------------------------------------------------------------

export const SHADOW_CASTER_BLOCK_NAME = 'FxShadowCaster';

/** Casters bind their block at the pass slot (a caster pass is its own pass). */
export const SHADOW_CASTER_SLOT = SLOT_PASS;

export const SHADOW_CASTER_LAYOUT = std140Layout([
  { name: 'lightVP', type: 'mat4' },
  { name: 'anchor', type: 'ivec4' },
  { name: 'info', type: 'vec4' },
]);

export const SHADOW_CASTER_UNIFORM_BLOCKS: readonly UniformBlockBinding[] = [{ name: SHADOW_CASTER_BLOCK_NAME, slot: SHADOW_CASTER_SLOT }];

/**
 * Caster vertex-shader helper: declares the caster block and
 * `vec4 fxShadowCasterPos(ivec3 posRaw, vec3 localOffsetWu)` = light clip position of a vertex at
 * `posRaw` (Q20.12 world position of the instance/origin) plus a local offset in WU (rotated mesh
 * vertex). The integer difference to the cascade anchor keeps it exact on the whole map. Also
 * `vec4 fxShadowCasterPosRel(vec3 anchorRelWu)` for vertices already relative to `u_fxShadowAnchor`.
 */
export const SHADOW_CASTER_GLSL = /* glsl */ `
layout(std140) uniform ${SHADOW_CASTER_BLOCK_NAME} {
  mat4 u_fxLightViewProj;  // anchor-relative WU -> light clip
  ivec4 u_fxShadowAnchor;  // xyz: anchor (raw Q20.12)
  vec4 u_fxShadowCasterInfo; // x: cascade index, y: texel size (WU), z: 0 static / 1 dynamic layer
};
vec4 fxShadowCasterPosRel(vec3 anchorRelWu) {
  return u_fxLightViewProj * vec4(anchorRelWu, 1.0);
}
vec4 fxShadowCasterPos(ivec3 posRaw, vec3 localOffsetWu) {
  return fxShadowCasterPosRel(vec3(posRaw - u_fxShadowAnchor.xyz) / 4096.0 + localOffsetWu);
}
`;

/** Empty fragment shader of depth-only caster pipelines. */
export const SHADOW_DEPTH_FS = /* glsl */ `#version 300 es
precision highp float;
void main() {}
`;

/**
 * Pipeline state every caster pipeline should use (depth only, polygon offset from the prototype).
 * Spread into the caster's `PipelineDesc` together with its own vertex shader/streams.
 */
export const SHADOW_CASTER_PIPELINE = {
  fragment: SHADOW_DEPTH_FS,
  colorWrite: false,
  depthTest: true,
  depthWrite: true,
  depthCompare: 'less',
  cullMode: 'none',
  depthBias: { constant: 2, slopeScale: 2.5 },
} as const satisfies Partial<PipelineDesc>;
