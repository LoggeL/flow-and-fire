/**
 * Minimal PNG decoder for Playwright screenshots (8-bit RGB/RGBA, non-interlaced) plus the pixel
 * statistics the editor specs use.
 */
import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
  readonly data: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Uint8Array): DecodedImage {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
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
      colorType = body[9]!;
      if (body[8] !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) throw new Error('unsupported PNG');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch: 3 | 4 = colorType === 6 ? 4 : 3;
  const stride = width * ch;
  const data = new Uint8Array(width * height * ch);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= ch ? data[dst + x - ch]! : 0;
      const b = y > 0 ? data[dst - stride + x]! : 0;
      const c = x >= ch && y > 0 ? data[dst - stride + x - ch]! : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + a;
          break;
        case 2:
          out = v + b;
          break;
        case 3:
          out = v + ((a + b) >> 1);
          break;
        case 4:
          out = v + paeth(a, b, c);
          break;
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      data[dst + x] = out & 255;
    }
  }
  return { width, height, channels: ch, data };
}

export interface PixelStats {
  /** Number of distinct colours after quantising each channel to 5 bits. */
  readonly distinctColors: number;
  /** Mean luminance 0..255. */
  readonly meanLuma: number;
  /** Standard deviation of the luminance. */
  readonly lumaStdDev: number;
  /** Share (0..1) of the most frequent quantised colour. */
  readonly dominantShare: number;
}

export function pixelStats(img: DecodedImage): PixelStats {
  const counts = new Uint32Array(1 << 15);
  const n = img.width * img.height;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    const r = img.data[i * img.channels]!;
    const g = img.data[i * img.channels + 1]!;
    const b = img.data[i * img.channels + 2]!;
    counts[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]!++;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l;
    sum2 += l * l;
  }
  let distinct = 0;
  let top = 0;
  for (const c of counts) {
    if (c > 0) distinct++;
    if (c > top) top = c;
  }
  const mean = sum / n;
  return { distinctColors: distinct, meanLuma: mean, lumaStdDev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), dominantShare: top / n };
}
