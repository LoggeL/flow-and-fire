// Einschlag: Treffer auf ein Gebäude. Tiefer, hallender Klong: große Gussplatte (f0 ≈ 120 Hz, langer
// Nachklang), hohler Kesselkörper (Comb mit negativer Rückkopplung = ungerade Obertöne), größerer Raum.
import { PLATE_PARTIALS, boom, clang, comb, crack, defineSfx, highpass, lowpass, mixMono, room, thump } from '../../../tools/sfx/src/index.ts';
import { finish } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_structure_metal',
  category: 'impact',
  description: 'Treffer auf Gebäude: tiefer, hallender Klong',
  variants: 4,
  tags: ['einschlag', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.06);
    const dur = 1.0;
    const body = clang({ f0: 120 * p, rng: rng.fork('clang'), durS: 0.95, decayScale: 1.3 * rng.jitter(0.15), partials: PLATE_PARTIALS, strike: 0.3, pitchDrop: 0.015 });
    const air = thump({ rng: rng.fork('thump'), durS: 0.4, t60: 0.3, lpFrom: 1500, lpTo: 180 });
    const hollow = comb(air, { freq: 95 * p, feedback: -0.85, damp: 0.35, tailS: 0.4 });
    const m = mixMono(
      [
        { sig: lowpass(body, 2200, 0.7, 2), db: 0 },
        { sig: hollow, db: -8 },
        { sig: crack({ rng: rng.fork('crack'), durS: 0.06, freq: 1200 * p, q: 0.8, t60: 0.02, drive: 4 }), db: -5 },
        { sig: boom({ from: 110 * p, to: 50 * p, sweepS: 0.05, t60: 0.3, durS: 0.5, drive: 2 }), db: -6 },
        { sig: air, db: -6 },
      ],
      dur,
    );
    return finish(room(highpass(m, 45, 0.7, 2), { t60: 0.9, wet: 0.28, seed: 214, darkHz: 900 }), dur, 0.3);
  },
});
