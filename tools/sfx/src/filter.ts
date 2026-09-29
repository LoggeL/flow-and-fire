/**
 * Filters: RBJ biquads with time-varying cutoff/Q/gain (filter envelopes), cascades, one-pole
 * smoothers and a DC blocker.
 */
import { type Mono, type Param, SR, paramAt } from './signal.ts';

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peak' | 'lowshelf' | 'highshelf' | 'allpass';

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Audio-EQ-Cookbook (R. Bristow-Johnson) coefficients, normalized by a0. */
export function biquadCoeffs(type: FilterType, freq: number, q: number, gainDb = 0, sr = SR): BiquadCoeffs {
  const f = Math.min(Math.max(freq, 5), sr * 0.49);
  const w0 = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const Q = Math.max(0.05, q);
  const alpha = sin / (2 * Q);
  const A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1; b1 = -2 * cos; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'allpass':
      b0 = 1 - alpha; b1 = -2 * cos; b2 = 1 + alpha;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'peak':
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Streaming biquad (Direct Form I, double precision state). */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(public c: BiquadCoeffs) {}

  process(x: number): number {
    const c = this.c;
    const y = c.b0 * x + c.b1 * this.x1 + c.b2 * this.x2 - c.a1 * this.y1 - c.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export interface FilterOptions {
  type: FilterType;
  /** Cutoff/center in Hz, may be an envelope (filter sweep). */
  freq: Param;
  /** Q (default 0.707). For bandpass higher = narrower. */
  q?: Param;
  /** Gain in dB for peak/shelf. */
  gainDb?: Param;
  /** Cascade n identical stages (2 → 24 dB/oct for LP/HP). */
  stages?: number;
  sr?: number;
}

const CONTROL_BLOCK = 16;

/** Apply a (possibly modulated) biquad. Coefficients are recomputed every 16 samples when modulated. */
export function filter(sig: Mono, o: FilterOptions): Mono {
  const sr = o.sr ?? SR;
  const q = o.q ?? Math.SQRT1_2;
  const g = o.gainDb ?? 0;
  const modulated = typeof o.freq !== 'number' || typeof q !== 'number' || typeof g !== 'number';
  const stages = Array.from({ length: Math.max(1, o.stages ?? 1) }, () => new Biquad(biquadCoeffs(o.type, paramAt(o.freq, 0, sr), paramAt(q, 0, sr), paramAt(g, 0, sr), sr)));
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    if (modulated && i % CONTROL_BLOCK === 0 && i > 0) {
      const c = biquadCoeffs(o.type, paramAt(o.freq, i, sr), paramAt(q, i, sr), paramAt(g, i, sr), sr);
      for (const s of stages) s.c = c;
    }
    let v = sig[i] as number;
    for (const s of stages) v = s.process(v);
    out[i] = v;
  }
  return out;
}

export const lowpass = (sig: Mono, freq: Param, q?: Param, stages?: number): Mono =>
  filter(sig, { type: 'lowpass', freq, ...(q !== undefined ? { q } : {}), ...(stages !== undefined ? { stages } : {}) });
export const highpass = (sig: Mono, freq: Param, q?: Param, stages?: number): Mono =>
  filter(sig, { type: 'highpass', freq, ...(q !== undefined ? { q } : {}), ...(stages !== undefined ? { stages } : {}) });
export const bandpass = (sig: Mono, freq: Param, q?: Param): Mono =>
  filter(sig, { type: 'bandpass', freq, ...(q !== undefined ? { q } : {}) });
export const peakEq = (sig: Mono, freq: number, gainDb: number, q = 1): Mono => filter(sig, { type: 'peak', freq, q, gainDb });

/** One-pole lowpass (gentle 6 dB/oct smoothing, e.g. for damping). */
export function onePole(sig: Mono, freq: Param, sr = SR): Mono {
  const out = new Float32Array(sig.length);
  let y = 0;
  for (let i = 0; i < sig.length; i++) {
    const a = Math.exp((-2 * Math.PI * paramAt(freq, i, sr)) / sr);
    y = (1 - a) * (sig[i] as number) + a * y;
    out[i] = y;
  }
  return out;
}

/** DC blocker (first-order highpass around `hz`). */
export function dcBlock(sig: Mono, hz = 10, sr = SR): Mono {
  const r = Math.exp((-2 * Math.PI * hz) / sr);
  const out = new Float32Array(sig.length);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < sig.length; i++) {
    const x = sig[i] as number;
    const y = x - x1 + r * y1;
    x1 = x;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Magnitude response (linear) of coefficients at frequency f — for tests and plots. */
export function magnitudeAt(c: BiquadCoeffs, f: number, sr = SR): number {
  const w = (2 * Math.PI * f) / sr;
  const re = (k: number): number => Math.cos(-k * w);
  const im = (k: number): number => Math.sin(-k * w);
  const nr = c.b0 + c.b1 * re(1) + c.b2 * re(2);
  const ni = c.b1 * im(1) + c.b2 * im(2);
  const dr = 1 + c.a1 * re(1) + c.a2 * re(2);
  const di = c.a1 * im(1) + c.a2 * im(2);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}
