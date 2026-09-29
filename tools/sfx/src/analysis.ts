/**
 * Measurement: loudness per ITU-R BS.1770-4 / EBU R128 (K-weighting, 400 ms blocks with 75 % overlap,
 * absolute gate -70 LUFS, relative gate -10 LU), sample and true peak (4× oversampling), RMS, clipping,
 * DC offset, spectral centroid, duration.
 */
import { fft, hann } from './fft.ts';
import { Biquad, type BiquadCoeffs } from './filter.ts';
import { type Audio, SR, isStereo } from './signal.ts';

/** K-weighting stage 1 (high shelf, head model) and stage 2 (RLB high-pass) for any sample rate. */
export function kWeightingCoeffs(sr: number): [BiquadCoeffs, BiquadCoeffs] {
  // Coefficients re-derived for arbitrary rates (as in libebur128); at 48 kHz they match BS.1770 tables.
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const pre: BiquadCoeffs = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const rlb: BiquadCoeffs = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [pre, rlb];
}

function kWeighted(ch: Float32Array, sr: number): Float64Array {
  const [c1, c2] = kWeightingCoeffs(sr);
  const s1 = new Biquad(c1);
  const s2 = new Biquad(c2);
  const out = new Float64Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = s2.process(s1.process(ch[i] as number));
  return out;
}

export interface Loudness {
  /** Integrated loudness (LUFS, gated). Signals shorter than one 400 ms block are zero-padded to one block. */
  integrated: number;
  /** Maximum momentary loudness (400 ms window, ungated; short signals zero-padded like a meter sees them). */
  momentaryMax: number;
  /** True if the signal was shorter than 400 ms (both values come from the single padded block). */
  short: boolean;
}

/** How a sound's loudness target is measured: loops/long beds integrated, one-shots by momentary max. */
export type LoudnessMode = 'integrated' | 'momentary';

const toLufs = (ms: number): number => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

/**
 * Loudness per BS.1770-4. Channel weights are 1.0 (L, R, mono). A mono file counts as one channel,
 * like ffmpeg's ebur128 filter: a centered mono source through an equal-power panner has the same loudness.
 */
export function loudness(a: Audio, sr = SR): Loudness {
  const chans = (isStereo(a) ? a : [a]).map((c) => kWeighted(c, sr));
  const n = chans[0]!.length;
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  // Prefix sums of summed channel energy for O(1) block means.
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (const c of chans) e += (c[i] as number) ** 2;
    cum[i + 1] = (cum[i] as number) + e;
  }
  if (n < block) {
    // The K-weighting filter tail is part of the signal; zero-padding adds no energy.
    const ms = (cum[n] as number) / block;
    return { integrated: toLufs(ms), momentaryMax: toLufs(ms), short: true };
  }
  const blocks: number[] = [];
  for (let s = 0; s + block <= n; s += hop) blocks.push(((cum[s + block] as number) - (cum[s] as number)) / block);
  const momentaryMax = toLufs(Math.max(...blocks));
  const absGated = blocks.filter((z) => toLufs(z) > -70);
  if (absGated.length === 0) return { integrated: -Infinity, momentaryMax, short: false };
  const relThresh = toLufs(absGated.reduce((s, z) => s + z, 0) / absGated.length) - 10;
  const relGated = absGated.filter((z) => toLufs(z) > relThresh);
  return { integrated: toLufs(relGated.reduce((s, z) => s + z, 0) / relGated.length), momentaryMax, short: false };
}

export function loudnessBy(a: Audio, mode: LoudnessMode, sr = SR): number {
  const l = loudness(a, sr);
  return mode === 'integrated' ? l.integrated : l.momentaryMax;
}

/** 4× oversampling interpolation kernel (windowed sinc, 48 taps per phase). */
const OS = 4;
const TAPS = 48;
const KERNEL: Float64Array[] = (() => {
  const phases: Float64Array[] = [];
  for (let p = 0; p < OS; p++) {
    const k = new Float64Array(TAPS);
    for (let t = 0; t < TAPS; t++) {
      const x = t - TAPS / 2 + 1 - p / OS;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TAPS / 2)); // Hann
      k[t] = sinc * w;
    }
    // Unity DC gain per phase (the truncated kernel would otherwise overshoot by ~1 %).
    const sum = k.reduce((a, b) => a + b, 0);
    for (let t = 0; t < TAPS; t++) k[t] = (k[t] as number) / sum;
    phases.push(k);
  }
  return phases;
})();

