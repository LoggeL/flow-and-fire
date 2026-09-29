/**
 * Effects: waveshaping/distortion, bitcrush, comb and delay lines, ring modulation, peak limiter.
 */
import { truePeakEnvelope } from './analysis.ts';
import { type Audio, type Mono, type Param, SR, dbToGain, isStereo, paramAt, samples } from './signal.ts';

export type ShapeKind = 'tanh' | 'soft' | 'hard' | 'fold' | 'asym';

export interface ShapeOptions {
  kind?: ShapeKind;
  /** Input drive (linear gain before the curve, default 2). May vary over time. */
  drive?: Param;
  /** Dry/wet 0..1 (default 1). */
  mix?: number;
  /** Compensate drive so peak level stays similar (default true). */
  compensate?: boolean;
  sr?: number;
}

function curve(kind: ShapeKind, x: number): number {
  switch (kind) {
    case 'tanh':
      return Math.tanh(x);
    case 'soft':
      return x / (1 + Math.abs(x));
    case 'hard':
      return Math.max(-1, Math.min(1, x));
    case 'fold': {
      // Wavefolder: reflect at ±1.
      let y = (x + 1) % 4;
      if (y < 0) y += 4;
      return y < 2 ? y - 1 : 3 - y;
    }
    case 'asym':
      // Tube-like asymmetric curve: adds even harmonics ("dumpfer Knall").
      return x >= 0 ? Math.tanh(x) : Math.tanh(x * 0.6) / 0.6 * 0.8;
  }
}

/** Waveshaper / distortion. */
export function shape(sig: Mono, o: ShapeOptions = {}): Mono {
  const sr = o.sr ?? SR;
  const kind = o.kind ?? 'tanh';
  const wet = o.mix ?? 1;
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    const d = paramAt(o.drive ?? 2, i, sr);
    const x = sig[i] as number;
    let y = curve(kind, x * d);
    if (o.compensate !== false) y /= Math.max(1e-6, curve(kind === 'fold' ? 'tanh' : kind, d));
    out[i] = x * (1 - wet) + y * wet;
  }
  return out;
}

/** Bit depth and sample-rate reduction (lo-fi radio/uplink grit). */
export function bitcrush(sig: Mono, bits: number, downsample = 1): Mono {
  const out = new Float32Array(sig.length);
  const levels = Math.pow(2, Math.max(1, bits) - 1);
  const hold = Math.max(1, Math.round(downsample));
  let v = 0;
  for (let i = 0; i < sig.length; i++) {
    if (i % hold === 0) v = Math.round((sig[i] as number) * levels) / levels;
    out[i] = v;
  }
  return out;
}

export interface CombOptions {
  /** Delay in seconds, or resonance frequency in Hz via `freq`. */
  delayS?: number;
  freq?: Param;
  /** Feedback -0.99..0.99 (negative = odd harmonics, hollow). */
  feedback: number;
  /** One-pole damping in the loop, 0..1 (default 0.2). */
  damp?: number;
  mix?: number;
  /** Extra output length in seconds for the ringing tail. */
  tailS?: number;
  sr?: number;
}

/** Feedback comb filter: metallic resonance ("Werkstimme"), pipes, Karplus-style rings. */
export function comb(sig: Mono, o: CombOptions): Mono {
  const sr = o.sr ?? SR;
  const n = sig.length + samples(o.tailS ?? 0, sr);
  const out = new Float32Array(n);
  const maxDelay = Math.ceil(sr / 20) + 2;
  const buf = new Float32Array(maxDelay + 4);
  let w = 0;
  let lp = 0;
  const damp = o.damp ?? 0.2;
  const wet = o.mix ?? 1;
  for (let i = 0; i < n; i++) {
    const d = Math.min(maxDelay, Math.max(1, o.freq !== undefined ? sr / paramAt(o.freq, i, sr) : (o.delayS ?? 0.005) * sr));
    const rp = w - d;
    const k = Math.floor(rp);
    const f = rp - k;
    const L = buf.length;
    const a = buf[((k % L) + L) % L] as number;
    const b = buf[(((k + 1) % L) + L) % L] as number;
    const delayed = a + (b - a) * f;
    lp = delayed * (1 - damp) + lp * damp;
    const x = i < sig.length ? (sig[i] as number) : 0;
    buf[w % L] = x + lp * o.feedback;
    w++;
    out[i] = x * (1 - wet) + delayed * wet;
  }
  return out;
}

