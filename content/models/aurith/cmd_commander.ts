/**
 * Kantor (f4:cmd_commander) – Aurith-Kommandant. **Referenzmodell für Aurith-Autoren.**
 *
 * Roster: „Dreibein mit rückwärts geknickten Gelenken (legs count 3), hoher Spindel-Torso, Krone aus drei Kristallen
 * als stärkster Leuchtpunkt, Perlglas-Sichel als Halbkreis hinter der Krone, breite Gabel mittig vor der Brust;
 * keine Arme, kein Kopf. Höhe ≥ 2,8 WU.“
 * faction.md §3.2/§5.2: Kurve = Körper, Gerade = Waffe; hoch und schlank; Kamm läuft nach hinten aus; Teamfarbe
 * ≥ 35 % der Draufsicht (Hinterkamm, Torso-Oberschale); Bernstein 25–35 %; Resonanzkern nur in der Krone;
 * Glyphenbänder ≤ 3 % (`glyph` = glow2); asymmetrisch nur über die Sichel.
 *
 * Kit-Muster für Aurith: `smooth` pro Part (Körper weich; Beine mit Knickwinkel 100°, damit Vierkant-Beine rund
 * wirken), `legPairs` + `legJoints` mit `kneeBack` (rückwärts geknickte Dreibein-Gelenke), `sweep` mit ovalen
 * Querschnitten (Spindel-Torso), `crystalCluster` (Krone), `torusArc` (Perlglas-Sichel), `glyphStrip` auf den
 * Flächenmitten des Torsos, gerade `cylinder`-Zinken für die Gabel.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Becken (Pechglas)
 *   legs_l – linkes Vorderbein  (PartStream 1, legs)
 *   legs_r – rechtes Vorderbein (PartStream 2, legs)
 *   legs_b – Hinterbein         (PartStream 3, legs)
 *   torso  – Spindel-Torso (Bernstein), Oberschale (Team), Hinterkamm (Team), Krone (Resonanzkern), Perlglas-Sichel,
 *            Glyphenbänder; dreht um +Y (PartStream 4, yaw)
 *   fork   – Brustgabel aus zwei geraden Zinken mit Steg, kippt (PartStream 5, pitch)
 */
