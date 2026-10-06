/**
 * AI random numbers (ai.md §2.5): a stateful xorshift32 per manager, seeded from
 * `rng32(gameSeed, 0, army, 0x41490000)` (@faf/fixed). Every manager gets its own stream so a
 * budget cut-off in one manager never shifts another manager's sequence.
 */
import { rng32, rngRange } from '@faf/fixed';
import { hashString } from './det.ts';

/** Salt of the AI base seed ('AI' << 16). */
export const AI_RNG_SALT = 0x41490000;

const TWO_POW_32 = 4294967296;
const ZERO_STATE_REPLACEMENT = 0x9e3779b9;

/** Marsaglia xorshift32 (13, 17, 5). State is never 0. */
export class Xorshift32 {
  private s: number;

  constructor(seed: number) {
    const s = seed >>> 0;
    this.s = s === 0 ? ZERO_STATE_REPLACEMENT : s;
  }

  /** Current state (for snapshots/tests). */
  get state(): number {
    return this.s;
  }

  /** Next u32. */
  nextU32(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }

  /** Uniform float in [0, 1) (u32 / 2^32, exact). */
  nextFloat(): number {
    return this.nextU32() / TWO_POW_32;
  }

  /** Uniform integer in [0, n) for 1 ≤ n ≤ 2^32 (multiply-high, no float rounding). */
  nextInt(n: number): number {
    if (!(n >= 1) || !Number.isInteger(n)) throw new RangeError(`nextInt: bad bound ${n}`);
    return rngRange(this.nextU32(), n);
  }

  /** True with probability p (0..1), compared on the exact u32 grid. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) {
      this.nextU32();
      return true;
    }
    return this.nextU32() < p * TWO_POW_32;
  }
}

/** Base seed of an army's AI: rng32(gameSeed, 0, army, 0x41490000). */
export function aiBaseSeed(gameSeed: number, army: number): number {
  return rng32(gameSeed >>> 0, 0, army, AI_RNG_SALT);
}

/** Numeric salt of a stream name (FNV-1a). */
export function streamSalt(name: string): number {
  return hashString(name);
}

/**
 * Independent RNG stream of one manager (or other consumer): seeded with
 * rng32(baseSeed, 0, 0, salt). `salt` may be a number or a stream name.
 */
export function managerRng(gameSeed: number, army: number, salt: number | string): Xorshift32 {
  const s = typeof salt === 'string' ? streamSalt(salt) : salt >>> 0;
  return new Xorshift32(rng32(aiBaseSeed(gameSeed, army), 0, 0, s));
}
