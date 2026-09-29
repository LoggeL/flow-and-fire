/**
 * Bilsenkraut (f2:str_t3_arty) – Schwere Artilleriestellung T3, 8×8 (Roster-Maßstab xz 4,0 / y 4,67; Basis auf 2×2,
 * alle Maße unten in Basis-Einheiten, im Spiel × 4 bzw. × 4,67).
 *
 * Roster: „8×8: doppelter Schwanz, Kapsel Ø 3,0 WU, Gegengewicht; 3 Tech-Streifen.“ faction.md §5.2: großer Schwanz
 * auf Kruste, Bilsenkraut mit Kapsel Ø 3,0 WU und doppeltem Schwanz; verboten: Linse.
 * Grundform wie der Schierling (Kruste, Sockel, Sechskant-Panzer mit Rückenplatte, Skorpionbogen über dem Rücken), T3 =
 * zwei parallele Schwänze (Team), die oben eine gemeinsame riesige Sechskant-Kapsel (Sehne, Ø 0,75 Basis = 3,0 WU)
 * tragen, ein Gegengewicht-Panzer hinten auf der Lafette und 3 Kerben. Die Kapselachse ist so vorverzerrt, dass sie
 * nach dem y-Maßstab (4,67 / 4) im Spiel 50° steht. Paartest Bilsenkraut↔Druse III: Bogen mit schräger Kapsel gegen
 * senkrechte Kristalle.
 *
 * Aufbau (Basis-Maße, y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull   – Kruste (Teamrand)
 *   turret – Sockel + Lafetten-Panzer (Rückenplatte, 3 Kerben) + Gegengewicht; Yaw   (PartStream 1)
 *   tail   – zwei Schwänze (Team) mit Manschetten + gemeinsame Kapsel; Pitch         (PartStream 2)
 */
import { defineModel, extrude, frustum, spike, stripes, strut, type Shape, type Vec3 } from '@faf/modelkit';
import { baseElevation, crust, tailBody } from './_wehr.ts';

const K = crust({ size: [1.96, 1.96], h: 0.2, rim: 0.16, jag: 0.05, seed: 71 });
const F = K.floor;
const PED_H = 0.1;
const T = F + PED_H + 0.1;
const rad = (a: number): number => (a * Math.PI) / 180;
const SHELL: [number, number][] = [
  [-0.5, -0.66],
  [0.5, -0.66],
  [0.64, 0.02],
  [0.26, 0.62],
  [-0.26, 0.62],
  [-0.64, 0.02],
];
const INLAY = SHELL.map(([x, z]): [number, number] => [x * 0.78, z * 0.8 - 0.02]);

/** Kapselachse: im Spiel 50°, vor dem Maßstab flacher. */
const ELEV = baseElevation(50, 4.67, 4);
const DIR: Vec3 = [0, Math.sin(rad(ELEV)), Math.cos(rad(ELEV))];
const TAIL_X = 0.3;
/** Schwanz-Gelenke (linke Seite, +X); die Spitze sitzt im Kapselboden. */
const J: Vec3[] = [
  [TAIL_X, T - 0.02, -0.46],
  [TAIL_X + 0.04, T + 0.4, -0.7],
  [TAIL_X - 0.04, T + 0.78, -0.56],
  [0.17, T + 0.98, -0.3],
];
const R = [0.15, 0.14, 0.12, 0.11];
const POD_R = 0.375;
const POD_LEN = 0.66;
const POD0: Vec3 = [0, J[3]![1] - 0.02, J[3]![2] - 0.04];
const at = (t: number): Vec3 => [POD0[0] + DIR[0] * t, POD0[1] + DIR[1] * t, POD0[2] + DIR[2] * t];

function tailSide(s: 1 | -1): Shape[] {
  const j = J.map((p): Vec3 => [s * p[0], p[1], p[2]]);
  const col = (i: number): Shape => {
    const a = j[i - 1]!;
    const b = j[i + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const d: Vec3 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
    const c = j[i]!;
    return strut({ from: [c[0] - d[0] * 0.05, c[1] - d[1] * 0.05, c[2] - d[2] * 0.05], to: [c[0] + d[0] * 0.05, c[1] + d[1] * 0.05, c[2] + d[2] * 0.05], radius: R[i]! * 1.3, caps: false, mat: 'sinew', maxLod: 0, tag: 'tail' });
  };
  return [
    ...tailBody(j, R),
    col(1),
    col(2),
  ];
}

export default defineModel({
  id: 'f2:str_t3_arty',
  parts: [
    { name: 'hull', shapes: K.shapes },
    {
      name: 'turret',
      pivot: [0, F, 0],
      anim: 'yaw',
      shapes: [
        frustum({ radius: 0.62, radiusTop: 0.54, height: PED_H + 0.02, segments: 6, caps: false, at: [0, F + PED_H / 2 - 0.01, 0], mat: 'underside', maxLod: 1, tag: 'neck' }),
        extrude({ profile: SHELL, depth: 0.1, axis: 'y', at: [0, T - 0.05, 0], mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
        extrude({ profile: INLAY, depth: 0.02, axis: 'y', at: [0, T + 0.005, 0], mat: 'team', keep: true, maxLod: 1, tag: 'carapace' }),
        extrude({ profile: SHELL, depth: 0.1, axis: 'y', at: [0, T - 0.05, 0], mat: 'team', keep: true, minLod: 2, tag: 'carapace' }),
        stripes({ count: 3, width: 0.16, stripe: 0.08, gap: 0.06, rot: [0, 90, 0], at: [0.14, T + 0.02, 0.2], maxLod: 1 }),
        // Gegengewicht: flacher Chitin-Keil hinten auf der Lafette (Seitenansicht [z, y]), vorn hoch, hinten flach
        extrude({
          profile: [
            [-0.86, T - 0.08],
            [-0.5, T - 0.02],
            [-0.52, T + 0.2],
            [-0.8, T + 0.1],
          ],
          depth: 0.5,
          axis: 'x',
          mat: 'chitin',
          maxLod: 1,
          tag: 'carapace',
        }),
      ],
    },
    {
      name: 'tail',
      parent: 'turret',
      pivot: [0, J[0]![1], J[0]![2]],
      anim: 'pitch',
      shapes: [
        ...tailSide(1),
        ...tailSide(-1),
        // gemeinsame Kapsel: Sechskant-Prisma Ø 0,75 (im Spiel 3,0 WU) mit Spitze, Sehne
        strut({ from: at(0), to: at(POD_LEN), radius: POD_R, sides: 6, caps: 'start', mat: 'sinew', keep: true, tag: 'pod' }),
        spike({ from: at(POD_LEN), to: at(POD_LEN + 0.3), radius: POD_R, sides: 6, mat: 'sinew', keep: true, tag: 'pod' }),
      ],
    },
  ],
  notes: 'v_arty_struct T3: zwei Schwänze + gemeinsame Kapsel als ein Pitch-Part; Kapselachse für y/xz = 4,67/4 vorverzerrt.',
});
