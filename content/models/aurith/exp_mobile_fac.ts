/**
 * Ensemble (f4:exp_mobile_fac) – Wandernde Halle der Aurith (T4, Post-MVP): mobile Fabrik mit Schildglocke und
 * Artillerie.
 *
 * experimentals.md §4.2 / roster.json `experimentals[1].kitbash`: „Überlanger Gleiter-Kiel 7 × 5 WU, Höhe ≈ 5 WU,
 * 0,3 WU Schwebespalt. Hinten eine halb offene Muschel-Apsis (offene Seite nach hinten = Ausgang) mit Kristall über
 * dem Scheitel (Resonanzkern, Flow-Einheit: FACTORY). Vorn links und rechts je ein offener Trichter 50° (Artillerie),
 * mittig ein Mast mit waagerechtem Reif Ø 5 WU als höchstem Punkt (Schild), vor dem Mast ein kurzer Gabelkranz,
 * seitlich eine Pfeifenbank. Teamfarbener Kamm über die ganze Länge. Lesereihenfolge von oben: Reif (Schild) →
 * Trichter (Artillerie) → Apsis (Halle).“
 *
 * Hybrid-Regel T4 (§3.2): Reif Ø 5 (Schild) > Trichter 2,4 WU lang (Artillerie, Icon) > Gabelkranz-Zinken 1,0 WU >
 * Pfeifen. Pflichtpaare: Ensemble ↔ Grundhalle III (Apsis auf Kiel gegen Apsis auf Dreipass-Sockel), Ensemble ↔ Stille
 * (Mast mit waagerechtem Reif in zwei Größen). Kristall erlaubt: Flow-Einheit (FACTORY).
 *
 * Gleiter: auf y = 0 gebaut, `hover` 0,3 WU (Roster-Beschreibung „0,3 WU Schwebespalt“ statt GLIDE_HEIGHT 0,25).
 * T4 stehen nicht in `roster.units`: Name, Klasse, Tech, Footprint und Icon stehen im Modell, Maßstab 1.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull    – Kiel (Pechglas-Unterschale + Bernstein-Oberschale), Kamm (Team) über die ganze Länge, Apsis (Team außen)
 *             mit Scheitelkristall (Resonanzkern), Mast + waagerechter Reif (Schildglocke), Pfeifenbänke links/rechts,
 *             Glyphenbänder
 *   horn_l / horn_r – Trichter vorn links/rechts, 50° (yawpitch)
 *   fork    – Gabelkranz vor dem Mast: drei kurze Gabeln auf einer Nabe (yaw)
 */
import {
  box,
  crystal,
  cylinder,
  defineModel,
  ellipsoid,
  extrude,
  glyphStrip,
  group,
  lodSegments,
  polygonProfile,
  radial,
  strut,
  sweep,
  torusArc,
  torus,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

const KEEL_TOP = 1.3;
const APSE_C: Vec3 = [0, 1.2, -1.7];
const APSE_R = 2.0;
const MAST_Z = 0.35;
const RING_Y = 4.95; // Schildreif als höchster Punkt: Gesamthöhe ≥ 5 WU (T4-Regel experimentals.md §3.2)
const HORN_ELEV = 50;

/**
 * Offener Trichter (wie Hymne/Tuba): Außenhaut Team mit Glocke, Innenhaut Pechglas (umgekehrte Windung, zeigt zur
 * Achse), Bernstein-Rand an der Mündung. LOD2: gerader Kegelstumpf mit fünf Seiten, innen dunkel, ohne Rand.
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

const HORN_X = 1.55;
const HORN_Z = 1.75;
const HORN_Y = 1.45;
const HDIR: Vec3 = [0, Math.sin((HORN_ELEV * Math.PI) / 180), Math.cos((HORN_ELEV * Math.PI) / 180)];
const hornShapes = (x: number): Shape[] => [
  ellipsoid({ radii: [0.5, 0.36, 0.5], segments: 8, rings: 3, at: [x, HORN_Y - 0.05, HORN_Z], mat: 'pitch', smooth: true, keep: true, maxLod: 1, tag: 'horn' }),
  ...horn([x, HORN_Y, HORN_Z], HDIR, 2.4, 0.28, 0.7, 10, 'horn'),
];

/**
 * Apsis als Viertelkugel-Schale: Mittelpunkt auf dem Kiel, Achse nach vorn (+Z), oben geschlossen, hinten und unten
 * offen. Außenhaut Team, Innenhaut Pechglas (umgekehrte Windung), Bernstein-Kante an der Öffnung.
 */
function apse(): Shape[] {
  const arc = (k: number): Vec2[] => Array.from({ length: k + 1 }, (_, j): Vec2 => [Math.cos((j / k) * Math.PI), Math.sin((j / k) * Math.PI)]);
  const out: Shape[] = [];
  const lods = [
    [0, 5, 12],
    [1, 4, 8],
    [2, 2, 5],
  ] as const;
  for (const [lod, n, k] of lods) {
    const path: Vec3[] = [];
    const rOut: number[] = [];
    const rIn: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * (Math.PI / 2);
      path.push([APSE_C[0], APSE_C[1], APSE_C[2] + APSE_R * Math.sin(a)]);
      rOut.push(i === n ? 0 : APSE_R * Math.cos(a));
      rIn.push(i === n ? 0 : (APSE_R - 0.14) * Math.cos(a));
    }
    const flags = { open: true, keep: true, minLod: lod, maxLod: lod, tag: 'shell' } as const;
    out.push(sweep({ path, radius: rOut, profile: arc(k), mat: 'team', ...flags }));
    out.push(sweep({ path, radius: rIn, profile: arc(k).reverse(), mat: 'pitch', ...flags }));
  }
  out.push(torusArc({ radius: APSE_R - 0.07, tube: 0.12, arc: 180, startDeg: 180, segments: 10, sides: 3, axis: 'z', at: APSE_C, mat: 'amberedge', keep: true, maxLod: 1, tag: 'shell' }));
  return out;
}

