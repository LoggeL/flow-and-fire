// Lotbruch: Tod des Kommandanten (Vogt). faction.md §8.2: „tiefer Glockenschlag, Unterdruck-Sog,
// Druckwelle, danach 2 s Stille-Ducking mit nachglühendem Knistern". Ablauf:
//   0,00 s  tiefer Glockenschlag, Prime A2 = 110 Hz (Flow-Grundton), Summton 55 Hz
//           (bis MS9 im Sound selbst, danach übernimmt varkan:sig_bell_deep)
//   0,05 s  Unterdruck-Sog: anschwellendes Rauschen mit sich öffnendem Band + steigender Unterton
//   ~0,85 s Druckwelle: harter Knall, Tiefbass-Wumm 70→24 Hz, Erdstoß, Grollen, Gussbruch
//   ~2,6 s  fast Stille (Engine duckt alles andere 2 s), nur nachglühendes Knistern und Glockenrest
import { BELL_PARTIALS, boom, clang, crack, defineSfx, envelope, highpass, lowpass, mixMono, mul, osc, room, shape, sizzle, sweep, thump } from '../../../tools/sfx/src/index.ts';
import { finish, gravel, ironBreak, rumble, suck } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:exp_commander',
  category: 'explosion',
  description: 'Lotbruch (Kommandant): Glockenschlag, Sog, Druckwelle mit Tiefbass, nachglühendes Knistern',
  variants: 1,
  tags: ['varkan', 'explosion', 'kommandant', 'lotbruch', 'MS5'],
  render({ rng }) {
    const dur = 5.0;
    const tS = 0.85; // Einsatz der Druckwelle
    const sogD = tS - 0.05;
    const bell = clang({ f0: 110, rng: rng.fork('glocke'), durS: 4.8, decayScale: 0.9, partials: BELL_PARTIALS, strike: 0.5, pitchDrop: 0.004 });
    const sub = mul(osc('sine', sweep(28, 62, sogD, sogD), sogD), envelope([[0, 0], [sogD * 0.95, 1, 2], [sogD, 0, 'lin']], sogD));
    const ember = sizzle({ rng: rng.fork('glut'), durS: 2.6, t60: 4.0, hp: 2500, density: 90, hiss: 0.15 });
    const emberEnv = envelope([[0, 0], [0.6, 1, 'lin'], [2.4, 0.4, 'lin'], [2.6, 0, 'lin']], 2.6);
    const m = mixMono(
      [
        { sig: lowpass(bell, 3000, 0.7, 1), db: -3 },
        { sig: suck(rng.fork('sog'), sogD, 120, 2600), db: -9, at: 0.05 },
        { sig: sub, db: -8, at: 0.05 },
        { sig: crack({ rng: rng.fork('knall'), durS: 0.2, freq: 700, q: 0.6, t60: 0.08, drive: 8 }), db: -2, at: tS },
        { sig: boom({ from: 70, to: 24, sweepS: 0.25, t60: 1.3, durS: 2.4, drive: 3.5 }), db: 0, at: tS },
        { sig: thump({ rng: rng.fork('stoss'), durS: 1.4, t60: 1.0, lpFrom: 2500, lpTo: 90, color: 'brown' }), db: -2, at: tS },
        { sig: rumble(rng.fork('grollen'), 2.4, 90, 1.6, 0.03), db: -4, at: tS },
        { sig: ironBreak({ rng: rng.fork('guss'), count: 10, fLo: 180, fHi: 800, spreadS: 0.25, t60: 0.25, durS: 0.9 }), db: -8, at: tS + 0.01 },
        { sig: gravel({ rng: rng.fork('kies'), durS: 1.8, fromS: 0.1, toS: 1.6, density: 400, lp: 2500, hp: 300, grainS: 0.002 }), db: -18, at: tS },
        { sig: mul(ember, emberEnv), db: -24, at: 2.3 },
      ],
      dur,
    );
    return finish(room(highpass(shape(m, { kind: 'tanh', drive: 1.25 }), 20, 0.7, 2), { t60: 1.2, wet: 0.14, seed: 324, darkHz: 700 }), dur, 0.8);
  },
});
