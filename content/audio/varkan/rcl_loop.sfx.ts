// Reclaim-Loop = Bau rückwärts (faction.md §8.2): das Wrack wird eingeschmolzen, zähes Blubbern.
// Gegenüber dem Gieß-Loop tiefer und langsamer, Blasen mit FALLENDER Tonhöhe, dazu rückwärts laufende
// Zisch-Schwellen (Hüllkurve steigt langsam an und bricht ab) und ein Schmelz-Brodeln im Tiefband.
// Die Engine steuert Tonhöhe/Pegel wie beim Bau-Loop. Periodisch gerechnet, ohne Crossfade nahtlos.
import { bandpass, defineSfx, envelope, highpass, lowpass, mixMono, mul } from '../../../tools/sfx/src/index.ts';
import { bubble, logRange, period, place, plfo, pnoise, poissonTimes, secondHalf } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:rcl_loop',
  category: 'build',
  description: 'Reclaim-Loop: Einschmelzen, tiefes Blubbern, rückwärts anschwellendes Zischen',
  variants: 2,
  loop: { lengthS: 3.0, crossfadeS: 0 },
  post: { dcBlock: false },
  tags: ['varkan', 'reclaim', 'loop', 'MS5'],
  render({ rng, sr }) {
    const p = period(3.0, sr);
    const tone = rng.jitter(0.06);
    const br = rng.fork('glug');
    const glugs = place(
      p,
      poissonTimes(br, 11, p.L).map((t) => ({
        t,
        sig: bubble(logRange(br, 95, 340) * tone, br, { rise: -br.range(0.08, 0.2), viscosity: br.range(0.8, 1.3), sr }),
        g: 0.35 + 0.65 * Math.pow(br.next(), 1.3),
      })),
    );
    // Kleine Nachblasen (Schlacke löst sich) mit fallender Tonhöhe, heller.
    const sr2 = rng.fork('small');
    const small = place(
      p,
      poissonTimes(sr2, 16, p.L).map((t) => ({ t, sig: bubble(logRange(sr2, 420, 900) * tone, sr2, { rise: -0.1, viscosity: 1.8, sr }), g: Math.pow(sr2.next(), 2) })),
    );
    // Rückwärts-Zischen: Schwelle 0,25–0,5 s, bricht hart ab (wie ein rückwärts abgespieltes Zischen).
    const sw = rng.fork('swell');
    const swellNoise = highpass(pnoise(p, 'pink', rng.fork('swellnoise')), 2600, 0.7, 2);
    const swellEnv = place(
      p,
      poissonTimes(sw, 2.2, p.L).map((t) => {
        const d = sw.range(0.25, 0.5);
        return { t, sig: envelope([[0, 0], [d, 1, 3], [d + 0.015, 0, 'lin']], d + 0.02, sr), g: sw.range(0.5, 1) };
      }),
    );
    const swells = mul(swellNoise, swellEnv);
    const simmer = mul(bandpass(pnoise(p, 'brown', rng.fork('simmer')), 180 * tone, 0.9), plfo(p, 2, 0.25, 0.75, 'sine', rng.next()));
    const rumble = lowpass(pnoise(p, 'brown', rng.fork('rumble')), 120, 0.7, 2);
    const mix = mixMono([
      { sig: glugs, db: 0 },
      { sig: small, db: -9 },
      { sig: swells, db: -12 },
      { sig: simmer, db: -6 },
      { sig: rumble, db: -12 },
    ]);
    return secondHalf(p, highpass(mix, 60, 0.7, 2));
  },
});