import {
  box,
  crystalCluster,
  cylinder,
  defineModel,
  ellipsoid,
  extrude,
  flipX,
  glyphStrip,
  legJoints,
  legPairs,
  limb,
  sweep,
  torusArc,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

const HIP_Y = 1.24;
const TORSO: Vec3[] = [
  [0, 1.28, 0],
  [0, 1.8, 0],
  [0, 2.3, 0],
  [0, 2.6, 0],
];
/** Spindel-Querschnitte [x, z]: breiteste Stelle auf Brusthöhe, oben schmal (hoch und schlank). */
const TORSO_R: [number, number][] = [
  [0.22, 0.19],
  [0.38, 0.31],
  [0.33, 0.27],
  [0.22, 0.19],
];
const CROWN_Y = 2.62;
const FORK_Y = 1.86;
const CROWN = { count: 3, radius: 0.1, height: 0.4, spread: 0.17, lean: 16, seed: 3, at: [0, CROWN_Y, -0.02] as Vec3, mat: 'phase', keep: true, tag: 'crystal' };

const legOpts = {
  kneeAt: 0.45,
  kneeUp: 0.08,
  kneeBack: 0.34, // rückwärts geknickt
  radius: [0.13, 0.11, 0.1],
  footY: 0.07, // Fußdeckel steht auf dem Boden
  hipCap: false,
  mat: 'pitch',
  keep: true,
  tag: 'legs',
} as const;
const front = { ...legOpts, hips: [[0.26, HIP_Y, 0.1]] as Vec3[], footOut: 0.62, splay: 4.2 };
const legs = legPairs({ ...front, sides: 4, maxLod: 0 });
const legsLow = legPairs({ ...front, sides: 3, jointCaps: false, minLod: 1, maxLod: 1 });
const BACK = legJoints([0, HIP_Y, -0.18], [0, 0.07, -0.98], legOpts);
/** LOD2: jedes Bein ein gerader Dreikant von der Hüfte zum Fuß. */
const legFar = (j: readonly Vec3[]) => limb({ ...legOpts, joints: [j[0]!, j[2]!], radius: 0.12, sides: 3, minLod: 2 });

/** Hinterkamm (Seitenprofil z/y): steigt hinter der Oberschale auf und läuft weit nach hinten unten aus. */
const FIN: Vec2[] = [
  [-0.2, 2.5],
  [-0.46, 2.86],
  [-0.82, 2.84],
  [-1.08, 2.52],
  [-1.16, 2.06],
  [-0.96, 2.3],
  [-0.62, 2.5],
  [-0.34, 2.36],
];

/** Glyphenband auf der Flächenmitte der Spindel (x = ±Apothem), Seite `s`. */
function glyphs(s: 1 | -1) {
  const apo = Math.cos(Math.PI / 8);
  return glyphStrip({
    path: TORSO.map((p, i): Vec3 => [s * TORSO_R[i]![0] * apo, p[1], 0]),
    normal: [s, 0, 0],
    width: 0.07,
    pattern: [0.26, -0.08, 0.1, -0.08, 0.34, -0.12],
    mat: 'glyph',
    maxLod: 0,
    tag: 'glyphs',
  });
}

export default defineModel({
  id: 'f4:cmd_commander',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [ellipsoid({ radii: [0.32, 0.2, 0.3], segments: 8, rings: 2, at: [0, HIP_Y, -0.04], mat: 'pitch', keep: true, maxLod: 1, tag: 'keel' })],
    },
    { name: 'legs_l', pivot: legs.pivotL, anim: 'legs', smooth: 100, shapes: [legs.left, legsLow.left, legFar(legs.joints[0]!)] },
    { name: 'legs_r', pivot: legs.pivotR, anim: 'legs', smooth: 100, shapes: [legs.right, legsLow.right, flipX(legFar(legs.joints[0]!))] },
    {
      name: 'legs_b',
      pivot: BACK[0],
      anim: 'legs',
      smooth: 100,
      shapes: [
        limb({ ...legOpts, joints: BACK, sides: 4, maxLod: 0 }),
        limb({ ...legOpts, joints: BACK, sides: 3, jointCaps: false, minLod: 1, maxLod: 1 }),
        legFar(BACK),
      ],
    },
    {
      name: 'torso',
      pivot: [0, HIP_Y, 0],
      anim: 'yaw',
      smooth: true,
      shapes: [
        // Spindel-Torso aus Bernsteinglas (Deckel verdeckt: Becken unten, Oberschale oben)
        sweep({ path: TORSO, radius: TORSO_R, sides: 8, caps: false, mat: 'amber', keep: true, tag: 'keel' }),
        // Torso-Oberschale (Teamfarbe): flache Halbschale, von oben die größte Teamfläche
        ellipsoid({ radii: [0.5, 0.2, 0.44], half: true, segments: 8, rings: 2, at: [0, TORSO[3]![1] - 0.02, -0.04], mat: 'team', keep: true, tag: 'lens' }),
        // Hinterkamm (Teamfarbe), 0,17 WU dick
        extrude({ profile: FIN, depth: 0.17, mat: 'team', keep: true, smooth: false, maxLod: 1, tag: 'fin' }),
        extrude({ profile: [FIN[0]!, FIN[2]!, FIN[4]!, FIN[6]!], depth: 0.17, mat: 'team', smooth: false, minLod: 2 }),
        // Krone aus drei Kristallen: stärkster Leuchtpunkt (Resonanzkern); LOD1 dreikantig, LOD2 ein Kristall
        crystalCluster({ ...CROWN, sides: 5, maxLod: 0 }),
        crystalCluster({ ...CROWN, sides: 3, minLod: 1, maxLod: 1 }),
        crystalCluster({ ...CROWN, count: 1, radius: 0.16, sides: 3, minLod: 2 }),
        // Perlglas-Sichel: Halbkreis hinter der Krone, links spitz auslaufend (einzige Asymmetrie)
        torusArc({
          radius: 0.56,
          tube: 0.1,
          arc: 180,
          startDeg: 190,
          segments: 6,
          sides: 3,
          flatten: 0.8,
          taper: 0.3,
          axis: 'z',
          at: [0, CROWN_Y + 0.12, -0.34],
          mat: 'pearl',
          keep: true,
          tag: 'sickle',
        }),
        glyphs(1),
        glyphs(-1),
      ],
    },
    {
      name: 'fork',
      parent: 'torso',
      pivot: [0, FORK_Y, 0.3],
      anim: 'pitch',
      shapes: [
        // Gabel: zwei gerade, parallele Sechskant-Zinken (Ø ≥ 0,17 WU) mit Steg, ragen weit vor die Brust
        cylinder({ radius: 0.1, height: 0.96, segments: 6, axis: 'z', caps: 'top', at: [0.17, FORK_Y, 0.8], mat: 'amberedge', keep: true, tag: 'fork' }),
        cylinder({ radius: 0.1, height: 0.96, segments: 6, axis: 'z', caps: 'top', at: [-0.17, FORK_Y, 0.8], mat: 'amberedge', keep: true, tag: 'fork' }),
        box({ size: [0.5, 0.14, 0.18], at: [0, FORK_Y, 0.38], mat: 'pitch', keep: true, maxLod: 1, tag: 'fork' }),
      ],
    },
  ],
  notes: 'v_cmd: Dreibein (3 Bein-Parts, Render-Pfad ersetzt sie später), Torso-Yaw, Gabel-Pitch.',
});

