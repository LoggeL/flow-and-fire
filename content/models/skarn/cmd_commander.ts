/**
 * Rädelsführer (f2:cmd_commander) – Skarn-Kommandant. **Referenzmodell für Skarn-Autoren.**
 *
 * Roster: „Großer 6-Beiner (Höhe 2,1 WU, Beinspanne 3,4 WU): Keilpanzer-Torso mit teamfarbenem Kopfkamm, Herzdruse
 * als stärkster Glutpunkt auf dem Rücken, Granatlinse mittig unter dem Kopf, zwei Quarz-Nadeln als Taster
 * links/rechts (symmetrisch, kein Waffen-/Bauarm-Schema), Spule im Rücken.“
 * faction.md §3.2/§5.2: flacher, facettierter Keil (Höhe ≤ 0,35 × Länge), Knie über der Rumpfoberkante, Füße auf das
 * 1,4–1,8-fache der Rumpfbreite gespreizt, Beinsegmente ≥ 0,17 WU, keine Kurven; Teamfarbe ≥ 35 % der Draufsicht
 * (Kopfkamm, Rückenplatten); Linse im Leerlauf dunkles Granatglas (`garnet`), Glut nur Herzdruse + Spulenachse.
 *
 * Kit-Muster für Skarn: `sweep` mit eckigem Sechskant-Profil (Keilpanzer mit Firstkante, Flat Shading),
 * `legPairs` (gespiegelte Knickbeine mit Spitzfüßen), `limb` (Taster-Nadeln), `bipyramid` (Granatlinse),
 * `crystalCluster` (Druse), LOD-Ersatz der Beine über `maxLod`/`minLod`.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Schwarzchitin)
 *   legs_l – drei linke Knickbeine, schwingen um die Hüften          (PartStream 1, legs)
 *   legs_r – drei rechte Knickbeine                                   (PartStream 2, legs)
 *   torso  – Rückenpanzer (Team), Kopfkamm (Team), Herzdruse (Glut), Spule mit Teamscheiben, Quarz-Taster; Yaw
 *                                                                     (PartStream 3, yaw)
 *   lens   – Hals + Granatlinse unter dem Kopf, kippt (Pitch)       (PartStream 4)
 */
