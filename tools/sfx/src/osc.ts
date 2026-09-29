/**
 * Oscillators: band-limited classic waves (PolyBLEP), 2-operator FM, modal/additive synthesis for
 * bells, plates and cast metal.
 */
import type { Rng } from './rng.ts';
import { type Mono, type Param, SR, paramAt, samples } from './signal.ts';

export type Wave = 'sine' | 'saw' | 'square' | 'triangle' | 'pulse';

export interface OscOptions {
  /** Start phase in cycles [0, 1). */
  phase?: number;
  /** Pulse width for 'pulse' (0..1, default 0.5). */
  pw?: Param;
  sr?: number;
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Band-limited oscillator with time-varying frequency (Hz). */
export function osc(wave: Wave, freq: Param, durS: number, opts: OscOptions = {}): Mono {
  const sr = opts.sr ?? SR;
  const n = samples(durS, sr);
  const out = new Float32Array(n);
  let ph = opts.phase ?? 0;
  let tri = -1; // triangle starts at its minimum (no DC offset)
  for (let i = 0; i < n; i++) {
    const f = paramAt(freq, i, sr);
    const dt = Math.min(0.5, Math.abs(f) / sr);
    let v: number;
    switch (wave) {
      case 'sine':
        v = Math.sin(2 * Math.PI * ph);
        break;
      case 'saw':
        v = 2 * ph - 1 - polyBlep(ph, dt);
        break;
      case 'square':
      case 'pulse':
      case 'triangle': {
        const pw = wave === 'pulse' ? Math.min(0.95, Math.max(0.05, paramAt(opts.pw ?? 0.5, i, sr))) : 0.5;
        v = (ph < pw ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 1 - pw) % 1, dt);
        if (wave === 'triangle') {
          // Leaky integration of the band-limited square.
          tri = dt * 4 * v + (1 - dt * 0.05) * tri;
          v = tri;
        }
        break;
      }
    }
    out[i] = v;
    ph += f / sr;
    ph -= Math.floor(ph);
  }
  return out;
}

export interface FmOptions {
  /** Carrier frequency in Hz. */
  carrier: Param;
  /** Modulator frequency = carrier · ratio (default 1). Inharmonic ratios (1.41, 2.76…) sound metallic. */
  ratio?: Param;
  /** Fixed modulator frequency in Hz (overrides ratio). */
  modFreq?: Param;
  /** Modulation index (peak phase deviation in radians); envelope it for bright attacks. */
  index: Param;
  /** Modulator self-feedback (0..1.5). */
  feedback?: number;
  durS: number;
  sr?: number;
}

/** Two-operator phase-modulation FM (DX-style). */
export function fm(o: FmOptions): Mono {
  const sr = o.sr ?? SR;
  const n = samples(o.durS, sr);
  const out = new Float32Array(n);
  let pc = 0;
  let pm = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const fc = paramAt(o.carrier, i, sr);
    const fmod = o.modFreq !== undefined ? paramAt(o.modFreq, i, sr) : fc * paramAt(o.ratio ?? 1, i, sr);
    const m = Math.sin(2 * Math.PI * pm + (o.feedback ?? 0) * prev);
    prev = m;
    out[i] = Math.sin(2 * Math.PI * pc + paramAt(o.index, i, sr) * m);
    pc += fc / sr;
    pm += fmod / sr;
    pc -= Math.floor(pc);
    pm -= Math.floor(pm);
  }
  return out;
}

export interface Partial {
  /** Frequency ratio to f0 (or absolute Hz if `hz` is set). */
  ratio: number;
  /** Linear amplitude. */
  amp: number;
  /** Time to decay by 60 dB, in seconds. */
  t60: number;
  hz?: boolean;
  /** Optional slow beating: second copy detuned by this many Hz (bell "warble"). */
  beatHz?: number;
}

