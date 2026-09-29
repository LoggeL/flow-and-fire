/**
 * Falle I (f2:str_t1_pd) – Punktverteidigung T1, 1×1.
 *
 * Roster: „Gezackte Kruste, schräge Falltür-Platte (teamfarben), darunter waagerechte Granatlinse.“ faction.md §5.2:
 * dieselbe Linse wie die Zecke (gestreckte Doppelpyramide auf kurzem Hals, waagerecht = Direktfeuer) unter einer
 * schrägen Falltür. Die Tür ist hinten angeschlagen und vorn um 38° aufgestellt, darunter ein dunkles Maul, aus dem
 * die Linse ragt. Paartest Falle↔Schlehe: flach und waagerecht gegen hohe senkrechte Dornen.
 * Teamfarbe: Krustenrand + Falltür; 1 Quarz-Kerbe hinten auf der Tür; keine Glut (keine Flow-Einheit).
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull   – Kruste (Krustengrau, Teamrand, Chitinboden)
 *   turret – Bau (Chitin-Keil mit dunklem Maul) + Falltür (Team) + Kerbe; dreht um +Y        (PartStream 1)
 *   lens   – Hals (Sehne) + Granatlinse, kippt (Pitch)                                      (PartStream 2)
 */
import { bipyramid, defineModel, extrude, group, stripes, strut } from '@faf/modelkit';
import { crust } from './_wehr.ts';

const K = crust({ size: [0.97, 0.97], h: 0.2, rim: 0.08, seed: 11 });
const F = K.floor;
const HINGE_Y = F + 0.06;
const HINGE_Z = -0.38;
const DOOR_DEG = 38;
const MAW_Z = 0.08;
/** Oberkante des Baus an der Stelle z (folgt der Tür). */
const doorY = (z: number): number => HINGE_Y + (z - HINGE_Z) * Math.tan((DOOR_DEG * Math.PI) / 180);
const LENS_Y = F + 0.16;
/** Falltür in der Draufsicht [x, z] ab Scharnier (z = 0): hinten breit, vorn zur Spitze gefast. */
const DOOR: [number, number][] = [
  [-0.3, 0],
  [0.3, 0],
  [0.37, 0.44],
  [0.15, 0.8],
  [-0.15, 0.8],
  [-0.37, 0.44],
];
/** Rückenplatte: Tür um 16 % eingezogen (Chitinrand bleibt sichtbar). */
const INLAY = DOOR.map(([x, z]): [number, number] => [x * 0.8, 0.06 + z * 0.8]);

export default defineModel({
  id: 'f2:str_t1_pd',
  parts: [
    { name: 'hull', shapes: K.shapes },
    {
      name: 'turret',
      pivot: [0, F, 0],
      anim: 'yaw',
      shapes: [
        // Bau: Keil unter der Tür (Seitenansicht [z, y]), vorn offen als dunkles Maul
        extrude({
          profile: [
            [HINGE_Z, F - 0.02],
            [MAW_Z, F - 0.02],
            [MAW_Z, doorY(MAW_Z) - 0.02],
            [HINGE_Z, HINGE_Y],
          ],
          depth: 0.46,
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
          depth: 0.4,
          axis: 'x',
          mat: 'underside',
          maxLod: 1,
          tag: 'carapace',
        }),
        // Falltür: flache Chitinplatte mit Bugspitze, teamfarbene Rückenplatte eingelegt, hinten angeschlagen, vorn
        // aufgestellt; Kerbe auf dem hinteren Drittel
        group(
          [
            extrude({ profile: DOOR, depth: 0.06, axis: 'y', mat: 'chitin', keep: true, tag: 'carapace' }),
            extrude({ profile: INLAY, depth: 0.02, axis: 'y', at: [0, 0.035, 0], mat: 'team', keep: true, tag: 'carapace' }),
            stripes({ count: 1, width: 0.2, rot: [0, 90, 0], at: [0, 0.05, 0.2] }),
          ],
          { at: [0, HINGE_Y + 0.03, HINGE_Z - 0.02], rot: [-DOOR_DEG, 0, 0] },
        ),
      ],
    },
    {
      name: 'lens',
      parent: 'turret',
      pivot: [0, LENS_Y, 0.1],
      anim: 'pitch',
      shapes: [
        strut({ from: [0, LENS_Y, -0.08], to: [0, LENS_Y, 0.12], radius: 0.13, caps: false, mat: 'sinew', maxLod: 1, tag: 'neck' }),
        // Granatlinse wie die Zecke: 4-seitig, waagerecht, die vordere Pyramide ragt ganz aus dem Maul
        bipyramid({ radius: 0.19, length: 0.62, front: 0.5, sides: 4, at: [0, LENS_Y, 0.2], mat: 'garnet', keep: true, tag: 'lens' }),
      ],
    },
  ],
  notes: 'v_pd: Falltür (Yaw) + Linse (Pitch). Kruste aus _wehr.ts (gezackter Rand, Teamband).',
});
