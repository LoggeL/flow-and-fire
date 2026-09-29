// Artillerie-Granate im Flug (Kelle, Pfanne, Tiegel, Hochofen): „hörbares Pfeifen im Flug" (faction.md
// §8.2). Pfeifton ~1,1 kHz aus schmalbandigem Rauschen und einem leisen Sinus, dazu das Taumeln des
// Schlackenbrockens (Tonhöhe und Pegel eiern mit 3–4 Hz) und Fahrtwind. Die Engine rechnet Doppler und
// Fallkurve über playbackRate. Periodisch über 1,5 s (ganzzahlige Zyklen), nahtlos ohne Crossfade.
import { bandpass, defineSfx, highpass, lowpass, mixMono, mul, osc } from '../../../tools/sfx/src/index.ts';
import { period, plfo, pnoise, secondHalf } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:prj_shell_whistle_loop',
  category: 'projectile',
  description: 'Artillerie-Granate im Flug (Loop): taumelndes Pfeifen mit Fahrtwind, Doppler über playbackRate',
  variants: 2,
  loop: { lengthS: 1.5, crossfadeS: 0 },
  post: { dcBlock: false },
  tags: ['varkan', 'projektil', 'artillerie', 'loop', 'MS9'],
  render({ rng, variant, sr }) {
    const p = period(1.5, sr);
    const L = p.L;
    // Ganzzahlige Zyklen pro Periode → exakt periodisch.
    const f = Math.round((variant === 0 ? 1080 : 1270) * rng.jitter(0.02) * L) / L;
    const wobble = variant === 0 ? 5 : 6; // Zyklen pro 1,5 s = 3,3 / 4 Hz Taumeln
    const pitch = plfo(p, wobble, f * 0.025, f, 'sine', rng.next());
    const amp = plfo(p, wobble, 0.25, 0.75, 'sine', rng.next());
    const tone = mul(osc('sine', pitch, 2 * L, { phase: 0 }), amp);
    const band = mul(bandpass(pnoise(p, 'white', rng.fork('band')), pitch, 18), amp);
    const band2 = mul(bandpass(pnoise(p, 'white', rng.fork('band2')), plfo(p, wobble, f * 0.05, f * 2.02, 'sine', 0.3), 14), amp);
    const wind = mul(bandpass(pnoise(p, 'pink', rng.fork('wind')), 700, 0.6), plfo(p, 2, 0.15, 0.85, 'sine', rng.next()));
    const mix = mixMono([
      { sig: band, db: 0 },
      { sig: tone, db: -14 },
      { sig: band2, db: -12 },
      { sig: wind, db: -13 },
      { sig: lowpass(pnoise(p, 'brown', rng.fork('rush')), 250, 0.7, 2), db: -18 },
    ]);
    return secondHalf(p, highpass(mix, 120, 0.7, 2));
  },
});