/** Kamm (Seitenprofil z/y) über die ganze Länge: flach vom Bug, über den Apsis-Scheitel, als Bogen über den Ausgang. */
const FIN: Vec2[] = [
  [3.1, 0.95],
  [2.2, 1.55],
  [1.1, 2.05],
  [0.3, 2.95],
  [-0.6, 3.75],
  [-1.7, 3.95],
  [-2.7, 3.45],
  [-3.4, 2.3],
  [-3.8, 0.85],
  [-3.3, 1.45],
  [-2.65, 2.7],
  [-1.8, 3.28],
  [-0.9, 3.1],
  [0.0, 2.5],
  [1.0, 1.6],
  [2.2, 1.2],
];
const FIN_LOW: Vec2[] = [FIN[0]!, FIN[3]!, FIN[5]!, FIN[7]!, FIN[8]!, FIN[10]!, FIN[12]!, FIN[14]!];

/** Pfeifenbank (Seite `s`): drei gestufte senkrechte Pfeifen quer zur Fahrtrichtung auf teamfarbener Kamm-Platte. */
function pipeBank(s: 1 | -1): Shape {
  const y0 = 0.95;
  const list: [number, number][] = [
    [1.7, 1.25],
    [1.98, 1.0],
    [2.26, 0.75],
  ];
  return group([
    box({ size: [0.95, 0.22, 0.5], at: [s * 1.98, y0, -0.2], mat: 'team', keep: true, tag: 'pipe' }),
    ...list.map(([x, h]) => cylinder({ radius: 0.13, height: h, segments: 6, caps: 'top', at: [s * x, y0 + h / 2, -0.2], mat: 'pitch', keep: true, maxLod: 0, tag: 'pipe' })),
    // ab LOD1: Block statt drei Pfeifen
    box({ size: [0.75, 1.0, 0.26], at: [s * 1.98, y0 + 0.5, -0.2], mat: 'pitch', keep: true, minLod: 1, tag: 'pipe' }),
  ]);
}

/** Glyphenband entlang der Kielflanke. */
function glyphs(s: 1 | -1) {
  const pts: Vec3[] = [];
  for (const z of [2.4, 1.2, 0, -1.2, -2.4]) {
    const f = Math.sqrt(Math.max(0, 1 - (z / 3.5) ** 2));
    pts.push([s * 2.5 * f * 0.97 * (z > 0 ? 1 - 0.3 * (z / 3.5) : 1), 0.62, z]);
  }
  return glyphStrip({ path: pts, normal: [s, 0.2, 0], width: 0.14, pattern: [0.8, -0.25, 0.35, -0.25, 1.0, -0.3], mat: 'glyph', maxLod: 0, tag: 'glyphs' });
}

const TINE = (a: number): Shape =>
  group(
    [
      cylinder({ radius: 0.12, height: 1.0, segments: 6, axis: 'z', caps: 'top', at: [0.2, 0, 0.85], mat: 'amberedge', keep: true, maxLod: 1, tag: 'fork' }),
      cylinder({ radius: 0.12, height: 1.0, segments: 6, axis: 'z', caps: 'top', at: [-0.2, 0, 0.85], mat: 'amberedge', keep: true, maxLod: 1, tag: 'fork' }),
      box({ size: [0.56, 0.2, 1.0], at: [0, 0, 0.85], mat: 'amberedge', keep: true, minLod: 2, tag: 'fork' }),
    ],
    { rot: [0, a, 0] },
  );
const FORK_C: Vec3 = [0, 1.62, 1.85];

