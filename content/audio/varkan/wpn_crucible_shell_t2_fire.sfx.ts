// Tiegel (T2-Artilleriestellung), Waffe core:wpn_crucible_shell_t2 (Tiegelgranate, 2 100 Schaden, 21 s).
// Schwerer Schwapp (ein ganzer Tiegel kippt) + tiefer Mörserknall mit Hall: die Stellung steht, der Knall rollt
// über die Halle. Tiefer und massiger als die Kelle, deutlich mehr Raum (T60 1,3 s).
//
// Schichten: großer slosh (Formant 130→650 Hz, zähes Blubbern) · mortarWumm 95→34 Hz, Rohr 105 Hz · zweiter,
// tiefer Nach-Wumm (Rohr-Rückstoß) · Guss-Tick des Verschlusses · Glut-Zischen · großer Raum.
import { defineSfx, highpass, mixMono, room, shape, sizzle, tick } from '../../../tools/sfx/src/index.ts';
import { castClack, mortarWumm, slosh } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_crucible_shell_t2_fire',
  category: 'weapon',
  description: 'Tiegel (T2-Artillerie): Tiegelgranate, schwerer Schwapp + tiefer Mörserknall mit Hall',
  variants: 3,
  tags: ['varkan', 'artillerie', 'core:wpn_crucible_shell_t2', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.035);
    const dur = 2.3;
    const wAt = 0.13 + rng.range(0, 0.025);
    const layers = mixMono(
      [
        { sig: slosh({ rng: rng.fork('slosh'), durS: 0.5, fLow: 130 * p, fHigh: 650 * p, peakS: 0.11, bubble: 0.5 }), db: -4 },
        { sig: mortarWumm({ rng: rng.fork('wumm'), from: 95 * p, to: 34 * p, t60: 0.75, tube: 105 * p, crackFreq: 700 * p, durS: 1.1 }), db: 0, at: wAt },
        { sig: mortarWumm({ rng: rng.fork('recoil'), from: 70 * p, to: 30 * p, t60: 0.4, tube: 80 * p, crackFreq: 400 * p, durS: 0.6 }), db: -9, at: wAt + 0.16 },
        { sig: castClack(430 * p, rng.fork('breech'), 0.25, 0.25), db: -17, at: wAt + 0.24 },
        { sig: tick(1900 * p, rng.fork('latch'), 0.025), db: -22, at: wAt + 0.26 },
        { sig: sizzle({ rng: rng.fork('ember'), durS: 1.4, t60: 1.1, hp: 2600, density: 350, hiss: 0.5 }), db: -22, at: wAt + 0.03 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.6 }), 30, 0.7, 2), { t60: 1.3, wet: 0.26, seed: 122, darkHz: 700, predelayS: 0.018 });
  },
});