export interface DelayOptions {
  timeS: number;
  feedback?: number;
  mix?: number;
  /** Lowpass in the feedback path (Hz, default 6000). */
  dampHz?: number;
  tailS?: number;
  sr?: number;
}

/** Feedback delay (echo, slap-back from a hall wall). */
export function delay(sig: Mono, o: DelayOptions): Mono {
  const sr = o.sr ?? SR;
  const d = Math.max(1, samples(o.timeS, sr));
  const n = sig.length + samples(o.tailS ?? 0, sr);
  const buf = new Float32Array(d);
  const out = new Float32Array(n);
  const fb = o.feedback ?? 0.3;
  const wet = o.mix ?? 0.3;
  const a = Math.exp((-2 * Math.PI * (o.dampHz ?? 6000)) / sr);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const x = i < sig.length ? (sig[i] as number) : 0;
    const y = buf[i % d] as number;
    lp = (1 - a) * y + a * lp;
    buf[i % d] = x + lp * fb;
    out[i] = x + y * wet;
  }
  return out;
}

/** Ring modulation with a sine (clangorous sidebands). */
export function ringMod(sig: Mono, freq: Param, mix = 1, sr = SR): Mono {
  const out = new Float32Array(sig.length);
  let ph = 0;
  for (let i = 0; i < sig.length; i++) {
    const x = sig[i] as number;
    out[i] = x * (1 - mix) + x * Math.sin(2 * Math.PI * ph) * mix;
    ph += paramAt(freq, i, sr) / sr;
    ph -= Math.floor(ph);
  }
  return out;
}

export interface LimiterOptions {
  ceilingDb?: number;
  lookaheadMs?: number;
  releaseMs?: number;
  /** Detect inter-sample (true) peaks via 4× oversampling (default true). */
  truePeak?: boolean;
  sr?: number;
}

/**
 * Look-ahead true-peak limiter (linked stereo). Gain reduction attacks over the look-ahead window and
 * releases exponentially; (true) peaks do not exceed the ceiling except for tiny interpolation residue.
 */
export function limiter(a: Audio, o: LimiterOptions = {}): Audio {
  const sr = o.sr ?? SR;
  const ceil = dbToGain(o.ceilingDb ?? -1);
  const la = Math.max(1, samples((o.lookaheadMs ?? 3) / 1000, sr));
  const rel = Math.exp(-1 / Math.max(1, ((o.releaseMs ?? 60) / 1000) * sr));
  const chans = isStereo(a) ? a : [a];
  const n = chans[0]!.length;
  // Required gain per sample.
  const need = new Float32Array(n);
  const peaks = chans.map((c) => (o.truePeak === false ? c.map(Math.abs) : truePeakEnvelope(c)));
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const pk of peaks) p = Math.max(p, pk[i] as number);
    need[i] = p > ceil ? ceil / p : 1;
  }
  // 1) Hold: minimum required gain over the look-ahead window (sliding-window minimum, O(n)).
  const hold = new Float32Array(n);
  const dq: number[] = [];
  let head = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (dq.length > head && (need[dq[dq.length - 1]!] as number) >= (need[i] as number)) dq.pop();
    dq.push(i);
    while ((dq[head] as number) > i + la - 1) head++;
    hold[i] = need[dq[head]!] as number;
  }
  // 2) Release: instant attack, exponential recovery (stays ≤ hold).
  const relc = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    const h = hold[i] as number;
    g = h < g ? h : g + (1 - rel) * (h - g);
    relc[i] = g;
  }
  // 3) Box smoothing over the look-ahead length: every value in the window is ≤ the need at the peak,
  //    so the smoothed gain still meets it, but changes slowly (no modulation splatter / new overs).
  const gain = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += relc[i] as number;
    if (i >= la) acc -= relc[i - la] as number;
    gain[i] = acc / Math.min(la, i + 1);
  }
  const res = chans.map((c) => c.map((v, i) => v * (gain[i] as number)));
  return isStereo(a) ? [res[0]!, res[1]!] : res[0]!;
}
