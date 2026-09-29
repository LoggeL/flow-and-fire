// Bau-/Nano-Loop als Gießgeräusch (faction.md §8.2 „Bau / Reclaim"): flüssiges Metall läuft in die Form.
// EIN Loop pro Armee: die Engine steuert die Tonhöhe über den Baufortschritt (playbackRate ≈ 0,85–1,25)
// und Dichte/Pegel über die Summe der fließenden Build Power.
// Schichten: Gießstrahl (rosa Rauschen, Bandpass um 700 Hz, langsam wandernd), zähe Blasen mit steigender
// Tonhöhe (250–1100 Hz), Ofen-Rauschen tief, Glut-Zischen + Knistern hoch.
// Periodisch gerechnet (foundry_kit), daher ohne Crossfade nahtlos.
import { bandpass, crackle, defineSfx, highpass, lowpass, mixMono, mul } from '../../../tools/sfx/src/index.ts';
import { bubble, logRange, period, place, plfo, pnoise, poissonTimes, secondHalf } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:bld_pour_loop',
  category: 'build',
  description: 'Bau-Loop: Gießstrahl mit Blasen und Glut-Zischen; Rate = Fortschritt, Pegel = Build Power',
  variants: 2,
  loop: { lengthS: 3.0, crossfadeS: 0 },
  post: { dcBlock: false },
  tags: ['varkan', 'bau', 'loop', 'MS5'],
  render({ rng, sr }) {
    const p = period(3.0, sr);
    const tone = rng.jitter(0.06);
    const stream = mul(
      bandpass(pnoise(p, 'pink', rng.fork('stream')), plfo(p, 2, 180 * tone, 720 * tone, 'sine', rng.next()), 1.3),
      plfo(p, 3, 0.18, 0.82, 'sine', rng.next()),
    );
    const body = lowpass(pnoise(p, 'brown', rng.fork('body')), 380, 0.8, 2);
    const br = rng.fork('bubbles');
    const bubbles = place(
      p,
      poissonTimes(br, 38, p.L).map((t) => ({
        t,
        sig: bubble(logRange(br, 260, 1100) * tone, br, { rise: br.range(0.06, 0.16), viscosity: br.range(1.4, 2.2), sr }),
        g: Math.pow(br.next(), 1.6),
      })),
    );
    const hiss = mul(highpass(pnoise(p, 'white', rng.fork('hiss')), 4200, 0.7, 2), plfo(p, 5, 0.3, 0.7, 'sine', rng.next()));
    const cr = rng.fork('crackle');
    const embers = place(p, [{ t: 0, sig: crackle(p.L, cr, { density: 22, grainS: 0.0005, spread: 2 }) }]);
    const mix = mixMono([
      { sig: stream, db: -3 },
      { sig: body, db: -8 },
      { sig: bubbles, db: 0 },
      { sig: hiss, db: -22 },
      { sig: embers, db: -12 },
    ]);
    return secondHalf(p, highpass(mix, 70, 0.7, 2));
  },
});
