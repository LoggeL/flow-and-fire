/**
 * Fühler II (f2:str_t2_radar) – Radar T2, 2×2 (Roster-Maßstab y 1,2).
 *
 * Roster: „Fühler auf 2×2 (Höhe × 1,2) mit Seitenplatten, 2 Tech-Streifen.“ Gleiche Grundform wie Fühler I (Kruste,
 * Sechskant-Buckel, V aus zwei geknickten Fühlern, 35°); T2 = vier schräg an den Buckel gelehnte Chitin-Seitenplatten
 * (Diagonalen, damit das V frei bleibt), 2 Kerben und die Höhe × 1,2 aus dem Roster-Maßstab.
 *
 * Aufbau (Basis-Maße, y = Boden, +Z = vorn): hull – Kruste, Buckel, Teamplatte, Seitenplatten, 2 Fühler, Kerben.
 */
import { cylinder, defineModel, frustum, plate, stripes } from '@faf/modelkit';
import { crust, feelerPair } from './_wehr.ts';

const K = crust({ size: [1.94, 1.94], h: 0.26, rim: 0.2, seed: 19 });
const F = K.floor;
const HUB_H = 0.26;
const HUB_TOP = F + HUB_H;

export default defineModel({
  id: 'f2:str_t2_radar',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        frustum({ radius: 0.58, radiusTop: 0.4, height: HUB_H + 0.02, segments: 6, caps: 'top', at: [0, F + HUB_H / 2 - 0.01, 0], mat: 'chitin', keep: true, tag: 'carapace' }),
        cylinder({ radius: 0.36, height: 0.03, segments: 6, caps: 'top', at: [0, HUB_TOP + 0.01, 0], mat: 'team', tag: 'carapace' }),
        // Seitenplatten (T2): vier Chitin-Platten auf den Diagonalen, nach außen abfallend
        ...[45, 135, 225, 315].map((a) =>
          plate({
            size: [0.42, 0.34],
            thickness: 0.05,
            arch: 0.04,
            segments: [2, 1],
            at: [0.56 * Math.cos((a * Math.PI) / 180), F + 0.13, 0.56 * Math.sin((a * Math.PI) / 180)],
            rot: [0, 90 - a, -28],
            mat: 'chitin',
            maxLod: 1,
            tag: 'carapace',
          }),
        ),
        ...feelerPair({ base: HUB_TOP, spread: 35, height: 2.3, knee: 0.55, forward: 0.3, radius: 0.13 }),
        stripes({ count: 2, width: 0.2, gap: 0.08, rot: [0, 90, 0], at: [0.09, F + 0.005, -0.72] }),
      ],
    },
  ],
  notes: 'v_radar T2: statisch, Roster-Maßstab y 1,2.',
});
