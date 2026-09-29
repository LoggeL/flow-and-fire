/**
 * Brüller (f4:lnd_t2_bot) – Aurith-Sturmläufer T2. Exportiert `tripod()` (Dreibein-Parts) für den Diskant.
 *
 * Roster: „Dreibein mit Kiel-Torso, breite Gabel (Zinkenabstand ≥ 0,5 × Rumpfbreite), Kamm nach hinten ≥ 1,0 ×
 * Rumpflänge, 2 Tonpunkte; kein Trichter, keine Pfeifen.“
 * faction.md §3.2: Dreibein statt Zweibein, rückwärts geknickte Gelenke; §5.2 Sturmläufer: Gabel auf Dreibein, breit.
 * Torso = waagerechter Bernstein-Kiel (nicht die senkrechte Spindel des Kantors), Zinkenabstand 0,44 WU = 0,73 ×
 * Rumpfbreite, Kamm 0,72 WU ≥ Torsolänge 0,72 WU. Paartests: Heuler↔Brüller (Gleiter gegen Dreibein),
 * Brüller↔Kantor (niedriger Kiel-Torso mit langem Kamm gegen hohe Spindel mit Krone und Sichel).
 * Maßstab 1,3 eingebacken (1×1-Footprint: Basis ≤ 1,53 WU).
 *
 * Aufbau (y = Boden, +Z = Bug, +X = linke Seite):
 *   hull   – Becken (Pechglas)
 *   legs_l – linkes Vorderbein  (PartStream 1, legs)
 *   legs_r – rechtes Vorderbein (PartStream 2, legs)
 *   legs_b – Hinterbein         (PartStream 3, legs)
 *   torso  – Kiel-Torso (Bernstein), Oberschale (Team), Rückenkamm (Team), Glyphenbänder, Tonpunkte; Yaw (PartStream 4)
 *   fork   – breite Gabel mit Steg, kippt (PartStream 5)
 */
