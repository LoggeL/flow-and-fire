import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeUtf8, encodeUtf8 } from '../src/index.ts';

describe('utf8', () => {
  it('matches TextEncoder/TextDecoder for well-formed strings', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 64 }), (s) => {
        const enc = encodeUtf8(s);
        expect(enc).toEqual(new TextEncoder().encode(s));
        return decodeUtf8(enc) === s;
      }),
      { numRuns: 1000 },
    );
  });

  it('decodes long inputs across the internal chunk size', () => {
    const s = 'ä€😀x'.repeat(3000);
    expect(decodeUtf8(encodeUtf8(s))).toBe(s);
  });

  it('rejects malformed input', () => {
    expect(() => encodeUtf8('\ud800')).toThrow(RangeError);
    expect(() => encodeUtf8('a\udc00')).toThrow(RangeError);
    for (const bad of [[0x80], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82], [0xff]]) {
      expect(() => decodeUtf8(new Uint8Array(bad)), JSON.stringify(bad)).toThrow(RangeError);
    }
  });
});
