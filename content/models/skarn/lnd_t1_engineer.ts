/**
 * Flicker (f2:lnd_t1_engineer) – Skarn-Engineer T1; Grundform der Engineer-Familie (Stopfer T2, Weber T3
 * importieren `engineerParts`).
 *
 * Roster: „Kurzer breiter Keilpanzer mit Quarz-Deck auf 4 Beinen, Spule quer über dem Heck (Randscheiben teamfarben,
 * Achse glüht), eine Quarz-Nadel diagonal nach vorn rechts mit glühendem Emitter; 1 Tech-Streifen schwarz.“
 * faction.md §5.2 Engineer: Spule quer auf dem Rücken (Glutkern in der Achse) + Quarz-Deck, Nadeln = Tech (1/2/3,
 * verschieden lang, asymmetrisch), 4 Beine (T3: 6), keine Waffenform. Teamfarbe auf Spulen-Randscheiben und
 * Panzer-Seitenband (≥ 25 % der Draufsicht), Deck Quarz, Tech-Streifen schwarz auf dem Deck.
 *
 * Aufbau (y = Boden, +Z = Bug, +X = linke Seite):
 *   hull    – Bauchschale (Chitin), Keilpanzer mit flachem Deck (Team = Seitenband), Quarz-Deckplatte, schwarze
 *             Tech-Streifen, Spule quer über dem Heck (Sehne, Team-Randscheiben, Glutachse); T2/T3: kurze statische
 *             Nadeln
 *   legs_l  – linke Knickbeine (2 bzw. 3), Knie über dem Deck             (PartStream 1, legs)
 *   legs_r  – rechte Knickbeine                                           (PartStream 2, legs)
 *   needle  – Bau-Nadel (Quarz, 2 Glieder) von links hinten diagonal nach vorn rechts, dreht (Yaw)   (PartStream 3)
 *   emitter – glühende Nadelspitze (Fadenstrom-Quelle), kippt (Pitch)     (PartStream 4)
 * Maßstab 1,0 / 1,3 / 1,4 kommt aus dem Roster; Beine und Nadeln bleiben absolut ≥ 0,17 WU Kantenbreite.
 */
