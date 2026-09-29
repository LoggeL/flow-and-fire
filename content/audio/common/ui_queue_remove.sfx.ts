// Aus der Bau-Queue entfernt: kurzer fallender Tick (Spiegel von ui_queue_add, etwas dumpfer).
import { decay, defineSfx, highpass, mixMono, mul, noise, osc, pan, sweep, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:ui_queue_remove',
  category: 'ui',
  description: 'Queue: kurzer fallender Tick',
  variants: 2,
  tags: ['ui', 'MS6'],
  render({ rng, sr }) {
    const d = 0.08;
    const f = 1600 * rng.jitter(0.04);
    const tone = mul(osc('triangle', sweep(f, f * 0.66, 0.04, d, 'exp', sr), d), decay(0.065, d, 0.001, sr));
    const click = mul(highpass(noise('white', 0.006, rng.fork('c')), 3000, 0.7, 2), decay(0.004, 0.006, 0.0001, sr));
    const m = mixMono([{ sig: tone }, { sig: click, db: -10 }], 0.1);
    return width(pan(highpass(m, 300, 0.7, 2), rng.range(-0.04, 0.04)), 1.2);
  },
});
