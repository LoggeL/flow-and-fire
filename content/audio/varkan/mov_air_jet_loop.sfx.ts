// Flieger-Antrieb (Lerche, Turmfalke, Dohle, Elster) als Loop: „Flieger fauchen wie ein Blasebalg" (faction.md §8.2).
//   Fauchen  rosa Rauschen, Bandpass 600–1400 Hz, im Blasebalg-Takt (~1,6 Hz) in Pegel UND Filter „atmend"
//   Glut     Knistern der Brennkammer (spärlich, hoch)
//   Turbine  leiser Säge-Grundton ~150 Hz + schmaler Pfeifton ~2,3 kHz (Verdichter), langsam schwebend
//   Druck    tiefes Rumpeln, Tiefpass 160 Hz
// Die Engine regelt Tonhöhe/Pegel über Geschwindigkeit und Distanz; Doppler über playbackRate.
import { bandpass, crackle, defineSfx, highpass, lfo, lowpass, mixMono, mul, noise, osc } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:mov_air_jet_loop',
  category: 'unit',
  description: 'Flieger-Antrieb (Loop): Blasebalg-Fauchen mit Glutknistern und leisem Turbinenpfeifen',
  variants: 2,
  loop: { lengthS: 2.0, crossfadeS: 0.3 },
  tags: ['varkan', 'bewegung', 'luft', 'loop', 'MS14'],
  render({ rng, durationS }) {
    const dur = durationS ?? 2.3;
    const breath = 1.6 * rng.jitter(0.1);
    const ph = rng.next();
    const roar = mul(
      bandpass(noise('pink', dur, rng.fork('roar')), lfo(breath, 350, 1000 * rng.jitter(0.1), dur, 'sine', ph), 0.9),
      lfo(breath, 0.28, 0.72, dur, 'sine', ph),
    );
    const air = highpass(noise('pink', dur, rng.fork('air')), 2500, 0.7, 1);
    const ember = highpass(crackle(dur, rng.fork('ember'), { density: 90, grainS: 0.0003 }), 3000, 0.7, 1);
    const f = 150 * rng.jitter(0.08);
    const turbine = lowpass(osc('saw', lfo(0.3, 2, f, dur), dur), 900, 0.8, 2);
    const whine = mul(osc('sine', lfo(0.23, 25, 2300 * rng.jitter(0.06), dur), dur), lfo(0.5, 0.2, 0.8, dur));
    const rumble = lowpass(noise('brown', dur, rng.fork('rumble')), 160, 0.7, 2);
    return highpass(
      mixMono(
        [
          { sig: roar, db: 0 },
          { sig: air, db: -18 },
          { sig: ember, db: -20 },
          { sig: turbine, db: -16 },
          { sig: whine, db: -30 },
          { sig: rumble, db: -8 },
        ],
        dur,
      ),
      45,
      0.7,
      2,
    );
  },
});
