/**
 * Hot-path packing helpers shared by the beam, trail and shield passes.
 *
 * `packHalf` converts through float32 (bit tricks on a scratch Float32Array) and is several times faster
 * than the exact double → binary16 `toHalf` of core. It rounds the float32 value to nearest-even, so the
 * result equals `toHalf(Math.fround(v))` (the float32 detour may double-round in rare tie cases, which is
 * irrelevant for colors and sizes).
 */

const scratchF32 = new Float32Array(1);
const scratchU32 = new Uint32Array(scratchF32.buffer);

/** binary16 bit pattern of `v` (via float32, round-to-nearest-even, overflow → ±Inf, NaN → 0x7e00). */
export function packHalf(v: number): number {
  scratchF32[0] = v;
  const x = scratchU32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const e = (x >>> 23) & 0xff;
  let m = x & 0x7fffff;
  if (e === 0xff) return m !== 0 ? 0x7e00 : sign | 0x7c00;
  let he = e - 112; // e - 127 + 15
  if (he >= 31) return sign | 0x7c00;
  if (he <= 0) {
    // Subnormal half (or zero).
    if (he < -10) return sign;
    m |= 0x800000;
    const shift = 14 - he;
    let hm = m >>> shift;
    const rem = m & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && (hm & 1) === 1)) hm++;
    return sign | hm;
  }
  let hm = m >>> 13;
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (hm & 1) === 1)) {
    hm++;
    if (hm === 0x400) {
      hm = 0;
      he++;
      if (he >= 31) return sign | 0x7c00;
    }
  }
  return sign | (he << 10) | hm;
}

/** Writes four halves at u16 index `i` (8 bytes). */
export function writeHalf4(u16: Uint16Array, i: number, a: number, b: number, c: number, d: number): void {
  u16[i] = packHalf(a);
  u16[i + 1] = packHalf(b);
  u16[i + 2] = packHalf(c);
  u16[i + 3] = packHalf(d);
}

/** Clamps to [0, 1] (NaN → 0). */
export function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** Reads component `i` of a raw position (NaN/undefined → 0, truncated to i32). */
export function rawAt(p: ArrayLike<number>, i: number): number {
  const v = p[i];
  return v === undefined ? 0 : v | 0;
}
