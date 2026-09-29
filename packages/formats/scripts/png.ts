/**
 * Minimal PNG codec for the map tools (Node only, node:zlib).
 *
 * Decoder: color types 0 (gray), 2 (RGB), 4 (gray+alpha), 6 (RGBA) at 8 or 16 bits per sample,
 * all five filter types, no interlacing (Adam7 is rejected), no palette. Every chunk CRC is
 * checked. Encoder: gray or RGBA at 8/16 bit, per-row filter chosen by the usual minimum-sum-of-
 * absolute-differences heuristic (deterministic), zlib level 9.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { crc32Update } from '../src/crc32.ts';

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngImage {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: 8 | 16;
  /** Samples per pixel: 1 gray, 2 gray+alpha, 3 RGB, 4 RGBA. */
  readonly channels: 1 | 2 | 3 | 4;
  /** width·height·channels samples, row-major, channel-interleaved (0..255 or 0..65535). */
  readonly samples: Uint16Array;
}

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngError';
  }
}

const CHANNELS_BY_COLOR_TYPE: Record<number, 1 | 2 | 3 | 4> = { 0: 1, 2: 3, 4: 2, 6: 4 };
const COLOR_TYPE_BY_CHANNELS: Record<number, number> = { 1: 0, 2: 4, 3: 2, 4: 6 };

function u32be(b: Uint8Array, p: number): number {
  return ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes a PNG file. Throws PngError on unsupported or corrupt input. */
export function decodePng(bytes: Uint8Array): PngImage {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) throw new PngError('not a PNG file (bad signature)');
  let p = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawIend = false;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    if (p + 12 > bytes.length) throw new PngError('truncated chunk header');
    const len = u32be(bytes, p);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    if (p + 12 + len > bytes.length) throw new PngError(`chunk ${type} runs past the end of the file`);
    const crc = crc32Update(0, bytes, p + 4, 4 + len);
    if (crc !== u32be(bytes, p + 8 + len)) throw new PngError(`CRC mismatch in chunk ${type}`);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      if (len !== 13) throw new PngError('IHDR must be 13 bytes');
      width = u32be(data, 0);
      height = u32be(data, 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[10] !== 0 || data[11] !== 0) throw new PngError('unsupported compression or filter method');
      if (data[12] !== 0) throw new PngError('interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    } else if ((bytes[p + 4]! & 0x20) === 0) {
      throw new PngError(`unsupported critical chunk ${type}`);
    }
    p += 12 + len;
  }
  if (!sawIend) throw new PngError('missing IEND');
  if (width === 0 || height === 0) throw new PngError('missing or empty IHDR');
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (channels === undefined) throw new PngError(`unsupported color type ${colorType} (only gray, gray+alpha, RGB, RGBA)`);
  if (bitDepth !== 8 && bitDepth !== 16) throw new PngError(`unsupported bit depth ${bitDepth} (only 8 or 16)`);

  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const bpp = (channels * bitDepth) >> 3;
  const stride = width * bpp;
  if (raw.length !== height * (stride + 1)) throw new PngError(`image data has ${raw.length} bytes, expected ${height * (stride + 1)}`);
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const samples = new Uint16Array(width * height * channels);
  let s = 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[rowStart + 1 + i]!;
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4:
          v = x + paeth(a, b, c);
          break;
        default:
          throw new PngError(`unknown filter type ${filter} in row ${y}`);
      }
      cur[i] = v & 0xff;
    }
    if (bitDepth === 8) {
      for (let i = 0; i < stride; i++) samples[s++] = cur[i]!;
    } else {
      for (let i = 0; i < stride; i += 2) samples[s++] = (cur[i]! << 8) | cur[i + 1]!;
    }
    prev.set(cur);
  }
  return { width, height, bitDepth, channels, samples };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32Update(0, out, 4, 4 + data.length));
  return out;
}

/** Encodes an image as PNG (deterministic for a given zlib build). */
export function encodePng(img: PngImage): Uint8Array {
  const { width, height, bitDepth, channels, samples } = img;
  if (samples.length !== width * height * channels) throw new PngError('sample count does not match width·height·channels');
  const bpp = (channels * bitDepth) >> 3;
  const stride = width * bpp;
  const raw = new Uint8Array(height * (stride + 1));
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const cand = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  let s = 0;
  for (let y = 0; y < height; y++) {
    if (bitDepth === 8) {
      for (let i = 0; i < stride; i++) cur[i] = samples[s++]! & 0xff;
    } else {
      for (let i = 0; i < stride; i += 2) {
        const v = samples[s++]!;
        cur[i] = v >>> 8;
        cur[i + 1] = v & 0xff;
      }
    }
    let bestFilter = 0;
    let bestSum = Infinity;
    for (let f = 0; f <= 4; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = cur[i]!;
        const a = i >= bpp ? cur[i - bpp]! : 0;
        const b = y > 0 ? prev[i]! : 0;
        const c = i >= bpp && y > 0 ? prev[i - bpp]! : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const d = (x - pred) & 0xff;
        cand[i] = d;
        sum += d < 128 ? d : 256 - d;
      }
      if (sum < bestSum) {
        bestSum = sum;
        bestFilter = f;
        best.set(cand);
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    raw.set(best, y * (stride + 1) + 1);
    prev.set(cur);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = COLOR_TYPE_BY_CHANNELS[channels]!;
  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of parts) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}
