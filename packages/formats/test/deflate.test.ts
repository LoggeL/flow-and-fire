import { deflateRawSync, inflateRawSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rng32, xxHash32 } from '@faf/fixed';
import { DEFAULT_DEFLATE_LEVEL, deflateRaw, FormatError, inflateRaw, MAX_INFLATE_BYTES } from '../src/index.ts';

function expectFormatError(fn: () => unknown, code: string): FormatError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FormatError);
    expect((e as FormatError).code).toBe(code);
    return e as FormatError;
  }
  throw new Error(`expected FormatError '${code}'`);
}

/** Random bytes from rng32 (incompressible). */
function randomBytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = rng32(seed, i, 0, 1) & 0xff;
  return out;
}

/**
 * Fixed golden input (48 KiB): an arena-like mix of zero runs, small counters, repeated records
 * and noise — exercises literals, matches, stored-length boundaries and dynamic Huffman blocks.
 */
function goldenInput(): Uint8Array {
  const out = new Uint8Array(48 * 1024);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4096; i++) dv.setUint32(i * 4, i * 7, true); // counters
  for (let i = 16384; i < 32768; i += 48) {
    dv.setUint32(i, 0x00100000 + i, true); // record-like rows
    dv.setUint16(i + 4, 3, true);
    dv.setInt32(i + 8, (i * 4099) | 0, true);
  }
  for (let i = 40960; i < out.length; i++) out[i] = rng32(0x601de, i, 0, 2) & 0xff; // noise tail
  return out;
}

async function webStreamDeflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const res = new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(cs));
  return new Uint8Array(await res.arrayBuffer());
}

async function webStreamInflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const res = new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(ds));
  return new Uint8Array(await res.arrayBuffer());
}

