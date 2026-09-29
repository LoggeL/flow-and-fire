// Tod groß (T3 mobil, Glutkessel, Werke II/III, Hochofen). faction.md §8.2: „Strukturtod: Kesselbersten
// mit langem Zisch-Ausklang". Schichten: sehr tiefer Wumm (90→28 Hz), Kesselhülle (große Gussplatte
// f0 ≈ 70 Hz + hohle Comb-Resonanz), Druckstoß, 9 Bruchstücke, Metall-Stöhnen, langer Trümmerregen,
// Grollen und ein langer, flatternder Dampfstrahl mit leisem Ventil-Pfeifen.
import { PLATE_PARTIALS, bandpass, boom, clang, comb, crack, defineSfx, envelope, highpass, lfo, lowpass, mixMono, mul, osc, room, shape, sweep, thump } from '../../../tools/sfx/src/index.ts';
import { debris, finish, ironBreak, rumble, steam } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:exp_large',
  category: 'explosion',
  description: 'Tod groß: Kesselbersten, langer Zisch-Ausklang',
  variants: 3,
  tags: ['varkan', 'explosion', 'tod', 'struktur', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.06);
    const dur = 4.0;
    const push = thump({ rng: rng.fork('push'), durS: 1.4, t60: 0.7, lpFrom: 3500, lpTo: 200 });
    const shell = lowpass(clang({ f0: 70 * p, rng: rng.fork('kessel'), durS: 2.0, decayScale: 2.2 * rng.jitter(0.15), partials: PLATE_PARTIALS, strike: 0.3, pitchDrop: 0.03 }), 1800, 0.7, 2);
    const gd = 1.6;
    const groanF = mul(sweep(95 * p, 55 * p, 1.4, gd), lfo(5.5 * rng.jitter(0.2), 0.02, 1, gd));
    const groan = mul(bandpass(osc('saw', groanF, gd), 420 * p, 2), envelope([[0, 0], [0.15, 1, 'lin'], [gd, 0.001, 'exp']], gd));
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.14, freq: 800 * p, q: 0.7, t60: 0.06, drive: 7 }), db: -3 },
        { sig: boom({ from: 90 * p, to: 28 * p, sweepS: 0.15, t60: 1.1, durS: 2.0, drive: 3 }), db: 0 },
        { sig: shell, db: -4, at: 0.004 },
        { sig: comb(push, { freq: 58 * p, feedback: -0.88, damp: 0.3, tailS: 0.6 }), db: -9 },
        { sig: push, db: -2 },
        { sig: ironBreak({ rng: rng.fork('guss'), count: 9, fLo: 200, fHi: 900, spreadS: 0.2, t60: 0.22, durS: 0.8 }), db: -4, at: 0.01 },
        { sig: groan, db: -15, at: 0.25 },
        { sig: debris({ rng: rng.fork('truemmer'), durS: dur, fromS: 0.2, toS: 3.0, count: 40, fLo: 500, fHi: 3000, t60: 0.05, bounce: 0.5, fallDb: 18, skew: 1.5 }), db: -11 },
        { sig: rumble(rng.fork('grollen'), dur, 120, 2.4, 0.05), db: -6 },
        {
          sig: steam({ rng: rng.fork('dampf'), durS: 3.9, attackS: 0.12, t60: 3.4 * rng.jitter(0.1), hp: 2200, flutter: 0.55, whistleHz: 3800 * rng.jitter(0.1), whistleDrop: 0.7, whistleDb: -10 }),
          db: -10,
          at: 0.05,
        },
      ],
      dur,
    );
    return finish(room(highpass(shape(m, { kind: 'tanh', drive: 1.3 }), 25, 0.7, 2), { t60: 1.0, wet: 0.16, seed: 323, darkHz: 800 }), dur, 0.6);
  },
});
