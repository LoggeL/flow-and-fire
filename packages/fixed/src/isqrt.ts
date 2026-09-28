import { FX_SHIFT } from './constants.ts';
import type { Fx } from './types.ts';

/** Largest n accepted by isqrt (2^53 − 1). */
export const ISQRT_MAX = Number.MAX_SAFE_INTEGER;

/**
 * floor(sqrt(n)) for integers 0 ≤ n ≤ 2^53 − 1, bit-exact on every engine.
 *
 * Math.sqrt is IEEE-754 correctly rounded, but floor() of the rounded value can be off by one
 * next to perfect squares; the integer correction loops fix that so that r² ≤ n < (r+1)².
 * All r² here are < 2^54 and even when ≥ 2^53, hence exactly representable.
 * This is the only place in the simulation that may call Math.sqrt.
 */
export function isqrt(n: number): number {
  if (!(n >= 0 && n <= ISQRT_MAX)) {
    throw new RangeError(`isqrt: argument out of range: ${n}`);
  }
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r + 0; // normalize −0 (isqrt(-0))
}

/** Square root of a non-negative Fx: floor(sqrt(a · 4096)) as raw Fx. */
export function fxSqrt(a: Fx): Fx {
  if (a < 0) throw new RangeError(`fxSqrt: negative argument ${a}`);
  return isqrt(a * (1 << FX_SHIFT)) as Fx;
}
