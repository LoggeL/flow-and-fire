/**
 * Nessel (f2:lnd_t1_arty) – Skarn-Artillerie T1.
 *
 * Roster: „Langer schmaler Keilpanzer auf 4 Beinen, dreigliedriger Schwanz über dem Rücken, Sechseck-Kapsel
 * (Ø 0,4 WU) schräg nach vorn (≈ 50°); keine Linse, nichts Waagerechtes.“ faction.md §5.2 Artillerie: Schwanz über
 * dem Rücken, Kapsel-Spitze 45–55° nach vorn, Rumpf ≥ 1,3 × länger als breit, Kapsel-Ø ≥ 0,34 WU; verboten: Linse,
 * waagerechte Elemente. Teamfarbe auf Rückenplatte und Schwanzoberseite (hier der ganze Schwanz). Pflicht-Paar
 * Nessel↔Klette: ein Bogen mit Schrägkapsel gegen einen Kamm aus senkrechten Dornen.
 *
 * Stechapfel (lnd_t3_arty) und Wolfsmilch (lnd_t2_mml) nutzen `tail` und `artyModel`.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), Rückenplatte (Team), Tech-Streifen
 *   legs_l – linke Knickbeine                                           (PartStream 1, legs)
 *   legs_r – rechte Knickbeine                                          (PartStream 2, legs)
 *   neck   – Schwanzansatz (Sehne) am Heck, dreht (Yaw)                 (PartStream 3)
 *   tail   – dreigliedriger Schwanz (Team) mit Sechseck-Kapsel (Sehne), kippt (Pitch)   (PartStream 4)
 */
import { defineModel, spike, strut, sweep, type ModelDef, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';
import { carapace, keel, skarnLegs, techStripes, type Keel } from './lnd_t1_tank.ts';

/** Sechskant-Querschnitt der Schwanzglieder (Firstkante außen, flacher Bauch innen), wie der Rumpf. */
const TAIL_PROFILE: readonly Vec2[] = [
  [1, 0],
  [0.55, 0.8],
  [0, 1],
  [-0.55, 0.8],
  [-1, 0],
  [-0.5, -0.7],
  [0.5, -0.7],
];

/** Richtung der Schwanzspitze: 50° über der Waagerechten, nach vorn. */
export const TIP_DIR: Vec3 = [0, Math.sin((50 * Math.PI) / 180), Math.cos((50 * Math.PI) / 180)];

/** Gelenke des Schwanzes: steigt vom Heck nach hinten oben, biegt über den Rücken, letztes Glied bei ≈ 50°. */
export function tailJoints(k: Keel, x: number, rise = 0.85): Vec3[] {
  return [
    [x, k.top - 0.02, k.rear + 0.24],
    [x, k.top + 0.24 * rise, k.rear + 0.04],
    [x, k.top + 0.46 * rise, k.rear + 0.16],
    [x, k.top + 0.62 * rise, k.rear + 0.3],
  ];
}

/** Raute für LOD1 (Firstkante außen). */
const TAIL_MID: readonly Vec2[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -0.7],
];
/** Dreieck-Querschnitt für LOD2 (Firstkante außen). */
const TAIL_FAR: readonly Vec2[] = [
  [1, -0.5],
  [0, 1],
  [-1, -0.5],
];

/**
 * Dreigliedriger Schwanz (Team) als eckiger Sweep; `r` = Halbbreite am Ansatz. LOD1 mit Rauten-, LOD2 mit
 * Dreieck-Querschnitt aus zwei Gliedern.
 */
export function tail(joints: readonly Vec3[], r = 0.14, mat = 'team'): Shape[] {
  const radius: [number, number][] = [
    [r, r * 0.85],
    [r * 0.92, r * 0.8],
    [r * 0.78, r * 0.68],
    [r * 0.66, r * 0.58],
  ];
  const up: Vec3 = [0, 0.3, -1]; // Firstkante auf der Bogen-Außenseite
  return [
    sweep({ path: joints, radius, profile: TAIL_PROFILE, up, mat, keep: true, maxLod: 0, tag: 'tail' }),
    sweep({ path: joints, radius, profile: TAIL_MID, up, mat, keep: true, minLod: 1, maxLod: 1, tag: 'tail' }),
    sweep({ path: [joints[0]!, joints[2]!, joints[3]!], radius: [radius[0]!, radius[2]!, radius[3]!], profile: TAIL_FAR, up, caps: false, mat, keep: true, minLod: 2, tag: 'tail' }),
  ];
}

