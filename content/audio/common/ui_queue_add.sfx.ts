// Einheit in die Bau-Queue: kurzer steigender Tick (Gegenstück zu ui_queue_remove).
import { decay, defineSfx, highpass, mixMono, mul, noise, osc, pan, sweep, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:ui_queue_add',
  category: 'ui',
  description: 'Queue: kurzer steigender Tick',
  variants: 3,
  tags: ['ui', 'MS6'],
  render({ rng, variant, sr }) {
    const d = 0.075;
    // Varianten: Grundton und Intervall (Quarte, kleine Terz, Quinte) je eigen, Richtung bleibt steigend.
    const f = [1150, 1030, 1270][variant % 3]! * rng.jitter(0.02);
    const up = [1.45, 1.26, 1.55][variant % 3]!;
    const tone = mul(osc(variant === 1 ? 'sine' : 'triangle', sweep(f, f * up, [0.035, 0.025, 0.045][variant % 3]!, d, 'exp', sr), d), decay([0.06, 0.05, 0.07][variant % 3]!, d, 0.001, sr));
    const click = mul(highpass(noise('white', 0.006, rng.fork('c')), 4000, 0.7, 2), decay(0.004, 0.006, 0.0001, sr));
    const m = mixMono([{ sig: tone }, { sig: click, db: -8 }], 0.1);
    return width(pan(highpass(m, 300, 0.7, 2), rng.range(-0.04, 0.04)), 1.2);
  },
});
