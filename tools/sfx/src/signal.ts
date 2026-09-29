/**
 * Signal basics: buffer types, parameter curves, layering, gain, pan/width, fades, varispeed.
 * All buffers are Float32Array at SR (48 kHz); stereo is a [left, right] pair.
 */

export const SR = 48000;

export type Mono = Float32Array;
export type Stereo = [Float32Array, Float32Array];
export type Audio = Mono | Stereo;

/**
 * A parameter that may vary over time: a constant, a per-sample curve (e.g. from `envelope`) or a
 * function of time in seconds.
 */
export type Param = number | Float32Array | ((t: number) => number);

export function isStereo(a: Audio): a is Stereo {
  return Array.isArray(a);
}

/** Seconds → samples (rounded). */
export function samples(seconds: number, sr = SR): number {
  return Math.max(0, Math.round(seconds * sr));
}

export function silence(seconds: number, sr = SR): Mono {
  return new Float32Array(samples(seconds, sr));
}

/** Value of a parameter at sample i. Float32Array params hold their last value past the end. */
export function paramAt(p: Param, i: number, sr = SR): number {
  if (typeof p === 'number') return p;
  if (typeof p === 'function') return p(i / sr);
  if (p.length === 0) return 0;
  return p[i < p.length ? i : p.length - 1] as number;
}

/** Materialize a parameter as a per-sample curve of length n. */
export function paramCurve(p: Param, n: number, sr = SR): Float32Array {
  const out = new Float32Array(n);
  if (typeof p === 'number') return out.fill(p);
  for (let i = 0; i < n; i++) out[i] = paramAt(p, i, sr);
  return out;
}

export function durationOf(a: Audio, sr = SR): number {
  return (isStereo(a) ? a[0].length : a.length) / sr;
}

export function lengthOf(a: Audio): number {
  return isStereo(a) ? a[0].length : a.length;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return g <= 0 ? -Infinity : 20 * Math.log10(g);
}

/** Multiply by a (possibly time-varying) gain / envelope. Returns a new buffer. */
export function mul(sig: Mono, g: Param, sr = SR): Mono {
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = (sig[i] as number) * paramAt(g, i, sr);
  return out;
}

/** Scale by decibels. */
export function gainDb(sig: Mono, db: number): Mono {
  const g = dbToGain(db);
  return sig.map((v) => v * g);
}

export interface Layer {
  sig: Audio;
  /** Start offset in seconds (default 0). */
  at?: number;
  /** Gain in dB (default 0). */
  db?: number;
}

/**
 * Layer several signals into one. Output length covers all layers unless `durS` is given. If any
 * layer is stereo the result is stereo (mono layers go to both channels).
 */
export function mix(layers: readonly Layer[], durS?: number, sr = SR): Audio {
  const stereo = layers.some((l) => isStereo(l.sig));
  let n = durS === undefined ? 0 : samples(durS, sr);
  if (durS === undefined) {
    for (const l of layers) n = Math.max(n, samples(l.at ?? 0, sr) + lengthOf(l.sig));
  }
  const L = new Float32Array(n);
  const R = stereo ? new Float32Array(n) : L;
  for (const l of layers) {
    const off = samples(l.at ?? 0, sr);
    const g = dbToGain(l.db ?? 0);
    const [a, b] = isStereo(l.sig) ? l.sig : [l.sig, l.sig];
    const len = Math.min(a.length, n - off);
    for (let i = 0; i < len; i++) {
      L[off + i] = (L[off + i] as number) + (a[i] as number) * g;
      if (stereo) R[off + i] = (R[off + i] as number) + (b[i] as number) * g;
    }
  }
  return stereo ? [L, R] : L;
}

/** Layer mono signals only (typed shortcut for `mix`). */
export function mixMono(layers: readonly (Layer & { sig: Mono })[], durS?: number, sr = SR): Mono {
  return mix(layers, durS, sr) as Mono;
}

