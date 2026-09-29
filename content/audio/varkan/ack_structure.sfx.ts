// Quittung Gebäude (Werke, Eco, Verteidigung ausgewählt): dumpfer Guss-Klang. Schwerer Gussblock wird
// mit dem Hammerstiel angeschlagen: tiefe Plattenmoden (~240 Hz), gedämpft, kurzer Körper, kaum Hall.
import { PLATE_PARTIALS, clang, defineSfx, highpass, lowpass, mixMono, room, thump } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:ack_structure',
  category: 'ack',
  description: 'Quittung Gebäude: dumpfer Guss-Klang',
  variants: 2,
  tags: ['varkan', 'ack', 'gebaeude', 'MS9'],
  render({ rng, variant }) {
    const dur = 0.38;
    const f0 = (variant === 0 ? 240 : 212) * rng.jitter(0.01);
    const body = lowpass(clang({ f0, rng: rng.fork('body'), durS: 0.36, decayScale: 0.45, partials: PLATE_PARTIALS, strike: 0.3, pitchDrop: 0.01 }), 2200, 0.7, 2);
    const knock = thump({ rng: rng.fork('knock'), durS: 0.08, t60: 0.04, lpFrom: 2500, lpTo: 400 });
    const m = mixMono(
      [
        { sig: body, db: 0 },
        { sig: knock, db: -8 },
      ],
      dur,
    );
    return room(highpass(m, 130, 0.7, 2), { t60: 0.3, wet: 0.1, seed: 17 });
  },
});
