/**
 * Hymne (f4:exp_assault) – Experimenteller Sturmläufer der Aurith (T4, Post-MVP).
 *
 * experimentals.md §4.1 / roster.json `experimentals[0].kitbash`: „Riesiges Dreibein (legs count 3, rückwärts
 * geknickt), Höhe ≈ 9 WU (3,2 × Kantor), hoher Spindel-Torso aus Bernstein. Waagerechte Brustgabel mit Strahllinse
 * zwischen den Zinken (Zinken 4,2 WU, ragen 1,5 WU über die Brust), rechts auf der Schulter ein kleiner Trichter
 * (Länge ≤ Gabel ÷ 1,5), auf dem Rücken zwei Gruppen aus je drei gestuften senkrechten Pfeifen, dazwischen zwei
 * parallele teamfarbene Kämme, die nach hinten bis über die Hüfte auslaufen. Kein Kristall, keine Krone, kein Kopf,
 * keine Arme.“
 *
 * Hybrid-Regel T4 (§3.2): Gabel (Direktfeuer, 4,2 WU) > Trichter (Artillerie, 2,6 WU ≤ 4,2 ÷ 1,5) > Pfeifen
 * (Flugabwehr, Ø 0,28 ≤ ½ Zinken-Ø 0,64). Winkel-Code: Gabel waagerecht, Trichter 45°, Pfeifen senkrecht.
 * Pflichtpaare: Hymne ↔ Kantor (Krone + Sichel gegen Doppelkamm + Pfeifen, dreifache Höhe), Hymne ↔ Brüller (Gabel auf
 * Dreibein in zwei Größen; die Hymne trägt zusätzlich Trichter und Pfeifen).
 *
 * Maßstab: T4 stehen nicht in `roster.units`, deshalb gibt das Modell Name, Klasse, Tech, Footprint und Icon selbst
 * an und ist direkt in Spiel-WU gebaut (Maßstab 1).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull   – Becken (Pechglas), Spindel-Torso (Bernstein), Schultermantel (Team), Doppelkamm (Team), zwei
 *            Pfeifengruppen (je drei gestufte Pfeifen auf teamfarbener Kamm-Platte), Glyphenbänder
 *   legs_l / legs_r / legs_b – Dreibein wie beim Kantor (Render-Pfad `legs` ersetzt sie später)
 *   fork   – Brustgabel: zwei waagerechte Zinken, Steg, Strahllinse (yawpitch)
 *   horn   – Schultertrichter rechts, 45° (pitch)
 */
