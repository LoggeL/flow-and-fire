/**
 * Pfeifenwerk I (f4:str_t1_aa) – Flugabwehrturm T1, 1×1.
 *
 * Roster: „Dreipass-Sockel mit teamfarbener Kamm-Platte und 2 gestuften senkrechten Pfeifen.“ faction.md §5.2:
 * Flugabwehr-Monopol = senkrechte Pfeifen (≥ 75°) mit gestufter Länge (Orgelprospekt) quer zur Blickrichtung auf
 * einer teamfarbenen Kamm-Platte; kein Trichter, keine Gabel, kein Kristall. Paartest Gabel I ↔ Pfeifenwerk I:
 * waagerechte Zinken gegen stehende Pfeifen. Pfeife = Sechskant-Zylinder (Ø 0,18, Bernstein-Kante)
 * mit schräg gefastem, dunklem Kopf und Kernspalt (Labium) vorn.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = links):
 *   hull  – Dreipass-Sockel (3 Linsen: Team-Rand + Bernstein-Kuppe), Pechglas-Drehkranz, 1 Tonpunkt
 *   plate – Bernstein-Kuppel, Kamm-Platte (Team, läuft nach hinten aus), 2 gestufte Pfeifen, Glyphenbänder;
 *           Yaw (PartStream 1)
 */
