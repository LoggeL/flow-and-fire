// Rinne (T2-Raketenwerfer), Waffe core:wpn_runner_missile_t2 (Glutraketen, 2er-Salve); Alias
// core:wpn_high_grate_sam_t3 (Hochrost, SAM-Salve).
// Raketen = „Fauchen mit Knistern der Glut-Treibladung“ (faction.md §8.2). Zündung (kurzer Plopp + Klack der
// Startschiene), dann schwillt das Fauchen an und entfernt sich: der Bandpass steigt erst (Zünden) und fällt dann
// (Doppler beim Wegfliegen), das Knistern der Treibladung ist dicht und hell.
import { crack, defineSfx, envelope, highpass, lowpass, mixMono, room, shape, thump, tick } from '../../../tools/sfx/src/index.ts';
import { roar } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_missile_fire',
  category: 'weapon',
  description: 'Rinne/Hochrost: Glutrakete, Zündung und Fauchen mit Knistern der Treibladung',
  variants: 4,
  tags: ['varkan', 'raketen', 'core:wpn_runner_missile_t2', 'core:wpn_high_grate_sam_t3', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.06);
    const dur = 1.1;
    const rd = 1.0;
    const pk = rng.range(0.08, 0.12);
    const env = envelope([[0, 0], [0.015, 0.5, 'lin'], [pk, 1, 'lin'], [pk + 0.15, 0.6, 'lin'], [rd, 0.0005, 'exp']], rd);
    const band = envelope([[0, 700 * p], [pk, 1500 * p, 'exp'], [rd, 520 * p, 'exp']], rd);
    const layers = mixMono(
      [
        { sig: roar({ rng: rng.fork('roar'), durS: rd, band, q: 0.6, env, crackle: 1100, grit: 0.7, color: 'pink', crackleDb: -7 }), db: 0, at: 0.015 },
        { sig: crack({ rng: rng.fork('ign'), durS: 0.07, freq: 1300 * p, q: 0.7, t60: 0.03, drive: 3 }), db: 3 },
        { sig: thump({ rng: rng.fork('push'), durS: 0.25, t60: 0.13, lpFrom: 1800, lpTo: 220 }), db: 0 },
        { sig: tick(1700 * p, rng.fork('rail'), 0.03), db: -16, at: 0.004 },
      ],
      dur,
    );
    return room(lowpass(highpass(shape(layers, { kind: 'tanh', drive: 1.4 }), 110, 0.7, 2), 7000, 0.7, 1), { t60: 0.4, wet: 0.14, seed: 141 });
  },
});
