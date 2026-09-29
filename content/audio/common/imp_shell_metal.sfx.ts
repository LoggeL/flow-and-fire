// Einschlag: Kanonengranate trifft eine Einheit (faction.md §8.2 „Treffer: gedämpfter Metall-Klong").
// Schichten: kurzer Knall, dicker Guss-Plattenklang (PLATE, f0 ≈ 300 Hz, Tiefpass = gedämpft), Luftstoß,
// kleiner Wumm, ein paar Funken. Varianten streuen Tonhöhe, Plattenmoden und Nachklang.
import { PLATE_PARTIALS, boom, clang, crack, defineSfx, highpass, lowpass, mixMono, room, shape, thump } from '../../../tools/sfx/src/index.ts';
import { debris, finish } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_shell_metal',
  category: 'impact',
  description: 'Kanonentreffer auf Einheit: gedämpfter Metall-Klong mit kurzem Knall und Funken',
  variants: 4,
  tags: ['einschlag', 'MS5'],
  render({ rng }) {
    const p = rng.jitter(0.07);
    const dur = 0.8;
    const body = clang({ f0: 300 * p, rng: rng.fork('clang'), durS: 0.7, decayScale: 0.45 * rng.jitter(0.2), partials: PLATE_PARTIALS, strike: 0.35, pitchDrop: 0.02 });
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.06, freq: 1500 * p, q: 0.8, t60: 0.02, drive: 4 }), db: -3 },
        { sig: lowpass(body, 2600 * rng.jitter(0.1), 0.7, 2), db: 0, at: 0.001 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.35, t60: 0.16, lpFrom: 1800, lpTo: 220 }), db: -5 },
        { sig: boom({ from: 170 * p, to: 80 * p, sweepS: 0.04, t60: 0.12, durS: 0.25, drive: 2 }), db: -9 },
        { sig: debris({ rng: rng.fork('sparks'), durS: 0.4, fromS: 0.02, toS: 0.25, count: 5, fLo: 2500, fHi: 5500, t60: 0.02, fallDb: 8, bounce: 0 }), db: -18 },
      ],
      dur,
    );
    return finish(room(highpass(shape(m, { kind: 'tanh', drive: 1.3 }), 70, 0.7, 2), { t60: 0.35, wet: 0.12, seed: 211 }), 0.8, 0.15);
  },
});
