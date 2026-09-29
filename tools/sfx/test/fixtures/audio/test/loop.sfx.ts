// Test-Fixture: Stereo-Loop (Ambience-Kategorie) mit Crossfade.
import { defineSfx, lowpass, noise } from '../../../../src/index.ts';

export default defineSfx({
  id: 'test:loop',
  category: 'ambience',
  variants: 1,
  loop: { lengthS: 0.6, crossfadeS: 0.1 },
  render({ rng, durationS }) {
    const d = durationS ?? 0.7;
    return [lowpass(noise('pink', d, rng.fork('l')), 3000), lowpass(noise('pink', d, rng.fork('r')), 3000)];
  },
});
