/**
 * Fühler III (f2:str_t3_radar) – Radar T3, 2×2 (Roster-Maßstab y 1,4).
 *
 * Roster: „Fühler auf 2×2 (Höhe × 1,4) mit drittem, kurzem Fühler, 3 Tech-Streifen.“ Grundform wie Fühler I/II
 * (Kruste, Buckel, Seitenplatten, V aus zwei geknickten Fühlern, 35°); T3 = dritter, kurzer Fühler hinten rechts, der
 * nach hinten-außen abknickt (bleibt unter dem V, damit das V die Silhouette führt), 3 Kerben, Höhe × 1,4.
 *
 * Aufbau (Basis-Maße, y = Boden, +Z = vorn): hull – Kruste, Buckel, Teamplatte, Seitenplatten, 3 Fühler, Kerben.
 */
import { cylinder, defineModel, frustum, plate, stripes } from '@faf/modelkit';
import { crust, feeler, feelerPair } from './_wehr.ts';

const K = crust({ size: [1.94, 1.94], h: 0.26, rim: 0.2, seed: 31 });
const F = K.floor;
const HUB_H = 0.26;
const HUB_TOP = F + HUB_H;

export default defineModel({
  id: 'f2:str_t3_radar',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        frustum({ radius: 0.58, radiusTop: 0.4, height: HUB_H + 0.02, segments: 6, caps: 'top', at: [0, F + HUB_H / 2 - 0.01, 0], mat: 'chitin', keep: true, tag: 'carapace' }),
        cylinder({ radius: 0.36, height: 0.03, segments: 6, caps: 'top', at: [0, HUB_TOP + 0.01, 0], mat: 'team', tag: 'carapace' }),
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
        // dritter, kurzer Fühler: hinten rechts, knickt nach hinten-außen ab
        ...feeler({ root: [-0.12, HUB_TOP - 0.06, -0.22], knee: [-0.3, HUB_TOP + 0.72, -0.46], tip: [-0.55, HUB_TOP + 1.12, -0.9], radius: [0.13, 0.12, 0.04] }),
        stripes({ count: 3, width: 0.2, stripe: 0.1, gap: 0.07, rot: [0, 90, 0], at: [0.17, F + 0.005, -0.74] }),
      ],
    },
  ],
  notes: 'v_radar T3: statisch, Roster-Maßstab y 1,4.',
});
