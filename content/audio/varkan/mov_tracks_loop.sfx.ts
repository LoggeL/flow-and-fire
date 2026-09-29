// Kettenfahrwerk leicht (Punze, Kelle, Sieb, Funke …) als nahtloser Loop. faction.md §8.2: „Ketten klirren schwer".
// Schichten: Antriebs-Brummen (Säge 46 Hz + braunes Rauschen, Tiefpass), Kettenglieder-Klirren (Guss-Ticks mit
// ~9 Hz und Jitter), leises Schleifen (Bandpass-Rauschen um 2,4 kHz, langsam moduliert).
// Die Engine regelt Tonhöhe/Pegel über die Geschwindigkeit (playbackRate 0,8–1,2).
import { defineSfx, highpass, lfo, lowpass, bandpass, mixMono, mul, noise, osc, tick, type Mono, samples } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:mov_tracks_loop',
  category: 'unit',
  description: 'Kettenfahrwerk T1 (Loop): schweres Klirren der Gussglieder über Antriebsbrummen',
  variants: 2,
  loop: { lengthS: 2.0, crossfadeS: 0.3 },
  tags: ['varkan', 'bewegung', 'loop', 'MS5'],
  render({ rng, durationS, sr }) {
    const dur = durationS ?? 2.3;
    const hum = lowpass(osc('saw', lfo(0.7, 1.5, 46 * rng.jitter(0.04), dur), dur), 180, 0.9, 2);
    const rumble = lowpass(noise('brown', dur, rng.fork('rumble')), 260, 0.7, 2);
    // Kettenglieder: unregelmäßige Folge metallischer Ticks.
    const links = new Float32Array(samples(dur, sr));
    const r = rng.fork('links');
    for (let t = r.range(0, 0.05); t < dur; t += (1 / 9) * r.jitter(0.25)) {
      const k = tick(r.range(850, 1400), r, r.range(0.025, 0.045));
      const g = r.range(0.35, 1);
      const off = samples(t, sr);
      for (let i = 0; i < k.length && off + i < links.length; i++) links[off + i] = (links[off + i] as number) + (k[i] as number) * g;
    }
    const grind = mul(bandpass(noise('pink', dur, rng.fork('grind')), lfo(0.3, 400, 2400, dur), 4), lfo(1.3, 0.3, 0.7, dur));
    const layers: { sig: Mono; db: number }[] = [
      { sig: hum, db: -10 },
      { sig: rumble, db: -8 },
      { sig: links, db: 0 },
      { sig: grind, db: -14 },
    ];
    return highpass(mixMono(layers, dur), 35, 0.7, 2);
  },
});
