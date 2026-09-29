// Allgemeiner Befehl (Assist, Guard, Patrol, Reclaim-Befehl): kurzer Ventil-Klick. Metallischer
// Doppel-Klick (Ventil öffnet/schließt) mit einem Hauch Druckluft dazwischen.
import { bandpass, defineSfx, envelope, highpass, mixMono, mul, noise, pan, tick, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:ui_cmd_generic',
  category: 'ui',
  description: 'Allgemeiner Befehl: kurzer Ventil-Klick',
  variants: 3,
  tags: ['varkan', 'ui', 'befehl', 'MS6'],
  render({ rng, sr }) {
    const dur = 0.16;
    const p = rng.jitter(0.05);
    const gap = rng.range(0.045, 0.06);
    const puff = mul(bandpass(noise('white', 0.06, rng.fork('puff')), 3000 * p, 1.5), envelope([[0, 0], [0.008, 1, 'lin'], [0.06, 0, 2]], 0.06, sr));
    const m = mixMono(
      [
        { sig: tick(1900 * p, rng.fork('open'), 0.02), db: 0 },
        { sig: puff, db: -14, at: 0.004 },
        { sig: tick(1450 * p, rng.fork('close'), 0.018), db: -5, at: gap },
      ],
      dur,
    );
    return width(pan(highpass(m, 350, 0.7, 2), rng.range(-0.05, 0.05)), 1.2);
  },
});
