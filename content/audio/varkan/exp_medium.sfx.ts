// Tod mittel (T2 mobil, T1/T2-Verteidigung, Werke I). Bersten mit Trümmerregen: Hauptdetonation,
// Nachbersten 0,18–0,3 s später, 7 Gussbruchstücke, dichter Trümmer- und Kiesregen über ~2 s,
// Grollen und Dampfzischen. Tiefer und länger als exp_small, kürzer und ohne Kesselton wie exp_large.
import { boom, crack, defineSfx, highpass, mixMono, room, shape, thump } from '../../../tools/sfx/src/index.ts';
import { debris, finish, gravel, ironBreak, rumble, steam } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:exp_medium',
  category: 'explosion',
  description: 'Tod mittel: Bersten mit Trümmerregen',
  variants: 3,
  tags: ['varkan', 'explosion', 'tod', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.06);
    const dur = 2.5;
    const t2 = rng.range(0.18, 0.3);
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.1, freq: 1000 * p, q: 0.7, t60: 0.04, drive: 6 }), db: -3 },
        { sig: boom({ from: 120 * p, to: 38 * p, sweepS: 0.1, t60: 0.6, durS: 1.1, drive: 3 }), db: 0 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.9, t60: 0.5, lpFrom: 2000, lpTo: 150 }), db: -2 },
        { sig: ironBreak({ rng: rng.fork('guss'), count: 7, fLo: 260, fHi: 1100, spreadS: 0.12, t60: 0.16, durS: 0.6 }), db: -3, at: 0.005 },
        { sig: boom({ from: 180 * p, to: 60 * p, sweepS: 0.05, t60: 0.2, durS: 0.4, drive: 3 }), db: -7, at: t2 },
        { sig: crack({ rng: rng.fork('crack2'), durS: 0.06, freq: 1500 * p, q: 0.8, t60: 0.02, drive: 5 }), db: -10, at: t2 },
        { sig: debris({ rng: rng.fork('truemmer'), durS: dur, fromS: 0.12, toS: 2.0, count: 28, fLo: 700, fHi: 3500, t60: 0.04, bounce: 0.5, fallDb: 16, skew: 1.4 }), db: -10 },
        { sig: gravel({ rng: rng.fork('kies'), durS: dur, fromS: 0.1, toS: 1.4, density: 500, lp: 3000, hp: 400, grainS: 0.0015 }), db: -16 },
        { sig: steam({ rng: rng.fork('dampf'), durS: 2.3, attackS: 0.08, t60: 1.6 * rng.jitter(0.15), hp: 2800, flutter: 0.5 }), db: -13, at: 0.1 },
        { sig: rumble(rng.fork('grollen'), dur, 140, 1.2), db: -9 },
      ],
      dur,
    );
    return finish(room(highpass(shape(m, { kind: 'tanh', drive: 1.3 }), 28, 0.7, 2), { t60: 0.7, wet: 0.14, seed: 322 }), dur, 0.4);
  },
});
