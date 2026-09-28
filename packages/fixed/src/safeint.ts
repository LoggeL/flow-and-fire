import { isFixedDebug } from './debug.ts';
import type { SafeInt } from './types.ts';

export const SAFE_INT_MAX = Number.MAX_SAFE_INTEGER;
export const SAFE_INT_MIN = Number.MIN_SAFE_INTEGER;

/**
 * Normalizes a number into a SafeInt: `v + 0` turns −0 into +0 (hash/serialization stable).
 * In debug mode non-integers and values beyond ±(2^53 − 1) throw.
 */
export function toSafeInt(v: number): SafeInt {
  const r = v + 0;
  if (isFixedDebug() && !Number.isSafeInteger(r)) {
    throw new RangeError(`toSafeInt: ${v} is not a safe integer`);
  }
  return r as SafeInt;
}

/** a + b as SafeInt (debug-checked). */
export function safeAdd(a: SafeInt, b: SafeInt | number): SafeInt {
  return toSafeInt(a + b);
}

/** a − b as SafeInt (debug-checked). */
export function safeSub(a: SafeInt, b: SafeInt | number): SafeInt {
  return toSafeInt(a - b);
}