import { cylinder, defineModel, ellipsoid, extrude, glyphStrip, group, quad, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

// Dreipass-Sockel für die Footprint-Kante E (Basis-Einheiten): Linsen-Radius 0,3 E, Abstand 0,2 E vom Zentrum.
const E = 1;
const LR = 0.3 * E;
const LD = 0.2 * E;
const LH = 0.14;
const LOBE_DEG = [0, 120, 240]; // 0° = hinten (−Z), 120°/240° = vorn links/rechts
const RIM_H = 0.07; // Teamfarben-Rand
const CAP_F = 0.86; // Kuppe: Anteil des Linsen-Radius

/** Dreipass: je Linse ein flacher Teamfarben-Rand (Kegel-Linse) und eine Bernstein-Kuppe darüber (weich, wie der Wirtschafts-Dreipass: hell oben, dunkel unten). */
function trefoil(): Shape[] {
  return LOBE_DEG.flatMap((a) => {
    const r = (a * Math.PI) / 180;
    const x = LD * Math.sin(r);
    const z = -LD * Math.cos(r);
    return [
      ellipsoid({ radii: [LR, RIM_H, LR], half: true, segments: 8, rings: 1, at: [x, RIM_H / 2, z], mat: 'team', keep: true, smooth: true, tag: 'lens' }),
      ellipsoid({ radii: [LR * CAP_F, LH, LR * CAP_F], half: true, segments: 8, rings: 2, at: [x, LH / 2, z], mat: 'amber', keep: true, smooth: true, tag: 'lens' }),
    ];
  });
}

/** Tonpunkte (Perlglas, Ø 0,12, Abstand 0,08) quer auf der Kuppe der hinteren Linse, `rho` = Abstand nach hinten. */
function tonpunkte(n: number, rho: number): Shape[] {
  const y = LH - (rho / (LR * CAP_F * Math.SQRT1_2)) * LH * (1 - Math.SQRT1_2); // Höhe der oberen Facette der Kuppe
  return Array.from({ length: n }, (_, i) =>
    cylinder({ radius: 0.06, height: 0.03, segments: 6, caps: 'top', at: [(i - (n - 1) / 2) * 0.2, y, -LD - rho], mat: 'pearl', maxLod: 1, tag: 'tone' }),
  );
}

/**
 * Glyphenband auf der Seitenfacette (±X) einer Halbellipsoid-Schale (segments 8, rings 2): t = Höhe im unteren Band,
 * u = Lage längs (−1…1).
 */
function sideGlyph(c: Vec3, r: Vec3, s: 1 | -1, t: number, u0: number, u1: number, width = 0.05): Shape {
  const c22 = Math.cos(Math.PI / 8);
  const s22 = Math.sin(Math.PI / 8);
  const k = Math.SQRT1_2;
  const P = (u: number): Vec3 => {
    const ex = r[0] * c22;
    const ez = u * r[2] * s22;
    return [c[0] + s * (ex + (k * ex - ex) * t), c[1] - r[1] / 2 + k * r[1] * t, c[2] + ez + (k * ez - ez) * t];
  };
  const nx = k * r[1];
  const ny = (1 - k) * r[0] * c22;
  const nl = Math.hypot(nx, ny);
  return glyphStrip({ path: [P(u0), P(u1)], normal: [(s * nx) / nl, ny / nl, 0], width, pattern: [0.1, -0.04, 0.05, -0.04, 0.16, -0.05], lift: 0.008, mat: 'glyph', maxLod: 0, tag: 'glyphs' });
}

const PR = 0.09; // Pfeifen-Radius (Ø 0,18 ≥ 0,17)
/** Pfeife: Sechskant (Fläche nach vorn), dunkler schräger Kopf, Kernspalt vorn unten. */
function pipe(x: number, y0: number, h: number, z: number): Shape[] {
  const apo = PR * Math.cos(Math.PI / 6);
  return [
    cylinder({ radius: PR, height: h, segments: 6, caps: false, rot: [0, 30, 0], at: [x, y0 + h / 2, z], mat: 'amberedge', keep: true, tag: 'pipe' }),
    group([cylinder({ radius: PR * 1.02, height: 0.03, segments: 6, caps: 'top', rot: [0, 30, 0], mat: 'pitch', tag: 'pipe' })], { at: [x, y0 + h, z], rot: [20, 0, 0], maxLod: 1 }),
    quad({ size: [0.09, 0.07], rot: [90, 0, 0], at: [x, y0 + 0.14, z + apo + 0.005], mat: 'pitch', maxLod: 0, tag: 'pipe' }),
  ];
}

const RING_Y = 0.1; // Oberkante der Linsen-Überlappung im Zentrum ≈ 0,10
const DOME_R: Vec3 = [0.22, 0.14, 0.22];
const DOME_C: Vec3 = [0, RING_Y + 0.05 + DOME_R[1] / 2, 0];
const PLATE_Y = RING_Y + 0.05 + DOME_R[1] - 0.02; // Unterkante der Kamm-Platte
const PLATE_T = 0.06;

/** Kamm-Platte (Draufsicht x/z): vorn breit gerundet, läuft nach hinten spitz aus. */
const PLATE: Vec2[] = [
  [0.23, 0.04],
  [0.18, 0.12],
  [0.07, 0.15],
  [-0.07, 0.15],
  [-0.18, 0.12],
  [-0.23, 0.04],
  [-0.15, -0.06],
  [0, -0.3],
  [0.15, -0.06],
];

export default defineModel({
  id: 'f4:str_t1_aa',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...trefoil(),
        cylinder({ radius: 0.21, height: 0.08, segments: 6, caps: 'top', at: [0, RING_Y + 0.02, 0], mat: 'pitch', maxLod: 1, tag: 'ring' }),
        ...tonpunkte(1, 0.2),
      ],
    },
    {
      name: 'plate',
      pivot: [0, RING_Y + 0.06, 0],
      anim: 'yaw',
      shapes: [
        ellipsoid({ radii: DOME_R, half: true, segments: 8, rings: 2, at: DOME_C, mat: 'amber', keep: true, smooth: true, tag: 'keel' }),
        // Kamm-Platte (Team), 0,06 dick; die Pfeifen stehen quer zur Blickrichtung darauf
        extrude({ profile: PLATE, depth: PLATE_T, axis: 'y', at: [0, PLATE_Y + PLATE_T / 2, 0], mat: 'team', keep: true, tag: 'fin' }),
        // 2 gestufte senkrechte Pfeifen (Orgelprospekt): links hoch, rechts kürzer
        ...pipe(0.12, PLATE_Y + PLATE_T, 0.56, 0.04),
        ...pipe(-0.12, PLATE_Y + PLATE_T, 0.4, 0.04),
        sideGlyph(DOME_C, DOME_R, 1, 0.4, -0.7, 0.5, 0.045),
        sideGlyph(DOME_C, DOME_R, -1, 0.4, -0.7, 0.5, 0.045),
      ],
    },
  ],
  notes: 'v_aa_struct: Pfeifen senkrecht (90°) auf der Kamm-Platte, gestuft 0,56 / 0,40 WU.',
});
