// Vogt (Kommandant), Waffe core:wpn_reeve_tapshot („Abstich“, Overcharge: bis 15 000 Schaden, 3,3 s).
// Der Vogt sticht seinen Glutkern an wie einen Hochofen: erst das Zischen des Glutkerns, das in ~100 ms
// anschwillt, dann ein tiefer Glockenschlag (f0 ≈ 250 Hz, langer Nachklang) mit dem Entladungsknall, danach
// fließt der Glutstrahl fauchend aus und knistert nach. Die „große“ Waffe des Kommandanten: tief, breit, mehr Raum.
//
// Schichten: Glutkern-Zischen (Hochpass-Rauschen, anschwellend) · Entladungsknall (Knall + Wumm 140→38 Hz +
// Luftstoß) · tiefe Glocke · Glutstrahl-Fauchen (Bandpass 1,2 kHz→450 Hz, Knistern) · langes Glut-Knistern · Raum.
import { boom, clang, crack, defineSfx, envelope, highpass, mixMono, mul, noise, room, shape, sizzle, sweep, thump } from '../../../tools/sfx/src/index.ts';
import { roar } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_reeve_tapshot_fire',
  category: 'weapon',
  description: 'Vogt: Abstich (Overcharge) – Glutkern-Zischen, tiefer Glockenschlag, Entladungsknall, Glutstrahl',
  variants: 2,
  tags: ['varkan', 'direktfeuer', 'overcharge', 'core:wpn_reeve_tapshot', 'core:cmd_commander', 'MS6'],
  render({ rng }) {
    const p = rng.jitter(0.025);
    const dur = 2.4;
    const hit = 0.1 + rng.range(0, 0.015);
    const pre = hit + 0.02;
    const coreHiss = mul(highpass(noise('white', pre, rng.fork('core')), sweep(2500, 5200, pre, pre), 0.9, 2), envelope([[0, 0], [hit, 1, 1.8], [pre, 0.3, 'lin']], pre));
    const sd = 1.6;
    const jetEnv = envelope([[0, 0], [0.04, 1, 'lin'], [0.35, 0.55, 'lin'], [sd, 0.0005, 'exp']], sd);
    const jet = roar({ rng: rng.fork('jet'), durS: sd, band: sweep(1200 * p, 450 * p, sd * 0.8, sd), q: 0.8, env: jetEnv, crackle: 900, grit: 0.6 });
    const layers = mixMono(
      [
        { sig: coreHiss, db: -6 },
        { sig: crack({ rng: rng.fork('crack'), durS: 0.14, freq: 1300 * p, q: 0.6, t60: 0.05, drive: 6 }), db: 0, at: hit },
        { sig: boom({ from: 140 * p, to: 38 * p, sweepS: 0.1, t60: 0.6, durS: 0.9, drive: 3.5 }), db: -5, at: hit },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.7, t60: 0.4, lpFrom: 2200, lpTo: 160 }), db: -5, at: hit },
        { sig: clang({ f0: 250 * p, rng: rng.fork('bell'), durS: 2.1, decayScale: 0.55 * rng.jitter(0.08), strike: 0.8 }), db: 1, at: hit + 0.003 },
        { sig: jet, db: -10, at: hit + 0.03 },
        { sig: sizzle({ rng: rng.fork('ember'), durS: 2.0, t60: 1.6, hp: 3000, density: 500, hiss: 0.35 }), db: -18, at: hit + 0.06 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.6 }), 45, 0.7, 2), { t60: 0.9, wet: 0.2, seed: 161, predelayS: 0.01 });
  },
});