/** Equal-power pan; pos in [-1 (left), 1 (right)], may vary over time. */
export function pan(sig: Mono, pos: Param = 0, sr = SR): Stereo {
  const L = new Float32Array(sig.length);
  const R = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    const p = Math.max(-1, Math.min(1, paramAt(pos, i, sr)));
    const a = ((p + 1) * Math.PI) / 4;
    const v = sig[i] as number;
    L[i] = v * Math.cos(a);
    R[i] = v * Math.sin(a);
  }
  return [L, R];
}

/** Stereo width via mid/side: 0 = mono, 1 = unchanged, >1 = wider. */
export function width(st: Stereo, w: number): Stereo {
  const [l, r] = st;
  const L = new Float32Array(l.length);
  const R = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) {
    const m = ((l[i] as number) + (r[i] as number)) * 0.5;
    const s = ((l[i] as number) - (r[i] as number)) * 0.5 * w;
    L[i] = m + s;
    R[i] = m - s;
  }
  return [L, R];
}

/** Two slightly different mono signals → stereo (e.g. two noise seeds for a wide bed). */
export function stereoOf(left: Mono, right: Mono): Stereo {
  return [left, right];
}

export function toMono(a: Audio): Mono {
  if (!isStereo(a)) return a;
  const out = new Float32Array(a[0].length);
  for (let i = 0; i < out.length; i++) out[i] = ((a[0][i] as number) + (a[1][i] as number)) * 0.5;
  return out;
}

export type FadeCurve = 'lin' | 'exp' | 'cos';

function fadeShape(x: number, curve: FadeCurve): number {
  if (curve === 'lin') return x;
  if (curve === 'cos') return 0.5 - 0.5 * Math.cos(Math.PI * x);
  return x * x * x; // 'exp'-like: perceptually smooth tail
}

/** Fade in and/or out (seconds), in place on a copy. */
export function fade(sig: Mono, inS: number, outS: number, curve: FadeCurve = 'cos', sr = SR): Mono {
  const out = sig.slice();
  const ni = Math.min(out.length, samples(inS, sr));
  const no = Math.min(out.length, samples(outS, sr));
  for (let i = 0; i < ni; i++) out[i] = (out[i] as number) * fadeShape(i / ni, curve);
  for (let i = 0; i < no; i++) {
    const j = out.length - 1 - i;
    out[j] = (out[j] as number) * fadeShape(i / no, curve);
  }
  return out;
}

/** Apply `fn` to each channel of mono or stereo audio. */
export function perChannel(a: Audio, fn: (ch: Mono, index: number) => Mono): Audio {
  return isStereo(a) ? [fn(a[0], 0), fn(a[1], 1)] : fn(a, 0);
}

/** Pad or cut to an exact length in seconds. */
export function fit(sig: Mono, durS: number, sr = SR): Mono {
  const n = samples(durS, sr);
  const out = new Float32Array(n);
  out.set(sig.subarray(0, Math.min(n, sig.length)));
  return out;
}

export function concat(...parts: Mono[]): Mono {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(n);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function reverse(sig: Mono): Mono {
  return sig.slice().reverse();
}

/**
 * Varispeed (tape-style pitch shift): rate > 1 is higher and shorter. `rate` may vary over time
 * (pitch bends). Cubic (Catmull-Rom) interpolation.
 */
export function varispeed(sig: Mono, rate: Param, sr = SR): Mono {
  const out: number[] = [];
  let pos = 0;
  let i = 0;
  while (pos < sig.length - 1) {
    const k = Math.floor(pos);
    const f = pos - k;
    const y0 = sig[k - 1] ?? 0;
    const y1 = sig[k] ?? 0;
    const y2 = sig[k + 1] ?? 0;
    const y3 = sig[k + 2] ?? 0;
    out.push(
      y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0))),
    );
    pos += Math.max(1e-3, paramAt(rate, i++, sr));
  }
  return Float32Array.from(out);
}

export function peakOf(a: Audio): number {
  let p = 0;
  for (const ch of isStereo(a) ? a : [a]) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i] as number));
  return p;
}

export function scaleAudio(a: Audio, g: number): Audio {
  return perChannel(a, (ch) => ch.map((v) => v * g));
}
