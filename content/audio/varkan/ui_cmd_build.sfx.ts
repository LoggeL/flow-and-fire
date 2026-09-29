// Bauauftrag platziert (faction.md §8.2): Kellen-Klirren. Zwei bis drei helle, kurze Anschläge einer
// Stahlkelle am Gießtiegel (Plattenmoden, hohes f0), leicht versetzt im Stereobild.
import { PLATE_PARTIALS, clang, defineSfx, highpass, lowpass, mix, pan, width, type Layer, type Stereo } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:ui_cmd_build',
  category: 'ui',
  description: 'Bauauftrag: Kellen-Klirren',
  variants: 3,
  tags: ['varkan', 'ui', 'befehl', 'MS6'],
  render({ rng, variant }) {
    const dur = 0.36;
    const p = rng.jitter(0.04);
    const n = variant === 1 ? 3 : 2;
    const layers: Layer[] = [];
    let t = 0;
    for (let k = 0; k < n; k++) {
      const f = (k === 0 ? 1550 : k === 1 ? 1980 : 1760) * p * rng.jitter(0.02);
      const c = clang({ f0: f, rng: rng.fork('c' + k), durS: 0.25, decayScale: 0.26, partials: PLATE_PARTIALS, strike: 0.6, pitchDrop: 0.004 });
      layers.push({ sig: pan(lowpass(highpass(c, 600, 0.7, 2), 7000, 0.7, 1), (k % 2 === 0 ? -1 : 1) * rng.range(0.05, 0.15)), db: k === 0 ? 0 : -3 - 2 * k, at: t });
      t += rng.range(0.05, 0.075);
    }
    return width(mix(layers, dur) as Stereo, 1.1);
  },
});
