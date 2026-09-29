// Hochofen (T3-Artilleriestellung), Waffe core:wpn_furnace_shell_t3 (Hochofengranate, 5 500 Schaden, 15 s).
// Sehr tiefer Knall (Wumm 70→26 Hz) und danach das Hochofen-Fauchen: tiefes, flackerndes Feuer-Rauschen
// (Bandpass 250–700 Hz, Flacker-LFO 8–12 Hz), das nach etwa 1,5 s verlischt. Kein Schwapp: der Hochofen schießt
// Glut, keine Kelle. Die schwerste Waffe der Fraktion, aber auf denselben M-max-Pegel normiert.
import { decay, defineSfx, envelope, highpass, lfo, mixMono, mul, room, shape, sizzle, sweep } from '../../../tools/sfx/src/index.ts';
import { mortarWumm, roar } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_furnace_shell_t3_fire',
  category: 'weapon',
  description: 'Hochofen (T3-Artillerie): Hochofengranate, sehr tiefer Knall + Hochofen-Fauchen',
  variants: 2,
  tags: ['varkan', 'artillerie', 'core:wpn_furnace_shell_t3', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.03);
    const dur = 2.4;
    const rd = 1.9;
    const flick = mul(lfo(9 * rng.jitter(0.25), 0.35, 0.65, rd, 'sine'), lfo(2.3 * rng.jitter(0.2), 0.15, 0.85, rd, 'triangle', rng.next()));
    const env = mul(envelope([[0, 0], [0.07, 1, 'lin'], [0.35, 0.7, 'lin'], [rd, 0.0005, 'exp']], rd), flick);
    const furnace = roar({ rng: rng.fork('roar'), durS: rd, band: sweep(700 * p, 260 * p, 1.2, rd), q: 0.8, env, crackle: 400, grit: 0.9 });
    const layers = mixMono(
      [
        { sig: mortarWumm({ rng: rng.fork('wumm'), from: 70 * p, to: 26 * p, t60: 0.9, tube: 75 * p, crackFreq: 480 * p, durS: 1.3 }), db: 0 },
        { sig: mul(furnace, decay(2.2, rd, 0.001)), db: -7, at: 0.03 },
        { sig: sizzle({ rng: rng.fork('ember'), durS: 1.6, t60: 1.3, hp: 2400, density: 420, hiss: 0.4 }), db: -19, at: 0.05 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.8 }), 25, 0.7, 2), { t60: 1.1, wet: 0.22, seed: 124, darkHz: 650, predelayS: 0.015 });
  },
});