/** Sechseck-Kapsel (Ø 0,4 WU) mit Spitze, entlang TIP_DIR ab `base`. */
export function capsule(base: Vec3, len = 0.3, r = 0.2): Shape[] {
  // Basis steckt im Schwanzende (kein Deckel nötig)
  const at = (d: number): Vec3 => [base[0] + TIP_DIR[0] * d, base[1] + TIP_DIR[1] * d, base[2] + TIP_DIR[2] * d];
  return [
    strut({ from: base, to: at(len), radius: r, sides: 6, caps: false, mat: 'sinew', keep: true, maxLod: 0, tag: 'pod' }),
    spike({ from: at(len), to: at(len + 0.14), radius: r, sides: 6, mat: 'sinew', keep: true, maxLod: 0, tag: 'pod' }),
    // LOD1/2: Kapsel als vierkantiger, spitz zulaufender Stumpf
    strut({ from: base, to: at(len + 0.1), radius: r, radiusEnd: r * 0.5, sides: 4, caps: 'end', mat: 'sinew', keep: true, minLod: 1, tag: 'pod' }),
  ];
}

export interface ArtyOpts {
  readonly id: string;
  readonly stripes: number;
  readonly legs: 4 | 6;
  /** Zweiter Schwanz (T3): zwei parallele Schwänze mit je einer Kapsel. */
  readonly twin?: boolean;
  readonly legR?: readonly [number, number];
}

export function artyModel(o: ArtyOpts): ModelDef {
  const K = keel({ len: 1.3, width: 0.7, height: 0.24, y: 0.42, z: 0.02 });
  const hipsZ = o.legs === 6 ? [0.3, -0.06, -0.42] : [0.26, -0.3];
  const legs = skarnLegs({
    hips: hipsZ.map((z): Vec3 => [0.24, K.y - 0.02, z]),
    footOut: 0.36, // Spanne 1,2 WU ≈ 1,7 × Rumpfbreite
    splay: o.legs === 6 ? 0.45 : 0.8,
    kneeY: K.top + 0.12,
    ...(o.legR === undefined ? {} : { radius: o.legR }),
    ...(o.legs === 6 ? { lod2: 'straight' as const } : {}),
  });
  const xs = o.twin === true ? [0.2, -0.2] : [0];
  const tails = xs.map((x) => tailJoints(K, x, o.twin === true ? 0.75 : 0.85));
  const base: Vec3 = [0, K.top - 0.02, K.rear + 0.24];
  return {
    id: o.id,
    parts: [
      { name: 'hull', shapes: [...carapace(K), ...techStripes(K, o.stripes)] },
      { name: 'legs_l', pivot: legs.pivotL, anim: 'legs', shapes: legs.left },
      { name: 'legs_r', pivot: legs.pivotR, anim: 'legs', shapes: legs.right },
      {
        name: 'neck',
        pivot: base,
        anim: 'yaw',
        // Schwanzansatz: breiter Sehnenblock auf dem Heck (bei zwei Schwänzen quer)
        shapes: [
          strut({ from: [xs[0]! + 0.12, K.top - 0.04, base[2]], to: [xs[xs.length - 1]! - 0.12, K.top - 0.04, base[2]], radius: 0.13, mat: 'sinew', maxLod: 1, tag: 'neck' }),
        ],
      },
      {
        name: 'tail',
        parent: 'neck',
        pivot: base,
        anim: 'pitch',
        shapes: tails.flatMap((j) => [...tail(j, o.twin === true ? 0.12 : 0.14), ...capsule(j[3]!)]),
      },
    ],
    notes: `v_arty: Schwanz${o.twin === true ? ' ×2' : ''} (Team) mit Kapsel über dem Rücken, Schwanzansatz Yaw, Schwanz Pitch; Beine als legs_l/legs_r.`,
  };
}

export default defineModel(artyModel({ id: 'f2:lnd_t1_arty', stripes: 1, legs: 4 }));