import {
  box,
  cylinder,
  defineModel,
  ellipsoid,
  extrude,
  flipX,
  glyphStrip,
  group,
  legJoints,
  legPairs,
  lens,
  limb,
  lodSegments,
  mirrorX,
  polygonProfile,
  sweep,
  torus,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

const HIP_Y = 3.5;
const TORSO: Vec3[] = [
  [0, 3.55, 0],
  [0, 4.6, 0],
  [0, 5.9, 0],
  [0, 7.0, 0],
  [0, 7.55, 0],
];
/** Spindel-Querschnitte [x, z]: bauchig auf Brusthöhe, oben schmal. */
const TORSO_R: [number, number][] = [
  [0.62, 0.52],
  [1.12, 0.92],
  [1.04, 0.86],
  [0.8, 0.66],
  [0.5, 0.42],
];
const FORK_Y = 5.0;
const TINE_X = 1.34;
const TINE_R = 0.32;

const legOpts = {
  kneeAt: 0.45,
  kneeUp: 0.2,
  kneeBack: 0.95, // rückwärts geknickt
  radius: [0.4, 0.34, 0.3],
  footY: 0.22,
  hipCap: false,
  mat: 'pitch',
  keep: true,
  tag: 'legs',
} as const;
const front = { ...legOpts, hips: [[0.72, HIP_Y, 0.35]] as Vec3[], footOut: 2.1, splay: 3.6 };
const legs = legPairs({ ...front, sides: 6, maxLod: 0 });
const legsLow = legPairs({ ...front, sides: 4, jointCaps: false, minLod: 1, maxLod: 1 });
const BACK = legJoints([0, HIP_Y, -0.45], [0, 0.22, -2.75], legOpts);
const legFar = (j: readonly Vec3[]) => limb({ ...legOpts, joints: [j[0]!, j[2]!], radius: 0.34, sides: 3, minLod: 2 });

/** Doppelkamm (Seitenprofil z/y): steigt über den Schultern zum höchsten Punkt (9 WU) und läuft bis über die Hüfte aus. */
const FIN: Vec2[] = [
  [0.35, 7.45],
  [0.05, 8.45],
  [-0.6, 9.0],
  [-1.5, 8.85],
  [-2.35, 7.9],
  [-2.95, 6.4],
  [-3.15, 4.7],
  [-2.75, 5.3],
  [-2.2, 6.55],
  [-1.5, 7.35],
  [-0.7, 7.65],
];
const FIN_LOW: Vec2[] = [FIN[0]!, FIN[2]!, FIN[4]!, FIN[6]!, FIN[8]!, FIN[10]!];

/** Pfeifengruppe (Seite `s`): drei gestufte senkrechte Pfeifen quer zur Fahrtrichtung, auf teamfarbener Kamm-Platte. */
function pipes(s: 1 | -1): Shape[] {
  const base = 7.2;
  const list: [number, number][] = [
    [0.98, 1.75],
    [1.3, 1.4],
    [1.62, 1.05],
  ];
  return [
    box({ size: [1.0, 0.24, 0.62], at: [s * 1.3, base, -0.75], mat: 'team', keep: true, tag: 'pipe' }),
    ...list.map(([x, h]) =>
      cylinder({ radius: 0.14, height: h, segments: 6, caps: 'top', at: [s * x, base + h / 2, -0.75], mat: 'pitch', keep: true, tag: 'pipe' }),
    ),
  ];
}

/**
 * Offener Trichter: Außenhaut (Teamfarbe) als Sweep mit Glocke, Innenhaut (Pechglas) mit umgekehrter Windung (zeigt
 * zur Achse), Bernstein-Rand an der Mündung. LOD2: gerader Kegelstumpf mit fünf Seiten, innen dunkel, ohne Rand.
 */
function horn(base: Vec3, dir: Vec3, len: number, rNeck: number, rMouth: number, sides: number, tag: string): Shape[] {
  const at = (f: number): Vec3 => [base[0] + dir[0] * len * f, base[1] + dir[1] * len * f, base[2] + dir[2] * len * f];
  const path = [0, 0.45, 0.75, 1].map(at);
  const rr = [rNeck, rNeck * 1.12, rNeck + (rMouth - rNeck) * 0.42, rMouth];
  const inner = rr.map((r, i) => (i === rr.length - 1 ? r * 0.93 : r * 0.8));
  const ring = (k: number) => polygonProfile(k).reverse();
  const far = [at(0), at(1)];
  const pitchDeg = (Math.atan2(dir[1], Math.hypot(dir[0], dir[2])) * 180) / Math.PI;
  return [
    sweep({ path, radius: rr, sides, caps: 'start', mat: 'team', keep: true, maxLod: 1, tag }),
    sweep({ path, radius: inner, profile: ring(sides), caps: false, mat: 'pitch', keep: true, maxLod: 0, tag }),
    sweep({ path, radius: inner, profile: ring(lodSegments(sides, 1)), caps: false, mat: 'pitch', keep: true, minLod: 1, maxLod: 1, tag }),
    torus({ radius: rMouth * 0.965, tube: rMouth * 0.07, segments: sides, sides: 3, axis: 'z', rot: [-pitchDeg, 0, 0], at: at(1), mat: 'amberedge', keep: true, maxLod: 1, tag }),
    sweep({ path: far, radius: [rNeck, rMouth], sides: 5, caps: 'start', mat: 'team', keep: true, minLod: 2, tag }),
    sweep({ path: far, radius: [rNeck * 0.8, rMouth * 0.93], profile: ring(5), caps: false, mat: 'pitch', keep: true, minLod: 2, tag }),
  ];
}

const HORN_BASE: Vec3 = [-1.28, 6.55, 0.1];
const S45 = Math.SQRT1_2;

/** Glyphenband auf der Flanke der Spindel. */
function glyphs(s: 1 | -1) {
  const apo = Math.cos(Math.PI / 10);
  return glyphStrip({
    path: TORSO.slice(0, 4).map((p, i): Vec3 => [s * TORSO_R[i]![0] * apo, p[1], 0]),
    normal: [s, 0, 0],
    width: 0.16,
    pattern: [0.7, -0.2, 0.3, -0.2, 0.9, -0.3],
    mat: 'glyph',
    maxLod: 0,
    tag: 'glyphs',
  });
}

export default defineModel({
  id: 'f4:exp_assault',
  name: 'Hymne',
  role: 'Experimenteller Sturmläufer',
  class: 'land',
  tech: 4,
  footprint: [4, 4],
  icon: 'land_bot_t4',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Becken (Pechglas)
        ellipsoid({ radii: [0.95, 0.6, 0.85], segments: 10, rings: 4, at: [0, HIP_Y, -0.05], mat: 'pitch', keep: true, tag: 'keel' }),
        // Spindel-Torso aus Bernsteinglas
        sweep({ path: TORSO, radius: TORSO_R, sides: 10, caps: false, mat: 'amber', keep: true, tag: 'keel' }),
        // Schultermantel (Teamfarbe): flache Halbschale über dem Torso
        ellipsoid({ radii: [1.3, 0.42, 1.15], half: true, segments: 12, rings: 2, at: [0, 7.5, -0.12], mat: 'team', keep: true, tag: 'shell' }),
        // Bernstein-Kante unter dem Mantel
        torus({ radius: 1.12, tube: 0.12, segments: 12, sides: 4, at: [0, 7.3, -0.12], scale: [1, 1, 0.9], mat: 'amberedge', maxLod: 1, tag: 'shell' }),
        // Doppelkamm (Teamfarbe), zwei parallele Kämme, je 0,3 WU dick
        mirrorX(extrude({ profile: FIN, depth: 0.3, at: [0.46, 0, 0], mat: 'team', keep: true, smooth: false, maxLod: 1, tag: 'fin' })),
        mirrorX(extrude({ profile: FIN_LOW, depth: 0.3, at: [0.46, 0, 0], mat: 'team', smooth: false, minLod: 2, tag: 'fin' })),
        // Pfeifengruppen links und rechts auf dem Rücken (Flugabwehr), flat
        group(pipes(1)),
        group(pipes(-1)),
        glyphs(1),
        glyphs(-1),
      ],
    },
    { name: 'legs_l', pivot: legs.pivotL, anim: 'legs', smooth: 100, shapes: [legs.left, legsLow.left, legFar(legs.joints[0]!)] },
    { name: 'legs_r', pivot: legs.pivotR, anim: 'legs', smooth: 100, shapes: [legs.right, legsLow.right, flipX(legFar(legs.joints[0]!))] },
    {
      name: 'legs_b',
      pivot: BACK[0],
      anim: 'legs',
      smooth: 100,
      shapes: [
        limb({ ...legOpts, joints: BACK, sides: 6, maxLod: 0 }),
        limb({ ...legOpts, joints: BACK, sides: 4, jointCaps: false, minLod: 1, maxLod: 1 }),
        legFar(BACK),
      ],
    },
    {
      name: 'fork',
      pivot: [0, FORK_Y, 0],
      anim: 'yawpitch',
      shapes: [
        // Brustgabel: zwei gerade, waagerechte Zinken (4,2 WU), ragen 1,6 WU vor die Brust
        cylinder({ radius: TINE_R, height: 4.2, segments: 6, axis: 'z', at: [TINE_X, FORK_Y, 0.5], mat: 'amberedge', keep: true, tag: 'fork' }),
        cylinder({ radius: TINE_R, height: 4.2, segments: 6, axis: 'z', at: [-TINE_X, FORK_Y, 0.5], mat: 'amberedge', keep: true, tag: 'fork' }),
        // Steg vor der Brust und Halter an den Flanken
        box({ size: [2 * TINE_X, 0.42, 0.46], at: [0, FORK_Y, 1.02], mat: 'pitch', keep: true, tag: 'fork' }),
        box({ size: [2 * TINE_X + 0.3, 0.36, 0.4], at: [0, FORK_Y, -0.9], mat: 'pitch', maxLod: 1, tag: 'fork' }),
        // Strahllinse zwischen den Zinken (Große Schwebung)
        lens({ radius: 0.62, thickness: 0.42, axis: 'z', segments: 10, at: [0, FORK_Y, 1.42], mat: 'amberdeep', keep: true, tag: 'lens' }),
        torus({ radius: 0.62, tube: 0.1, segments: 10, sides: 4, axis: 'z', at: [0, FORK_Y, 1.42], mat: 'pitch', maxLod: 1, tag: 'lens' }),
      ],
    },
    {
      name: 'horn',
      pivot: HORN_BASE,
      anim: 'pitch',
      shapes: [
        // Lager auf der rechten Schulter
        ellipsoid({ radii: [0.42, 0.42, 0.42], segments: 8, rings: 4, at: HORN_BASE, mat: 'pitch', keep: true, smooth: true, tag: 'horn' }),
        // Schultertrichter 45°, Länge 2,6 WU (≤ Gabel ÷ 1,5), Mündung Ø 1,4 WU
        ...horn(HORN_BASE, [0, S45, S45], 2.6, 0.3, 0.7, 10, 'horn'),
      ],
    },
  ],
  notes:
    'v_exp_assault: T4 nicht in roster.units → Name/Klasse/Tech/Footprint/Icon im Modell. Dreibein wie Kantor (3 Bein-Parts, Render-Pfad `legs`), Gabel yawpitch, Trichter pitch = 5 animierte Parts (Design: 2 + prozedurale Beine).',
});
