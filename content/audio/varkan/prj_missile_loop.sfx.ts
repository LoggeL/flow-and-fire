// Glutrakete im Flug (Rinne, Hochrost): Fauchen mit Knistern der Glut-Treibladung (faction.md §8.2).
//   Fauchen   rosa Rauschen, Bandpass ~1,5 kHz, leichtes Flattern der Flamme (ganzzahlige LFO-Zyklen)
//   Glut      dichtes, hohes Knistern der Treibladung
//   Druck     tiefes Brausen unter 300 Hz
// Periodisch über 1,0 s, nahtlos ohne Crossfade. Doppler über playbackRate.
import { bandpass, crackle, defineSfx, highpass, lowpass, mixMono, mul } from '../../../tools/sfx/src/index.ts';
import { period, place, plfo, pnoise, secondHalf } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:prj_missile_loop',
  category: 'projectile',
  description: 'Glutrakete im Flug (Loop): Fauchen mit Glut-Knistern, flatternde Flamme',
  variants: 2,
  loop: { lengthS: 1.0, crossfadeS: 0 },
  post: { dcBlock: false },
  tags: ['varkan', 'projektil', 'rakete', 'loop', 'MS9'],
  render({ rng, variant, sr }) {
    const p = period(1.0, sr);
    const fc = (variant === 0 ? 1500 : 1150) * rng.jitter(0.05);
    const flutter = plfo(p, variant === 0 ? 23 : 17, 0.22, 0.78, 'sine', rng.next());
    const roar = mul(bandpass(pnoise(p, 'pink', rng.fork('roar')), plfo(p, 3, fc * 0.2, fc, 'sine', rng.next()), 0.8), flutter);
    const hiss = highpass(pnoise(p, 'white', rng.fork('hiss')), 4500, 0.7, 2);
    const ember = highpass(place(p, [{ t: 0, sig: crackle(p.L, rng.fork('ember'), { density: variant === 0 ? 420 : 300, grainS: 0.0004, spread: 2 }) }]), 1600, 0.7, 1);
    const push = lowpass(pnoise(p, 'brown', rng.fork('push')), 280, 0.7, 2);
    const mix = mixMono([
      { sig: roar, db: 0 },
      { sig: hiss, db: -26 },
      { sig: ember, db: -15 },
      { sig: push, db: -7 },
    ]);
    return secondHalf(p, highpass(mix, 60, 0.7, 2));
  },
});
