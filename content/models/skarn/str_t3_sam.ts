/**
 * Igel (f2:str_t3_sam) – Raketenabwehr T3, 2×2 (Roster-Maßstab xz 2,0 / y 2,8; Basis 1×1).
 *
 * Roster: „Kruste auf 2×2 mit doppelt so vielen, dickeren Dornen im Halbkreis (4), 3 Tech-Streifen.“ faction.md
 * §5.2: Igel = Dornenkamm mit doppelt so vielen, dickeren Dornen im Halbkreis. Die vier Dornen stehen auf einem
 * nach vorn gewölbten Halbkreis-Sockel (Halbachteck, keine Kurven) und fächern leicht nach außen (im Spiel ≥ 80° steil,
 * y-Maßstab 1,4-fach), jeder mit Sehnen-Manschette, auf teamfarbener Sockelplatte. Gegen Schlehe: Halbkreis statt
 * Riegel, 4 dicke statt 2–3 schlanke Dornen, 3 Kerben.
 *
 * Aufbau (Basis-Maße, y = Boden, +Z = vorn):
 *   hull   – Kruste, 3 Kerben hinten auf dem Boden
 *   turret – Halbkreis-Sockel (Chitin, Teamplatte) + 4 Dornen; dreht um +Y   (PartStream 1)
 */
import { defineModel, extrude, spike, stripes, strut, type Vec3 } from '@faf/modelkit';
import { crust } from './_wehr.ts';

const K = crust({ size: [0.97, 0.97], h: 0.16, seed: 41 });
const F = K.floor;
const BASE_H = 0.15;
const TOP = F + BASE_H;
const ARC_R = 0.24;
/** Winkel der Dornwurzeln auf dem Halbkreis (0° = +X, 90° = vorn). */
const ANG = [-10, 50, 130, 190];
/** Halbachteck in der Draufsicht [x, z], nach vorn gewölbt (gerade Kante hinten). */
function halfOct(r: number, z0: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let a = -22.5; a <= 202.5 + 1e-6; a += 45) pts.push([r * Math.cos((a * Math.PI) / 180), z0 + r * Math.sin((a * Math.PI) / 180)]);
  return pts;
}

const roots: Vec3[] = ANG.map((a) => [ARC_R * Math.cos((a * Math.PI) / 180), TOP, -0.06 + ARC_R * Math.sin((a * Math.PI) / 180)]);

export default defineModel({
  id: 'f2:str_t3_sam',
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, stripes({ count: 3, width: 0.1, stripe: 0.08, gap: 0.05, rot: [0, 90, 0], at: [0.13, F + 0.005, -0.28] })],
    },
    {
      name: 'turret',
      pivot: [0, F, 0],
      anim: 'yaw',
      shapes: [
        // Halbkreis-Sockel: Halbachteck, Wände leicht geböscht (zwei Lagen)
        extrude({ profile: halfOct(0.4, -0.08), depth: BASE_H * 0.6, axis: 'y', at: [0, F + BASE_H * 0.3 - 0.01, 0], mat: 'chitin', keep: true, tag: 'neck' }),
        extrude({ profile: halfOct(0.34, -0.07), depth: BASE_H * 0.5, axis: 'y', at: [0, F + BASE_H * 0.75, 0], mat: 'team', keep: true, tag: 'neck' }),
        // 4 dicke Dornen, leicht nach außen gefächert
        ...roots.flatMap((r, i) => {
          const a = (ANG[i]! * Math.PI) / 180;
          const out = 0.1;
          return [
            strut({ from: [r[0], r[1] - 0.04, r[2]], to: [r[0], r[1] + 0.05, r[2]], radius: 0.175, sides: 4, caps: 'end', mat: 'sinew', maxLod: 1, tag: 'spike' }),
            spike({ from: r, to: [r[0] + out * Math.cos(a), 0.92 - (i % 3 === 0 ? 0.08 : 0), r[2] + out * Math.sin(a)], radius: 0.15, mat: 'chitin', keep: true, tag: 'spike' }),
          ];
        }),
      ],
    },
  ],
  notes: 'v_aa_struct (SAM): Basis 1×1, Roster-Maßstab xz 2,0 / y 2,8 ergibt 2×2 und steilere Dornen.',
});