export interface ModalOptions {
  durS: number;
  /** Attack time in seconds (default 0.3 ms: struck). */
  attackS?: number;
  /** Pitch envelope multiplier (e.g. a tiny downward glide on impact). */
  pitch?: Param;
  /** Random start phases and ±jitter on ratios/decays for variation. */
  rng?: Rng;
  jitter?: number;
  sr?: number;
}

/**
 * Modal synthesis: a sum of exponentially decaying sinusoids. The core of all bell, clang, plate and
 * "Glockenhammer" sounds.
 */
export function modal(f0: number, partials: readonly Partial[], o: ModalOptions): Mono {
  const sr = o.sr ?? SR;
  const n = samples(o.durS, sr);
  const out = new Float32Array(n);
  const na = Math.max(1, samples(o.attackS ?? 0.0003, sr));
  const jit = o.jitter ?? 0;
  for (const p of partials) {
    const r = o.rng;
    const f = (p.hz ? p.ratio : f0 * p.ratio) * (r ? r.jitter(jit) : 1);
    const t60 = p.t60 * (r ? r.jitter(jit * 2) : 1);
    if (f >= sr * 0.49) continue;
    const k = Math.log(1000) / Math.max(1e-4, t60);
    const lim = Math.min(n, Math.ceil((t60 * 1.5 + 0.01) * sr));
    const copies = p.beatHz ? [0, p.beatHz] : [0];
    for (const det of copies) {
      let ph = r ? r.next() : 0;
      const a = p.amp / copies.length;
      for (let i = 0; i < lim; i++) {
        const env = Math.exp((-k * i) / sr) * (i < na ? i / na : 1);
        out[i] = (out[i] as number) + a * env * Math.sin(2 * Math.PI * ph);
        ph += ((f + det) * (o.pitch !== undefined ? paramAt(o.pitch, i, sr) : 1)) / sr;
        ph -= Math.floor(ph);
      }
    }
  }
  return out;
}

/**
 * Partial ratios of a cast bronze/iron church bell (hum, prime, tierce, quint, nominal, …),
 * relative to the prime. Amplitudes/decays are a neutral starting point.
 */
export const BELL_PARTIALS: readonly Partial[] = [
  { ratio: 0.5, amp: 0.45, t60: 3.2, beatHz: 0.7 },
  { ratio: 1.0, amp: 0.6, t60: 2.2, beatHz: 1.1 },
  { ratio: 1.183, amp: 0.55, t60: 1.6 },
  { ratio: 1.506, amp: 0.3, t60: 1.2 },
  { ratio: 2.0, amp: 0.8, t60: 1.0 },
  { ratio: 2.514, amp: 0.35, t60: 0.7 },
  { ratio: 2.662, amp: 0.25, t60: 0.6 },
  { ratio: 3.011, amp: 0.3, t60: 0.5 },
  { ratio: 4.166, amp: 0.18, t60: 0.35 },
  { ratio: 5.433, amp: 0.1, t60: 0.25 },
  { ratio: 6.796, amp: 0.06, t60: 0.18 },
];

/** Modes of a free thick plate / cast block (inharmonic, dull "Guss" clank). */
export const PLATE_PARTIALS: readonly Partial[] = [
  { ratio: 1.0, amp: 0.7, t60: 0.5 },
  { ratio: 1.59, amp: 0.5, t60: 0.38 },
  { ratio: 2.14, amp: 0.45, t60: 0.3 },
  { ratio: 2.65, amp: 0.3, t60: 0.22 },
  { ratio: 3.16, amp: 0.25, t60: 0.17 },
  { ratio: 3.65, amp: 0.2, t60: 0.13 },
  { ratio: 4.15, amp: 0.12, t60: 0.1 },
];

/** Scale all partial decays (T1 short, T3 long). */
export function scaleDecay(partials: readonly Partial[], k: number): Partial[] {
  return partials.map((p) => ({ ...p, t60: p.t60 * k }));
}
