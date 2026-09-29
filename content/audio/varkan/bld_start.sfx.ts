// Baustelle gesetzt: Kellen-Klirren (zwei helle Guss-Anschläge) und Gussbeginn (Strahl schwillt an,
// erste Blasen, Glut-Zischen). Danach übernimmt der Bau-Loop (bld_pour_loop).
import { PLATE_PARTIALS, bandpass, clang, defineSfx, envelope, highpass, mixMono, mul, noise, sizzle } from '../../../tools/sfx/src/index.ts';
import { bubble, logRange, poissonTimes, scatter } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:bld_start',
  category: 'build',
  description: 'Baustelle gesetzt: Kellen-Klirren und Gussbeginn',
  variants: 3,
  tags: ['varkan', 'bau', 'MS9'],
  render({ rng, sr }) {
    const dur = 0.6;
    const p = rng.jitter(0.05);
    const gap = rng.range(0.055, 0.085);
    const clink = (f: number, k: string): Float32Array => clang({ f0: f, rng: rng.fork(k), durS: 0.3, decayScale: 0.22, partials: PLATE_PARTIALS, strike: 0.7, pitchDrop: 0.004 });
    const streamEnv = envelope([[0, 0], [0.18, 1, 0.7], [0.42, 0.7, 'lin'], [dur, 0, 1.5]], dur - 0.08, sr);
    const stream = mul(bandpass(noise('pink', dur - 0.08, rng.fork('stream')), envelope([[0, 450 * p], [0.3, 750 * p, 'exp']], dur - 0.08, sr), 1.3), streamEnv);
    const br = rng.fork('bub');
    const bubbles = scatter(
      dur,
      poissonTimes(br, 30, 0.42).map((t) => ({ t: 0.12 + t, sig: bubble(logRange(br, 300, 1000) * p, br, { rise: 0.12, viscosity: 1.8, sr }), g: Math.pow(br.next(), 1.5) * Math.min(1, t / 0.15) })),
      sr,
    );
    const m = mixMono(
      [
        { sig: clink(2150 * p, 'a'), db: -3 },
        { sig: clink(2650 * p * rng.jitter(0.03), 'b'), db: -7, at: gap },
        { sig: stream, db: -9, at: 0.08 },
        { sig: bubbles, db: -9, at: 0.08 },
        { sig: sizzle({ rng: rng.fork('sz'), durS: 0.45, t60: 0.5, hp: 4000, density: 200, hiss: 0.5 }), db: -24, at: 0.12 },
      ],
      dur,
    );
    return highpass(m, 120, 0.7, 2);
  },
});
