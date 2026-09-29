/**
 * Minimal PNG decoder for screenshots (8-bit RGB/RGBA, non-interlaced — what Playwright produces)
 * plus pixel statistics used by the E2E specs and the dev check script.
 */
import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
  readonly data: Uint8Array;
}

export function decodePng(buf: Uint8Array): DecodedImage {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (off < buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(buf[off + 4]!, buf[off + 5]!, buf[off + 6]!, buf[off + 7]!);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(off + 8);
      height = dv.getUint32(off + 12);
      const depth = body[8]!;
      colorType = body[9]!;
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) {
        throw new Error(`unsupported PNG (depth ${depth}, color type ${colorType}, interlace ${body[12]})`);
      }
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch: 3 | 4 = colorType === 6 ? 4 : 3;
  const stride = width * ch;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const r = raw[src + x]!;
      const a = x >= ch ? data[dst + x - ch]! : 0;
      const b = y > 0 ? data[dst - stride + x]! : 0;
      const c = x >= ch && y > 0 ? data[dst - stride + x - ch]! : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = r;
          break;
        case 1:
          v = r + a;
          break;
        case 2:
          v = r + b;
          break;
        case 3:
          v = r + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      data[dst + x] = v & 255;
    }
  }
  return { width, height, channels: ch, data };
}

export interface PixelStats {
  /** Distinct colors after quantising each channel to 5 bits. */
  readonly distinctColors: number;
  /** Share of the most frequent (quantised) color, 0..1. */
  readonly dominantShare: number;
}

/** Color statistics of a region (defaults to the whole image). */
export function pixelStats(img: DecodedImage, x0 = 0, y0 = 0, x1 = img.width, y1 = img.height): PixelStats {
  const counts = new Map<number, number>();
  let total = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
      const o = (y * img.width + x) * img.channels;
      const key = ((img.data[o]! >> 3) << 10) | ((img.data[o + 1]! >> 3) << 5) | (img.data[o + 2]! >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total++;
    }
  }
  let max = 0;
  for (const v of counts.values()) max = Math.max(max, v);
  return { distinctColors: counts.size, dominantShare: total === 0 ? 1 : max / total };
}

/** Number of pixels that differ by more than `threshold` (sum of channel deltas) between two images. */
export function diffPixels(a: DecodedImage, b: DecodedImage, threshold = 24): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('image size mismatch');
  let n = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const oa = i * a.channels;
    const ob = i * b.channels;
    const d =
      Math.abs(a.data[oa]! - b.data[ob]!) + Math.abs(a.data[oa + 1]! - b.data[ob + 1]!) + Math.abs(a.data[oa + 2]! - b.data[ob + 2]!);
    if (d > threshold) n++;
  }
  return n;
}
