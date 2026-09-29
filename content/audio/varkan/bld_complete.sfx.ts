// Bau fertig (faction.md §8.2): der Guss setzt sich (dumpfer Guss-Klong), dann Abkühl-Knacken, also
// metallisches Schrumpfen in unregelmäßigen, ausdünnenden Abständen, und ein kurzer Dampfstoß.
// Den leisen hohen Glockenschlag spielt die Engine danach separat (varkan:sig_bell_small, Cooldown ≥ 1 s).
import { PLATE_PARTIALS, crackle, defineSfx, envelope, highpass, mixMono, modal, mul, noise, scaleDecay, tick } from '../../../tools/sfx/src/index.ts';
import { scatter, type Event } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:bld_complete',
  category: 'build',
  description: 'Bau fertig: Guss setzt sich, Abkühl-Knacken, Dampfstoß (Glocke folgt separat)',
  variants: 3,
  tags: ['varkan', 'bau', 'MS9'],
  render({ rng, sr }) {
    const dur = 1.0;
    const settle = modal(210 * rng.jitter(0.05), scaleDecay(PLATE_PARTIALS, 0.55), { durS: 0.45, rng: rng.fork('settle'), jitter: 0.01 });
    // Knacken: Abstände wachsen (Metall kühlt ab), Frequenzen und Stärken zufällig.
    const r = rng.fork('ticks');
    const ticks: Event[] = [];
    let t = 0.05 + r.range(0, 0.02);
    for (let k = 0; t < 0.85; k++) {
      ticks.push({ t, sig: tick(r.range(1700, 4300), r, r.range(0.012, 0.035)), g: Math.pow(r.range(0.25, 1), 1.2) * (1 - t * 0.5) });
      t += 0.03 + 0.045 * k * r.jitter(0.5);
    }
    const steamEnv = envelope([[0, 0], [0.015, 1, 'lin'], [0.35, 0.001, 'exp']], 0.35, sr);
    const steam = mul(highpass(noise('white', 0.35, rng.fork('steam')), 3200, 0.7, 2), steamEnv);
    const cr = mul(crackle(0.8, rng.fork('cr'), { density: 45, grainS: 0.0004 }), envelope([[0, 1], [0.8, 0, 'exp']], 0.8, sr));
    const m = mixMono(
      [
        { sig: settle, db: -2 },
        { sig: scatter(dur, ticks, sr), db: 0 },
        { sig: steam, db: -18, at: 0.02 },
        { sig: cr, db: -16, at: 0.05 },
      ],
      dur,
    );
    return highpass(m, 110, 0.7, 2);
  },
});
