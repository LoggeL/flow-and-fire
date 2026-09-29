import { deflateSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/index.ts';
import { decodePng, encodePng, PNG_SIGNATURE, PngError, type PngImage } from '../scripts/png.ts';

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 4 + data.length));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Independent reference encoder that uses row y's filter type = filters[y % filters.length]. */
function encodeWithFilters(img: PngImage, filters: readonly number[], colorType: number, interlace = 0): Uint8Array {
  const bpp = (img.channels * img.bitDepth) >> 3;
  const stride = img.width * bpp;
  const rows: Uint8Array[] = [];
  let prev = new Uint8Array(stride);
  let s = 0;
  for (let y = 0; y < img.height; y++) {
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; ) {
      const v = img.samples[s++]!;
      if (img.bitDepth === 16) {
        cur[i++] = v >> 8;
        cur[i++] = v & 0xff;
      } else cur[i++] = v;
    }
    const f = filters[y % filters.length]!;
    const row = new Uint8Array(stride + 1);
    row[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]!;
      row[i + 1] = (cur[i]! - pred) & 0xff;
    }
    rows.push(row);
    prev = cur;
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, img.width);
  new DataView(ihdr.buffer).setUint32(4, img.height);
  ihdr[8] = img.bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  return concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('tEXt', new TextEncoder().encode('a\0b')), pngChunk('IDAT', new Uint8Array(deflateSync(concat(rows)))), pngChunk('IEND', new Uint8Array(0))]);
}

const imageArb = (channels: 1 | 2 | 3 | 4, bitDepth: 8 | 16) =>
  fc
    .record({ width: fc.integer({ min: 1, max: 17 }), height: fc.integer({ min: 1, max: 9 }) })
    .chain(({ width, height }) =>
      fc.array(fc.integer({ min: 0, max: bitDepth === 16 ? 65535 : 255 }), { minLength: width * height * channels, maxLength: width * height * channels }).map(
        (s): PngImage => ({ width, height, channels, bitDepth, samples: Uint16Array.from(s) }),
      ),
    );

describe('png codec', () => {
  it('encode -> decode is the identity (16-bit gray, 8-bit gray, 8-bit RGBA, 16-bit RGBA)', () => {
    for (const [ch, bd] of [
      [1, 16],
      [1, 8],
      [4, 8],
      [4, 16],
    ] as const) {
      fc.assert(
        fc.property(imageArb(ch, bd), (img) => {
          expect(decodePng(encodePng(img))).toEqual(img);
        }),
        { numRuns: 60 },
      );
    }
  });

  it('decodes all five filter types for every supported color type', () => {
    const colorTypes = { 1: 0, 2: 4, 3: 2, 4: 6 } as const;
    for (const ch of [1, 2, 3, 4] as const) {
      for (const bd of [8, 16] as const) {
        fc.assert(
          fc.property(imageArb(ch, bd), fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 5 }), (img, filters) => {
            expect(decodePng(encodeWithFilters(img, [0, 1, 2, 3, 4, ...filters], colorTypes[ch]))).toEqual(img);
          }),
          { numRuns: 25 },
        );
      }
    }
  });

  it('rejects corrupt or unsupported files', () => {
    const img: PngImage = { width: 3, height: 2, channels: 1, bitDepth: 8, samples: Uint16Array.from([1, 2, 3, 4, 5, 6]) };
    const good = encodePng(img);
    const badCrc = good.slice();
    badCrc[20] = badCrc[20]! ^ 1;
    expect(() => decodePng(badCrc)).toThrow(PngError);
    expect(() => decodePng(good.subarray(1))).toThrow(PngError);
    expect(() => decodePng(good.subarray(0, good.length - 12))).toThrow(PngError);
    expect(() => decodePng(encodeWithFilters(img, [0], 0, 1))).toThrow(/interlaced/);
    expect(() => decodePng(encodeWithFilters(img, [0], 3))).toThrow(/color type/);
  });
});
