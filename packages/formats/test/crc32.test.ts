import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc32, crc32Update } from '../src/index.ts';

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(ascii('a'))).toBe(0xe8b7be43);
    expect(crc32(ascii('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(new Uint8Array(32))).toBe(0x190a55ad);
    expect(crc32(new Uint8Array(32).fill(0xff))).toBe(0xff6cab0b);
  });

  it('honours offset/length and chains like one pass', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), fc.nat(), (bytes, cutSeed) => {
        const cut = bytes.length === 0 ? 0 : cutSeed % (bytes.length + 1);
        const chained = crc32Update(crc32(bytes, 0, cut), bytes, cut);
        const padded = new Uint8Array(bytes.length + 7);
        padded.set(bytes, 3);
        return chained === crc32(bytes) && crc32(padded, 3, bytes.length) === crc32(bytes);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects out-of-range views', () => {
    expect(() => crc32(new Uint8Array(4), 2, 3)).toThrow(RangeError);
  });
});
