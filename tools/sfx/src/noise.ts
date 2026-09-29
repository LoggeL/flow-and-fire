/**
 * Noise generators: white, pink (Paul Kellet's refined filter), brown (leaky integrator), and sparse
 * crackle (ember/Glut-Knistern, gravel, debris).
 */
import type { Rng } from './rng.ts';
import { type Mono, type Param, SR, paramAt, samples } from './signal.ts';

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Noise normalized to roughly unit peak. */
export function noise(color: NoiseColor, durS: number, rng: Rng, sr = SR): Mono {
  const n = samples(durS, sr);
  const out = new Float32Array(n);
  if (color === 'white') {
    for (let i = 0; i < n; i++) out[i] = rng.bipolar();
    return out;
  }
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng.bipolar();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return out;
  }
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * rng.bipolar()) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

export interface CrackleOptions {
  /** Mean impulses per second (may vary over time). */
  density: Param;
  /** Impulse length in seconds (default 0.4 ms); longer = "pops". */
  grainS?: number;
  /** Amplitude spread: amplitude = rng^spread (higher = more small crackles). */
  spread?: number;
  sr?: number;
}

/** Sparse random impulses with random polarity/amplitude — embers, gravel, sizzle. */
export function crackle(durS: number, rng: Rng, o: CrackleOptions): Mono {
  const sr = o.sr ?? SR;
  const n = samples(durS, sr);
  const out = new Float32Array(n);
  const g = Math.max(1, samples(o.grainS ?? 0.0004, sr));
  for (let i = 0; i < n; i++) {
    if (rng.next() < paramAt(o.density, i, sr) / sr) {
      const a = Math.pow(rng.next(), o.spread ?? 2.5) * (rng.next() < 0.5 ? -1 : 1);
      for (let k = 0; k < g && i + k < n; k++) {
        const e = 1 - k / g;
        out[i + k] = (out[i + k] as number) + a * e * e * (k % 2 === 0 ? 1 : -0.6);
      }
    }
  }
  return out;
}
