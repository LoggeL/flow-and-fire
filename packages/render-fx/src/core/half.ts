/**
 * IEEE 754 binary16 conversion for f16 instance attributes (colors, sizes). Round-to-nearest-even,
 * overflow to ±Inf, gradual underflow into subnormals, NaN → canonical quiet NaN 0x7e00.
 * Converts from the full double directly (no float32 detour, so there is no double rounding).
 */

const TWO_POW_M24 = 2 ** -24;
const TWO_POW_M14 = 2 ** -14;

/** Round to nearest integer, ties to even (x ≥ 0). */
function roundHalfEven(x: number): number {
  const r = Math.floor(x);
  const d = x - r;
  if (d > 0.5 || (d === 0.5 && (r & 1) === 1)) return r + 1;
  return r;
}

/** Converts a number to its binary16 bit pattern (0..0xffff). */
export function toHalf(f: number): number {
  if (Number.isNaN(f)) return 0x7e00;
  const sign = f < 0 || Object.is(f, -0) ? 0x8000 : 0;
  const a = Math.abs(f);
  if (a === Infinity) return sign | 0x7c00;
  if (a < TWO_POW_M14) {
    // Subnormal (or rounds up into the smallest normal: m = 1024 gives 0x0400 naturally).
    return sign | roundHalfEven(a / TWO_POW_M24);
  }
  let e = Math.floor(Math.log2(a));
  // log2 may be off by one near powers of two; correct exactly.
  if (2 ** e > a) e--;
  else if (2 ** (e + 1) <= a) e++;
  let m = roundHalfEven((a / 2 ** e - 1) * 1024);
  if (m === 1024) {
    m = 0;
    e++;
  }
  if (e > 15) return sign | 0x7c00;
  return sign | ((e + 15) << 10) | m;
}

/** Converts a binary16 bit pattern to a number. */
export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return sign * m * TWO_POW_M24;
  if (e === 31) return m === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + m / 1024) * 2 ** (e - 15);
}

/** Largest finite binary16 value. */
export const HALF_MAX = 65504;
