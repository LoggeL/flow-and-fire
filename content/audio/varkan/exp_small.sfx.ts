// Tod klein (T1 mobil, Mauer, kleine Gebäude). faction.md §8.2: „Tod: Gusseisen bricht, dazu Dampfzischen".
// Schichten: Knall, Wumm (150→45 Hz, Tiefband gehört den Explosionen), Luftstoß, 4 Gussbruchstücke
// (spröder Knacks + stumpfer Plattenklang), Trümmer mit Aufspringen, kurzes Dampfzischen.
import { boom, crack, defineSfx, highpass, mixMono, room, shape, thump } from '../../../tools/sfx/src/index.ts';
import { debris, finish, ironBreak, steam } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:exp_small',
  category: 'explosion',
  description: 'Tod klein: Gusseisen bricht, kurzes Dampfzischen',
  variants: 4,
  tags: ['varkan', 'explosion', 'tod', 'MS5'],
  render({ rng }) {
    const p = rng.jitter(0.07);
    const dur = 1.5;
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.08, freq: 1200 * p, q: 0.7, t60: 0.03, drive: 6 }), db: -3 },
        { sig: boom({ from: 150 * p, to: 45 * p, sweepS: 0.08, t60: 0.32 * rng.jitter(0.15), durS: 0.6, drive: 3 }), db: 0 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.5, t60: 0.3, lpFrom: 2200, lpTo: 200 }), db: -3 },
        { sig: ironBreak({ rng: rng.fork('guss'), count: 4, fLo: 380, fHi: 1300, spreadS: 0.07, t60: 0.12, durS: 0.5 }), db: -3, at: 0.005 },
        { sig: debris({ rng: rng.fork('truemmer'), durS: dur, fromS: 0.1, toS: 0.9, count: 10, fLo: 900, fHi: 3200, t60: 0.035, bounce: 0.5, fallDb: 12 }), db: -14 },
        { sig: steam({ rng: rng.fork('dampf'), durS: 1.35, attackS: 0.05, t60: 0.9 * rng.jitter(0.2), hp: 3000, flutter: 0.45 }), db: -12, at: 0.06 },
      ],
      dur,
    );
    return finish(room(highpass(shape(m, { kind: 'tanh', drive: 1.3 }), 30, 0.7, 2), { t60: 0.45, wet: 0.12, seed: 321 }), dur, 0.3);
  },
});
