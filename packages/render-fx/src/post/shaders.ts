/**
 * GLSL of the post chain (fullscreen triangle + down/up/composite/FXAA fragment shaders).
 * Ported from the SPK4 prototype (tools/render-bench/src/proto/post.ts, DECISIONS 17).
 */
import { std140Layout, vf } from '@faf/render';
import type { VertexStreamLayout } from '@faf/render';
import { ACES_GLSL, DISPLAY_GAMMA, KAWASE_DOWN_TAPS, KAWASE_UP_TAPS, glslFloat, kawaseTapsGlsl } from './tonemap.ts';

/**
 * Fullscreen triangle from a 3-vertex u8 stream (attribute 0 enabled on purpose: Firefox on macOS
 * emulates attribute-less draws expensively).
 */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Vertex data of the fullscreen triangle: (0,0), (2,0), (0,2) as u8x2 with 4-byte stride. */
export const FULLSCREEN_TRIANGLE = Uint8Array.of(0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0);

export const FULLSCREEN_STREAM: VertexStreamLayout = {
  stepMode: 'vertex',
  stride: 4,
  attributes: [{ location: 0, format: vf('u8', 2, 'float'), offset: 0 }],
};

/** Per-step uniform block of the post passes (bound at render's SLOT_PASS). */
export const POST_LAYOUT = std140Layout([
  { name: 'texel', type: 'vec4' },
  { name: 'params', type: 'vec4' },
]);

export const POST_BLOCK_NAME = 'FxPost';

const POST_BLOCK = /* glsl */ `
layout(std140) uniform ${POST_BLOCK_NAME} {
  vec4 u_texel;  // xy: 1 / source size, zw: 1 / target size
  vec4 u_params; // down: x threshold, y knee, z prefilter (1/0)
                 // up: x weight of the added down level
                 // composite: x exposure, y bloom intensity, z hdr (1/0), w luma into alpha (1/0)
};
`;

/** Values above this are clamped before the bloom prefilter (fireflies, f16 overflow → inf/NaN). */
export const BLOOM_INPUT_MAX = 64;

export const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
${POST_BLOCK}
uniform highp sampler2D u_src;
in vec2 v_uv;
out vec4 o_color;
vec3 prefilter(vec3 c) {
  c = min(c, vec3(${glslFloat(BLOOM_INPUT_MAX)}));
  float br = max(c.r, max(c.g, c.b));
  float knee = max(u_params.y, 1e-4);
  float soft = clamp(br - u_params.x + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contrib = max(soft, br - u_params.x) / max(br, 1e-4);
  return c * contrib;
}
void main() {
  vec3 sum = vec3(0.0);
${kawaseTapsGlsl(KAWASE_DOWN_TAPS, 'u_src', 'v_uv', 'u_texel.xy')}
  vec3 c = sum * ${glslFloat(1 / KAWASE_DOWN_TAPS.reduce((a, t) => a + t[2], 0))};
  if (u_params.z > 0.5) c = prefilter(c);
  o_color = vec4(c, 1.0);
}
`;

export const UP_FS = /* glsl */ `#version 300 es
precision highp float;
${POST_BLOCK}
uniform highp sampler2D u_src;  // lower (smaller) level
uniform highp sampler2D u_add;  // down level of the target size
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec3 sum = vec3(0.0);
${kawaseTapsGlsl(KAWASE_UP_TAPS, 'u_src', 'v_uv', 'u_texel.xy')}
  o_color = vec4(sum * ${glslFloat(1 / KAWASE_UP_TAPS.reduce((a, t) => a + t[2], 0))} + texture(u_add, v_uv).rgb * u_params.x, 1.0);
}
`;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
${POST_BLOCK}
${ACES_GLSL}
uniform highp sampler2D u_scene;
uniform highp sampler2D u_bloom;
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  if (u_params.y > 0.0) c += texture(u_bloom, v_uv).rgb * u_params.y;
  if (u_params.z > 0.5) {
    // Scene shaders output display-referred colors (as @faf/render does): linearize, expose, ACES, back.
    vec3 lin = pow(max(c, vec3(0.0)), vec3(${glslFloat(DISPLAY_GAMMA)})) * u_params.x;
    c = pow(fxAces(lin), vec3(${glslFloat(1 / DISPLAY_GAMMA)}));
  } else {
    c = clamp(c, 0.0, 1.0);
  }
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  o_color = vec4(c, u_params.w > 0.5 ? luma : 1.0);
}
`;

