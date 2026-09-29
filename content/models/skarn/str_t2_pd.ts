/**
 * Falle II (f2:str_t2_pd) – Punktverteidigung T2, 2×2 (Roster-Maßstab xz 2,0 / y 2,4; Basis = Falle I auf 1×1).
 *
 * Roster: „Falle × 1,3 mit drei Linsen unter der Falltür, 2 Tech-Streifen.“ Dieselbe Grundform wie Falle I (Kruste,
 * Bau mit dunklem Maul, schräge Falltür mit Rückenplatte), T2 liest man an der breiteren Tür mit Seitenklappen
 * (T2-Seitenplatten, faction.md §3.4), dem Linsen-Fächer (mittlere Linse lang, zwei kürzere daneben) und 2 Kerben.
 * Alle drei Linsen waagerecht (Direktfeuer), fest in der Tür-Drehung (Roster: 1 animierter Part).
 *
 * Aufbau (Basis-Maße vor dem Maßstab, y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull   – Kruste (Krustengrau, Teamrand, Chitinboden)
 *   turret – Bau + Falltür (Team-Rückenplatte, 2 Kerben) + Seitenklappen + drei Granatlinsen; dreht um +Y (PartStream 1)
 */
import { bipyramid, defineModel, extrude, group, mirrorX, stripes, strut } from '@faf/modelkit';
import { crust } from './_wehr.ts';

const K = crust({ size: [0.97, 0.97], h: 0.17, rim: 0.075, seed: 23 });
const F = K.floor;
const HINGE_Y = F + 0.06;
const HINGE_Z = -0.4;
const DOOR_DEG = 36;
const MAW_Z = 0.06;
const doorY = (z: number): number => HINGE_Y + (z - HINGE_Z) * Math.tan((DOOR_DEG * Math.PI) / 180);
const LENS_Y = F + 0.14;
/** Falltür (Draufsicht [x, z] ab Scharnier): breiter als bei Falle I, vorn gefast. */
const DOOR: [number, number][] = [
  [-0.34, 0],
  [0.34, 0],
  [0.42, 0.44],
  [0.2, 0.8],
  [-0.2, 0.8],
  [-0.42, 0.44],
];
const INLAY = DOOR.map(([x, z]): [number, number] => [x * 0.8, 0.06 + z * 0.8]);

/** Granatlinse mit Hals (Sehne), waagerecht bei x. */
function lensAt(x: number, len: number, r: number, z: number, front: number): ReturnType<typeof group> {
  return group([
    strut({ from: [x, LENS_Y, z - len * 0.4], to: [x, LENS_Y, z - len * 0.05], radius: r * 0.72, caps: false, mat: 'sinew', maxLod: 1, tag: 'neck' }),
    bipyramid({ radius: r, length: len, front, sides: 4, at: [x, LENS_Y, z], mat: 'garnet', keep: true, tag: 'lens' }),
  ]);
}

export default defineModel({
  id: 'f2:str_t2_pd',
  parts: [
    { name: 'hull', shapes: K.shapes },
    {
      name: 'turret',
      pivot: [0, F, 0],
      anim: 'yaw',
      shapes: [
        // Bau (Seitenansicht [z, y]) mit dunklem Maul vorn
        extrude({
          profile: [
            [HINGE_Z, F - 0.02],
            [MAW_Z, F - 0.02],
            [MAW_Z, doorY(MAW_Z) - 0.02],
            [HINGE_Z, HINGE_Y],
          ],
          depth: 0.66,
          axis: 'x',
          mat: 'chitin',
          tag: 'carapace',
        }),
        extrude({
          profile: [
            [MAW_Z - 0.04, F + 0.02],
            [MAW_Z + 0.005, F + 0.02],
            [MAW_Z + 0.005, doorY(MAW_Z) - 0.05],
            [MAW_Z - 0.04, doorY(MAW_Z) - 0.05],
          ],
          depth: 0.6,
          axis: 'x',
          mat: 'underside',
          maxLod: 1,
          tag: 'carapace',
        }),
        // Seitenklappen (T2): flache Chitinplatten, schräg an den Bauflanken
        mirrorX(
          extrude({
            profile: [
              [HINGE_Z + 0.06, F],
              [0.1, F],
              [0.04, F + 0.24],
              [HINGE_Z + 0.06, F + 0.08],
            ],
            depth: 0.05,
            axis: 'x',
            at: [0.37, 0, 0],
            rot: [0, 0, -18],
            mat: 'chitin',
            maxLod: 1,
            tag: 'carapace',
          }),
        ),
        // Falltür mit Rückenplatte (Team) und 2 Kerben
        group(
          [
            extrude({ profile: DOOR, depth: 0.06, axis: 'y', mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
            extrude({ profile: INLAY, depth: 0.02, axis: 'y', at: [0, 0.035, 0], mat: 'team', keep: true, maxLod: 1, tag: 'carapace' }),
            // LOD2: eine Tür ganz in Teamfarbe statt Platte + Einlage
            extrude({ profile: DOOR, depth: 0.06, axis: 'y', mat: 'team', keep: true, minLod: 2, tag: 'carapace' }),
            stripes({ count: 2, width: 0.2, gap: 0.06, rot: [0, 90, 0], at: [0.08, 0.05, 0.2], maxLod: 1 }),
          ],
          { at: [0, HINGE_Y + 0.03, HINGE_Z - 0.02], rot: [-DOOR_DEG, 0, 0] },
        ),
        // Linsen-Fächer: mittlere lang (ragt vor die Tür), zwei kürzere daneben
        lensAt(0, 0.6, 0.15, 0.21, 0.5),
        lensAt(0.24, 0.48, 0.13, 0.19, 0.55),
        lensAt(-0.24, 0.48, 0.13, 0.19, 0.55),
      ],
    },
  ],
  notes: 'Basis 1×1 wie Falle I; Roster-Maßstab xz 2,0 / y 2,4 ergibt 2×2. Drei Linsen fest im Tür-Part (1 animierter Part).',
});
