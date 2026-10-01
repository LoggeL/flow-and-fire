/**
 * GLSL helpers of the beam/trail/shield passes. Include after `FRAME_BLOCK_GLSL`, `FX_VIEW_BLOCK_GLSL`
 * and `FX_COMMON_GLSL` where the functions need them (the noise/hash helpers need nothing).
 */

/** f16 instance attributes arrive as `uvec2` (4 halves) or `uint` (2 halves), little-endian. */
export const FX_HALF_GLSL = /* glsl */ `
vec4 fxHalf4(uvec2 h) {
  return vec4(unpackHalf2x16(h.x), unpackHalf2x16(h.y));
}
vec2 fxHalf2(uint h) {
  return unpackHalf2x16(h);
}
`;

/**
 * Integer hash / 1D value noise (periodic with 256 cells, so a scrolled coordinate can be wrapped with
 * `mod(x, 256.0)` without a seam) and a 3-octave variant.
 */
export const FX_NOISE_GLSL = /* glsl */ `
uint fxHashU(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float fxHash01(uint x) {
  return float(fxHashU(x) >> 8) * (1.0 / 16777216.0);
}
float fxNoise1(float x) {
  float i = floor(x);
  float f = x - i;
  uint a = uint(int(mod(i, 256.0)));
  uint b = (a + 1u) & 255u;
  float u = f * f * (3.0 - 2.0 * f);
  return mix(fxHash01(a), fxHash01(b), u);
}
float fxNoise3(float x) {
  return fxNoise1(x) * 0.55 + fxNoise1(x * 2.13 + 17.0) * 0.3 + fxNoise1(x * 4.71 + 41.0) * 0.15;
}
`;

/**
 * Screen-space geometry of an axis-aligned billboard ribbon (beams and trails): a quad from `a` to `b`
 * (camera-relative WU) whose width is perpendicular to both the axis and the view ray, extended by the
 * local half width beyond both ends for soft end caps. A sub-pixel ribbon is widened to `FX_MIN_HALF_PX`
 * pixels and its intensity lowered by the same factor (constant energy, no shimmering).
 *
 * Vertex `vid` 0..3 (triangle strip): bit 0 = end (0 → a, 1 → b), bit 1 = side (0 → −1, 1 → +1).
 * Outputs: position (camera-relative WU), `along` = WU along the axis measured from `a`, `side` = ±1,
 * `halfW` = local half width after widening, `gain` = intensity factor (≤ 1).
 */
export const FX_RIBBON_GLSL = /* glsl */ `
const float FX_MIN_HALF_PX = 0.8;
struct FxRibbon {
  vec3 pos;
  float along;
  float side;
  float halfW;
  float gain;
};
FxRibbon fxRibbon(int vid, vec3 a, vec3 b, vec3 axis, float len, float halfA, float halfB) {
  FxRibbon r;
  float s = float(vid & 1);
  r.side = float(vid >> 1) * 2.0 - 1.0;
  vec3 p = mix(a, b, s);
  float halfW = max(mix(halfA, halfB, s), 0.0);
  float depth = max(dot(p, u_fxFwd.xyz), 0.05);
  float halfPx = halfW * u_fxTime.z / depth;
  float grow = halfPx < FX_MIN_HALF_PX ? min(FX_MIN_HALF_PX / max(halfPx, 1e-4), 16.0) : 1.0;
  halfW *= grow;
  r.gain = 1.0 / grow;
  vec3 perp = cross(axis, p);
  float pl = length(perp);
  // Axis (nearly) parallel to the view ray: any screen-space direction works.
  perp = pl > 1e-4 * max(length(p), 1e-3) ? perp / pl : normalize(cross(axis, u_fxUp.xyz) + u_fxRight.xyz * 1e-3);
  float endSign = s * 2.0 - 1.0;
  r.pos = p + axis * (endSign * halfW) + perp * (r.side * halfW);
  r.along = s * len + endSign * halfW;
  r.halfW = halfW;
  return r;
}
`;

/** Formats a number as a GLSL float literal (always with a decimal point). */
export function glslFloat(v: number): string {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}
