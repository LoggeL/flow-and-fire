// Test-Fixture: kurzer One-Shot mit zwei Varianten (Glockenhammer-Rezept, klein).
import { clang, crack, defineSfx, mixMono } from '../../../../src/index.ts';

export default defineSfx({
  id: 'test:one_shot',
  category: 'weapon',
  variants: 2,
  render({ rng }) {
    return mixMono([{ sig: crack({ rng: rng.fork('c'), durS: 0.05 }), db: -10 }, { sig: clang({ f0: 600, rng: rng.fork('b'), durS: 0.4, decayScale: 0.1 }) }]);
  },
});
