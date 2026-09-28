/**
 * Deterministic, seedable test-case generator (sfc32). Test-only: plain JS math is fine here.
 */
export class TestRng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed | 0;
    for (let i = 0; i < 16; i++) this.u32();
  }

  /** Uniform u32. */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform integer in [0, 2^bits) for bits ≤ 53. */
  bits(bits: number): number {
    if (bits <= 0) return 0;
    if (bits <= 32) return bits === 32 ? this.u32() : this.u32() >>> (32 - bits);
    const hi = this.u32() >>> (64 - bits);
    return hi * 4294967296 + this.u32();
  }

  /** Integer in [lo, hi] (inclusive), |values| < 2^53. */
  range(lo: number, hi: number): number {
    const span = hi - lo + 1;
    return lo + Math.floor((this.u32() / 4294967296) * span);
  }

  /** Sign-random integer with a random bit length in [0, maxBits]: covers all magnitudes evenly. */
  signedLog(maxBits: number): number {
    const len = this.range(0, maxBits);
    const v = this.bits(len);
    return this.u32() & 1 ? -v : v;
  }

  pick<T>(list: readonly T[]): T {
    return list[this.range(0, list.length - 1)]!;
  }

  bool(): boolean {
    return (this.u32() & 1) === 1;
  }
}

/** Floor division on BigInt (BigInt `/` truncates towards zero). */
export function bigFloorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
}
