/**
 * The FX view uniform block (TRACK-RENDERFX common contract). Every 3D FX pass binds render's
 * `Frame` block at SLOT_FRAME and this block at SLOT_FX_VIEW.
 */
import type { BufH, BufferBinding } from '@faf/render';
import { SLOT_FRAME, std140Layout } from '@faf/render';
import { SLOT_FX_VIEW } from './slots.ts';

export const FX_VIEW_BLOCK_GLSL = /* glsl */ `
layout(std140) uniform FxView {
  vec4 u_fxRight; // xyz: camera right in world axes
  vec4 u_fxUp;    // xyz: camera up in world axes
  vec4 u_fxFwd;   // xyz: camera view direction in world axes
  vec4 u_fxTime;  // x: FX time (s mod 4096); y: dt (s); z: pixels per WU at distance 1; w: camera distance (WU)
};
`;

export const FX_VIEW_LAYOUT = std140Layout([
  { name: 'fxRight', type: 'vec4' },
  { name: 'fxUp', type: 'vec4' },
  { name: 'fxFwd', type: 'vec4' },
  { name: 'fxTime', type: 'vec4' },
]);

/**
 * Buffers every 3D FX pass receives in its constructor: `frame` holds render's `Frame` block
 * (FRAME_LAYOUT), `fxView` the {@link FX_VIEW_BLOCK_GLSL} block.
 */
export interface FxBindings {
  readonly frame: BufH;
  readonly fxView: BufH;
}

/** The two shared buffer bindings (Frame at SLOT_FRAME, FxView at SLOT_FX_VIEW) for a pass's bind group. */
export function fxSharedBufferBindings(b: FxBindings): BufferBinding[] {
  return [
    { slot: SLOT_FRAME, buffer: b.frame },
    { slot: SLOT_FX_VIEW, buffer: b.fxView },
  ];
}

/**
 * GLSL helpers shared by the FX shaders. Requires `FRAME_BLOCK_GLSL` and {@link FX_VIEW_BLOCK_GLSL}
 * to be declared before it.
 */
export const FX_COMMON_GLSL = /* glsl */ `
const float FX_TIME_WRAP = 4096.0;
const float FX_INV_RAW = 1.0 / 4096.0;
// Camera-relative position (WU) of an absolute raw Q20.12 position: integer difference first.
vec3 fxRelPos(ivec3 posRaw) {
  return vec3(posRaw - u_camPosInt.xyz) * FX_INV_RAW - u_camFrac.xyz;
}
// Age in seconds of something that started at wrapped FX time t0 (both mod FX_TIME_WRAP).
float fxAge(float t0) {
  return mod(u_fxTime.x - t0 + FX_TIME_WRAP, FX_TIME_WRAP);
}
// Camera-facing billboard corner: rel = centre (camera-relative WU), corner in [-1, 1]^2, size in WU.
vec3 fxBillboard(vec3 rel, vec2 corner, vec2 halfSize) {
  return rel + u_fxRight.xyz * (corner.x * halfSize.x) + u_fxUp.xyz * (corner.y * halfSize.y);
}
`;