import {
  bipyramid,
  crystalCluster,
  cylinder,
  defineModel,
  extrude,
  legPairs,
  limb,
  strut,
  sweep,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

const BODY_Y = 1.2; // Mittelebene des Panzers
const HIP_X = 0.4;
const HIP_Y = BODY_Y - 0.06;
const HIPS_Z = [0.42, 0, -0.42];

// Keilpanzer: Sechskant-Querschnitt mit Firstkante, Bugspitze vorn (+Z), Höhe 0,58 ≤ 0,35 × Länge 1,84
const KEEL: Vec3[] = [
  [0, BODY_Y, -0.86],
  [0, BODY_Y, -0.3],
  [0, BODY_Y, 0.42],
  [0, BODY_Y, 0.98],
];
const KEEL_R: [number, number][] = [
  [0.44, 0.2],
  [0.64, 0.3],
  [0.56, 0.26],
  [0.06, 0.05],
];
/** Obere Hälfte des Sechskant-Querschnitts mit Firstkante (u = seitlich, v = oben). */
const UPPER: Vec2[] = [
  [1, 0],
  [0.55, 0.8],
  [0, 1],
  [-0.55, 0.8],
  [-1, 0],
];
/** Untere Hälfte (flacher Bauch). */
const LOWER: Vec2[] = [
  [-1, 0],
  [-0.5, -0.7],
  [0.5, -0.7],
  [1, 0],
];

const legOpts = {
  hips: HIPS_Z.map((z): Vec3 => [HIP_X, HIP_Y, z]),
  footOut: 1.3, // Beinspanne 2 × (0,4 + 1,3) = 3,4 WU
  splay: 0.75,
  kneeAt: 0.35,
  kneeUp: 1.0, // Knie ≈ 1,74 WU, über der Panzeroberkante (1,5)
  radius: [0.13, 0.12, 0], // Kantenbreite ≥ 0,17 WU, Spitzfuß
  hipCap: false, // Hüfte steckt im Panzer
  mat: 'chitin',
  keep: true,
  tag: 'legs',
} as const;
const legs = legPairs({ ...legOpts, sides: 4, maxLod: 0 });
// LOD1/2: dreikantige Beine ohne Kniedeckel (die Überlappung verdeckt die Fuge)
const legsLow = legPairs({ ...legOpts, sides: 3, jointCaps: false, minLod: 1 });

const DRUSE = { count: 3, radius: 0.125, height: 0.5, spread: 0.22, lean: 24, seed: 7, at: [0, BODY_Y + 0.24, -0.26] as Vec3, mat: 'glow', tag: 'druse' };
const SPOOL: Vec3 = [0, BODY_Y + 0.2, -0.7];

/** Quarz-Taster (Bau-Nadel) auf der Seite x = ±1; LOD1 dreikantig, LOD2 ohne. */
function feeler(side: 1 | -1, sides: 3 | 4, lod: { readonly maxLod: 0 | 1; readonly minLod?: 1 }): ReturnType<typeof limb> {
  return limb({
    ...lod,
    sides,
    joints: [
      [side * 0.36, BODY_Y + 0.04, 0.4],
      [side * 0.74, BODY_Y + 0.34, 0.78],
      [side * 0.66, BODY_Y - 0.18, 1.3],
    ],
    radius: [0.12, 0.11, 0],
    hipCap: false,
    jointCaps: sides === 4,
    mat: 'quartz',
    keep: true,
    tag: 'needle',
  });
}

export default defineModel({
  id: 'f2:cmd_commander',
  parts: [
    {
      name: 'hull',
      shapes: [sweep({ path: KEEL, radius: KEEL_R, profile: LOWER, mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' })],
    },
    { name: 'legs_l', pivot: legs.pivotL, anim: 'legs', shapes: [legs.left, legsLow.left] },
    { name: 'legs_r', pivot: legs.pivotR, anim: 'legs', shapes: [legs.right, legsLow.right] },
    {
      name: 'torso',
      pivot: [0, BODY_Y, 0],
      anim: 'yaw',
      shapes: [
        // Rückenpanzer mit Firstkante (Teamfarbe); LOD2: ein Keil aus drei Querschnitten ohne Bauchschale
        sweep({ path: KEEL, radius: KEEL_R, profile: UPPER, mat: 'team', keep: true, maxLod: 1, tag: 'carapace' }),
        sweep({ path: [KEEL[0]!, KEEL[1]!, KEEL[3]!], radius: [KEEL_R[0]!, KEEL_R[1]!, KEEL_R[3]!], profile: UPPER, mat: 'team', minLod: 2 }),
        // Kopfkamm: flacher, nach hinten auslaufender Kamm über dem Kopf (Teamfarbe)
        extrude({
          profile: [
            [0.94, BODY_Y + 0.06],
            [0.58, BODY_Y + 0.44],
            [0.06, BODY_Y + 0.46],
            [0.3, BODY_Y + 0.26],
          ],
          depth: 0.18,
          mat: 'team',
          maxLod: 0,
          tag: 'carapace',
        }),
        // Herzdruse: stärkster Glutpunkt (drei Sechskant-Kristalle); LOD1 vierkantig, LOD2 ein Kristall
        crystalCluster({ ...DRUSE, sides: 6, keep: true, maxLod: 0 }),
        crystalCluster({ ...DRUSE, sides: 4, keep: true, minLod: 1, maxLod: 1 }),
        crystalCluster({ ...DRUSE, count: 1, radius: 0.2, sides: 4, keep: true, minLod: 2 }),
        // Spule quer im Rücken: Sehnen-Wickel, teamfarbene Randscheiben, Glutachse; LOD1 ein Block
        cylinder({ radius: 0.15, height: 0.6, axis: 'x', segments: 6, caps: false, at: SPOOL, mat: 'sinew', maxLod: 0, tag: 'spool' }),
        cylinder({ radius: 0.25, height: 0.08, axis: 'x', segments: 6, at: [0.3, SPOOL[1], SPOOL[2]], mat: 'team', maxLod: 0, tag: 'spool' }),
        cylinder({ radius: 0.25, height: 0.08, axis: 'x', segments: 6, at: [-0.3, SPOOL[1], SPOOL[2]], mat: 'team', maxLod: 0, tag: 'spool' }),
        cylinder({ radius: 0.07, height: 0.7, axis: 'x', segments: 3, at: SPOOL, mat: 'glow', maxLod: 0, tag: 'spool' }),
        cylinder({ radius: 0.23, height: 0.66, axis: 'x', segments: 4, at: SPOOL, mat: 'team', minLod: 1, maxLod: 1 }),
        // Quarz-Taster links/rechts (symmetrisch)
        feeler(1, 4, { maxLod: 0 }),
        feeler(-1, 4, { maxLod: 0 }),
        feeler(1, 3, { minLod: 1, maxLod: 1 }),
        feeler(-1, 3, { minLod: 1, maxLod: 1 }),
      ],
    },
    {
      name: 'lens',
      parent: 'torso',
      pivot: [0, BODY_Y - 0.2, 0.46],
      anim: 'pitch',
      shapes: [
        // Granatlinse: gestreckte Doppelpyramide, waagerecht, ragt über die Bugspitze
        // Hals: kurzes Vierkantprisma unter dem Kopf
        strut({ from: [0, BODY_Y - 0.06, 0.4], to: [0, BODY_Y - 0.2, 0.6], radius: 0.13, caps: false, mat: 'sinew', maxLod: 0, tag: 'neck' }),
        bipyramid({ radius: 0.18, length: 0.8, front: 0.62, sides: 4, at: [0, BODY_Y - 0.2, 0.9], mat: 'garnet', keep: true, tag: 'lens' }),
      ],
    },
  ],
  notes: 'v_cmd: 6 Beine als zwei Parts (legs_l/legs_r, Render-Pfad ersetzt sie später), Torso-Yaw, Linsen-Pitch.',
});