import {
  cylinder,
  defineModel,
  extrude,
  legPairs,
  limb,
  quad,
  spike,
  stripes,
  sweep,
  type PartDef,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

const BODY_Y = 0.5;
/** Keilpanzer: kurz und breit, flaches Deck (Engineer), Bugspitze vorn; Höhe 0,30 ≤ 0,35 × Länge 1,05. */
const KEEL: Vec3[] = [
  [0, BODY_Y, -0.5],
  [0, BODY_Y, -0.05],
  [0, BODY_Y, 0.3],
  [0, BODY_Y, 0.55],
];
const KEEL_R: [number, number][] = [
  [0.36, 0.16],
  [0.42, 0.16],
  [0.36, 0.15],
  [0.05, 0.04],
];
/** Oberseite mit flachem Deck: Seitenbänder (Team) fallen nach außen ab. */
const UPPER: Vec2[] = [
  [1, 0],
  [0.62, 0.85],
  [-0.62, 0.85],
  [-1, 0],
];
const LOWER: Vec2[] = [
  [-1, 0],
  [-0.5, -0.7],
  [0.5, -0.7],
  [1, 0],
];
/** Deckhöhe (flacher Teil hinten bis Mitte). */
export const ENG_DECK = BODY_Y + 0.16 * 0.85;
const SPOOL: Vec3 = [0, ENG_DECK + 0.1, -0.38];

type Tech = 1 | 2 | 3;
const SCALE: Record<Tech, number> = { 1: 1, 2: 1.3, 3: 1.4 };

/** Glieder-Radius im Basismaß, damit die Kante nach dem Roster-Maßstab ≥ 0,17 WU bleibt (4-Kant r ≥ 0,12). */
const rAbs = (tech: Tech, r: number): number => r / SCALE[tech];

function legSet(tech: Tech) {
  const hipsZ = tech === 3 ? [0.26, -0.02, -0.3] : [0.2, -0.22];
  const r = rAbs(tech, 0.12);
  const opts = {
    hips: hipsZ.map((z): Vec3 => [0.24, BODY_Y - 0.03, z]),
    footOut: tech === 3 ? 0.36 : 0.46, // Spanne 1,40 (T1) · 1,20 × 1,4 = 1,68 (T3) ≤ 2 × Footprint
    splay: tech === 3 ? 0.7 : 0.9,
    kneeAt: 0.35,
    kneeUp: 0.5, // Knie ≈ 0,80 über dem Deck (0,64)
    radius: [r, r * 0.92, 0],
    hipCap: false,
    mat: 'chitin',
    keep: true,
    tag: 'legs',
  } as const;
  return {
    hi: legPairs({ ...opts, sides: 4, maxLod: 0 }),
    lo: legPairs({ ...opts, sides: 3, jointCaps: false, minLod: 1 }),
  };
}

interface NeedleSpec {
  readonly joints: readonly [Vec3, Vec3, Vec3];
}
/** Nadel 1 (lang, Yaw): links hinten → Ellbogen über dem Deck → vorn rechts vor dem Bug. */
const N1: NeedleSpec = { joints: [[0.16, ENG_DECK, -0.18], [-0.04, ENG_DECK + 0.48, 0.16], [-0.36, ENG_DECK + 0.06, 0.62]] };
/** Nadel 2 (kurz, statisch, T2/T3): links vorn. */
const N2: NeedleSpec = { joints: [[0.2, ENG_DECK, 0.12], [0.34, ENG_DECK + 0.22, 0.3], [0.3, ENG_DECK - 0.06, 0.56]] };
/** Nadel 3 (mittel, statisch, T3): rechts hinten, seitlich ausgestellt. */
const N3: NeedleSpec = { joints: [[-0.2, ENG_DECK, -0.24], [-0.42, ENG_DECK + 0.3, -0.12], [-0.56, ENG_DECK + 0.04, 0.1]] };
const EMIT_TIP: Vec3 = [-0.47, ENG_DECK - 0.16, 0.8];

function needleShapes(tech: Tech, n: NeedleSpec, pointed: boolean): Shape[] {
  const r = rAbs(tech, 0.12);
  const radius = pointed ? [r, r * 0.9, 0] : [r, r * 0.9, r * 0.8];
  const base = { joints: n.joints, radius, hipCap: false, mat: 'quartz', keep: true, tag: 'needle' } as const;
  return [limb({ ...base, sides: 4, maxLod: 0 }), limb({ ...base, sides: 3, jointCaps: false, minLod: 1, ...(pointed ? { maxLod: 1 } : {}) })];
}

/** Engineer-Parts für Tech 1–3 (Maßstab aus dem Roster: 1,0 / 1,3 / 1,4). */
export function engineerParts(tech: Tech): PartDef[] {
  const legs = legSet(tech);
  // Tech-Streifen: 0,10 WU × Maßstab breit, Abstand 0,10 WU absolut ⇒ im Basismaß 0,10 / Maßstab
  const gap = 0.1 / SCALE[tech];
  const hull: Shape[] = [
    sweep({ path: KEEL, radius: KEEL_R, profile: LOWER, mat: 'chitin', keep: true, maxLod: 1, tag: 'carapace' }),
    sweep({ path: KEEL, radius: KEEL_R, profile: UPPER, mat: 'team', keep: true, maxLod: 1, tag: 'carapace' }),
    // LOD2: Panzer aus drei Querschnitten, ohne Bauchschale
    sweep({ path: [KEEL[0]!, KEEL[1]!, KEEL[3]!], radius: [KEEL_R[0]!, KEEL_R[1]!, KEEL_R[3]!], profile: UPPER, mat: 'team', keep: true, minLod: 2 }),
    // Quarz-Deck: flache, vorn spitze Platte auf dem Panzer (Klassenkennung Engineer)
    extrude({
      profile: [
        [0.2, -0.48],
        [0.23, -0.05],
        [0.17, 0.3],
        [0, 0.46],
        [-0.17, 0.3],
        [-0.23, -0.05],
        [-0.2, -0.48],
      ],
      depth: 0.03,
      axis: 'y',
      at: [0, ENG_DECK + 0.012, 0],
      mat: 'quartz',
      keep: true,
      maxLod: 1,
      tag: 'carapace',
    }),
    quad({ size: [0.4, 0.84], at: [0, ENG_DECK + 0.03, -0.04], mat: 'quartz', keep: true, minLod: 2 }),
    // Tech-Streifen schwarz auf dem Quarz-Deck, vor der Spule
    stripes({ count: tech, width: 0.3, gap, at: [0, ENG_DECK + 0.03, -0.1 + ((tech - 1) / 2) * (0.1 + gap)], mat: 'underside', maxLod: 1 }),
    // Spule quer über dem Heck: Sehnen-Wickel, teamfarbene Randscheiben, Glutachse; LOD2 ein Team-Block
    cylinder({ radius: 0.12, height: 0.44, axis: 'x', segments: 6, caps: false, at: SPOOL, mat: 'sinew', maxLod: 1, tag: 'spool' }),
    cylinder({ radius: 0.2, height: 0.08, axis: 'x', segments: 6, at: [0.24, SPOOL[1], SPOOL[2]], mat: 'team', keep: true, maxLod: 1, tag: 'spool' }),
    cylinder({ radius: 0.2, height: 0.08, axis: 'x', segments: 6, at: [-0.24, SPOOL[1], SPOOL[2]], mat: 'team', keep: true, maxLod: 1, tag: 'spool' }),
    cylinder({ radius: 0.075, height: 0.74, axis: 'x', segments: 3, at: SPOOL, mat: 'glow', keep: true, maxLod: 1, tag: 'spool' }),
    cylinder({ radius: 0.19, height: 0.56, axis: 'x', segments: 4, at: SPOOL, mat: 'team', keep: true, minLod: 2, tag: 'spool' }),
  ];
  if (tech >= 2) hull.push(...needleShapes(tech, N2, true));
  if (tech === 3) hull.push(...needleShapes(tech, N3, true));
  const wrist = N1.joints[2];
  return [
    { name: 'hull', shapes: hull },
    { name: 'legs_l', pivot: legs.hi.pivotL, anim: 'legs', shapes: [legs.hi.left, legs.lo.left] },
    { name: 'legs_r', pivot: legs.hi.pivotR, anim: 'legs', shapes: [legs.hi.right, legs.lo.right] },
    { name: 'needle', pivot: N1.joints[0], anim: 'yaw', shapes: needleShapes(tech, N1, false) },
    {
      name: 'emitter',
      parent: 'needle',
      pivot: wrist,
      anim: 'pitch',
      shapes: [
        spike({ from: wrist, to: EMIT_TIP, radius: rAbs(tech, 0.11), sides: 4, mat: 'glow', keep: true, maxLod: 1, tag: 'needle' }),
        spike({ from: wrist, to: EMIT_TIP, radius: rAbs(tech, 0.11), sides: 3, mat: 'glow', keep: true, minLod: 2, tag: 'needle' }),
      ],
    },
  ];
}

export default defineModel({
  id: 'f2:lnd_t1_engineer',
  parts: engineerParts(1),
  notes: 'Grundform v_eng (Superset); Stopfer/Weber importieren engineerParts(). Beine als legs_l/legs_r wie beim Rädelsführer.',
});
