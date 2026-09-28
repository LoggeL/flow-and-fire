import { describe, expect, it } from 'vitest';
import { rng32, rngChanceMilli, rngFxUnit, rngRange } from '@faf/fixed';
import { TestRng } from './support/prng.ts';

describe('rng32', () => {
  it('matches the pinned golden values (changing them breaks all replays)', () => {
    expect(rng32(0, 0, 0, 0)).toBe(0x439200d7);
    expect(rng32(1, 0, 0, 0)).toBe(0x4f842f68);
    expect(rng32(0, 1, 0, 0)).toBe(0x2feffa1f);
    expect(rng32(0, 0, 1, 0)).toBe(0x59789d0c);
    expect(rng32(0, 0, 0, 1)).toBe(0x35131091);
    expect(rng32(0xdeadbeef, 1000, 42, 7)).toBe(0x1535b01a);
    expect(rng32(123456789, 2000, 8191, 0xffffffff)).toBe(0x00e03c86);
    expect(rng32(-1, -1, -1, -1)).toBe(0x0a128e81);
  });

  it('is stateless and returns u32', () => {
    const a = rng32(7, 8, 9, 10);
    for (let i = 0; i < 100; i++) rng32(i, i, i, i);
    expect(rng32(7, 8, 9, 10)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(a)).toBe(true);
    // inputs are taken mod 2^32
    expect(rng32(7 + 4294967296, 8, 9, 10)).toBe(a);
  });

  it('is roughly uniform over 16 buckets (chi² at p < 0.001)', () => {
    const buckets = new Array<number>(16).fill(0);
    const n = 160_000;
    for (let i = 0; i < n; i++) buckets[rng32(42, i >>> 8, i & 255, 3) >>> 28]!++;
    const expected = n / 16;
    const chi2 = buckets.reduce((s, c) => s + ((c - expected) * (c - expected)) / expected, 0);
    expect(chi2).toBeLessThan(37.7); // df = 15
  });

  it('flips about half of the output bits for a one-bit input change', () => {
    let total = 0;
    const samples = 4096;
    for (let i = 0; i < samples; i++) {
      const a = rng32(1, i, 5, 9);
      const b = rng32(1, i ^ 1, 5, 9);
      let x = (a ^ b) >>> 0;
      while (x !== 0) {
        total += x & 1;
        x >>>= 1;
      }
    }
    const mean = total / samples;
    expect(mean).toBeGreaterThan(15);
    expect(mean).toBeLessThan(17);
  });
});

describe('rngRange', () => {
  it('equals floor(r·n / 2^32) exactly (BigInt) and stays in [0, n)', () => {
    const rng = new TestRng(0x7a);
    for (let i = 0; i < 100_000; i++) {
      const r = rng.u32();
      const n = i % 4 === 0 ? 4294967296 : rng.range(1, i % 2 === 0 ? 1000 : 4294967295);
      const got = rngRange(r, n);
      const want = Number((BigInt(r) * BigInt(n)) >> 32n);
      if (got !== want) expect(`${r}·${n} → ${got}`).toBe(`${r}·${n} → ${want}`);
      expect(got).toBeLessThan(n);
      expect(got).toBeGreaterThanOrEqual(0);
    }
    expect(rngRange(0xffffffff, 6)).toBe(5);
    expect(rngRange(0, 6)).toBe(0);
  });

  it('helpers', () => {
    expect(rngFxUnit(0xffffffff)).toBe(4095);
    expect(rngFxUnit(0)).toBe(0);
    expect(rngChanceMilli(0, 1)).toBe(true);
    expect(rngChanceMilli(0xffffffff, 1000)).toBe(true);
    expect(rngChanceMilli(0xffffffff, 999)).toBe(false);
  });
});
