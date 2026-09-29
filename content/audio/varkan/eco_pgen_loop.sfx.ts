// Glutkessel (Pgen), nur auf Z0: rhythmischer Blasebalg (faction.md §8.2 „Eco-Gebäude"). Ein Zyklus
// dauert 2 s: Druckhub (tiefes, kräftiges Fauchen, das die Glut anfacht) und Saughub (leiser, heller).
// Am Umkehrpunkt klappt das Lederventil. Darunter Kessel-Rauschen und nachglühendes Knistern, das beim
// Druckhub dichter wird. Periodisch über 4 s (2 Zyklen), nahtlos ohne Crossfade.
import { bandpass, crackle, defineSfx, envelope, highpass, lowpass, mixMono, mul, samples, sweep, tick } from '../../../tools/sfx/src/index.ts';
import { period, place, plfo, pnoise, secondHalf, type Event } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:eco_pgen_loop',
  category: 'eco',
  description: 'Glutkessel (Loop, Z0): rhythmischer Blasebalg, Ventilklappe, Kessel-Rauschen',
  variants: 1,
  loop: { lengthS: 4.0, crossfadeS: 0 },
  post: { dcBlock: false },
  tags: ['varkan', 'eco', 'pgen', 'loop', 'MS14'],
  render({ rng, sr }) {
    const p = period(4.0, sr);
    const cyc = 2.0;
    const r = rng.fork('cycles');
    // Hüllkurven der Hübe (über zwei Perioden wiederholt).
    const pushEnv: Event[] = [];
    const pullEnv: Event[] = [];
    const flaps: Event[] = [];
    for (let c = 0; c < p.L / cyc; c++) {
      const t0 = c * cyc;
      const push = 0.85 * r.jitter(0.05);
      pushEnv.push({ t: t0, sig: envelope([[0, 0], [0.12, 0.8, 'lin'], [0.35, 1, 'lin'], [push, 0, 1.8]], push + 0.01, sr), g: r.range(0.9, 1) });
      pullEnv.push({ t: t0 + 1.0, sig: envelope([[0, 0], [0.3, 0.6, 'lin'], [0.8, 0, 1.5]], 0.82, sr), g: r.range(0.8, 1) });
      flaps.push({ t: t0 + 0.93, sig: tick(r.range(380, 460), r, 0.05), g: 0.9 });
      flaps.push({ t: t0 + 1.9, sig: tick(r.range(520, 600), r, 0.035), g: 0.5 });
    }
    const pushE = place(p, pushEnv);
    const pullE = place(p, pullEnv);
    // Druckhub: rosa Rauschen, Bandpass wandert 380 → 700 Hz während des Hubs.
    const cycSweep = (from: number, to: number, time: number): Float32Array => {
      const s = sweep(from, to, time, cyc, 'exp', sr);
      const out = new Float32Array(2 * p.n);
      for (let i = 0; i < out.length; i++) out[i] = s[i % samples(cyc, sr)] as number;
      return out;
    };
    const air = pnoise(p, 'pink', rng.fork('air'));
    const push = mul(bandpass(air, cycSweep(380, 720, 0.8), 1.1), pushE);
    const pull = mul(highpass(bandpass(pnoise(p, 'pink', rng.fork('pull')), 1400, 0.9), 500, 0.7, 1), pullE);
    const roar = mul(lowpass(pnoise(p, 'brown', rng.fork('roar')), 160, 0.7, 2), plfo(p, 2, 0.2, 0.8, 'sine', 0.8));
    // Glut-Knistern wird beim Druckhub dichter (Luft facht an).
    const glow = mul(highpass(place(p, [{ t: 0, sig: crackle(p.L, rng.fork('glow'), { density: 30, grainS: 0.0004, spread: 2 }) }]), 1500, 0.7, 1), mixMono([{ sig: pushE }, { sig: new Float32Array(2 * p.n).fill(0.25) }]));
    const mix = mixMono([
      { sig: push, db: 0 },
      { sig: pull, db: -9 },
      { sig: place(p, flaps), db: -14 },
      { sig: roar, db: -10 },
      { sig: glow, db: -18 },
    ]);
    return secondHalf(p, highpass(mix, 50, 0.7, 2));
  },
});
