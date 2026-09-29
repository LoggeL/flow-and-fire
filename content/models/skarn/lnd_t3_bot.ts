/**
 * Tarantel (f2:lnd_t3_bot) – Skarn-Belagerungsläufer T3.
 *
 * Roster: „Überlanger Keilpanzer auf 6 Beinen, Doppellinse plus kurze Nahlinse, Rückenpanzer, 3 Tech-Streifen.“
 * faction.md §5.2 Direktfeuer-Läufer T3: Doppellinse auf 6 Beinen, verboten: Schwanz. §3.4 T3: Maßstab 1,7 (2×2),
 * 6 Beine, Doppelaufbau oder überlanger Panzer, 3 Streifen. Beinradius vor dem Maßstab 0,085 (nach 1,7 ≈ 0,145 ⇒
 * Kante ≥ 0,2 WU), damit die Beine nicht plump werden.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), überlange Rückenplatte (Team), Rückenpanzer-Sattel (Chitin), 3 Tech-Streifen
 *   legs_l – drei linke Knickbeine                                      (PartStream 1, legs)
 *   legs_r – drei rechte Knickbeine                                     (PartStream 2, legs)
 *   neck   – Sehnenhals mit Joch, Doppellinse (Granat) und kurzer Nahlinse darunter, dreht (Yaw)   (PartStream 3)
 */
import { defineModel, plate, strut } from '@faf/modelkit';
import { carapace, garnetLens, keel, ridgeAt, skarnLegs, techStripes } from './lnd_t1_tank.ts';

const K = keel({ len: 1.7, width: 0.84, height: 0.32, y: 0.62, z: -0.14, waist: 0.35 });
const LEGS = skarnLegs({
  hips: [
    [0.28, K.y - 0.02, 0.3],
    [0.28, K.y - 0.02, -0.12],
    [0.28, K.y - 0.02, -0.54],
  ],
  footOut: 0.46, // Spanne 1,48 WU ≈ 1,76 × Rumpfbreite
  splay: 0.45,
  kneeY: K.top + 0.14,
  radius: [0.085, 0.08],
});
const NECK_Z = K.bow - 0.36;
const LENS_Y = K.top + 0.08;
const LENS_X = 0.14;
const SADDLE_Z = -0.02;

export default defineModel({
  id: 'f2:lnd_t3_bot',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...carapace(K),
        // Rückenpanzer: schmaler, gewölbter Chitin-Sattel mittig über dem Rücken (T3-Doppelaufbau)
        plate({ size: [0.4, 0.5], thickness: 0.08, arch: 0.06, archZ: 0.03, segments: [2, 2], point: 0.2, at: [0, ridgeAt(K, SADDLE_Z) + 0.04, SADDLE_Z], mat: 'chitin', maxLod: 1, tag: 'carapace' }),
        ...techStripes(K, 3),
      ],
    },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', shapes: LEGS.right },
    {
      name: 'neck',
      pivot: [0, K.top, NECK_Z],
      anim: 'yaw',
      shapes: [
        strut({ from: [0, K.top - 0.1, NECK_Z - 0.06], to: [0, LENS_Y - 0.02, NECK_Z + 0.12], radius: 0.11, caps: false, mat: 'sinew', maxLod: 1, tag: 'neck' }),
        strut({ from: [LENS_X + 0.04, LENS_Y, NECK_Z + 0.16], to: [-LENS_X - 0.04, LENS_Y, NECK_Z + 0.16], radius: 0.08, mat: 'sinew', maxLod: 1, tag: 'neck' }),
        // Doppellinse (0,62 WU) und kurze Nahlinse (0,32 WU) mittig darunter, alle waagerecht
        garnetLens([LENS_X, LENS_Y, K.bow + 0.12], 0.62, 0.13),
        garnetLens([-LENS_X, LENS_Y, K.bow + 0.12], 0.62, 0.13),
        garnetLens([0, K.y + 0.02, K.bow + 0.02], 0.34, 0.12, 0.7),
      ],
    },
  ],
  notes: 'v_bot (T3): Doppellinse + Nahlinse fest am Hals (1 animierter Part laut Roster), Beine als legs_l/legs_r.',
});
