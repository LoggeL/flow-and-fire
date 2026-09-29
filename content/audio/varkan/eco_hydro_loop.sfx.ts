// Dampfquelle (Hydro), nur auf Z0: Dampfzischen mit Blubbern. Breites Zischen (Hochpass-Rauschen,
// langsam atmend), einzelne Dampfstöße, darunter tiefes Blubbern der Quelle und ein leises Grollen.
// Periodisch über 4 s, nahtlos ohne Crossfade.
import { bandpass, defineSfx, envelope, highpass, lowpass, mixMono, mul } from '../../../tools/sfx/src/index.ts';
import { bubble, logRange, period, place, plfo, pnoise, poissonTimes, secondHalf } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:eco_hydro_loop',
  category: 'eco',
  description: 'Dampfquelle (Loop, Z0): Dampfzischen mit Blubbern und Dampfstößen',
  variants: 1,
  loop: { lengthS: 4.0, crossfadeS: 0 },
  post: { dcBlock: false },
  tags: ['varkan', 'eco', 'hydro', 'loop', 'MS14'],
  render({ rng, sr }) {
    const p = period(4.0, sr);
    const steam = mul(bandpass(highpass(pnoise(p, 'white', rng.fork('steam')), 1800, 0.7, 2), plfo(p, 1, 1200, 4200, 'sine', 0.3), 0.6), plfo(p, 3, 0.2, 0.75, 'sine', 0.6));
    const pr = rng.fork('puffs');
    const puffEnv = place(
      p,
      poissonTimes(pr, 1.1, p.L).map((t) => {
        const d = pr.range(0.25, 0.6);
        return { t, sig: envelope([[0, 0], [0.02, 1, 'lin'], [d, 0, 2]], d, sr), g: pr.range(0.5, 1) };
      }),
    );
    const puffs = mul(highpass(pnoise(p, 'pink', rng.fork('puffnoise')), 900, 0.7, 2), puffEnv);
    const br = rng.fork('bub');
    const bubbles = place(p, poissonTimes(br, 16, p.L).map((t) => ({ t, sig: bubble(logRange(br, 140, 520), br, { rise: 0.15, viscosity: 0.9, sr }), g: Math.pow(br.next(), 1.4) })));
    const rumble = lowpass(pnoise(p, 'brown', rng.fork('rumble')), 140, 0.7, 2);
    const mix = mixMono([
      { sig: steam, db: 3 },
      { sig: puffs, db: 2 },
      { sig: bubbles, db: -3 },
      { sig: rumble, db: -10 },
    ]);
    return secondHalf(p, highpass(mix, 55, 0.7, 2));
  },
});
