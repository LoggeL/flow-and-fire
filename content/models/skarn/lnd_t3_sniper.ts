/**
 * Langbein (f2:lnd_t3_sniper) – Skarn-Präzisionsläufer T3.
 *
 * Roster: „Panzer hoch über dem Boden (Knie ≥ 1,5 × Rumpflänge) auf 6 überlangen Beinen, Linse ≥ 1,2 × Rumpflänge;
 * Maßstab 1,4.“ faction.md §5.2 Präzisionsläufer: extrem lange Linse, Panzer hoch über dem Boden, 6 überlange Beine;
 * verboten: zweite Linse. Der Rumpf ist kurz und breit (0,8 × 0,74 WU, flacher Zeckenschild), damit Linse und
 * Beinspanne nach 1,4 im 1×1-Footprint bleiben und die Rückenplatte trotz der sechs Stelzbeine ≥ 30 % der Draufsicht
 * hält; die Linse liegt deshalb ab dem Hals über dem Vorderrücken. Beinradius vor dem Maßstab 0,088 (nach 1,4 Kante
 * ≈ 0,17 WU).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), Rückenplatte (Team), 3 Tech-Streifen
 *   legs_l – drei linke Stelzbeine                                      (PartStream 1, legs)
 *   legs_r – drei rechte Stelzbeine                                     (PartStream 2, legs)
 *   neck   – Sehnenhals, dreht (Yaw)                                    (PartStream 3)
 *   lens   – Langlinse (Granat, 1,0 WU = 1,25 × Rumpflänge), kippt (Pitch)   (PartStream 4)
 */
import { defineModel, strut, type Vec3 } from '@faf/modelkit';
import { carapace, garnetLens, keel, skarnLegs, techStripes } from './lnd_t1_tank.ts';

const K = keel({ len: 0.8, width: 0.74, height: 0.22, y: 1.0, z: -0.1, rearW: 0.8 });
const LEGS = skarnLegs({
  hips: [0.1, -0.1, -0.3].map((z): Vec3 => [0.22, K.y - 0.02, z]),
  footOut: 0.44, // Spanne 1,32 WU ≈ 1,8 × Rumpfbreite
  splay: 0.6,
  kneeAt: 0.4,
  kneeY: K.top + 0.18, // Knie ≈ 1,3 WU ≥ 1,5 × Rumpflänge (1,2)
  radius: [0.088, 0.084],
});
const NECK_Z = K.bow - 0.34;
const LENS_Y = K.top + 0.06;
const LENS_LEN = 1.0;

export default defineModel({
  id: 'f2:lnd_t3_sniper',
  parts: [
    { name: 'hull', shapes: [...carapace(K), ...techStripes(K, 3)] },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', shapes: LEGS.right },
    {
      name: 'neck',
      pivot: [0, K.top, NECK_Z],
      anim: 'yaw',
      shapes: [strut({ from: [0, K.top - 0.06, NECK_Z - 0.06], to: [0, LENS_Y, NECK_Z + 0.08], radius: 0.1, caps: false, mat: 'sinew', maxLod: 1, tag: 'neck' })],
    },
    {
      name: 'lens',
      parent: 'neck',
      pivot: [0, LENS_Y, NECK_Z + 0.06],
      anim: 'pitch',
      // Langlinse 1,0 WU = 1,25 × Rumpflänge, liegt ab dem Hals über dem Bug, Spitze 0,6 WU vor der Bugspitze
      shapes: [garnetLens([0, LENS_Y, NECK_Z - 0.06 + LENS_LEN / 2], LENS_LEN, 0.13, 0.74)],
    },
  ],
  notes: 'v_sniper: Hals-Yaw, Linsen-Pitch; 6 Stelzbeine als legs_l/legs_r.',
});
