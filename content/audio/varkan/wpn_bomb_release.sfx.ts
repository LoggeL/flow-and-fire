// Dohle (T1-Bomber), Waffe core:wpn_slag_bomb_t1 (Schlackenbomben, 4er-Reihe); Alias core:wpn_magpie_bomb_t2
// (Elster, 2er).
// Die Bombenklappe klackt (zwei Guss-Klacks: Riegel auf, Klappe schlägt an), dann der Abwurf-Schwapp: der
// Schlackenbehälter löst sich mit einem kurzen, dumpfen Schwapp und einem Luftzug. Das Fallpfeifen ist ein eigener
// Sound (common:prj_bomb_fall).
import { bandpass, defineSfx, envelope, highpass, mixMono, mul, noise, room, shape, sweep, tick } from '../../../tools/sfx/src/index.ts';
import { castClack, slosh } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_bomb_release',
  category: 'weapon',
  description: 'Dohle/Elster: Bombenklappe klackt, dazu Abwurf-Schwapp',
  variants: 3,
  tags: ['varkan', 'luft', 'bomben', 'core:wpn_slag_bomb_t1', 'core:wpn_magpie_bomb_t2', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.05);
    const dur = 1.0;
    const hatch = rng.range(0.035, 0.05);
    const drop = hatch + rng.range(0.06, 0.09);
    const wd = 0.5;
    const whoosh = mul(bandpass(noise('pink', wd, rng.fork('air')), sweep(1400 * p, 500 * p, wd, wd), 1.2), envelope([[0, 0], [0.08, 1, 'lin'], [wd, 0.0005, 'exp']], wd));
    const layers = mixMono(
      [
        { sig: tick(2600 * p, rng.fork('latch'), 0.02), db: -6 },
        { sig: castClack(540 * p * rng.jitter(0.03), rng.fork('hatch'), 0.35, 0.25), db: 0, at: hatch },
        { sig: castClack(1150 * p, rng.fork('hatch2'), 0.15, 0.1), db: -8, at: hatch + 0.004 },
        { sig: slosh({ rng: rng.fork('slosh'), durS: 0.4, fLow: 170 * p, fHigh: 700 * p, peakS: 0.06, bubble: 0.6 }), db: -2, at: drop },
        { sig: whoosh, db: -9, at: drop + 0.03 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.5 }), 90, 0.7, 2), { t60: 0.3, wet: 0.1, seed: 151 });
  },
});