/**
 * Per-sample true-peak envelope of one channel: max(|x[i]|, |x(i + p/4)|) for p = 1..3, i.e. the peak of
 * the 4× oversampled signal attributed to the preceding sample. Used by the true-peak limiter.
 */
export function truePeakEnvelope(ch: Float32Array): Float32Array {
  const env = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    let m = Math.abs(ch[i] as number);
    for (let p = 1; p < OS; p++) {
      const k = KERNEL[p]!;
      let acc = 0;
      const j0 = i - TAPS / 2 + 1;
      for (let t = 0; t < TAPS; t++) {
        const j = j0 + t;
        if (j >= 0 && j < ch.length) acc += (ch[j] as number) * (k[t] as number);
      }
      m = Math.max(m, Math.abs(acc));
    }
    env[i] = m;
  }
  return env;
}

/** True peak (linear) via 4× oversampling, per BS.1770 Annex 2 (48-tap windowed-sinc interpolator). */
export function truePeak(a: Audio): number {
  let peak = 0;
  for (const ch of isStereo(a) ? a : [a]) {
    for (let i = 0; i < ch.length; i++) {
      const s = Math.abs(ch[i] as number);
      if (s > peak) peak = s;
    }
  }
  for (const ch of isStereo(a) ? a : [a]) {
    for (let i = 0; i < ch.length; i++) {
      // Inter-sample overs are bounded by a few dB: only interpolate around loud samples.
      if (Math.abs(ch[i] as number) < peak * 0.25 && Math.abs(ch[i + 1] ?? 0) < peak * 0.25) continue;
      for (let p = 1; p < OS; p++) {
        const k = KERNEL[p]!;
        let acc = 0;
        for (let t = 0; t < TAPS; t++) {
          const j = i + t - TAPS / 2 + 1;
          if (j >= 0 && j < ch.length) acc += (ch[j] as number) * (k[t] as number);
        }
        peak = Math.max(peak, Math.abs(acc));
      }
    }
  }
  return peak;
}

export interface Analysis {
  durationS: number;
  channels: number;
  sampleRate: number;
  peakDb: number;
  truePeakDb: number;
  rmsDb: number;
  lufs: number;
  lufsMomentaryMax: number;
  lufsShort: boolean;
  /** Samples at or above 0.999 full scale. */
  clippedSamples: number;
  dcOffset: number;
  /** Power-weighted spectral centroid in Hz. */
  centroidHz: number;
  /** Time until the signal falls permanently below -60 dB relative to its peak. */
  activeS: number;
}

const db = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/** Power-weighted spectral centroid over all STFT frames (Hann, 2048). */
export function spectralCentroid(a: Audio, sr = SR): number {
  const ch = isStereo(a) ? a[0].map((v, i) => (v + (a[1][i] as number)) * 0.5) : a;
  const N = 2048;
  const hop = 1024;
  const w = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let num = 0;
  let den = 0;
  for (let s = 0; s < Math.max(1, ch.length - N + hop); s += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < N; i++) re[i] = (ch[s + i] ?? 0) * (w[i] as number);
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const p = (re[k] as number) ** 2 + (im[k] as number) ** 2;
      num += p * ((k * sr) / N);
      den += p;
    }
  }
  return den > 0 ? num / den : 0;
}

export function analyze(a: Audio, sr = SR): Analysis {
  const chans = isStereo(a) ? a : [a];
  const n = chans[0]!.length;
  let peak = 0;
  let sum2 = 0;
  let sum = 0;
  let clipped = 0;
  for (const ch of chans) {
    for (let i = 0; i < n; i++) {
      const v = ch[i] as number;
      const av = Math.abs(v);
      if (av > peak) peak = av;
      if (av >= 0.999) clipped++;
      sum2 += v * v;
      sum += v;
    }
  }
  let lastActive = 0;
  const thr = peak * 0.001;
  for (const ch of chans) for (let i = n - 1; i > lastActive; i--) if (Math.abs(ch[i] as number) > thr) { lastActive = i; break; }
  const l = loudness(a, sr);
  return {
    durationS: n / sr,
    channels: chans.length,
    sampleRate: sr,
    peakDb: db(peak),
    truePeakDb: db(truePeak(a)),
    rmsDb: db(Math.sqrt(sum2 / Math.max(1, n * chans.length))),
    lufs: l.integrated,
    lufsMomentaryMax: l.momentaryMax,
    lufsShort: l.short,
    clippedSamples: clipped,
    dcOffset: sum / Math.max(1, n * chans.length),
    centroidHz: spectralCentroid(a, sr),
    activeS: (lastActive + 1) / sr,
  };
}
