/**
 * Minimal PNG decoder for Playwright screenshots (8-bit RGB/RGBA, non-interlaced) and the pixel
 * statistics the FX benchmark and the fx-lab E2E specs check (canvas not uniform, bright/HDR pixels
 * around a point, image difference before/after a context loss). Node only (zlib).
 */
import { inflateSync } from 'node:zlib';

export interface RgbImage {
  readonly width: number;
  readonly height: number;
  /** Tightly packed RGB, 3 bytes per pixel. */
  readonly rgb: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes an 8-bit RGB or RGBA non-interlaced PNG into packed RGB (alpha dropped). */
export function decodePng(png: Uint8Array): RgbImage {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9]!;
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`PNG: unsupported format (depth ${data[8]}, color type ${colorType}, interlace ${data[12]})`);
      }
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (width === 0 || height === 0) throw new Error('PNG: missing IHDR');
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new Error('PNG: truncated image data');
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]!;
    const base = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let v = raw[base + x]!;
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      else if (ft !== 0) throw new Error(`PNG: invalid filter ${ft}`);
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      rgb[o] = cur[x * bpp]!;
      rgb[o + 1] = cur[x * bpp + 1]!;
      rgb[o + 2] = cur[x * bpp + 2]!;
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return { width, height, rgb };
}

/** Rec. 709-ish integer luma 0..255. */
export function luma(r: number, g: number, b: number): number {
  return (r * 54 + g * 183 + b * 19) >> 8;
}

export interface ImageStats {
  /** Luma max − min over a sample grid (every `step` px): ≈ 0 for a uniform/cleared canvas. */
  lumaSpread: number;
  meanLuma: number;
  /** Fraction of sampled pixels with luma ≥ 235 (blown-out/bloomed HDR highlights). */
  brightFraction: number;
  /** Fraction of sampled pixels with luma ≤ 8. */
  blackFraction: number;
  /** Fraction of sampled pixels that are "fire coloured": r ≥ 180, r > g > b, r − b ≥ 60. */
  fireFraction: number;
  samples: number;
}

/** Region in relative image coordinates (0..1), default = whole image. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const FULL_REGION: Region = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** Pixel statistics over a grid (every `step` pixels) inside `region`. */
export function imageStats(img: RgbImage, region: Region = FULL_REGION, step = 4): ImageStats {
  const xa = Math.max(0, Math.floor(region.x0 * img.width));
  const xb = Math.min(img.width, Math.ceil(region.x1 * img.width));
  const ya = Math.max(0, Math.floor(region.y0 * img.height));
  const yb = Math.min(img.height, Math.ceil(region.y1 * img.height));
  let min = 255;
  let max = 0;
  let sum = 0;
  let n = 0;
  let bright = 0;
  let black = 0;
  let fire = 0;
  for (let y = ya; y < yb; y += step) {
    for (let x = xa; x < xb; x += step) {
      const o = (y * img.width + x) * 3;
      const r = img.rgb[o]!;
      const g = img.rgb[o + 1]!;
      const b = img.rgb[o + 2]!;
      const l = luma(r, g, b);
      if (l < min) min = l;
      if (l > max) max = l;
      sum += l;
      n++;
      if (l >= 235) bright++;
      if (l <= 8) black++;
      if (r >= 180 && r > g && g > b && r - b >= 60) fire++;
    }
  }
  if (n === 0) return { lumaSpread: 0, meanLuma: 0, brightFraction: 0, blackFraction: 0, fireFraction: 0, samples: 0 };
  return { lumaSpread: max - min, meanLuma: sum / n, brightFraction: bright / n, blackFraction: black / n, fireFraction: fire / n, samples: n };
}

/**
 * Mean absolute per-channel difference (0..255) of two images of the same size over a sample grid.
 * Throws on a size mismatch.
 */
export function meanAbsDiff(a: RgbImage, b: RgbImage, step = 2): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`image size mismatch ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      const o = (y * a.width + x) * 3;
      sum += Math.abs(a.rgb[o]! - b.rgb[o]!) + Math.abs(a.rgb[o + 1]! - b.rgb[o + 1]!) + Math.abs(a.rgb[o + 2]! - b.rgb[o + 2]!);
      n += 3;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** Difference of two same-size images inside a region (every pixel). */
export interface RegionDiff {
  /** Fraction of pixels whose largest channel difference is ≥ the threshold. */
  changedFraction: number;
  /** Mean absolute per-channel difference (0..255). */
  meanAbs: number;
  pixels: number;
}

/** Compares `a` and `b` inside `region`; a pixel counts as changed when max |Δchannel| ≥ `threshold`. */
export function regionDiff(a: RgbImage, b: RgbImage, region: Region, threshold = 16): RegionDiff {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`image size mismatch ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  const xa = Math.max(0, Math.floor(region.x0 * a.width));
  const xb = Math.min(a.width, Math.ceil(region.x1 * a.width));
  const ya = Math.max(0, Math.floor(region.y0 * a.height));
  const yb = Math.min(a.height, Math.ceil(region.y1 * a.height));
  let changed = 0;
  let sum = 0;
  let n = 0;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const o = (y * a.width + x) * 3;
      const dr = Math.abs(a.rgb[o]! - b.rgb[o]!);
      const dg = Math.abs(a.rgb[o + 1]! - b.rgb[o + 1]!);
      const db = Math.abs(a.rgb[o + 2]! - b.rgb[o + 2]!);
      if (Math.max(dr, dg, db) >= threshold) changed++;
      sum += dr + dg + db;
      n++;
    }
  }
  return n === 0 ? { changedFraction: 0, meanAbs: 0, pixels: 0 } : { changedFraction: changed / n, meanAbs: sum / (3 * n), pixels: n };
}
