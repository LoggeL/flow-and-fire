/**
 * Spectrogram + waveform as PNG (no dependencies): log-frequency STFT (20 Hz – Nyquist), dB colour map,
 * waveform strip on top, grid lines at 100 Hz / 1 kHz / 10 kHz and every 100 ms.
 */
import { deflateSync } from 'node:zlib';
import { fft, hann } from './fft.ts';
import { type Audio, SR, isStereo } from './signal.ts';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Encode an RGB image (row-major, 3 bytes per pixel) as PNG. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

/** Perceptual "inferno"-like colour map, t in [0, 1]. */
function colour(t: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0, 0, 0, 4],
    [0.2, 40, 11, 84],
    [0.4, 101, 21, 110],
    [0.6, 188, 55, 84],
    [0.8, 249, 142, 9],
    [1, 252, 255, 164],
  ];
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (x <= b[0]) {
      const f = (x - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    }
  }
  return [252, 255, 164];
}

export interface SpectrogramOptions {
  /** Image width in px (default: 4 px per 10 ms, clamped 480..1400). */
  width?: number;
  /** Spectrogram height in px (default 320); waveform strip adds 80 px. */
  height?: number;
  /** Dynamic range in dB below the loudest bin (default 90). */
  rangeDb?: number;
  sr?: number;
}

export function spectrogramPng(a: Audio, o: SpectrogramOptions = {}): Uint8Array {
  const sr = o.sr ?? SR;
  const ch = isStereo(a) ? a[0].map((v, i) => (v + (a[1][i] as number)) * 0.5) : a;
  const dur = ch.length / sr;
  const W = o.width ?? Math.max(480, Math.min(1400, Math.round(dur * 400)));
  const H = o.height ?? 320;
  const WAVE_H = 80;
  const range = o.rangeDb ?? 90;
  const N = 2048;
  const win = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const fMin = 20;
  const fMax = sr / 2;
  // STFT column per pixel.
  const cols: Float64Array[] = [];
  let maxDb = -Infinity;
  for (let x = 0; x < W; x++) {
    const center = Math.round(((x + 0.5) / W) * ch.length);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < N; i++) re[i] = (ch[center - N / 2 + i] ?? 0) * (win[i] as number);
    fft(re, im);
    const col = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      // Row y (0 = top) → frequency band on a log axis; take the max bin in the band.
      const f0 = fMin * Math.pow(fMax / fMin, (H - 1 - y) / H);
      const f1 = fMin * Math.pow(fMax / fMin, (H - y) / H);
      const k0 = Math.max(1, Math.floor((f0 * N) / sr));
      const k1 = Math.max(k0, Math.min(N / 2 - 1, Math.ceil((f1 * N) / sr)));
      let p = 0;
      for (let k = k0; k <= k1; k++) p = Math.max(p, (re[k] as number) ** 2 + (im[k] as number) ** 2);
      const d = 10 * Math.log10(p + 1e-20);
      col[y] = d;
      if (d > maxDb) maxDb = d;
    }
    cols.push(col);
  }
  const TH = H + WAVE_H;
  const rgb = new Uint8Array(W * TH * 3);
  const put = (x: number, y: number, c: readonly [number, number, number]): void => {
    const i = (y * W + x) * 3;
    rgb[i] = c[0];
    rgb[i + 1] = c[1];
    rgb[i + 2] = c[2];
  };
  // Waveform strip (min/max per column), dark grey background, 0 dBFS at the edges.
  for (let x = 0; x < W; x++) {
    const s0 = Math.floor((x / W) * ch.length);
    const s1 = Math.max(s0 + 1, Math.floor(((x + 1) / W) * ch.length));
    let mn = 0;
    let mx = 0;
    for (let i = s0; i < s1; i++) {
      const v = ch[i] ?? 0;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    for (let y = 0; y < WAVE_H; y++) {
      const v = 1 - (2 * (y + 0.5)) / WAVE_H;
      const on = v <= mx && v >= mn;
      const clip = Math.abs(v) > 0.99 && on;
      put(x, y, clip ? [255, 40, 40] : on ? [120, 200, 255] : y === WAVE_H / 2 ? [60, 60, 70] : [22, 22, 28]);
    }
  }
  const gridRows = new Set([100, 1000, 10000].map((f) => Math.round(H - 1 - (H * Math.log(f / fMin)) / Math.log(fMax / fMin))));
  const gridCols = new Set<number>();
  for (let t = 0.1; t < dur; t += 0.1) gridCols.add(Math.round((t / dur) * W));
  for (let x = 0; x < W; x++) {
    const col = cols[x]!;
    for (let y = 0; y < H; y++) {
      let c = colour(((col[y] as number) - (maxDb - range)) / range);
      if (gridRows.has(y) || gridCols.has(x)) c = [c[0] * 0.6 + 70, c[1] * 0.6 + 70, c[2] * 0.6 + 70];
      put(x, WAVE_H + y, [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
    }
  }
  return encodePng(W, TH, rgb);
}
