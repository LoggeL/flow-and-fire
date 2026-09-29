// Stichel (T1-Bot), Waffe core:wpn_mg_t1 (Schnellfeuer-MG, 7 Schaden, 0,3 s).
// Alias core:wpn_spark_mg_t1 (Funke, playbackRate 1,2, −3 dB).
// Kurzer, trockener Metallschlag ohne Glocke: heller Mündungsknall, Guss-Klack mit sehr kurzen Platten-Moden,
// kleiner Luftstoß, Verschluss-Tick. Fast kein Raum. 6 Varianten, weil er sehr oft hintereinander spielt.
import { crack, defineSfx, highpass, mixMono, room, shape, thump, tick } from '../../../tools/sfx/src/index.ts';
import { castClack } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_mg_t1_fire',
  category: 'weapon',
  description: 'Stichel (T1-Bot): Schnellfeuer-MG, kurzer trockener Metallschlag ohne Glocke',
  variants: 6,
  tags: ['varkan', 'direktfeuer', 'core:wpn_mg_t1', 'core:wpn_spark_mg_t1', 'MS5'],
  render({ rng }) {
    const p = rng.jitter(0.05);
    const dur = 0.3;
    const layers = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.05, freq: 2600 * p, q: 0.9, t60: 0.018, drive: 5 }), db: 0 },
        { sig: castClack(1250 * p * rng.jitter(0.04), rng.fork('clack'), 0.07, 0.08), db: -5, at: 0.001 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.16, t60: 0.09, lpFrom: 3200, lpTo: 500 }), db: -6 },
        { sig: tick(3100 * p, rng.fork('bolt'), 0.012), db: -20, at: 0.035 + rng.range(0, 0.012) },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 2.2 }), 160, 0.7, 2), { t60: 0.25, wet: 0.08, seed: 111 });
  },
});
