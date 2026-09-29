/**
 * Reverberation: an algorithmic Freeverb-style network (Schroeder/Moorer: 8 damped combs + 4
 * allpasses per channel) and convolution with procedurally generated impulse responses.
 */
import { convolveFft } from './fft.ts';
import { onePole } from './filter.ts';
import { Rng } from './rng.ts';
import { type Audio, type Mono, type Stereo, SR, isStereo, samples, toMono } from './signal.ts';

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

export interface ReverbOptions {
  /** 0..1, larger = longer decay (default 0.5). */
  roomSize?: number;
  /** 0..1 high-frequency damping (default 0.5). */
  damping?: number;
  /** Wet/dry levels (linear, defaults 0.25 / 1). */
  wet?: number;
  dry?: number;
  /** 0..1 stereo width of the wet signal (default 1). */
  width?: number;
  predelayS?: number;
  /** Extra output length for the tail (default 1.5 s). */
  tailS?: number;
  sr?: number;
}

class Comb {
  private buf: Float32Array;
  private i = 0;
  private store = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number, feedback: number, damp: number): number {
    const y = this.buf[this.i] as number;
    this.store = y * (1 - damp) + this.store * damp;
    this.buf[this.i] = x + this.store * feedback;
    this.i = (this.i + 1) % this.buf.length;
    return y;
  }
}

class Allpass {
  private buf: Float32Array;
  private i = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const b = this.buf[this.i] as number;
    this.buf[this.i] = x + b * 0.5;
    this.i = (this.i + 1) % this.buf.length;
    return b - x;
  }
}

/** Algorithmic stereo reverb (Freeverb topology). Input mono or stereo, output stereo. */
export function reverb(input: Audio, o: ReverbOptions = {}): Stereo {
  const sr = o.sr ?? SR;
  const scale = sr / 44100;
  const room = (o.roomSize ?? 0.5) * 0.28 + 0.7;
  const damp = (o.damping ?? 0.5) * 0.4;
  const wet = o.wet ?? 0.25;
  const dry = o.dry ?? 1;
  const w = o.width ?? 1;
  const wet1 = wet * (w / 2 + 0.5);
  const wet2 = wet * ((1 - w) / 2);
  const pre = samples(o.predelayS ?? 0, sr);
  const [inL, inR] = isStereo(input) ? input : [input, input];
  const n = inL.length + pre + samples(o.tailS ?? 1.5, sr);
  const mk = (spread: number): { combs: Comb[]; aps: Allpass[] } => ({
    combs: COMB_TUNING.map((t) => new Comb(Math.round((t + spread) * scale))),
    aps: ALLPASS_TUNING.map((t) => new Allpass(Math.round((t + spread) * scale))),
  });
  const L = mk(0);
  const R = mk(STEREO_SPREAD);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i - pre;
    const x = j >= 0 && j < inL.length ? (((inL[j] as number) + (inR[j] as number)) * 0.5) * 0.015 * 2 : 0;
    let yl = 0;
    let yr = 0;
    for (const c of L.combs) yl += c.process(x, room, damp);
    for (const c of R.combs) yr += c.process(x, room, damp);
    for (const a of L.aps) yl = a.process(yl);
    for (const a of R.aps) yr = a.process(yr);
    const dl = i < inL.length ? (inL[i] as number) : 0;
    const dr = i < inR.length ? (inR[i] as number) : 0;
    outL[i] = dl * dry + yl * wet1 + yr * wet2;
    outR[i] = dr * dry + yr * wet1 + yl * wet2;
  }
  return [outL, outR];
}

export interface IrOptions {
  /** Decay time to -60 dB in seconds. */
  t60: number;
  /** IR length (default t60). */
  durS?: number;
  predelayS?: number;
  /** Damping: high frequencies decay faster (lowpass sweeps from `brightHz` down to `darkHz`). */
  brightHz?: number;
  darkHz?: number;
  /** Number of discrete early reflections (default 6) within the first 40 ms. */
  early?: number;
  stereo?: boolean;
  seed?: number;
  sr?: number;
}

/**
 * Generated impulse response: exponentially decaying noise with frequency-dependent damping and a few
 * early reflections. Deterministic by seed. Useful for small halls ("Gießhalle"), metal rooms, open field.
 */
export function makeIR(o: IrOptions): Audio {
  const sr = o.sr ?? SR;
  const dur = o.durS ?? o.t60;
  const n = samples(dur, sr);
  const pre = samples(o.predelayS ?? 0.005, sr);
  const k = Math.log(1000) / Math.max(1e-3, o.t60);
  const rng = new Rng(o.seed ?? 0x1ea7);
  const bright = o.brightHz ?? 9000;
  const dark = o.darkHz ?? 1500;
  const cutoff = new Float32Array(n);
  for (let i = 0; i < n; i++) cutoff[i] = bright * Math.pow(dark / bright, Math.min(1, i / Math.max(1, n)));
  const one = (r: Rng): Mono => {
    const raw = new Float32Array(n);
    for (let i = pre; i < n; i++) raw[i] = r.bipolar() * Math.exp((-k * (i - pre)) / sr);
    const early = o.early ?? 6;
    for (let e = 0; e < early; e++) {
      const t = pre + samples(r.range(0.004, 0.04), sr);
      if (t < n) raw[t] = (raw[t] as number) + r.range(0.3, 0.8) * (r.next() < 0.5 ? -1 : 1);
    }
    const damped = onePole(onePole(raw, cutoff, sr), cutoff, sr);
    // Normalize IR energy to 1 so wet level is predictable.
    let e2 = 0;
    for (let i = 0; i < n; i++) e2 += (damped[i] as number) ** 2;
    const g = e2 > 0 ? 1 / Math.sqrt(e2) : 0;
    return damped.map((v) => v * g);
  };
  const l = one(rng.fork('L'));
  return o.stereo ? [l, one(rng.fork('R'))] : l;
}

/** Convolve with an IR (mono or stereo IR) and blend wet/dry (linear levels). */
export function convolve(input: Audio, ir: Audio, wet = 0.3, dry = 1): Audio {
  const src = toMono(input);
  const irs = isStereo(ir) ? ir : [ir];
  const wetCh = irs.map((h) => convolveFft(src, h));
  const n = wetCh[0]!.length;
  const dryCh = isStereo(input) ? input : [input];
  const out = wetCh.map((w, c) => {
    const d = dryCh[Math.min(c, dryCh.length - 1)]!;
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = (i < d.length ? (d[i] as number) * dry : 0) + (w[i] as number) * wet;
    return o;
  });
  if (out.length === 2) return [out[0]!, out[1]!];
  if (isStereo(input)) {
    // Stereo input, mono IR: add the same wet signal to both channels.
    const r = new Float32Array(n);
    const w = wetCh[0]!;
    for (let i = 0; i < n; i++) r[i] = (i < input[1].length ? (input[1][i] as number) * dry : 0) + (w[i] as number) * wet;
    return [out[0]!, r];
  }
  return out[0]!;
}