describe('deflate-raw codec (fflate)', () => {
  it('round-trips empty, 1 byte, random and highly compressible inputs', () => {
    const cases: Uint8Array[] = [new Uint8Array(0), Uint8Array.of(0x5a), randomBytes(100_000, 3)];
    // 2 MB of highly compressible data (repeating 64-byte records with a counter).
    const big = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i & 63) < 8 ? (i >>> 6) & 0xff : i & 7;
    cases.push(big);
    for (const input of cases) {
      const z = deflateRaw(input);
      const back = inflateRaw(z, input.length);
      expect(back.length).toBe(input.length);
      expect(Buffer.from(back).equals(Buffer.from(input))).toBe(true);
    }
    expect(deflateRaw(big).length).toBeLessThan(big.length / 50);
    expect([...deflateRaw(new Uint8Array(0))]).toEqual([0x03, 0x00]); // the canonical empty stream
  });

  it('round-trips arbitrary inputs at every level', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), fc.integer({ min: 0, max: 9 }), (input, level) => {
        const back = inflateRaw(deflateRaw(input, level), input.length);
        expect(Buffer.from(back).equals(Buffer.from(input))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic and pins the compressed bytes of a fixed input (detects fflate drift)', () => {
    const input = goldenInput();
    const a = deflateRaw(input);
    const b = deflateRaw(input.slice());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(DEFAULT_DEFLATE_LEVEL).toBe(6);
    // Golden values for fflate 0.8.3, level 6, mem 4. A change here means written replays are no
    // longer byte-identical to a rewrite: document the fflate update and re-record the goldens.
    expect({ len: a.length, xxh: xxHash32(a, 0, a.length, 0) >>> 0 }).toEqual({ len: GOLDEN_LEN, xxh: GOLDEN_XXH32 });
    const l1 = deflateRaw(input, 1);
    const l9 = deflateRaw(input, 9);
    expect({ l1: [l1.length, xxHash32(l1, 0, l1.length, 0) >>> 0], l9: [l9.length, xxHash32(l9, 0, l9.length, 0) >>> 0] }).toEqual(GOLDEN_L1_L9);
    expect(() => deflateRaw(input, 10)).toThrow(RangeError);
    expect(() => deflateRaw(input, -1)).toThrow(RangeError);
    expect(() => deflateRaw(input, 1.5)).toThrow(RangeError);
  });

  it('reads streams from node:zlib and CompressionStream, and zlib reads ours', async () => {
    const input = goldenInput();
    for (const level of [0, 1, 6, 9]) {
      const z = new Uint8Array(deflateRawSync(input, { level }));
      expect(Buffer.from(inflateRaw(z, input.length)).equals(Buffer.from(input))).toBe(true);
    }
    const web = await webStreamDeflateRaw(input);
    expect(Buffer.from(inflateRaw(web, input.length)).equals(Buffer.from(input))).toBe(true);
    const webEmpty = await webStreamDeflateRaw(new Uint8Array(0));
    expect(inflateRaw(webEmpty, 0).length).toBe(0);
    for (const level of [0, 1, 6, 9]) {
      const ours = deflateRaw(input, level);
      expect(Buffer.from(inflateRawSync(ours)).equals(Buffer.from(input))).toBe(true);
    }
    expect(Buffer.from(await webStreamInflateRaw(deflateRaw(input))).equals(Buffer.from(input))).toBe(true);
  });

  it('rejects corrupt data with FormatError(bad-compression)', () => {
    const input = goldenInput();
    const z = deflateRaw(input);
    // Truncated streams.
    for (const cut of [1, 2, 10, z.length >>> 1, z.length - 1]) {
      expectFormatError(() => inflateRaw(z.subarray(0, cut), input.length), 'bad-compression');
    }
    expectFormatError(() => inflateRaw(new Uint8Array(0), 0), 'bad-compression');
    // Block type 3 (reserved).
    expectFormatError(() => inflateRaw(Uint8Array.of(0x07, 0x00), 0), 'bad-compression');
    // Random garbage: either FormatError or (by chance) a valid stream of exactly the expected
    // length — never another exception.
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 512 }), fc.integer({ min: 0, max: 4096 }), (junk, n) => {
        try {
          expect(inflateRaw(junk, n).length).toBe(n);
        } catch (e) {
          expect(e).toBeInstanceOf(FormatError);
          expect(['bad-compression']).toContain((e as FormatError).code);
        }
      }),
      { numRuns: 2000 },
    );
    // Bit flips in a valid stream.
    for (let i = 0; i < 400; i++) {
      const bad = z.slice();
      const bit = rng32(9, i, 0, 0) % (bad.length * 8);
      bad[bit >>> 3]! ^= 1 << (bit & 7);
      try {
        expect(inflateRaw(bad, input.length).length).toBe(input.length);
      } catch (e) {
        expect(e).toBeInstanceOf(FormatError);
        expect((e as FormatError).code).toBe('bad-compression');
      }
    }
  });

  it('insists on the exact expected length', () => {
    const input = randomBytes(5000, 11);
    const z = deflateRaw(input);
    expectFormatError(() => inflateRaw(z, input.length + 1), 'bad-compression');
    expectFormatError(() => inflateRaw(z, input.length - 1), 'bad-compression');
    expectFormatError(() => inflateRaw(z, 0), 'bad-compression');
    // Stored blocks (level 0) overrunning the buffer take fflate's copy path.
    const stored = deflateRaw(input, 0);
    expectFormatError(() => inflateRaw(stored, 100), 'bad-compression');
    expectFormatError(() => inflateRaw(stored, input.length + 7), 'bad-compression');
    expectFormatError(() => inflateRaw(z, -1), 'bad-value');
    expectFormatError(() => inflateRaw(z, 1.5), 'bad-value');
  });

  it('refuses expected lengths above the limit before allocating', () => {
    const z = deflateRaw(new Uint8Array(10));
    expectFormatError(() => inflateRaw(z, 11, 10), 'too-large');
    expectFormatError(() => inflateRaw(z, MAX_INFLATE_BYTES + 1), 'too-large');
    expect(MAX_INFLATE_BYTES).toBe(256 * 1024 * 1024);
    expect(inflateRaw(z, 10, 10).length).toBe(10);
    expect(() => inflateRaw(z, 10, -1)).toThrow(RangeError);
  });

  it('survives a deflate bomb (≈100 KB → 100 MB) with a 1 KB expected length', () => {
    const bomb = new Uint8Array(deflateRawSync(Buffer.alloc(100 * 1024 * 1024), { level: 9 }));
    expect(bomb.length).toBeLessThan(120 * 1024);
    const err = expectFormatError(() => inflateRaw(bomb, 1024), 'bad-compression');
    expect(err.message).toMatch(/more than the expected 1024/);
  });
});

// Pinned by the golden test above (fflate 0.8.3, DEFLATE_MEM_LEVEL 4).
const GOLDEN_LEN = 17633;
const GOLDEN_XXH32 = 0x6a8f26bb;
const GOLDEN_L1_L9 = { l1: [17813, 0xa6bab47a], l9: [17603, 0x56787aa6] };
