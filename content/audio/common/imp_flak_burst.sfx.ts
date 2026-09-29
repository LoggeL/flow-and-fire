// Einschlag: Flak/SAM-Näherungszünder, Detonation in der Luft. Heller, trockener Knall ohne Erdstoß
// (Hochpass 180 Hz), dichter Splitterregen hoher Ticks, pfeifende Splitter und ein Echo vom Boden.
import { bandpass, boom, crack, defineSfx, delay, envelope, highpass, mixMono, mul, noise, sweep, thump } from '../../../tools/sfx/src/index.ts';
import { debris, finish } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_flak_burst',
  category: 'impact',
  description: 'Flak/SAM-Luftdetonation mit Splitterregen',
  variants: 4,
  tags: ['einschlag', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.07);
    const dur = 0.8;
    const layers = [
      { sig: crack({ rng: rng.fork('crack'), durS: 0.06, freq: 2400 * p, q: 0.7, t60: 0.02, drive: 6 }), db: 0 },
      { sig: boom({ from: 320 * p, to: 140 * p, sweepS: 0.03, t60: 0.09, durS: 0.2, drive: 3 }), db: -6 },
      { sig: thump({ rng: rng.fork('air'), durS: 0.2, t60: 0.12, lpFrom: 4000, lpTo: 600 }), db: -6 },
      { sig: debris({ rng: rng.fork('splitter'), durS: dur, fromS: 0.03, toS: 0.6, count: 26, fLo: 3000, fHi: 7500, t60: 0.015, bounce: 0, fallDb: 14, skew: 1.3 }), db: -9 },
    ];
    for (let i = 0; i < 3; i++) {
      const r = rng.fork(`whizz${i}`);
      const d = 0.09;
      const w = mul(bandpass(noise('white', d, r), sweep(5200 * r.jitter(0.2), 2400, d, d), 6), envelope([[0, 0], [0.02, 1, 'lin'], [d, 0, 'lin']], d));
      layers.push({ sig: w, db: -16 - r.range(0, 4), at: r.range(0.02, 0.2) } as (typeof layers)[number]);
    }
    const m = delay(mixMono(layers, dur), { timeS: 0.11 * rng.jitter(0.2), feedback: 0.1, mix: 0.2, dampHz: 2500 });
    return finish(highpass(m, 180, 0.7, 2), dur, 0.15);
  },
});
