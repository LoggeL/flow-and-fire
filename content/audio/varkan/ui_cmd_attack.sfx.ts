// Angriffsbefehl (faction.md §8.2): trockener Hammerschlag. Stahlhammer auf Gussblock: kurzer,
// dichter Plattenklang, harte Transiente, dumpfer Körper, kein Hall.
import { PLATE_PARTIALS, clang, crack, defineSfx, highpass, mixMono, pan, shape, thump, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:ui_cmd_attack',
  category: 'ui',
  description: 'Angriffsbefehl: trockener Hammerschlag',
  variants: 3,
  tags: ['varkan', 'ui', 'befehl', 'MS6'],
  render({ rng }) {
    const dur = 0.25;
    const p = rng.jitter(0.05);
    const m = mixMono(
      [
        { sig: clang({ f0: 640 * p, rng: rng.fork('plate'), durS: 0.22, decayScale: 0.16, partials: PLATE_PARTIALS, strike: 0.8, pitchDrop: 0.015 }), db: 0 },
        { sig: crack({ rng: rng.fork('crack'), durS: 0.03, freq: 2600 * p, t60: 0.012, drive: 3 }), db: -5 },
        { sig: thump({ rng: rng.fork('body'), durS: 0.12, t60: 0.06, lpFrom: 1800, lpTo: 250 }), db: -6 },
      ],
      dur,
    );
    return width(pan(highpass(shape(m, { kind: 'tanh', drive: 1.6 }), 220, 0.7, 2), rng.range(-0.05, 0.05)), 1.15);
  },
});
