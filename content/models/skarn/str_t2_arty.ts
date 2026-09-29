/**
 * Schierling (f2:str_t2_arty) – Artilleriestellung T2, 2×2.
 *
 * Roster: „Großer Schwanz auf Kruste, Kapsel schräg nach vorn (45–55°).“ faction.md §3.2/§5.2: Schwanz = Artillerie
 * (Monopol), drei gebogene Keilsegmente über dem Rücken, die Spitze mit der Kapsel zeigt schräg nach vorn;
 * Kapsel-Ø ≥ 0,34 WU; verboten: Linse, waagerechte Elemente.
 * Ein flacher Sechskant-Panzer mit Bugspitze (Chitin, teamfarbene Rückenplatte, 2 Kerben) dreht auf einem Sockel in
 * der Kruste; hinten wächst der Schwanz (Team) als Skorpionbogen nach oben und vorn, das letzte Glied und die
 * Sechskant-Kapsel (Sehne, Ø 0,46 WU) stehen 50° steil nach vorn.
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull   – Kruste (Teamrand)
 *   turret – Sockel + Panzer (Schwanzansatz, Kitbash `neck`/`carapace`) mit Rückenplatte und Kerben; Yaw (PartStream 1)
 *   tail   – drei Schwanzglieder (Team) + Sehnen-Manschetten + Kapsel; Pitch um den Ansatz          (PartStream 2)
 */
import { defineModel, extrude, frustum, stripes, type Vec3 } from '@faf/modelkit';
import { crust, tail } from './_wehr.ts';

const K = crust({ size: [1.94, 1.94], h: 0.26, rim: 0.19, seed: 37 });
const F = K.floor;
const PED_H = 0.14;
const T = F + PED_H + 0.12; // Oberseite des Panzers
const rad = (a: number): number => (a * Math.PI) / 180;
/** Panzer in der Draufsicht [x, z]: Sechskant mit Bugspitze. */
const SHELL: [number, number][] = [
  [-0.42, -0.62],
  [0.42, -0.62],
  [0.54, 0.02],
  [0.2, 0.56],
  [-0.2, 0.56],
  [-0.54, 0.02],
];
const INLAY = SHELL.map(([x, z]): [number, number] => [x * 0.78, z * 0.8 - 0.02]);

const P0: Vec3 = [0, T - 0.02, -0.42];
const P1: Vec3 = [0, T + 0.62, -0.8];
const P2: Vec3 = [0, T + 1.3, -0.62];
const ELEV = 50;
const P3: Vec3 = [0, P2[1] + 0.42 * Math.sin(rad(ELEV)), P2[2] + 0.42 * Math.cos(rad(ELEV))];
const TAIL = tail({ joints: [P0, P1, P2, P3], radius: [0.25, 0.23, 0.2, 0.17], podLen: 0.5, podR: 0.23, podTip: 0.24 });

export default defineModel({
  id: 'f2:str_t2_arty',
  parts: [
    { name: 'hull', shapes: K.shapes },
    {
      name: 'turret',
      pivot: [0, F, 0],
      anim: 'yaw',
      shapes: [
        frustum({ radius: 0.52, radiusTop: 0.44, height: PED_H + 0.02, segments: 6, caps: false, at: [0, F + PED_H / 2 - 0.01, 0], mat: 'underside', maxLod: 1, tag: 'neck' }),
        extrude({ profile: SHELL, depth: 0.12, axis: 'y', at: [0, T - 0.06, 0], mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
        extrude({ profile: INLAY, depth: 0.02, axis: 'y', at: [0, T + 0.005, 0], mat: 'team', keep: true, maxLod: 1, tag: 'carapace' }),
        // LOD2: Panzer ganz in Teamfarbe statt Platte + Einlage
        extrude({ profile: SHELL, depth: 0.12, axis: 'y', at: [0, T - 0.06, 0], mat: 'team', keep: true, minLod: 2, tag: 'carapace' }),
        stripes({ count: 2, width: 0.2, gap: 0.08, rot: [0, 90, 0], at: [0.09, T + 0.02, 0.05], maxLod: 1 }),
      ],
    },
    { name: 'tail', parent: 'turret', pivot: P0, anim: 'pitch', shapes: TAIL.shapes },
  ],
  notes: 'v_arty_struct: Schwanz-Pitch um den Ansatz, Kapselachse 50° (Kitbash tail + pod).',
});
