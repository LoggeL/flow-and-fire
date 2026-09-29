// Turmfalke (T1-Luft), Waffe core:wpn_kestrel_gun_t1 (Zwillings-Luftkanone); Alias core:wpn_magpie_gun_t2
// (Elster, playbackRate 0,9).
// Kurz und trocken, leicht metallisch: tiefer als das MG, mit etwas Körper (kurzer Wumm) und einem winzigen
// Guss-Nachklingen (Platten-Moden um 900 Hz). Kein Raum: die Flieger sind in der Luft, nicht in der Halle.
import { boom, crack, defineSfx, highpass, mixMono, shape, thump } from '../../../tools/sfx/src/index.ts';
import { castClack } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_air_gun_fire',
  category: 'weapon',
  description: 'Turmfalke/Elster: Luftkanone, kurz und trocken, leicht metallisch',
  variants: 4,
  tags: ['varkan', 'direktfeuer', 'luft', 'core:wpn_kestrel_gun_t1', 'core:wpn_magpie_gun_t2', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.04);
    const dur = 0.36;
    const layers = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.09, freq: 1900 * p, q: 0.6, t60: 0.04, drive: 6 }), db: 0 },
        { sig: boom({ from: 280 * p, to: 150 * p, sweepS: 0.03, t60: 0.06, durS: 0.1, drive: 2.5 }), db: -16 },
        { sig: castClack(880 * p * rng.jitter(0.03), rng.fork('ring'), 0.22, 0.25), db: -12, at: 0.003 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.25, t60: 0.14, lpFrom: 3000, lpTo: 500 }), db: -6 },
      ],
      dur,
    );
    return highpass(shape(layers, { kind: 'tanh', drive: 1.8 }), 180, 0.7, 2);
  },
});
