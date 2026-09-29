// Einschlag: MG-Fehlschuss. Staub-Puff = weicher Rauschstoß mit schließendem Tiefpass, kleiner Erdstoß,
// ein paar Körner. Leise wirkend und dumpf, damit Dauerfeuer nicht nervt.
import { crack, defineSfx, envelope, highpass, lowpass, mixMono, mul, noise, sweep, thump } from '../../../tools/sfx/src/index.ts';
import { finish, gravel } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_bullet_ground',
  category: 'impact',
  description: 'MG-Fehlschuss: Staub-Puff',
  variants: 4,
  tags: ['einschlag', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.1);
    const dur = 0.3;
    const puff = lowpass(mul(noise('pink', dur, rng.fork('puff')), envelope([[0, 0], [0.004, 1, 'lin'], [0.12 * rng.jitter(0.2), 0.001, 'exp']], dur)), sweep(2500 * p, 600 * p, 0.08, dur), 0.7, 2);
    const m = mixMono(
      [
        { sig: puff, db: 0 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.15, t60: 0.08, lpFrom: 900, lpTo: 150 }), db: -3 },
        { sig: crack({ rng: rng.fork('snap'), durS: 0.03, freq: 1400 * p, q: 0.8, t60: 0.008, drive: 3 }), db: -7 },
        { sig: gravel({ rng: rng.fork('korn'), durS: dur, fromS: 0.01, toS: 0.22, density: 600, lp: 3000, hp: 400 }), db: -14 },
      ],
      dur,
    );
    return finish(highpass(m, 80, 0.7, 2), dur, 0.05);
  },
});
