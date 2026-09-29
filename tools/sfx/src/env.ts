/**
 * Envelopes and control curves: multi-segment envelopes, ADSR, exponential decays, pitch sweeps, LFOs.
 * All return per-sample Float32Array curves usable as `Param`.
 */
import { SR, samples } from './signal.ts';

/**
 * Segment shape towards the next point:
 * - 'lin' linear, 'exp' geometric (needs both ends > 0, falls back to a steep power curve otherwise),
 * - 'hold' step at the end, a number k = power curve (k > 1 slow start, k < 1 fast start).
 */
export type Curve = 'lin' | 'exp' | 'hold' | number;

/** Envelope point: [time in s, value, curve of the segment that ends here]. */
export type EnvPoint = readonly [t: number, v: number, curve?: Curve];

function interp(v0: number, v1: number, x: number, curve: Curve): number {
  if (curve === 'hold') return x < 1 ? v0 : v1;
  if (curve === 'lin') return v0 + (v1 - v0) * x;
  if (curve === 'exp') {
    if (v0 > 0 && v1 > 0) return v0 * Math.pow(v1 / v0, x);
    // Towards/away from zero: a steep power curve sounds like an exponential decay/attack.
    return v1 < v0 ? v1 + (v0 - v1) * Math.pow(1 - x, 4) : v0 + (v1 - v0) * Math.pow(x, 4);
  }
  return v0 + (v1 - v0) * Math.pow(x, curve);
}

/**
 * Multi-segment envelope. Points must be sorted by time; before the first point the first value
 * holds, after the last point the last value holds. Duration defaults to the last point.
 */
export function envelope(points: readonly EnvPoint[], durS?: number, sr = SR): Float32Array {
  if (points.length === 0) throw new Error('envelope: keine Punkte');
  const last = points[points.length - 1] as EnvPoint;
  const n = samples(durS ?? last[0], sr);
  const out = new Float32Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    while (seg < points.length && (points[seg] as EnvPoint)[0] <= t) seg++;
    if (seg === 0) out[i] = (points[0] as EnvPoint)[1];
    else if (seg >= points.length) out[i] = last[1];
    else {
      const [t0, v0] = points[seg - 1] as EnvPoint;
      const [t1, v1, c] = points[seg] as EnvPoint;
      out[i] = interp(v0, v1, t1 > t0 ? (t - t0) / (t1 - t0) : 1, c ?? 'lin');
    }
  }
  return out;
}

export interface Adsr {
  a: number;
  d: number;
  s: number;
  r: number;
  /** Sustain time in seconds between decay and release (default 0). */
  hold?: number;
  /** Peak level (default 1). */
  peak?: number;
  curve?: Curve;
}

/** Classic ADSR; total length = a + d + hold + r. */
export function adsr(p: Adsr, sr = SR): Float32Array {
  const peak = p.peak ?? 1;
  const c = p.curve ?? 'exp';
  const t1 = p.a;
  const t2 = t1 + p.d;
  const t3 = t2 + (p.hold ?? 0);
  const t4 = t3 + p.r;
  return envelope(
    [
      [0, 0],
      [t1, peak, 'lin'],
      [t2, p.s * peak, c],
      [t3, p.s * peak, 'lin'],
      [t4, 0, c],
    ],
    t4,
    sr,
  );
}

/**
 * Exponential decay reaching -60 dB after `t60` seconds, with a short linear attack.
 * `durS` defaults to t60 (then it ends at 0.001 → faded to 0 over the last 2 ms).
 */
export function decay(t60: number, durS = t60, attackS = 0.0005, sr = SR): Float32Array {
  const n = samples(durS, sr);
  const out = new Float32Array(n);
  const k = Math.log(1000) / Math.max(1e-4, t60);
  const na = Math.max(1, samples(attackS, sr));
  const nf = Math.min(n, samples(0.002, sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = Math.exp(-k * t);
    if (i < na) v *= i / na;
    if (i >= n - nf) v *= (n - i) / nf;
    out[i] = v;
  }
  return out;
}

/** Frequency (or any value) sweep from `from` to `to` over `timeS`, then held until `durS`. */
export function sweep(from: number, to: number, timeS: number, durS = timeS, curve: Curve = 'exp', sr = SR): Float32Array {
  return envelope(
    [
      [0, from],
      [timeS, to, curve],
    ],
    durS,
    sr,
  );
}

export type LfoShape = 'sine' | 'triangle' | 'square' | 'saw';

/** Low-frequency oscillator: center + depth · wave(rate). */
export function lfo(rateHz: number, depth: number, center: number, durS: number, shape: LfoShape = 'sine', phase = 0, sr = SR): Float32Array {
  const n = samples(durS, sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (phase + (rateHz * i) / sr) % 1;
    let w: number;
    if (shape === 'sine') w = Math.sin(2 * Math.PI * x);
    else if (shape === 'triangle') w = 1 - 4 * Math.abs(x - 0.5);
    else if (shape === 'square') w = x < 0.5 ? 1 : -1;
    else w = 2 * x - 1;
    out[i] = center + depth * w;
  }
  return out;
}

/** Semitones → frequency ratio. */
export function semis(n: number): number {
  return Math.pow(2, n / 12);
}

/** MIDI note → Hz (A4 = 69 = 440 Hz). */
export function midiHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}
