/**
 * Deterministic random numbers for sound synthesis. Every sound variant gets its own stream derived
 * from (sound id, variant index, optional seed), so adding or reordering sounds never changes others.
 */

/** FNV-1a 32-bit hash of a string (stable seed derivation). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small, fast PRNG (mulberry32) with helpers. Not for security. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Symmetric bipolar value in [-1, 1). */
  bipolar(): number {
    return this.next() * 2 - 1;
  }

  /** Multiplicative jitter: 1 ± amount (uniform). */
  jitter(amount: number): number {
    return 1 + amount * this.bipolar();
  }

  /** Standard normal (Box-Muller). */
  gauss(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: leere Liste');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Independent child stream (e.g. one per layer), stable by label. */
  fork(label: string): Rng {
    return new Rng(hashString(label) ^ Math.imul(this.state, 0x9e3779b1));
  }
}

/** Seed for one variant of a sound. */
export function variantSeed(id: string, variant: number, seed = 0): number {
  return (hashString(id) ^ Math.imul(variant + 1, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)) >>> 0;
}
