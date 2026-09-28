import {
  FX_FRAC_MASK,
  FX_ONE,
  FX_RAW_MAX,
  FX_RAW_MIN,
  FX_SHIFT,
  FX_SMALL_MAX_RAW,
} from './constants.ts';
import { isFixedDebug } from './debug.ts';
import { isqrt } from './isqrt.ts';
import type { Fx, FxSmall } from './types.ts';

/**
 * Q20.12 arithmetic (PLAN §3.3). Every operation is defined on integers only and returns an
 * int32 (`| 0` = two's-complement wrap, identical to `as i32` in a later i64 port).
 * Intermediates are exact in Float64 as long as the documented invariants hold.
 */

/**
 * Literal helper: converts a decimal constant to Fx (round half up, like Math.round).
 * Only for constants/blueprint compile time — never feed runtime state through it.
 */
export function fx(v: number): Fx {
  // floor((2·v·4096 + 1) / 2) == round-half-up(v·4096); scaling by 2^13 is exact.
  const raw = Math.floor((v * (FX_ONE * 2) + 1) / 2);
  if (!(raw >= FX_RAW_MIN && raw <= FX_RAW_MAX)) {
    throw new RangeError(`fx: ${v} is out of the Q20.12 range`);
  }
  return (raw | 0) as Fx;
}

/** Literal helper for FxSmall constants (|raw| ≤ FX_SMALL_MAX_RAW). */
export function fxSmall(v: number): FxSmall {
  const f = fx(v);
  return toFxSmall(f);
}

/** Narrows an Fx to FxSmall; throws if |raw| > FX_SMALL_MAX_RAW. */
export function toFxSmall(a: Fx): FxSmall {
  if (a > FX_SMALL_MAX_RAW || a < -FX_SMALL_MAX_RAW) {
    throw new RangeError(`toFxSmall: ${a} exceeds ±${FX_SMALL_MAX_RAW}`);
  }
  return a as FxSmall;
}

/** Integer → Fx (n · 4096). */
export function fxFromInt(n: number): Fx {
  return ((n * FX_ONE) | 0) as Fx;
}

/** floor(a) as integer. */
export function fxFloorToInt(a: Fx): number {
  return a >> FX_SHIFT;
}

/** ceil(a) as integer. */
export function fxCeilToInt(a: Fx): number {
  return (a + FX_FRAC_MASK) >> FX_SHIFT;
}

/** round-half-up(a) as integer. */
export function fxRoundToInt(a: Fx): number {
  return (a + (FX_ONE >> 1)) >> FX_SHIFT;
}

/** Fractional part (0..4095) as raw Fx. */
export function fxFrac(a: Fx): Fx {
  return (a & FX_FRAC_MASK) as Fx;
}

export function fxAdd(a: Fx, b: Fx): Fx {
  return ((a + b) | 0) as Fx;
}

export function fxSub(a: Fx, b: Fx): Fx {
  return ((a - b) | 0) as Fx;
}

export function fxNeg(a: Fx): Fx {
  return ((0 - a) | 0) as Fx;
}

export function fxAbs(a: Fx): Fx {
  return (a < 0 ? (0 - a) | 0 : a) as Fx;
}

export function fxMin(a: Fx, b: Fx): Fx {
  return a < b ? a : b;
}

export function fxMax(a: Fx, b: Fx): Fx {
  return a > b ? a : b;
}

export function fxClamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

/** a · n for an integer n (exact while |a·n| < 2^53, then wrapped to int32). */
export function fxMulInt(a: Fx, n: number): Fx {
  return ((a * n) | 0) as Fx;
}

/**
 * a · b in Fx: floor(a·b / 4096).
 * Invariant: |a·b| ≤ 2^53 − 1 (e.g. |a|, |b| ≤ 2^26 raw) so the product is exact; checked in debug.
 */
export function fxMul(a: Fx, b: Fx): Fx {
  const p = a * b;
  if (isFixedDebug() && !(p >= -Number.MAX_SAFE_INTEGER && p <= Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`fxMul: inexact product ${a}·${b}`);
  }
  return (Math.floor(p / FX_ONE) | 0) as Fx;
}

/**
 * Fast path for small operands: Math.imul(a, b) >> 12 (exact while |a·b| < 2^31).
 * In debug mode the result is compared with fxMul and a mismatch throws.
 */
export function fxMulSmall(a: FxSmall, b: FxSmall): Fx {
  const r = Math.imul(a, b) >> FX_SHIFT;
  if (isFixedDebug()) {
    const ref = fxMul(a, b);
    if (r !== ref) throw new RangeError(`fxMulSmall: ${a}·${b} = ${r} ≠ fxMul ${ref} (operands not FxSmall)`);
  }
  return r as Fx;
}

/**
 * Floor division of integers n / d with d ≠ 0, exact for |n| ≤ 2^52, |d| ≤ 2^31.
 * The float quotient is only an estimate; the loops enforce q·d ≤ n < (q+1)·d (for d > 0).
 */
export function floorDivExact(n: number, d: number): number {
  if (d === 0) throw new RangeError('floorDivExact: division by zero');
  if (d < 0) {
    n = 0 - n;
    d = 0 - d;
  }
  let q = Math.floor(n / d);
  let r = n - q * d;
  while (r < 0) {
    q--;
    r += d;
  }
  while (r >= d) {
    q++;
    r -= d;
  }
  return q + 0;
}

/**
 * a / b in Fx: floor(a·4096 / b) with integer correction, correct floor semantics for any signs.
 * Division by zero throws.
 */
export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) throw new RangeError('fxDiv: division by zero');
  return (floorDivExact(a * FX_ONE, b) | 0) as Fx;
}

/** Floor division of an Fx by an integer n ≠ 0. */
export function fxDivInt(a: Fx, n: number): Fx {
  if (n === 0) throw new RangeError('fxDivInt: division by zero');
  return (floorDivExact(a, n) | 0) as Fx;
}

/** Length of (x, y): floor(sqrt(x² + y²)) raw. Invariant: x² + y² ≤ 2^53 − 1. */
export function fxLen2D(x: Fx, y: Fx): Fx {
  return isqrt(x * x + y * y) as Fx;
}

/** Length of (x, y, z): floor(sqrt(x² + y² + z²)) raw. Invariant: sum ≤ 2^53 − 1. */
export function fxLen3D(x: Fx, y: Fx, z: Fx): Fx {
  return isqrt(x * x + y * y + z * z) as Fx;
}

/** Distance between (ax, ay) and (bx, by). */
export function fxDist(ax: Fx, ay: Fx, bx: Fx, by: Fx): Fx {
  const dx = bx - ax;
  const dy = by - ay;
  return isqrt(dx * dx + dy * dy) as Fx;
}

/** Squared distance as a plain integer (exact while ≤ 2^53 − 1); cheap range checks. */
export function fxDist2(ax: Fx, ay: Fx, bx: Fx, by: Fx): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** Linear interpolation a + (b − a)·t with t in Fx (0..4096). */
export function fxLerp(a: Fx, b: Fx, t: Fx): Fx {
  return ((a + Math.floor(((b - a) * t) / FX_ONE)) | 0) as Fx;
}
