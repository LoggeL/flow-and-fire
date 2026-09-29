// Sieb (T1-Flugabwehr), Waffe core:wpn_aa_repeater_t1 (Zwillings-Flak, 2er-Salve); Alias core:wpn_grate_aa_t1
// (Rost I, Turm).
// Flugabwehr = „schnelles, trockenes Rasseln (Ratsche, Sieb) in hoher Lage“ (faction.md §8.2). Zwei helle,
// kurze Abschüsse im Abstand von 45–60 ms (Zwilling), jeder zieht ein kurzes Rasseln der Siebtrommel nach sich.
// Hochpass 350 Hz: das Tief- und Mittenband gehört Kanonen und Artillerie.
import { crack, defineSfx, highpass, mixMono, room, shape } from '../../../tools/sfx/src/index.ts';
import { rattle } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_aa_repeater_t1_fire',
  category: 'weapon',
  description: 'Sieb (T1-Flugabwehr): Zwillings-Flak, zwei helle Abschüsse mit trockenem Rasseln',
  variants: 4,
  tags: ['varkan', 'flugabwehr', 'core:wpn_aa_repeater_t1', 'core:wpn_grate_aa_t1', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.05);
    const dur = 0.45;
    const gap = rng.range(0.045, 0.06);
    const layers = mixMono(
      [
        { sig: crack({ rng: rng.fork('c1'), durS: 0.05, freq: 3400 * p, q: 1.0, t60: 0.016, drive: 5 }), db: 0 },
        { sig: crack({ rng: rng.fork('c2'), durS: 0.05, freq: 3100 * p, q: 1.0, t60: 0.016, drive: 5 }), db: -1.5, at: gap },
        { sig: rattle({ rng: rng.fork('r1'), count: 5, rate: 70 * p, fLo: 2600 * p, fHi: 5200 * p, fall: 0.8 }), db: -8, at: 0.012 },
        { sig: rattle({ rng: rng.fork('r2'), count: 6, rate: 65 * p, fLo: 2400 * p, fHi: 5000 * p, fall: 0.78 }), db: -9, at: gap + 0.012 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.8 }), 350, 0.7, 2), { t60: 0.22, wet: 0.08, seed: 131 });
  },
});
