// Kelle (T1-Artillerie), Waffe core:wpn_slag_mortar_t1 (Schlackenmörser, 100 Schaden, ballistisch, 9 s).
// Artillerie = „Schwapp + Wumm“ (faction.md §8.2): Die Kelle schwingt die flüssige Schlacke an (Schwapp), dann
// stößt der Mörser sie aus (Wumm). Artillerie liegt im Tiefband (§8.3), deshalb nur Hochpass 40 Hz.
//
// Schichten: slosh (Formant 180→900 Hz, Blubbern) · mortarWumm 120→45 Hz mit Rohr-Plopp ≈ 150 Hz, 90 ms nach dem
// Schwapp · Nach-Schwapp der Kelle (leiser, dunkler) · Glut-Zischen · kleiner Raum.
import { defineSfx, highpass, mixMono, room, shape, sizzle } from '../../../tools/sfx/src/index.ts';
import { mortarWumm, slosh } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_slag_mortar_t1_fire',
  category: 'weapon',
  description: 'Kelle (T1-Artillerie): Schlackenmörser, Schwapp der Kelle + Wumm des Mörsers',
  variants: 4,
  tags: ['varkan', 'artillerie', 'core:wpn_slag_mortar_t1', 'MS5'],
  render({ rng }) {
    const p = rng.jitter(0.04);
    const dur = 1.5;
    const wAt = 0.085 + rng.range(0, 0.02);
    const layers = mixMono(
      [
        { sig: slosh({ rng: rng.fork('slosh'), durS: 0.32, fLow: 180 * p, fHigh: 900 * p, peakS: 0.07, bubble: 0.55 }), db: -3 },
        { sig: mortarWumm({ rng: rng.fork('wumm'), from: 120 * p, to: 45 * p, t60: 0.42, tube: 150 * p, crackFreq: 900 * p, durS: 0.7 }), db: 0, at: wAt },
        { sig: slosh({ rng: rng.fork('after'), durS: 0.45, fLow: 140 * p, fHigh: 520 * p, peakS: 0.12, bubble: 0.8 }), db: -11, at: wAt + 0.08 },
        { sig: sizzle({ rng: rng.fork('ember'), durS: 0.9, t60: 0.7, hp: 3000, density: 300, hiss: 0.5 }), db: -21, at: wAt + 0.02 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.5 }), 40, 0.7, 2), { t60: 0.55, wet: 0.16, seed: 121, darkHz: 800 });
  },
});
