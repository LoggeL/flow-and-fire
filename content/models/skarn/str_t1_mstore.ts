/**
 * Wabe (f2:str_t1_mstore) – Skarn-Massespeicher T1 auf 2×2.
 *
 * Roster: „Niedriger eckiger Stapel aus Panzerplatten (Mass = eckig), keine Druse, keine Spule.“
 * faction.md §5.2 Storage: Mass (Wabe) = eckiger Stapel aus Panzerplatten, flach; verboten: Druse, Spule.
 * Pflicht-Paartest Wabe ↔ Glimmzelle: hier ein einzelner, gestufter Vierkant-Stapel (von oben ein Achtstern aus
 * Team- und Chitinecken), dort zwei flache Sechseckzellen mit glimmender Deckelnaht.
 *
 * Aufbau (y = Boden, +Z = vorn), alles statisch (hull):
 *   Kruste (Achteck, Krustengrau) mit gezackter Teamkante, drei gefaste Panzerplatten als Stufen-Stapel (Chitin /
 *   Team 45° gedreht / Chitin), Tech-Streifen (Quarz) hinten auf der obersten Platte. Kein Glühen (Speicher ≠ Flow).
 */
import { beveledBox, defineModel, stripes } from '@faf/modelkit';
import { crust } from './str_t1_mex.ts';

const CRUST_H = 0.16;
const P = 0.17; // Plattendicke

export default defineModel({
  id: 'f2:str_t1_mstore',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...crust({ radius: 1.07, height: CRUST_H, crest: { lo: 0.04, hi: 0.14, width: 0.1 }, seed: 41 }),
        beveledBox({ size: [1.24, P, 1.24], bevel: { top: 0.08 }, at: [0, CRUST_H + P / 2, 0], mat: 'chitin', keep: true, tag: 'carapace' }),
        beveledBox({ size: [1.02, P, 1.02], bevel: { top: 0.08 }, at: [0, CRUST_H + P * 1.5, 0], rot: [0, 45, 0], mat: 'team', keep: true, tag: 'carapace' }),
        beveledBox({ size: [0.7, P, 0.7], bevel: { top: 0.1 }, at: [0, CRUST_H + P * 2.5, 0], mat: 'chitin', keep: true, tag: 'carapace' }),
        stripes({ count: 1, width: 0.36, at: [0, CRUST_H + P * 3 + 0.004, -0.1], mat: 'quartz', maxLod: 1 }),
      ],
    },
  ],
  notes: 'v_mstore: Stufen-Stapel aus drei Panzerplatten (Chitin/Team/Chitin), kein Glühen.',
});
