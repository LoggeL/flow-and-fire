// Ambience „Hochland-Wind" (Karten-Grundbett, Loop 20 s, stereo). Breit, langsam moduliert:
//   Grundwind  rosa Rauschen je Kanal (eigener Seed = breit), Bandpass 250–950 Hz, dem Böen-Verlauf folgend
//   Böen       glatte Zufallskurve (~0,12 Hz) steuert Pegel und Filter; L/R leicht versetzt (wandert im Raum)
//   Pfeifen    schmaler Bandpass (Q 14) 900–1700 Hz, nur in Böen hörbar, sehr leise
//   Grund      braunes Rauschen, Tiefpass 110 Hz
import { type Stereo, bandpass, defineSfx, highpass, lowpass, mixMono, mul, noise, type Rng, samples } from '../../../tools/sfx/src/index.ts';

/** Glatte Zufallskurve in [0, 1]: Stützpunkte alle 1/rateHz s, Kosinus-interpoliert. */
export function smoothRand(rng: Rng, durS: number, rateHz: number, sr = 48000): Float32Array {
  const n = samples(durS, sr);
  const step = sr / rateHz;
  const pts = Array.from({ length: Math.ceil(n / step) + 2 }, () => rng.next());
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / step;
    const k = Math.floor(x);
    const f = 0.5 - 0.5 * Math.cos(Math.PI * (x - k));
    out[i] = (pts[k] as number) * (1 - f) + (pts[k + 1] as number) * f;
  }
  return out;
}

export default defineSfx({
  id: 'common:amb_wind_loop',
  category: 'ambience',
  description: 'Ambience Hochland-Wind (Loop 20 s): breiter, langsam in Böen modulierter Wind',
  variants: 1,
  loop: { lengthS: 20, crossfadeS: 3 },
  tags: ['ambience', 'loop', 'MS9'],
  render({ rng, durationS }) {
    const dur = durationS ?? 23;
    const gustShared = smoothRand(rng.fork('gust'), dur, 0.12);
    const channel = (label: string): Float32Array => {
      const r = rng.fork(label);
      const own = smoothRand(r.fork('own'), dur, 0.2);
      const g = gustShared.map((v, i) => Math.pow(0.7 * v + 0.3 * (own[i] as number), 1.8));
      const base = mul(lowpass(bandpass(noise('pink', dur, r.fork('n')), g.map((v) => 220 + 750 * v), 0.8), 2200, 0.7, 1), g.map((v) => 0.1 + 0.9 * v));
      const whistleF = smoothRand(r.fork('wf'), dur, 0.08).map((v) => 900 + 800 * v);
      const whistle = mul(bandpass(noise('white', dur, r.fork('w')), whistleF, 14), g.map((v) => Math.pow(v, 3)));
      const ground = lowpass(noise('brown', dur, r.fork('g')), 110, 0.7, 2);
      return highpass(
        mixMono([
          { sig: base, db: 0 },
          { sig: whistle, db: -12 },
          { sig: ground, db: -17 },
        ]),
        30,
        0.7,
        2,
      );
    };
    const st: Stereo = [channel('L'), channel('R')];
    return st;
  },
});
