/**
 * Gespinst (f2:lnd_t2_shield) – Skarn-Mobilschild T2.
 *
 * Roster: „Keilpanzer auf 4 Beinen, Netzring waagerecht (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt auf zwei
 * Fühler-Stützen.“ faction.md §5.2 Mobiler Schild; verboten: Linse, Schwanz. Winkel-Code: Ring = Schild. Pflicht-Paar
 * Schabe↔Gespinst: Fühler schräg nach vorn gegen waagerechten Ring über dem Rücken.
 *
 * Netzring als flacher Sechseck-Ring (eckiger Sweep um einen geschlossenen Sechseck-Pfad mit Firstkante oben, bleibt
 * in allen LODs sechseckig), Ø 1,18 WU vor dem Maßstab = 1,4 × Rumpfbreite; Stützen als zweigliedrige Fühler, die den
 * Ring an zwei Ecken halten. Beinradius vor dem Maßstab 0,1 (nach 1,3 Kante ≥ 0,17 WU).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Bauchschale (Chitin), Rückenplatte (Team), 2 Tech-Streifen, zwei Fühler-Stützen (Chitin)
 *   legs_l – zwei linke Knickbeine                                      (PartStream 1, legs)
 *   legs_r – zwei rechte Knickbeine                                     (PartStream 2, legs)
 *   ring   – Netzring (Team) mit Sehnen-Lagern an den Stützen, dreht (Yaw)   (PartStream 3)
 */
import { defineModel, limb, sweep, type Vec2, type Vec3 } from '@faf/modelkit';
import { carapace, keel, skarnLegs, techStripes } from './lnd_t1_tank.ts';

const K = keel({ len: 1.08, width: 0.84, height: 0.26, y: 0.48, z: -0.04 });
const LEGS = skarnLegs({
  hips: [
    [0.28, K.y - 0.02, 0.22],
    [0.28, K.y - 0.02, -0.3],
  ],
  footOut: 0.42, // Spanne 1,4 WU ≈ 1,67 × Rumpfbreite
  splay: 0.7,
  kneeY: K.top + 0.12,
  radius: [0.1, 0.095],
});
const RING_Y = K.top + 0.66;
const RING_Z = -0.06;
const RING_R = 0.56;
/** Querschnitt des Rings in LOD2: Dreieck mit Firstkante oben. */
const RING_FAR: readonly Vec2[] = [
  [1, -0.5],
  [0, 1],
  [-1, -0.5],
];
/** Querschnitt des Rings: flach, Firstkante oben (u = radial, v = oben). */
const RING_PROFILE: readonly Vec2[] = [
  [1, -0.55],
  [1, 0.3],
  [0, 1],
  [-1, 0.3],
  [-1, -0.55],
];

function hexPoint(i: number, y: number): Vec3 {
  const a = (i * Math.PI) / 3;
  return [Math.cos(a) * RING_R, y, RING_Z + Math.sin(a) * RING_R];
}
/** Geschlossener Sechseck-Pfad, beginnt und endet in einer Kantenmitte (glatter Schluss ohne Knick). */
const RING_PATH: Vec3[] = (() => {
  const a = hexPoint(0, RING_Y);
  const b = hexPoint(1, RING_Y);
  const mid: Vec3 = [(a[0] + b[0]) / 2, RING_Y, (a[2] + b[2]) / 2];
  return [mid, ...[1, 2, 3, 4, 5, 6].map((i) => hexPoint(i, RING_Y)), mid];
})();

/** Fühler-Stütze: vom Rücken nach außen geknickt, hält den Ring an der Ecke x = ±R. */
function strutLeg(side: 1 | -1, lod: { readonly maxLod?: 0 | 1; readonly minLod?: 1 | 2 }, sides: 3 | 4, straight = false): ReturnType<typeof limb> {
  const foot: Vec3 = [side * 0.16, K.top - 0.04, RING_Z];
  const knee: Vec3 = [side * 0.42, K.top + 0.3, RING_Z - 0.04];
  const top: Vec3 = [side * (RING_R - 0.02), RING_Y - 0.04, RING_Z];
  return limb({
    ...lod,
    joints: straight ? [knee, top] : [foot, knee, top],
    radius: straight ? [0.1, 0.08] : [0.11, 0.1, 0.08],
    sides,
    hipCap: false,
    jointCaps: sides === 4,
    mat: 'chitin',
    keep: true,
    tag: 'antenna',
  });
}

export default defineModel({
  id: 'f2:lnd_t2_shield',
  parts: [
    {
      name: 'hull',
      shapes: [...carapace(K), ...techStripes(K, 2), strutLeg(1, { maxLod: 0 }, 4), strutLeg(-1, { maxLod: 0 }, 4), strutLeg(1, { minLod: 1, maxLod: 1 }, 3), strutLeg(-1, { minLod: 1, maxLod: 1 }, 3), strutLeg(1, { minLod: 2 }, 3, true), strutLeg(-1, { minLod: 2 }, 3, true)],
    },
    { name: 'legs_l', pivot: LEGS.pivotL, anim: 'legs', shapes: LEGS.left },
    { name: 'legs_r', pivot: LEGS.pivotR, anim: 'legs', shapes: LEGS.right },
    {
      name: 'ring',
      pivot: [0, RING_Y, RING_Z],
      anim: 'yaw',
      shapes: [
        sweep({ path: RING_PATH, radius: [[0.1, 0.07]], profile: RING_PROFILE, caps: false, mat: 'team', keep: true, maxLod: 1, tag: 'webring' }),
        sweep({ path: [1, 2, 3, 4, 5, 6, 7].map((i) => hexPoint(i, RING_Y)), radius: [[0.1, 0.07]], profile: RING_FAR, caps: false, mat: 'team', keep: true, minLod: 2, tag: 'webring' }),
      ],
    },
  ],
  notes: 'v_shield_mobile: Netzring (Yaw) als höchster Punkt auf zwei Fühler-Stützen; Beine als legs_l/legs_r.',
});
