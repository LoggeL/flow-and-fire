// Bewegungsbefehl (faction.md §8.2): Ventil-Zisch mit fallender Tonhöhe. Kurzer Ventil-Klick, danach
// resonantes Zischen, dessen Resonanz von ~3,4 kHz auf ~1,3 kHz fällt, plus leiser Ton, der mitfällt.
import { bandpass, decay, defineSfx, envelope, highpass, mixMono, mul, noise, osc, pan, tick, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:ui_cmd_move',
  category: 'ui',
  description: 'Bewegungsbefehl: Ventil-Zisch mit fallender Tonhöhe',
  variants: 3,
  tags: ['varkan', 'ui', 'befehl', 'MS5'],
  render({ rng, sr }) {
    const dur = 0.34;
    const p = rng.jitter(0.05);
    const len = 0.3;
    const fall = envelope([[0, 3400 * p], [len, 1300 * p, 'exp']], len, sr);
    const env = envelope([[0, 0], [0.012, 1, 'lin'], [0.08, 0.75, 'lin'], [len, 0, 1.6]], len, sr);
    const hiss = mul(bandpass(noise('white', len, rng.fork('hiss')), fall, 5), env);
    const air = mul(highpass(noise('pink', len, rng.fork('air')), 2500, 0.7, 1), env);
    const tone = mul(osc('sine', mul(fall, 0.5), len), mul(env, decay(0.25, len, 0.005, sr)));
    const m = mixMono(
      [
        { sig: tick(2600 * p, rng.fork('valve'), 0.015), db: -10 },
        { sig: hiss, db: 0, at: 0.005 },
        { sig: air, db: -16, at: 0.005 },
        { sig: tone, db: -20, at: 0.005 },
      ],
      dur,
    );
    return width(pan(highpass(m, 400, 0.7, 2), rng.range(-0.06, 0.06)), 1.3);
  },
});
