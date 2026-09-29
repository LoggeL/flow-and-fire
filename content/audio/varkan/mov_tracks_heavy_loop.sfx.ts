// Kettenfahrwerk schwer (Meißel, Rinne, Rüttelsieb, Pfanne, Trommelsieb) als nahtloser Loop.
// Wie mov_tracks_loop, aber tiefer, langsamer und mit mehr Schleifen (faction.md §8.2: „Ketten klirren schwer"):
//   Antrieb   Säge ~33 Hz + Rechteck-Unterton, Tiefpass, leicht gesättigt (Diesel-/Kessel-Brummen)
//   Rumpeln   braunes Rauschen, Tiefpass 200 Hz, mit dem Kettentakt amplitudenmoduliert
//   Glieder   schwere Guss-Klongs (~6 Hz, Plattenmoden 380–650 Hz) + seltener heller Nachschlag
//   Schleifen Bandpass-Rauschen 900–1600 Hz, lauter und langsamer moduliert, dazu leises Quietschen
// Die Engine regelt Tonhöhe/Pegel über die Geschwindigkeit (playbackRate 0,8–1,2).
import {
  PLATE_PARTIALS,
  bandpass,
  defineSfx,
  highpass,
  lfo,
  lowpass,
  mixMono,
  modal,
  mul,
  noise,
  osc,
  samples,
  scaleDecay,
  shape,
  tick,
  type Mono,
} from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:mov_tracks_heavy_loop',
  category: 'unit',
  description: 'Kettenfahrwerk schwer (Loop): tiefe, langsame Guss-Glieder mit viel Schleifen über schwerem Antrieb',
  variants: 2,
  loop: { lengthS: 2.5, crossfadeS: 0.35 },
  tags: ['varkan', 'bewegung', 'loop', 'MS9'],
  render({ rng, durationS, sr }) {
    const dur = durationS ?? 2.85;
    const f0 = 33 * rng.jitter(0.05);
    const hum = shape(
      lowpass(mixMono([{ sig: osc('saw', lfo(0.45, 1.2, f0, dur), dur) }, { sig: osc('square', f0 * 0.5, dur), db: -6 }]), 150, 0.9, 2),
      { kind: 'tanh', drive: 1.8 },
    );
    const rate = 6 * rng.jitter(0.06);
    const rumble = mul(lowpass(noise('brown', dur, rng.fork('rumble')), 200, 0.7, 2), lfo(rate, 0.3, 0.8, dur));
    // Kettenglieder: schwere Guss-Klongs mit Jitter, gelegentlich ein zweiter heller Nachschlag (Spiel im Glied).
    const links = new Float32Array(samples(dur, sr));
    const r = rng.fork('links');
    const add = (sig: Mono, t: number, g: number): void => {
      const off = samples(t, sr);
      for (let i = 0; i < sig.length && off + i < links.length; i++) links[off + i] = (links[off + i] as number) + (sig[i] as number) * g;
    };
    for (let t = r.range(0, 0.06); t < dur; t += (1 / rate) * r.jitter(0.2)) {
      const clonk = modal(r.range(380, 650), scaleDecay(PLATE_PARTIALS, r.range(0.12, 0.2)), { durS: 0.12, rng: r, jitter: 0.03 });
      add(clonk, t, r.range(0.45, 1));
      if (r.next() < 0.45) add(tick(r.range(1100, 1700), r, r.range(0.02, 0.035)), t + r.range(0.018, 0.04), r.range(0.15, 0.35));
    }
    const grind = mul(bandpass(noise('pink', dur, rng.fork('grind')), lfo(0.22, 350, 1250, dur), 3), lfo(0.9, 0.3, 0.75, dur, 'sine', rng.next()));
    const squeal = mul(bandpass(noise('white', dur, rng.fork('squeal')), lfo(0.37, 180, 2900 * rng.jitter(0.08), dur), 22), lfo(0.37, 0.5, 0.5, dur, 'sine', 0.25));
    const layers: { sig: Mono; db: number }[] = [
      { sig: hum, db: -8 },
      { sig: rumble, db: -6 },
      { sig: links, db: 0 },
      { sig: grind, db: -10 },
      { sig: squeal, db: -26 },
    ];
    return highpass(mixMono(layers, dur), 28, 0.7, 2);
  },
});
