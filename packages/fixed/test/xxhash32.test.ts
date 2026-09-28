import { describe, expect, it } from 'vitest';
import { XxHash32, xxHash32 } from '@faf/fixed';
import { TestRng } from './support/prng.ts';

const PRIME = 2654435761;
const enc = new TextEncoder();

/** Independent BigInt reference implementation of XXH32 (spec-level, no Math.imul). */
function refXxh32(data: Uint8Array, seed: number): number {
  const M = 0xffffffffn;
  const P1 = 2654435761n;
  const P2 = 2246822519n;
  const P3 = 3266489917n;
  const P4 = 668265263n;
  const P5 = 374761393n;
  const rotl = (x: bigint, r: bigint): bigint => ((x << r) | (x >> (32n - r))) & M;
  const rd = (p: number): bigint =>
    BigInt(data[p]! | (data[p + 1]! << 8) | (data[p + 2]! << 16)) + (BigInt(data[p + 3]!) << 24n);
  const s = BigInt(seed >>> 0);
  const len = data.length;
  let p = 0;
  let h: bigint;
  if (len >= 16) {
    const v = [(s + P1 + P2) & M, (s + P2) & M, s, (s - P1 + (1n << 32n)) & M];
    while (p + 16 <= len) {
      for (let i = 0; i < 4; i++) {
        v[i] = (rotl((v[i]! + rd(p) * P2) & M, 13n) * P1) & M;
        p += 4;
      }
    }
    h = (rotl(v[0]!, 1n) + rotl(v[1]!, 7n) + rotl(v[2]!, 12n) + rotl(v[3]!, 18n)) & M;
  } else {
    h = (s + P5) & M;
  }
  h = (h + BigInt(len)) & M;
  while (p + 4 <= len) {
    h = (rotl((h + rd(p) * P3) & M, 17n) * P4) & M;
    p += 4;
  }
  while (p < len) {
    h = (rotl((h + BigInt(data[p]!) * P5) & M, 11n) * P1) & M;
    p++;
  }
  h ^= h >> 15n;
  h = (h * P2) & M;
  h ^= h >> 13n;
  h = (h * P3) & M;
  h ^= h >> 16n;
  return Number(h);
}

function sanityBuffer(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  let g = PRIME;
  for (let i = 0; i < n; i++) {
    buf[i] = g >>> 24;
    g = Number((BigInt(g) * BigInt(g)) & 0xffffffffn);
  }
  return buf;
}

function hashStr(s: string, seed = 0): number {
  const b = enc.encode(s);
  return xxHash32(b, 0, b.length, seed);
}

describe('xxHash32 reference vectors', () => {
  it('matches the xxHash sanity vectors', () => {
    const buf = sanityBuffer(101);
    expect(xxHash32(new Uint8Array(0), 0, 0, 0)).toBe(0x02cc5d05);
    expect(xxHash32(new Uint8Array(0), 0, 0, PRIME)).toBe(0x36b78ae7);
    expect(xxHash32(buf, 0, 1, 0)).toBe(0xb85cbee5);
    expect(xxHash32(buf, 0, 1, PRIME)).toBe(0xd5845d64);
    expect(xxHash32(buf, 0, 14, 0)).toBe(0xe5aa0ab4);
    expect(xxHash32(buf, 0, 14, PRIME)).toBe(0x4481951d);
    expect(xxHash32(buf, 0, 101, 0)).toBe(0x1f1aa412);
    expect(xxHash32(buf, 0, 101, PRIME)).toBe(0x498ec8e2);
  });

  it('matches known string digests', () => {
    expect(hashStr('')).toBe(0x02cc5d05);
    expect(hashStr('a')).toBe(0x550d7456);
    expect(hashStr('abc')).toBe(0x32d153ff);
    expect(hashStr('Nobody inspects the spammish repetition')).toBe(0xe2293b2f);
  });

  it('equals the BigInt reference for random data, lengths, offsets and seeds', () => {
    const rng = new TestRng(0x5eed);
    const big = new Uint8Array(4096 + 8);
    for (let i = 0; i < big.length; i++) big[i] = rng.u32() & 0xff;
    for (let i = 0; i < 3000; i++) {
      const len = i < 300 ? i : rng.range(0, 4096);
      const off = rng.range(0, 8); // exercises aligned and unaligned fast/slow paths
      const seed = i % 3 === 0 ? 0 : rng.u32();
      const view = big.subarray(off, off + len);
      const want = refXxh32(view, seed);
      expect(xxHash32(big, off, len, seed)).toBe(want);
      expect(xxHash32(view, 0, len, seed)).toBe(want);
    }
  });

  it('rejects out-of-bounds ranges', () => {
    expect(() => xxHash32(new Uint8Array(4), 2, 3, 0)).toThrow(RangeError);
    expect(() => new XxHash32().update(new Uint8Array(4), 0, 5)).toThrow(RangeError);
  });
});

describe('XxHash32 streaming', () => {
  it('streaming == one-shot for random split points', () => {
    const rng = new TestRng(0x57e4);
    const data = new Uint8Array(2048 + 3);
    for (let i = 0; i < data.length; i++) data[i] = rng.u32() & 0xff;
    const h = new XxHash32();
    for (let i = 0; i < 2000; i++) {
      const off = rng.range(0, 3);
      const len = rng.range(0, 2048);
      const seed = rng.u32();
      h.reset(seed);
      let p = off;
      const end = off + len;
      while (p < end) {
        const step = Math.min(end - p, rng.pick([0, 1, 3, 4, 7, 15, 16, 17, 31, 64, 100, 1000]));
        h.update(data, p, step);
        p += step;
      }
      expect(h.digest()).toBe(xxHash32(data, off, len, seed));
    }
  });

  it('digest() is repeatable and the stream can continue', () => {
    const data = sanityBuffer(101);
    const h = new XxHash32(0);
    h.update(data, 0, 50);
    const mid = h.digest();
    expect(h.digest()).toBe(mid);
    expect(mid).toBe(xxHash32(data, 0, 50, 0));
    h.update(data, 50, 51);
    expect(h.digest()).toBe(0x1f1aa412);
  });

  it('hashes a 20 MB arena-like buffer without allocating per update', () => {
    const arena = new Uint8Array(new ArrayBuffer(20 * 1024 * 1024));
    for (let i = 0; i < arena.length; i += 4093) arena[i] = i & 0xff;
    const h = new XxHash32();
    const gc = (globalThis as { gc?: () => void }).gc;
    // warm up (JIT + cached Uint32Array view)
    for (let k = 0; k < 3; k++) h.reset(k).update(arena, 0, 65536).update(arena, 7, 1000);
    gc?.();
    const before = process.memoryUsage().heapUsed;
    let acc = 0;
    for (let k = 0; k < 20_000; k++) {
      h.reset(k);
      h.update(arena, (k & 63) * 1024, 1024); // aligned fast path
      h.update(arena, 3, 29); // unaligned + buffered tail
      acc ^= h.digest();
    }
    gc?.();
    const grown = process.memoryUsage().heapUsed - before;
    expect(acc).not.toBe(-1);
    if (gc !== undefined) expect(grown).toBeLessThan(256 * 1024);
    const one = xxHash32(arena, 0, arena.length, 0);
    expect(new XxHash32(0).update(arena, 0, arena.length).digest()).toBe(one);
  });
});
