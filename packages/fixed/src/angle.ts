import { ANG_EIGHTH, ANG_HALF, ANG_MASK, ANG_QUARTER, FX_ONE } from './constants.ts';
import { ATAN_DATA, SIN_QUARTER_DATA } from './luts.generated.ts';
import type { Ang16, Fx } from './types.ts';

/**
 * Binary angles (Ang16, u16, 65536 = full turn) and LUT trigonometry (PLAN §3.3).
 * Convention: angle 0 points along +x, angles grow towards +y (counter-clockwise in a
 * right-handed x/y plane): cosA(atan2A(y, x)) ≈ x/|v|, sinA(atan2A(y, x)) ≈ y/|v|.
 */

const SIN_STEPS = 4096; // entries per quarter wave
const ATAN_STEPS = 1024; // entries for ratio 0..1

/** Quarter-wave sine table (Fx) with sentinel [4096] = sin(90°) = 1.0. */
const SIN_LUT = new Int32Array(SIN_STEPS + 1);
/** atan(k/1024) in Ang16 with sentinel [1024] = 45°. */
const ATAN_LUT = new Int32Array(ATAN_STEPS + 1);

(function decodeLuts(): void {
  if (SIN_QUARTER_DATA.length !== SIN_STEPS || ATAN_DATA.length !== ATAN_STEPS) {
    throw new Error('fixed: LUT data has unexpected size');
  }
  for (let i = 0; i < SIN_STEPS; i++) SIN_LUT[i] = SIN_QUARTER_DATA[i]! | 0;
  SIN_LUT[SIN_STEPS] = FX_ONE;
  for (let i = 0; i < ATAN_STEPS; i++) ATAN_LUT[i] = ATAN_DATA[i]! | 0;
  ATAN_LUT[ATAN_STEPS] = ANG_EIGHTH;
})();

/** Literal helper: degrees → Ang16 (round half up, wrapped). Constants/compile time only. */
export function deg(v: number): Ang16 {
  // floor((2·v·65536/360 + 1) / 2) == round-half-up(v·65536/360)
  const raw = Math.floor(((v * 65536 * 2) / 360 + 1) / 2);
  if (!(raw >= -2147483648 && raw <= 2147483647)) throw new RangeError(`deg: ${v} out of range`);
  return (raw & ANG_MASK) as Ang16;
}

/** (a + b) mod 65536. */
export function angAdd(a: Ang16, b: Ang16 | number): Ang16 {
  return ((a + b) & ANG_MASK) as Ang16;
}

/** (a − b) mod 65536. */
export function angSub(a: Ang16, b: Ang16 | number): Ang16 {
  return ((a - b) & ANG_MASK) as Ang16;
}

/** Signed shortest rotation from `from` to `to` in [−32768, 32767]. */
export function angDiff(from: Ang16, to: Ang16): number {
  return ((to - from) << 16) >> 16;
}

/**
 * Rotates `cur` towards `target` by at most `maxStep` (≥ 0) along the shortest way.
 * Returns `target` exactly once it is within reach.
 */
export function angRotateTowards(cur: Ang16, target: Ang16, maxStep: number): Ang16 {
  const d = angDiff(cur, target);
  if (d <= maxStep && d >= 0 - maxStep) return target;
  return ((d > 0 ? cur + maxStep : cur - maxStep) & ANG_MASK) as Ang16;
}

/** sin on a quarter position p ∈ [0, 16384] with linear interpolation between LUT entries. */
function sinQuarter(p: number): number {
  const i = p >> 2;
  const f = p & 3;
  const a = SIN_LUT[i]!;
  if (f === 0) return a;
  return a + (((SIN_LUT[i + 1]! - a) * f) >> 2);
}

/** sin(a) as Fx (−4096..4096). */
export function sinA(a: Ang16): Fx {
  const q = (a >> 14) & 3;
  const p = a & (ANG_QUARTER - 1);
  switch (q) {
    case 0:
      return sinQuarter(p) as Fx;
    case 1:
      return sinQuarter(ANG_QUARTER - p) as Fx;
    case 2:
      return (0 - sinQuarter(p)) as Fx;
    default:
      return (0 - sinQuarter(ANG_QUARTER - p)) as Fx;
  }
}

/** cos(a) as Fx (−4096..4096). */
export function cosA(a: Ang16): Fx {
  return sinA(((a + ANG_QUARTER) & ANG_MASK) as Ang16);
}

/** atan of a ratio num/den with 0 ≤ num ≤ den, den > 0, as Ang16 in [0, 8192]. */
function atanOctant(num: number, den: number): number {
  // t = floor(num · 65536 / den) ∈ [0, 65536]: 10 bits index + 6 bits fraction.
  // Exact: num·65536 ≤ 2^47 and a non-integer quotient is ≥ 1/den ≥ 2^−32 away from an integer,
  // far above the rounding error of values ≤ 2^16, so floor() of the float quotient is exact.
  const t = Math.floor((num * 65536) / den);
  const i = t >> 6;
  const f = t & 63;
  const a = ATAN_LUT[i]!;
  if (f === 0) return a;
  return a + (((ATAN_LUT[i + 1]! - a) * f) >> 6);
}

/**
 * atan2(y, x) as Ang16 via octant reduction and the 1024-entry atan LUT.
 * Inputs are raw integers (e.g. Fx components) with |x|, |y| ≤ 2^31. atan2A(0, 0) = 0.
 */
export function atan2A(y: number, x: number): Ang16 {
  const ax = x < 0 ? 0 - x : x;
  const ay = y < 0 ? 0 - y : y;
  if (ax === 0 && ay === 0) return 0 as Ang16;
  // First quadrant angle in [0, 16384].
  const base = ay <= ax ? atanOctant(ay, ax) : ANG_QUARTER - atanOctant(ax, ay);
  let r: number;
  if (x >= 0) r = y >= 0 ? base : 0 - base;
  else r = y >= 0 ? ANG_HALF - base : ANG_HALF + base;
  return (r & ANG_MASK) as Ang16;
}

/** Unit direction of an angle: writes (cos, sin) as Fx into out[0], out[1]. */
export function angToDir(a: Ang16, out: Int32Array, offset = 0): void {
  out[offset] = cosA(a);
  out[offset + 1] = sinA(a);
}
