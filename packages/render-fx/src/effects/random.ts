/**
 * Deterministic hashing and random numbers for presentation code (TRACK-RENDERFX: no Math.random,
 * visible variation must be reproducible for screenshots).
 *
 * Every function here uses plain u32 arithmetic (Math.imul, >>> 0), so the GLSL mirror with `uint`
 * arithmetic produces bit-identical results:
 *
 * ```glsl
 * uint fxFmix(uint h) { h ^= h >> 16; h *= 0x85EBCA6Bu; h ^= h >> 13; h *= 0xC2B2AE35u; h ^= h >> 16; return h; }
 * uint fxHash32(uint a, uint b, uint c) {
 *   uint h = fxFmix(a + 0x9E3779B9u);
 *   h = fxFmix(h ^ (b + 0x7F4A7C15u));
 *   return fxFmix(h ^ (c + 0x94D049BBu));
 * }
 * ```
 */

/** Murmur3 32-bit finalizer (avalanche mix). */
export function fxFmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Hashes up to three u32 values into one u32 (inputs are truncated to u32 first).
 * `fxHash32(a, b, c) = fmix(fmix(fmix(a + K0) ^ (b + K1)) ^ (c + K2))` with
 * K0 = 0x9E3779B9, K1 = 0x7F4A7C15, K2 = 0x94D049BB (all sums wrap modulo 2^32).
 */
export function fxHash32(a: number, b = 0, c = 0): number {
  let h = fxFmix32((a + 0x9e3779b9) >>> 0);
  h = fxFmix32((h ^ ((b + 0x7f4a7c15) >>> 0)) >>> 0);
  return fxFmix32((h ^ ((c + 0x94d049bb) >>> 0)) >>> 0);
}

/** Uniform float in [0, 1) from a u32 hash (24 significant bits, exact in f32). */
export function hashToUnit(h: number): number {
  return (h >>> 8) / 16777216;
}

/**
 * Orthonormal basis around a unit vector n (Duff et al. 2017, "Building an Orthonormal Basis,
 * Revisited"). Writes b1 into out[o..o+2] and b2 into out[o+3..o+5]. Used by the cone sampling of
 * {@link FxRng.cone} and the particle reference (GLSL mirror uses the same formula):
 *
 *   s = n.z >= 0 ? 1 : −1;  a = −1 / (s + n.z);  b = n.x·n.y·a
 *   b1 = (1 + s·n.x²·a, s·b, −s·n.x);  b2 = (b, s + n.y²·a, −n.y)
 */
export function orthonormalBasis(nx: number, ny: number, nz: number, out: Float64Array | number[], o = 0): void {
  const s = nz >= 0 ? 1 : -1;
  const a = -1 / (s + nz);
  const b = nx * ny * a;
  out[o] = 1 + s * nx * nx * a;
  out[o + 1] = s * b;
  out[o + 2] = -s * nx;
  out[o + 3] = b;
  out[o + 4] = s + ny * ny * a;
  out[o + 5] = -ny;
}

const TWO_PI = Math.PI * 2;
const basisScratch = new Float64Array(6);

/**
 * Small deterministic PRNG (Weyl sequence + murmur finalizer, "splitmix32"-style). Not
 * cryptographic; period 2^32. Same seed → same sequence on every engine.
 */
export class FxRng {
  private state: number;

  constructor(seed: number) {
    this.state = fxHash32(seed >>> 0) >>> 0;
  }

  /** Re-seeds the generator in place. */
  reseed(seed: number): void {
    this.state = fxHash32(seed >>> 0) >>> 0;
  }

  /** Next u32. */
  next(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    return fxFmix32(this.state);
  }

  /** Uniform float in [0, 1). */
  float01(): number {
    return this.next() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float01();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.float01() * (max - min + 1));
  }

  /** Uniformly distributed unit vector on the sphere. */
  unitVector(out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const z = 2 * this.float01() - 1;
    const phi = TWO_PI * this.float01();
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out[0] = r * Math.cos(phi);
    out[1] = r * Math.sin(phi);
    out[2] = z;
    return out;
  }

  /**
   * Uniformly distributed unit vector inside a cone around `dir` (unit vector) with half angle
   * `halfAngleRad` (π = whole sphere): cosθ = 1 − u·(1 − cos half), φ = 2π·v.
   */
  cone(dir: ArrayLike<number>, halfAngleRad: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const cosT = 1 - this.float01() * (1 - Math.cos(halfAngleRad));
    const phi = TWO_PI * this.float01();
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const dx = dir[0] ?? 0;
    const dy = dir[1] ?? 1;
    const dz = dir[2] ?? 0;
    orthonormalBasis(dx, dy, dz, basisScratch);
    const c = sinT * Math.cos(phi);
    const s = sinT * Math.sin(phi);
    const b = basisScratch;
    out[0] = b[0]! * c + b[3]! * s + dx * cosT;
    out[1] = b[1]! * c + b[4]! * s + dy * cosT;
    out[2] = b[2]! * c + b[5]! * s + dz * cosT;
    return out;
  }
}