import { defineModel, ellipsoid, flipX, legJoints, legPairs, limb, type PartDef, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';
import { crest, forkTines, shellGlyphs, toneDots, type KeelShape } from './lnd_t1_tank.ts';

export interface TripodOpts {
  /** Hüfte des linken Vorderbeins (das rechte ist gespiegelt). */
  readonly front: Vec3;
  /** Fußabstand nach außen (x) und Fächerung nach vorn (Fuß-z = Hüft-z × (1 + splay)). */
  readonly footOut: number;
  readonly splay: number;
  /** Hinterbein: Hüfte und Fuß. */
  readonly backHip: Vec3;
  readonly backFoot: Vec3;
  /** Radien Hüfte, Knie, Fuß. */
  readonly radius: readonly [number, number, number];
  readonly kneeAt?: number;
  readonly kneeUp?: number;
  readonly kneeBack?: number;
  readonly footY?: number;
}

/** Drei Bein-Parts (`legs_l`, `legs_r`, `legs_b`), Pechglas, rückwärts geknickte Knie; LOD1 dreikantig, LOD2 gerade. */
export function tripod(o: TripodOpts): PartDef[] {
  const legOpts = {
    kneeAt: o.kneeAt ?? 0.45,
    kneeUp: o.kneeUp ?? 0.06,
    kneeBack: o.kneeBack ?? 0.22,
    radius: o.radius,
    footY: o.footY ?? 0.06,
    hipCap: false,
    mat: 'pitch',
    keep: true,
    tag: 'legs',
  } as const;
  const front = { ...legOpts, hips: [o.front] as Vec3[], footOut: o.footOut, splay: o.splay };
  const legs = legPairs({ ...front, sides: 4, maxLod: 0 });
  const legsLow = legPairs({ ...front, sides: 3, jointCaps: false, minLod: 1, maxLod: 1 });
  const back = legJoints(o.backHip, o.backFoot, legOpts);
  const far = (j: readonly Vec3[]): Shape => limb({ ...legOpts, joints: [j[0]!, j[2]!], radius: o.radius[1], sides: 3, minLod: 2 });
  return [
    { name: 'legs_l', pivot: legs.pivotL, anim: 'legs', smooth: 100, shapes: [legs.left, legsLow.left, far(legs.joints[0]!)] },
    { name: 'legs_r', pivot: legs.pivotR, anim: 'legs', smooth: 100, shapes: [legs.right, legsLow.right, flipX(far(legs.joints[0]!))] },
    {
      name: 'legs_b',
      pivot: back[0],
      anim: 'legs',
      smooth: 100,
      shapes: [
        limb({ ...legOpts, joints: back, sides: 4, maxLod: 0 }),
        limb({ ...legOpts, joints: back, sides: 3, jointCaps: false, minLod: 1, maxLod: 1 }),
        far(back),
      ],
    },
  ];
}

/** Kiel-Torso eines Läufers: volles Bernstein-Ellipsoid mit teamfarbener Oberschale. */
export function walkerTorso(o: { radii: Vec3; at: Vec3; cap: Vec3; segments?: number }): { shapes: Shape[]; shape: KeelShape } {
  const [rx, ry, rz] = o.radii;
  const capY = o.at[1] + ry * 0.7;
  return {
    shapes: [
      ellipsoid({ radii: o.radii, drop: 0.3, segments: o.segments ?? 10, rings: 4, at: o.at, mat: 'amber', smooth: true, keep: true, tag: 'keel' }),
      ellipsoid({ radii: o.cap, half: true, drop: 0.2, segments: 8, rings: 2, at: [o.at[0], capY + o.cap[1] / 2, o.at[2] - 0.04], mat: 'team', smooth: true, keep: true, tag: 'lens' }),
    ],
    // Glyphen-Referenz: die obere Hälfte des Torsos als Schale
    shape: { radii: [rx, ry, rz], base: o.at, drop: 0.3, top: o.at[1] + ry, capTop: capY + o.cap[1] },
  };
}

const HIP_Y = 0.62;
const TORSO_Y = 0.86;
const T = walkerTorso({ radii: [0.3, 0.2, 0.36], at: [0, TORSO_Y, 0], cap: [0.24, 0.11, 0.3] });
const FORK_Y = 0.84;

/** Rückenkamm: steigt hinter der Oberschale auf und läuft weit nach hinten aus (0,72 WU = Torsolänge). */
const CREST: Vec2[] = [
  [0.02, 1.02],
  [-0.14, 1.2],
  [-0.34, 1.36],
  [-0.52, 1.4],
  [-0.66, 1.28],
  [-0.7, 1.08],
  [-0.58, 1.06],
  [-0.46, 0.94],
  [-0.3, 0.86],
  [-0.1, 0.92],
];

export default defineModel({
  id: 'f4:lnd_t2_bot',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [ellipsoid({ radii: [0.24, 0.14, 0.22], segments: 8, rings: 2, at: [0, HIP_Y, -0.02], mat: 'pitch', keep: true, maxLod: 1, tag: 'keel' })],
    },
    ...tripod({ front: [0.18, HIP_Y, 0.06], footOut: 0.34, splay: 5, backHip: [0, HIP_Y, -0.12], backFoot: [0, 0.037, -0.58], radius: [0.1, 0.085, 0.075], footY: 0.037 }),
    {
      name: 'torso',
      pivot: [0, HIP_Y, 0],
      anim: 'yaw',
      shapes: [...T.shapes, ...crest(CREST), ...shellGlyphs(T.shape, { phi: 70, th0: -50, th1: 40 }), ...toneDots(2, { from: [-0.44, 1.2], dir: [-1, -0.2] })],
    },
    {
      name: 'fork',
      parent: 'torso',
      pivot: [0, FORK_Y, 0.26],
      anim: 'pitch',
      // breite Gabel: Zinkenabstand 0,44 WU, Zinken 0,54 WU, ragen 0,4 WU vor den Torso
      shapes: forkTines({ y: FORK_Y, z0: 0.22, len: 0.54, gap: 0.44, bridge: 0.14 }),
    },
  ],
  notes: 'v_bot: Dreibein (3 Bein-Parts wie der Kantor), Torso-Yaw, Gabel-Pitch.',
});
