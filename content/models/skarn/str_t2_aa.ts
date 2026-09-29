/**
 * Schlehe II (f2:str_t2_aa) – Flakturm T2, 2×2 (Roster-Maßstab xz 2,0 / y 2,4; Basis = Schlehe I auf 1×1).
 *
 * Roster: „Schlehe × 1,3 mit 3 Dornen und Seitenplatten, 2 Tech-Streifen.“ Gleiche Grundform wie Schlehe I (Kruste,
 * Kammsockel quer, senkrechte Dornen); T2 = dritter, höherer Mitteldorn, Seitenplatten an den Riegelenden und
 * 2 Kerben. Der y-Maßstab (2,4 / 2,0) streckt die Dornen zusätzlich: im Spiel ≥ 84° steil.
 *
 * Aufbau (Basis-Maße, y = Boden, +Z = vorn):
 *   hull   – Kruste, 2 Kerben
 *   turret – Kammsockel (Teamplatte) + Seitenplatten + 3 Dornen; dreht um +Y   (PartStream 1)
 */
import { defineModel, extrude, mirrorX, spike, stripes, strut } from '@faf/modelkit';
import { crust } from './_wehr.ts';

const K = crust({ size: [0.97, 0.97], h: 0.17, seed: 29 });
const F = K.floor;
const R_TOP = F + 0.17;
const THORNS: { x: number; tip: number; lean: number }[] = [
  { x: 0.2, tip: 0.86, lean: 0.06 },
  { x: 0, tip: 0.98, lean: 0 },
  { x: -0.2, tip: 0.86, lean: -0.06 },
];

export default defineModel({
  id: 'f2:str_t2_aa',
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, stripes({ count: 2, width: 0.12, gap: 0.06, rot: [0, 90, 0], at: [0.08, F + 0.005, -0.27] })],
    },
    {
      name: 'turret',
      pivot: [0, F, 0],
      anim: 'yaw',
      shapes: [
        extrude({
          profile: [
            [-0.36, F - 0.02],
            [0.36, F - 0.02],
            [0.28, R_TOP],
            [-0.28, R_TOP],
          ],
          depth: 0.3,
          axis: 'z',
          mat: 'chitin',
          keep: true,
          tag: 'neck',
        }),
        extrude({
          profile: [
            [-0.3, -0.13],
            [0.3, -0.13],
            [0.24, 0.13],
            [-0.24, 0.13],
          ],
          depth: 0.03,
          axis: 'y',
          at: [0, R_TOP + 0.01, 0],
          mat: 'team',
          tag: 'neck',
        }),
        // Seitenplatten (T2): Chitin-Schilde an den Riegelenden, nach außen gekippt
        mirrorX(
          extrude({
            profile: [
              [-0.2, F - 0.02],
              [0.2, F - 0.02],
              [0.14, F + 0.24],
              [-0.12, F + 0.24],
            ],
            depth: 0.05,
            axis: 'x',
            at: [0.37, 0, 0],
            rot: [0, 0, -14],
            mat: 'chitin',
            maxLod: 1,
            tag: 'carapace',
          }),
        ),
        ...THORNS.flatMap((t) => [
          strut({ from: [t.x, R_TOP - 0.04, 0], to: [t.x, R_TOP + 0.07, 0], radius: 0.14, sides: 4, caps: 'end', mat: 'sinew', maxLod: 1, tag: 'spike' }),
          spike({ from: [t.x, R_TOP, 0], to: [t.x + t.lean, t.tip, 0.02], radius: 0.115, mat: 'chitin', keep: true, tag: 'spike' }),
        ]),
      ],
    },
  ],
  notes: 'Basis 1×1 wie Schlehe I; Roster-Maßstab xz 2,0 / y 2,4 ergibt 2×2.',
});