export default defineModel({
  id: 'f4:exp_mobile_fac',
  name: 'Ensemble',
  role: 'Wandernde Halle',
  class: 'land',
  tech: 4,
  footprint: [6, 6],
  icon: 'land_arty_t4',
  hover: 0.3,
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Riesenkiel 7 × 5 WU: dunkle Unterschale + Bernstein-Oberschale (Tropfenform, Bug schmaler)
        ellipsoid({ radii: [2.3, 0.3, 3.3], half: true, drop: 0.3, segments: 16, rings: 1, at: [0, 0.15, 0], rot: [180, 0, 0], mat: 'pitch', keep: true, tag: 'keel' }),
        ellipsoid({ radii: [2.5, 1.0, 3.5], half: true, drop: 0.3, segments: 16, rings: 3, at: [0, 0.8, 0], mat: 'amber', keep: true, tag: 'keel' }),
        // Kamm (Teamfarbe) über die ganze Länge, 0,6 WU dick, steht über dem Apsis-Scheitel
        extrude({ profile: FIN, depth: 0.6, mat: 'team', keep: true, smooth: false, maxLod: 1, tag: 'fin' }),
        extrude({ profile: FIN_LOW, depth: 0.6, mat: 'team', smooth: false, minLod: 2, tag: 'fin' }),
        // Apsis: halb offene Muschel (Viertelkugel), Scheitel vorn oben, offene Seite nach hinten (Ausgang)
        ...apse(),
        // Hallenboden (Pechglas) in der Apsis
        box({ size: [2.6, 0.12, 1.9], at: [0, KEEL_TOP + 0.02, -1.95], mat: 'pitch', maxLod: 1, smooth: false, tag: 'shell' }),
        // Glyphenfeld (Teamfarbe) auf dem Vorderdeck, trägt den Gabelkranz
        ellipsoid({ radii: [1.25, 0.3, 1.25], half: true, segments: 12, rings: 2, at: [0, 1.28, 1.85], mat: 'team', keep: true, tag: 'keel' }),
        // Resonanzkern: Kristall über dem Apsis-Scheitel (Flow-Einheit FACTORY)
        crystal({ radius: 0.34, height: 0.7, tip: 0.5, bottomTip: 0.25, at: [0, APSE_C[1] + APSE_R + 0.6, -0.55], mat: 'phase', keep: true, smooth: false, tag: 'crystal' }),
        // Mast mit waagerechtem Reif Ø 5 WU = höchster Punkt (Schildglocke)
        cylinder({ radius: 0.2, height: RING_Y - 1.2, segments: 6, at: [0, 1.2 + (RING_Y - 1.2) / 2, MAST_Z], mat: 'pitch', keep: true, smooth: false, tag: 'mast' }),
        torus({ radius: 2.45, tube: 0.17, segments: 24, sides: 3, at: [0, RING_Y, MAST_Z], mat: 'pitch', keep: true, smooth: false, maxLod: 1, tag: 'ring' }),
        torus({ radius: 2.45, tube: 0.18, segments: 9, sides: 3, at: [0, RING_Y, MAST_Z], mat: 'pitch', keep: true, smooth: false, minLod: 2, tag: 'ring' }),
        radial(strut({ from: [0.18, RING_Y, 0], to: [2.35, RING_Y, 0], radius: 0.07, sides: 3, mat: 'pitch' }), { count: 3, startDeg: 90, at: [0, 0, MAST_Z], maxLod: 0 }),
        cylinder({ radius: 0.34, height: 0.3, segments: 8, at: [0, RING_Y, MAST_Z], mat: 'amberedge', maxLod: 1, smooth: false, tag: 'mast' }),
        // Pfeifenbänke seitlich (Flugabwehr)
        pipeBank(1),
        pipeBank(-1),
        glyphs(1),
        glyphs(-1),
      ],
    },
    { name: 'horn_l', pivot: [HORN_X, HORN_Y, HORN_Z], anim: 'yawpitch', shapes: hornShapes(HORN_X) },
    { name: 'horn_r', pivot: [-HORN_X, HORN_Y, HORN_Z], anim: 'yawpitch', shapes: hornShapes(-HORN_X) },
    {
      name: 'fork',
      pivot: FORK_C,
      anim: 'yaw',
      shapes: [
        // Gabelkranz: Nabe mit drei kurzen Gabeln (Nahabwehr)
        cylinder({ radius: 0.36, height: 0.34, segments: 8, at: FORK_C, mat: 'pitch', keep: true, tag: 'fork' }),
        group([TINE(0), TINE(120), TINE(240)], { at: FORK_C }),
      ],
    },
  ],
  notes:
    'v_exp_mobile_fac: T4 nicht in roster.units → Name/Klasse/Tech/Footprint/Icon im Modell. Gleiter mit hover 0,3 (Roster). 3 animierte Parts: Trichter links/rechts yawpitch, Gabelkranz yaw.',
});
