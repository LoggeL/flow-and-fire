/**
 * Wolfsmilch (f2:lnd_t2_mml) – Skarn-Raketenwerfer T2.
 *
 * Roster: „Schwanz trägt statt der Kapsel einen breiten Köcher (0,5 × 0,25 × 1,1 WU) bei 50° (≥ 2 × Dorn-Breite);
 * keine Linse.“ faction.md §5.2 Raketenwerfer: breiter Köcher statt Kapsel, verboten: Kapsel, Linse. Pflicht-Paare
 * Wolfsmilch↔Ginster (breiter Schrägköcher gegen senkrechte Dornen) und Ohrwurm↔Wolfsmilch (waagerechtes
 * Linsenpaar gegen Schrägköcher). Köcher vor dem Maßstab 0,4 × 0,2 × 0,84 (nach 1,3: 0,52 × 0,26 × 1,09 WU).
 *
 * Chassis und Schwanz der Nessel (lnd_t1_arty.ts), Schwanz etwas flacher, damit der lange Köcher nicht überragt.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), Rückenplatte (Team), 2 Tech-Streifen
 *   legs_l – zwei linke Knickbeine                                      (PartStream 1, legs)
 *   legs_r – zwei rechte Knickbeine                                     (PartStream 2, legs)
 *   neck   – Schwanzansatz (Sehne), dreht (Yaw)                         (PartStream 3)
 *   tail   – Schwanz (Team) mit Köcher (Chitin, Team-Deckel, Sehnen-Mündungen), kippt (Pitch)   (PartStream 4)
 */
import { box, defineModel, quad, strut, type Vec3 } from '@faf/modelkit';
import { carapace, keel, skarnLegs, techStripes } from './lnd_t1_tank.ts';
import { TIP_DIR, tail, tailJoints } from './lnd_t1_arty.ts';

const K = keel({ len: 1.2, width: 0.68, height: 0.24, y: 0.42, z: -0.1 });
const LEGS = skarnLegs({
  hips: [
    [0.24, K.y - 0.02, 0.18],
    [0.24, K.y - 0.02, -0.34],
  ],
  footOut: 0.34, // Spanne 1,16 WU ≈ 1,7 × Rumpfbreite
  splay: 0.6,
  kneeY: K.top + 0.12,
  radius: [0.1, 0.095],
});
const J = tailJoints(K, 0, 0.55);
const BASE: Vec3 = J[0]!;
const Q_LEN = 0.84;
const Q: Vec3 = [J[3]![0] + TIP_DIR[0] * (Q_LEN / 2 - 0.06), J[3]![1] + TIP_DIR[1] * (Q_LEN / 2 - 0.06), J[3]![2] + TIP_DIR[2] * (Q_LEN / 2 - 0.06)];
const MOUTH: Vec3 = [Q[0] + TIP_DIR[0] * (Q_LEN / 2 + 0.005), Q[1] + TIP_DIR[1] * (Q_LEN / 2 + 0.005), Q[2] + TIP_DIR[2] * (Q_LEN / 2 + 0.005)];

export default defineModel({
  id: 'f2:lnd_t2_mml',
  parts: [
    { name: 'hull', shapes: [...carapace(K), ...techStripes(K, 2)] },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', shapes: LEGS.right },
    {
      name: 'neck',
      pivot: BASE,
      anim: 'yaw',
      shapes: [strut({ from: [0.12, K.top - 0.04, BASE[2]], to: [-0.12, K.top - 0.04, BASE[2]], radius: 0.13, mat: 'sinew', maxLod: 1, tag: 'neck' })],
    },
    {
      name: 'tail',
      parent: 'neck',
      pivot: BASE,
      anim: 'pitch',
      shapes: [
        ...tail(J, 0.14),
        // Köcher: breite, flache Box bei 50°; Rückseite mit Teamfarben-Deckel
        box({ size: [0.4, 0.2, Q_LEN], at: Q, rot: [-50, 0, 0], mat: 'chitin', keep: true, tag: 'pod' }),
        box({ size: [0.32, 0.02, Q_LEN * 0.74], at: [Q[0], Q[1] + 0.105 * 0.643, Q[2] - 0.105 * 0.766], rot: [-50, 0, 0], mat: 'team', maxLod: 1, tag: 'pod' }),
        // Mündungen: 2 × 2 Sehnenflecken auf der Stirnseite
        ...[
          [0.09, 0.045],
          [-0.09, 0.045],
          [0.09, -0.045],
          [-0.09, -0.045],
        ].map(([dx, dv]) =>
          quad({ size: [0.11, 0.06], at: [MOUTH[0] + dx!, MOUTH[1] + dv! * 0.643, MOUTH[2] - dv! * 0.766], rot: [40, 0, 0], mat: 'sinew', maxLod: 0, tag: 'pod' }),
        ),
      ],
    },
  ],
  notes: 'v_mml: Schwanz mit Köcher (Pitch) auf Schwanzansatz (Yaw); Beine als legs_l/legs_r.',
});
