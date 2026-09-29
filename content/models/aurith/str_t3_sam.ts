/**
 * Hochorgel (f4:str_t3_sam) – Raketenabwehr T3, 2×2 (Roster-Maßstab 1,0: Maße unten sind Spielmaße).
 *
 * Roster: „Dreipass-Sockel mit teamfarbener Platte und 4 senkrechten Spindeln (doppelt so viele wie Pfeifenwerk I),
 * 3 Tonpunkte.“ faction.md §5.2: Pfeifenwerk-Grundform, aber senkrechte Spindeln (gestreckte Sechskant-Doppelkegel,
 * Ø 0,38 ≥ 2 × Pfeifen-Ø) statt Pfeifen, gestuft wie ein Orgelprospekt quer zur Blickrichtung; kein Kristall.
 * Paartest (T4-Liste) Hochorgel ↔ Raketen-Experimental: stehende Spindelreihe gegen einzelne große Spindel.
 * Spindeln stecken mit der unteren Spitze in der Kamm-Platte; Bernstein-Kante wie Gabel und Pfeifen (Waffe = flat).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = links):
 *   hull  – Dreipass-Sockel (3 Linsen: Team-Rand + Bernstein-Kuppe), Pechglas-Drehkranz, 3 Tonpunkte
 *   plate – Bernstein-Kuppel, Kamm-Platte (Team, läuft nach hinten aus), 4 gestufte senkrechte Spindeln,
 *           Glyphenbänder; Yaw (PartStream 1)
 */
import { cone, cylinder, defineModel, ellipsoid, extrude, glyphStrip, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

// Dreipass-Sockel für die Footprint-Kante E (Basis-Einheiten): Linsen-Radius 0,3 E, Abstand 0,2 E vom Zentrum.
const E = 2;
const LR = 0.3 * E;
const LD = 0.2 * E;
const LH = 0.24;
const LOBE_DEG = [0, 120, 240]; // 0° = hinten (−Z), 120°/240° = vorn links/rechts
const RIM_H = 0.11; // Teamfarben-Rand
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
    cylinder({ radius: 0.06, height: 0.04, segments: 6, caps: 'top', at: [(i - (n - 1) / 2) * 0.2, y, -LD - rho], mat: 'pearl', maxLod: 1, tag: 'tone' }),
  );
}

/**
 * Glyphenband auf der Seitenfacette (±X) einer Halbellipsoid-Schale (segments 8, rings 2): t = Höhe im unteren Band,
 * u = Lage längs (−1…1), `pk` = Rhythmus-Maßstab (große Gebäude: längere Striche, weniger Dreiecke).
 */
function sideGlyph(c: Vec3, r: Vec3, s: 1 | -1, t: number, u0: number, u1: number, width = 0.05, pk = 1): Shape {
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
  return glyphStrip({ path: [P(u0), P(u1)], normal: [(s * nx) / nl, ny / nl, 0], width, pattern: [0.1, -0.04, 0.05, -0.04, 0.16, -0.05].map((v) => v * pk), lift: 0.008 * pk, mat: 'glyph', maxLod: 0, tag: 'glyphs' });
}

const SR = 0.19; // Spindel-Radius (Ø 0,38 = 2,1 × Pfeifen-Ø)
/**
 * Senkrechte Spindel (gestreckter Sechskant-Doppelkegel, Taille im unteren Drittel): Oberkegel Bernstein-Kante,
 * Unterkegel Pechglas (steckt in der Platte) – liest sich als Geschoss, nicht als Kristall.
 */
function spindle(x: number, y0: number, len: number, z: number): Shape[] {
  const lo = len * 0.3;
  const up = len - lo;
  const wy = y0 - 0.1 + lo; // Taille
  return [
    cone({ radius: SR, height: up, segments: 6, at: [x, wy + up / 2, z], mat: 'amberedge', keep: true, tag: 'spindle' }),
    cone({ radius: SR, height: lo, segments: 6, rot: [180, 0, 0], at: [x, wy - lo / 2, z], mat: 'pitch', keep: true, maxLod: 1, tag: 'spindle' }),
  ];
}

const RING_Y = 0.15; // Oberkante der Linsen-Überlappung im Zentrum
const DOME_R: Vec3 = [0.46, 0.24, 0.46];
const DOME_C: Vec3 = [0, RING_Y + 0.08 + DOME_R[1] / 2, 0];
const PLATE_Y = RING_Y + 0.08 + DOME_R[1] - 0.04; // Unterkante der Kamm-Platte
const PLATE_T = 0.09;

/** Kamm-Platte (Draufsicht x/z): breit und flach, läuft nach hinten spitz aus. */
const PLATE: Vec2[] = [
  [0.86, 0.05],
  [0.74, 0.17],
  [0.3, 0.22],
  [-0.3, 0.22],
  [-0.74, 0.17],
  [-0.86, 0.05],
  [-0.46, -0.1],
  [0, -0.48],
  [0.46, -0.1],
];

export default defineModel({
  id: 'f4:str_t3_sam',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...trefoil(),
        cylinder({ radius: 0.42, height: 0.12, segments: 6, caps: 'top', at: [0, RING_Y + 0.03, 0], mat: 'pitch', maxLod: 1, tag: 'ring' }),
        ...tonpunkte(3, 0.34),
      ],
    },
    {
      name: 'plate',
      pivot: [0, RING_Y + 0.09, 0],
      anim: 'yaw',
      shapes: [
        ellipsoid({ radii: DOME_R, half: true, segments: 8, rings: 2, at: DOME_C, mat: 'amber', keep: true, smooth: true, tag: 'keel' }),
        // Kamm-Platte (Team); die Spindeln stehen quer zur Blickrichtung darauf
        extrude({ profile: PLATE, depth: PLATE_T, axis: 'y', at: [0, PLATE_Y + PLATE_T / 2, 0], mat: 'team', keep: true, tag: 'fin' }),
        // 4 gestufte senkrechte Spindeln (doppelt so viele wie Pfeifenwerk I): von links nach rechts kürzer
        ...spindle(0.63, PLATE_Y + PLATE_T, 1.34, 0.04),
        ...spindle(0.21, PLATE_Y + PLATE_T, 1.18, 0.04),
        ...spindle(-0.21, PLATE_Y + PLATE_T, 1.02, 0.04),
        ...spindle(-0.63, PLATE_Y + PLATE_T, 0.86, 0.04),
        sideGlyph(DOME_C, DOME_R, 1, 0.4, -0.7, 0.5, 0.08, 2),
        sideGlyph(DOME_C, DOME_R, -1, 0.4, -0.7, 0.5, 0.08, 2),
      ],
    },
  ],
  notes: 'v_sam: 4 senkrechte Spindeln (Ø 0,38) statt Pfeifen, gestuft 1,34 / 1,18 / 1,02 / 0,86 WU.',
});
