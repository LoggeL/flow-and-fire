// Einschlag: Kanonen-Fehlschuss in den Boden. Erdwurf = dumpfer Knall, Erdstoß, danach rieselnder Kies
// und feiner Staub. Kein Metall, damit Treffer und Fehlschuss im Gefecht unterscheidbar bleiben.
import { boom, crack, defineSfx, highpass, mixMono, room, thump } from '../../../tools/sfx/src/index.ts';
import { finish, gravel } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_shell_ground',
  category: 'impact',
  description: 'Kanonen-Fehlschuss: Erdwurf, Knall mit Kies',
  variants: 4,
  tags: ['einschlag', 'MS5'],
  render({ rng }) {
    const p = rng.jitter(0.06);
    const dur = 0.8;
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.07, freq: 900 * p, q: 0.7, t60: 0.025, drive: 5 }), db: -2 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.5, t60: 0.22 * rng.jitter(0.15), lpFrom: 1400, lpTo: 150, color: 'brown' }), db: 0 },
        { sig: boom({ from: 130 * p, to: 50 * p, sweepS: 0.05, t60: 0.18, durS: 0.35, drive: 2.5 }), db: -4 },
        { sig: gravel({ rng: rng.fork('kies'), durS: dur, fromS: 0.03, toS: 0.55 * rng.jitter(0.15), density: 900, lp: 3500, hp: 300, grainS: 0.0015 }), db: -10 },
        { sig: gravel({ rng: rng.fork('staub'), durS: dur, fromS: 0.08, toS: 0.7, density: 2500, lp: 6000, hp: 1500, grainS: 0.0004 }), db: -20 },
      ],
      dur,
    );
    return finish(room(highpass(m, 40, 0.7, 2), { t60: 0.3, wet: 0.1, seed: 212 }), 0.8, 0.2);
  },
});
