// Zapfstelle (Mex), nur auf Z0: Pumpentakt (faction.md §8.2 „Eco-Gebäude"). 4 Hübe pro 3 s (0,75 s):
// Kolben-Stoß (dumpfer Guss-Klong + Luftstoß), Ventil-Klick, danach Ansaugen/Schwappen der Masse.
// Darunter der Pumpenmotor (Säge 50 Hz, tiefpassgefiltert) und leises Blubbern im Steigrohr.
// Alle Frequenzen sind Vielfache von 1/3 Hz → exakt periodisch über 3 s, nahtlos ohne Crossfade.
import { PLATE_PARTIALS, bandpass, defineSfx, envelope, highpass, lowpass, mixMono, modal, mul, osc, scaleDecay, thump, tick } from '../../../tools/sfx/src/index.ts';
import { bubble, logRange, period, place, plfo, pnoise, poissonTimes, secondHalf, type Event } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:eco_mex_loop',
  category: 'eco',
  description: 'Zapfstelle (Loop, Z0): Pumpentakt mit Kolben-Klong, Ventil-Klick und Schwappen',
  variants: 1,
  loop: { lengthS: 3.0, crossfadeS: 0 },
  post: { dcBlock: false },
  tags: ['varkan', 'eco', 'mex', 'loop', 'MS14'],
  render({ rng, sr }) {
    const p = period(3.0, sr);
    const stroke = 0.75;
    const r = rng.fork('strokes');
    const hits: Event[] = [];
    const clicks: Event[] = [];
    const slosh: Event[] = [];
    for (let k = 0; k < p.L / stroke; k++) {
      // +60 ms: Die Loop-Naht liegt in der ruhigen Phase kurz vor einem Kolbenstoß, nicht auf seiner Transiente.
      const t0 = k * stroke + 0.06;
      const clonk = modal(145 * r.jitter(0.02), scaleDecay(PLATE_PARTIALS, 0.28), { durS: 0.4, rng: r, jitter: 0.01 });
      hits.push({ t: t0, sig: clonk, g: r.range(0.85, 1) });
      hits.push({ t: t0, sig: thump({ rng: r.fork('th' + k), durS: 0.2, t60: 0.12, lpFrom: 900, lpTo: 140 }), g: 0.7 });
      clicks.push({ t: t0 + 0.11 + r.range(0, 0.01), sig: tick(r.range(1500, 1750), r, 0.02), g: 0.8 });
      slosh.push({ t: t0 + 0.28, sig: envelope([[0, 0], [0.12, 1, 'lin'], [0.38, 0, 1.6]], 0.4, sr), g: r.range(0.7, 1) });
    }
    const sloshSig = mul(bandpass(pnoise(p, 'pink', rng.fork('slosh')), 480, 1.6), place(p, slosh));
    const motor = mul(lowpass(osc('saw', 50, 2 * p.L, { phase: rng.next() }), 220, 0.8, 2), plfo(p, 4, 0.15, 0.85, 'sine', 0));
    const br = rng.fork('bub');
    const bubbles = place(p, poissonTimes(br, 9, p.L).map((t) => ({ t, sig: bubble(logRange(br, 160, 420), br, { rise: 0.12, viscosity: 1.6, sr }), g: Math.pow(br.next(), 1.5) })));
    const mix = mixMono([
      { sig: place(p, hits), db: 0 },
      { sig: place(p, clicks), db: -10 },
      { sig: sloshSig, db: -9 },
      { sig: motor, db: -18 },
      { sig: bubbles, db: -16 },
    ]);
    return secondHalf(p, highpass(mix, 55, 0.7, 2));
  },
});
