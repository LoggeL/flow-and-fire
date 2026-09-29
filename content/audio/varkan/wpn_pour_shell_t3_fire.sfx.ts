// Pfanne (T3-Artillerie, mobil), Waffe core:wpn_pour_shell_t3 (Gießgranate, 700 Schaden, 10 s).
// Tiefes Schwapp + Wumm wie die Kelle, aber eine Oktave schwerer, danach das Klirren der Gießpfanne: zwei bis drei
// helle Kellen-Schläge (Platten-Moden), wenn die Pfanne zurück in die Halterung schlägt.
import { defineSfx, highpass, mixMono, room, shape, sizzle } from '../../../tools/sfx/src/index.ts';
import { addAt, castClack, mortarWumm, slosh } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_pour_shell_t3_fire',
  category: 'weapon',
  description: 'Pfanne (T3-Artillerie): Gießgranate, tiefes Schwapp + Wumm, danach Kellen-Klirren',
  variants: 3,
  tags: ['varkan', 'artillerie', 'core:wpn_pour_shell_t3', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.035);
    const dur = 2.2;
    const wAt = 0.11 + rng.range(0, 0.02);
    // Kellen-Klirren: 2–3 metallische Schläge, der erste am lautesten.
    const clink = new Float32Array(Math.round(0.6 * 48000));
    const r = rng.fork('clink');
    const n = r.int(2, 3);
    let t = 0;
    for (let k = 0; k < n; k++) {
      addAt(clink, castClack(1650 * p * r.jitter(0.06), r, 0.5, 0.35), t, [1, 0.55, 0.35][k] ?? 0.3);
      t += r.range(0.06, 0.11);
    }
    const layers = mixMono(
      [
        { sig: slosh({ rng: rng.fork('slosh'), durS: 0.45, fLow: 120 * p, fHigh: 600 * p, peakS: 0.1, bubble: 0.6 }), db: -3 },
        { sig: mortarWumm({ rng: rng.fork('wumm'), from: 85 * p, to: 32 * p, t60: 0.65, tube: 95 * p, crackFreq: 650 * p, durS: 1.0 }), db: 0, at: wAt },
        { sig: clink, db: -15, at: wAt + 0.28 + rng.range(0, 0.04) },
        { sig: slosh({ rng: rng.fork('after'), durS: 0.6, fLow: 110 * p, fHigh: 420 * p, peakS: 0.15, bubble: 0.9 }), db: -12, at: wAt + 0.12 },
        { sig: sizzle({ rng: rng.fork('ember'), durS: 1.2, t60: 0.9, hp: 2800, density: 300, hiss: 0.5 }), db: -22, at: wAt + 0.03 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.6 }), 30, 0.7, 2), { t60: 0.9, wet: 0.2, seed: 123, darkHz: 750 });
  },
});
