// Krähe (T2-Gunship), Waffe core:wpn_crow_gun_t2 („Bauch-Glocke“, 16 Schaden, 0,3 s).
// Kleiner, gedämpfter Glockenhammer: hohe kleine Glocke (f0 ≈ 700 Hz) mit sehr kurzem Nachklang, durch einen
// schließenden Tiefpass gedämpft („im Bauch“), weicher Knall. Kein Raum (Luft).
import { boom, clang, crack, defineSfx, highpass, lowpass, mixMono, shape, sweep } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:wpn_crow_gun_t2_fire',
  category: 'weapon',
  description: 'Krähe (T2-Gunship): Bauch-Glocke, kleiner gedämpfter Glockenhammer',
  variants: 4,
  tags: ['varkan', 'direktfeuer', 'luft', 'core:wpn_crow_gun_t2', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.035);
    const dur = 0.5;
    const bell = clang({ f0: 700 * p, rng: rng.fork('bell'), durS: 0.45, decayScale: 0.1 * rng.jitter(0.1), strike: 0.35 });
    const layers = mixMono(
      [
        { sig: lowpass(crack({ rng: rng.fork('crack'), durS: 0.07, freq: 1500 * p, q: 0.7, t60: 0.028, drive: 3 }), 2600, 0.7, 1), db: -2 },
        { sig: lowpass(bell, sweep(3800, 1600, 0.05, 0.45), 0.8, 2), db: 0, at: 0.002 },
        { sig: boom({ from: 200 * p, to: 110 * p, sweepS: 0.04, t60: 0.1, durS: 0.16, drive: 2.5 }), db: -9 },
      ],
      dur,
    );
    return highpass(shape(layers, { kind: 'tanh', drive: 1.3 }), 110, 0.7, 2);
  },
});
