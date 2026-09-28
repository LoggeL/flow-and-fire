/**
 * Stateless counter-hash RNG (PLAN §3.3): the same (seed, tick, entityIdx, salt) always yields the
 * same u32 — no hidden state, order-independent, trivially replayable and portable.
 * Built from the murmur3 fmix32 finalizer (Math.imul, >>> 0) with golden-ratio / murmur constants
 * to decorrelate the inputs.
 */

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

/** Uniform u32 for (seed, tick, entityIdx, salt); all inputs are taken mod 2^32. */
export function rng32(seed: number, tick: number, entityIdx: number, salt: number): number {
  let h = fmix32((seed ^ 0x3c6ef372) | 0);
  h = fmix32((h + Math.imul(tick | 0, 0x9e3779b1)) | 0);
  h = fmix32((h ^ Math.imul(entityIdx | 0, 0x27d4eb2f)) | 0);
  h = fmix32((h + Math.imul(salt | 0, 0x165667b1)) | 0);
  return h >>> 0;
}

/**
 * Maps a u32 `r` to [0, n) for an integer 1 ≤ n ≤ 2^32 via multiply-high (floor(r·n / 2^32)),
 * computed exactly with a 16-bit split (no float rounding). Bias ≤ n / 2^32.
 */
export function rngRange(r: number, n: number): number {
  const ru = r >>> 0;
  const hi = (ru >>> 16) * n; // ≤ 2^48
  const lo = (ru & 0xffff) * n; // ≤ 2^48
  return Math.floor((hi + Math.floor(lo / 65536)) / 65536);
}

/** Maps a u32 to an Fx fraction in [0, 4096) (top 12 bits). */
export function rngFxUnit(r: number): number {
  return (r >>> 0) >>> 20;
}

/** Bernoulli trial with probability permille/1000 (integer 0..1000). */
export function rngChanceMilli(r: number, permille: number): boolean {
  return rngRange(r, 1000) < permille;
}
