// UI-Klick (Buttons, Menüs, Build-Palette). Neutral, fraktionsübergreifend: kurzer, heller Relais-Klick.
// Stereo mit minimaler Breite, damit er im Kopfhörer nicht „im Kopf klebt".
import { decay, defineSfx, highpass, mixMono, mul, noise, osc, pan, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:ui_click',
  category: 'ui',
  description: 'UI-Klick: kurzer heller Relais-Klick',
  variants: 3,
  tags: ['ui', 'MS5'],
  render({ rng, variant }) {
    const dur = 0.06;
    // Varianten: eigene Relais-Tonhöhe (Blip und Gehäuse), damit Klickserien nicht maschinengewehrartig klingen.
    const blip = mul(osc('sine', [2100, 1820, 2420][variant % 3]! * rng.jitter(0.02), dur), decay([0.018, 0.014, 0.022][variant % 3]!, dur, 0.0003));
    const tickNoise = highpass(mul(noise('white', dur, rng.fork('n')), decay(0.006, dur, 0.0001)), 4000, 0.7, 2);
    const body = mul(osc('triangle', [520, 640, 450][variant % 3]! * rng.jitter(0.03), dur), decay(0.012, dur, 0.0005));
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
