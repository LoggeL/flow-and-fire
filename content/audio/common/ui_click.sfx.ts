// UI-Klick (Buttons, Menüs, Build-Palette). Neutral, fraktionsübergreifend: kurzer, heller Relais-Klick.
// Stereo mit minimaler Breite, damit er im Kopfhörer nicht „im Kopf klebt".
import { decay, defineSfx, highpass, mixMono, mul, noise, osc, pan, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:ui_click',
  category: 'ui',
  description: 'UI-Klick: kurzer heller Relais-Klick',
  variants: 3,
  tags: ['ui', 'MS5'],
  render({ rng }) {
    const dur = 0.06;
    const blip = mul(osc('sine', 2100 * rng.jitter(0.05), dur), decay(0.018, dur, 0.0003));
    const tickNoise = highpass(mul(noise('white', dur, rng.fork('n')), decay(0.006, dur, 0.0001)), 4000, 0.7, 2);
    const body = mul(osc('triangle', 520 * rng.jitter(0.05), dur), decay(0.012, dur, 0.0005));
    const m = mixMono(
      [
        { sig: blip, db: -3 },
        { sig: tickNoise, db: -6 },
        { sig: body, db: -12 },
      ],
      dur,
    );
    return width(pan(m, rng.range(-0.05, 0.05)), 1.2);
  },
});
