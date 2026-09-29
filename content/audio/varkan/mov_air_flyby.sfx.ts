// Vorbeiflug nahe der Kamera (Flieger): Blasebalg-Fauchen + Turbinenton mit Doppler.
// Physikalisch grob: Quelle fliegt mit ~v = 0,25 c in Abstand d vorbei. Tonhöhe fällt um den Scheitel
// (f·c/(c − v·cosθ)), Pegel ~ 1/Abstand, Tiefpass öffnet sich nahe der Kamera (Luftdämpfung).
// Mono (die Engine pannt räumlich); der Scheitel liegt je Variante bei 0,75–0,95 s.
import { bandpass, defineSfx, fade, highpass, lowpass, mixMono, mul, noise, osc, samples } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:mov_air_flyby',
  category: 'unit',
  description: 'Vorbeiflug mit Doppler: Fauchen und Turbinenton, fallende Tonhöhe am Scheitel',
  variants: 3,
  tags: ['varkan', 'bewegung', 'luft', 'MS14'],
  render({ rng, sr }) {
    const dur = 1.95;
    const n = samples(dur, sr);
    const tc = rng.range(0.75, 0.95);
    const v = rng.range(0.2, 0.28); // Machzahl
    const d = rng.range(0.18, 0.28); // Scheitelabstand in „Sekunden Flugzeit"
    const dop = new Float32Array(n);
    const amp = new Float32Array(n);
    const cut = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / sr - tc;
      const dist = Math.hypot(x, d);
      const cos = -x / dist; // > 0 beim Anflug
      dop[i] = 1 / (1 - v * cos);
      amp[i] = Math.pow(d / dist, 1.4);
      cut[i] = 600 + 7000 * Math.pow(d / dist, 1.5);
    }
    const f = 160 * rng.jitter(0.08);
    const turbine = lowpass(osc('saw', dop.map((k) => f * k), dur), 1200, 0.8, 1);
    const fw = 2400 * rng.jitter(0.06);
    const whine = osc('sine', dop.map((k) => fw * k), dur);
    const roar = bandpass(noise('pink', dur, rng.fork('roar')), dop.map((k) => 950 * k), 0.8);
    const hiss = highpass(noise('pink', dur, rng.fork('hiss')), 3000, 0.7, 1);
    const rumble = lowpass(noise('brown', dur, rng.fork('rumble')), 150, 0.7, 2);
    const src = mixMono([
      { sig: roar, db: 0 },
      { sig: turbine, db: -12 },
      { sig: whine, db: -28 },
      { sig: hiss, db: -14 },
      { sig: rumble, db: -8 },
    ]);
    const shaped = mul(lowpass(src, cut, 0.7, 1), amp);
    return fade(highpass(shaped, 40, 0.7, 2), 0.15, 0.25);
  },
});
