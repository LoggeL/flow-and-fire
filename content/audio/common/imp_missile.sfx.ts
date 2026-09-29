// Einschlag: Rakete (Rinne, Hochrost). Detonation (Knall + Wumm + Luftstoß) mit Glut-Zischen der
// Schlacke-Treibladung und vereinzelten Glutfunken.
import { boom, crack, defineSfx, highpass, mixMono, room, shape, sizzle, thump } from '../../../tools/sfx/src/index.ts';
import { finish, gravel } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_missile',
  category: 'impact',
  description: 'Raketen-Einschlag: Detonation + Glut-Zischen',
  variants: 3,
  tags: ['einschlag', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.06);
    const dur = 1.0;
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.08, freq: 1600 * p, q: 0.7, t60: 0.03, drive: 6 }), db: 0 },
        { sig: boom({ from: 160 * p, to: 45 * p, sweepS: 0.07, t60: 0.3, durS: 0.5, drive: 3 }), db: -3 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.45, t60: 0.3, lpFrom: 3000, lpTo: 250 }), db: -4 },
        { sig: sizzle({ rng: rng.fork('glut'), durS: 0.9, t60: 0.7 * rng.jitter(0.15), hp: 3200, density: 400, hiss: 0.55 }), db: -12, at: 0.03 },
        { sig: gravel({ rng: rng.fork('funken'), durS: dur, fromS: 0.05, toS: 0.9, density: 150, lp: 9000, hp: 2000, grainS: 0.0006 }), db: -18 },
      ],
      dur,
    );
    return finish(room(highpass(shape(m, { kind: 'tanh', drive: 1.3 }), 50, 0.7, 2), { t60: 0.4, wet: 0.14, seed: 215 }), dur, 0.2);
  },
});
