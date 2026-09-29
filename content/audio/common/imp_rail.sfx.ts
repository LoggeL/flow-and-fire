// Einschlag: Reißnadel-Treffer (Langrohr). Scharfer Metallriss: sehr harter Knacks, dann ein reißendes
// Rauschen durch einen Comb-Filter mit fallender Resonanz (singendes Metall), heller Stabklang, Funken.
import { comb, crack, decay, defineSfx, highpass, mixMono, modal, mul, noise, room, scaleDecay, sweep, thump } from '../../../tools/sfx/src/index.ts';
import { GLASS_PARTIALS, debris, finish } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_rail',
  category: 'impact',
  description: 'Reißnadel-Treffer: scharfer Metallriss',
  variants: 2,
  tags: ['einschlag', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.05);
    const dur = 1.0;
    const tearSrc = mul(noise('white', 0.4, rng.fork('tear')), decay(0.28, 0.4, 0.001));
    const tear = comb(tearSrc, { freq: sweep(2200 * p, 700 * p, 0.3, 0.7), feedback: 0.9, damp: 0.15, tailS: 0.3 });
    const ring = modal(1150 * p, scaleDecay(GLASS_PARTIALS, 1.1), { durS: 0.9, rng: rng.fork('ring'), jitter: 0.02 });
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.05, freq: 4200 * p, q: 0.8, t60: 0.012, drive: 8 }), db: 0 },
        { sig: tear, db: -5 },
        { sig: ring, db: -9, at: 0.002 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.2, t60: 0.12, lpFrom: 2500, lpTo: 400 }), db: -8 },
        { sig: debris({ rng: rng.fork('sparks'), durS: dur, fromS: 0.01, toS: 0.4, count: 10, fLo: 3500, fHi: 8000, t60: 0.015, bounce: 0 }), db: -14 },
      ],
      dur,
    );
    return finish(room(highpass(m, 120, 0.7, 2), { t60: 0.35, wet: 0.12, seed: 217 }), dur, 0.2);
  },
});
