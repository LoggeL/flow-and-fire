// Reclaim fertig (Wrack aufgebraucht): Schlacke-Plopp (große, zähe Blase platzt, dazu eine kleine) und
// danach ein heller Masse-Tick (die Masse wird gutgeschrieben), mit kurzem Nachzischen.
import { decay, defineSfx, highpass, mixMono, mul, noise, osc, sizzle, sweep, tick } from '../../../tools/sfx/src/index.ts';
import { bubble } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:rcl_complete',
  category: 'build',
  description: 'Reclaim fertig: Schlacke-Plopp und heller Masse-Tick',
  variants: 3,
  tags: ['varkan', 'reclaim', 'MS9'],
  render({ rng, variant, sr }) {
    const dur = 0.6;
    // Varianten: Blasengröße (Plopp-Tonhöhe) fest gestaffelt, dazu leichter Zufall.
    const p = [0.88, 1.0, 1.15][variant % 3]! * rng.jitter(0.03);
    const plop = bubble(175 * p, rng.fork('plop'), { rise: 0.14, viscosity: 3.5, sr });
    const burst = mul(highpass(noise('pink', 0.03, rng.fork('burst')), 700, 0.7, 1), decay(0.02, 0.03, 0.0005, sr));
    const small = bubble(390 * p * rng.jitter(0.08), rng.fork('small'), { rise: 0.12, viscosity: 3, sr });
    const tAt = 0.16 + rng.range(0, 0.03);
    const massTick = tick(2450 * rng.jitter(0.03), rng.fork('tick'), 0.025);
    const blip = mul(osc('sine', sweep(1750, 1850, 0.02, 0.07, 'lin', sr), 0.07), decay(0.05, 0.07, 0.001, sr));
    const m = mixMono(
      [
        { sig: plop, db: 0 },
        { sig: burst, db: -12, at: 0.004 },
        { sig: small, db: -8, at: 0.06 + rng.range(0, 0.03) },
        { sig: massTick, db: -5, at: tAt },
        { sig: blip, db: -10, at: tAt + 0.003 },
        { sig: sizzle({ rng: rng.fork('sz'), durS: 0.35, t60: 0.3, hp: 3800, density: 150, hiss: 0.6 }), db: -22, at: 0.02 },
      ],
      dur,
    );
    return highpass(m, 90, 0.7, 2);
  },
});