/** FXAA 3.11-style (5-tap early out, edge search with 6 steps), luma from the alpha channel. */
export const FXAA_FS = /* glsl */ `#version 300 es
precision highp float;
${POST_BLOCK}
uniform highp sampler2D u_ldr;
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec2 px = u_texel.xy;
  vec4 m = texture(u_ldr, v_uv);
  float lM = m.a;
  float lN = texture(u_ldr, v_uv + vec2(0.0, px.y)).a;
  float lS = texture(u_ldr, v_uv - vec2(0.0, px.y)).a;
  float lE = texture(u_ldr, v_uv + vec2(px.x, 0.0)).a;
  float lW = texture(u_ldr, v_uv - vec2(px.x, 0.0)).a;
  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.0312, lMax * 0.125)) {
    o_color = vec4(m.rgb, 1.0);
    return;
  }
  float lNW = texture(u_ldr, v_uv + vec2(-px.x, px.y)).a;
  float lNE = texture(u_ldr, v_uv + px).a;
  float lSW = texture(u_ldr, v_uv - px).a;
  float lSE = texture(u_ldr, v_uv + vec2(px.x, -px.y)).a;
  float edgeH = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  float edgeV = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  bool horizontal = edgeH >= edgeV;
  float l1 = horizontal ? lS : lW;
  float l2 = horizontal ? lN : lE;
  float g1 = abs(l1 - lM);
  float g2 = abs(l2 - lM);
  float stepLen = horizontal ? px.y : px.x;
  float gradient;
  float lEdge;
  if (g1 >= g2) {
    stepLen = -stepLen;
    gradient = g1;
    lEdge = 0.5 * (l1 + lM);
  } else {
    gradient = g2;
    lEdge = 0.5 * (l2 + lM);
  }
  vec2 uvEdge = v_uv + (horizontal ? vec2(0.0, stepLen * 0.5) : vec2(stepLen * 0.5, 0.0));
  vec2 dir = horizontal ? vec2(px.x, 0.0) : vec2(0.0, px.y);
  float scaled = gradient * 0.25;
  vec2 uvP = uvEdge + dir;
  vec2 uvN = uvEdge - dir;
  float dP = texture(u_ldr, uvP).a - lEdge;
  float dN = texture(u_ldr, uvN).a - lEdge;
  bool doneP = abs(dP) >= scaled;
  bool doneN = abs(dN) >= scaled;
  const float STEPS[6] = float[6](1.5, 2.0, 2.0, 2.0, 4.0, 8.0);
  for (int i = 0; i < 6 && !(doneP && doneN); ++i) {
    if (!doneP) { uvP += dir * STEPS[i]; dP = texture(u_ldr, uvP).a - lEdge; doneP = abs(dP) >= scaled; }
    if (!doneN) { uvN -= dir * STEPS[i]; dN = texture(u_ldr, uvN).a - lEdge; doneN = abs(dN) >= scaled; }
  }
  float distP = horizontal ? uvP.x - v_uv.x : uvP.y - v_uv.y;
  float distN = horizontal ? v_uv.x - uvN.x : v_uv.y - uvN.y;
  bool nearestP = distP < distN;
  float dist = min(distP, distN);
  float span = distP + distN;
  bool correct = ((nearestP ? dP : dN) < 0.0) != (lM - lEdge < 0.0);
  float edgeBlend = correct ? 0.5 - dist / max(span, 1e-6) : 0.0;
  float avg = (2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE) / 12.0;
  float sub = clamp(abs(avg - lM) / range, 0.0, 1.0);
  sub = smoothstep(0.0, 1.0, sub);
  float subBlend = sub * sub * 0.75;
  float blend = max(edgeBlend, subBlend);
  vec2 uv = v_uv + (horizontal ? vec2(0.0, stepLen * blend) : vec2(stepLen * blend, 0.0));
  o_color = vec4(texture(u_ldr, uv).rgb, 1.0);
}
`;
