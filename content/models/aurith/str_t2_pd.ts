/**
 * Gabel II (f4:str_t2_pd) – Strahlverteidigung T2, 2×2 (Roster-Maßstab xz 2,0 / y 2,4, Basis = Gabel I auf 1×1;
 * alle Maße unten in Basis-Einheiten).
 *
 * Roster: „Gabel ×2 (2×2) mit Linse zwischen den Zinken (Strahl), 2 Tonpunkte.“ faction.md §5.2: dieselbe Gabel wie
 * Gleiter und Gabel I; T2 = Strahllinse (Bernstein-Tiefe, senkrecht, blickt nach vorn) zwischen weiter gestellten
 * Zinken, höhere Kuppel (y ×1,2 über dem Maßstab), 2 Tonpunkte. Tech durch Skalierung, nicht durch neue Form.
 * Direktfeuer-Monopol = waagerechte Gabel (gegen die stehenden Pfeifen des Pfeifenwerks II).
 * Gebäude dreizählig: drei überlappende Linsen (eine hinten, zwei vorn) mit Teamfarben-Rand und Kuppe aus
 * Bernstein (hell oben, dunkel unten), darüber Pechglas-Drehkranz und eine Bernstein-Kuppel (weich) als Lafette;
 * Gabel flat, Kamm (Team) läuft hinter der Kuppel nach hinten aus.
 * Kein Kristall (Kampfbau), Glyphenbänder auf den Kuppelflanken, 2 Tonpunkte (Perlglas) auf der hinteren Linse.
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe, +X = links):
 *   hull   – Dreipass-Sockel (3 Linsen: Team-Rand + Bernstein-Kuppe), Pechglas-Drehkranz, 2 Tonpunkte
 *   turret – Bernstein-Kuppel, Gabel (2 Zinken + Steg) mit Strahllinse, Hinterkamm (Team), Glyphenbänder; Yaw
 *            (PartStream 1)
 */
import { box, cylinder, defineModel, ellipsoid, extrude, glyphStrip, lens, quad, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

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

const RING_Y = 0.1; // Oberkante der Linsen-Überlappung im Zentrum ≈ 0,10
const DOME_R: Vec3 = [0.23, 0.32, 0.25]; // hoch: die Gabel sitzt über dem Sockelumriss (Schattenriss)
const DOME_C: Vec3 = [0, RING_Y + 0.05 + DOME_R[1] / 2, -0.02];
const FORK_Y = DOME_C[1] + 0.1;
const TX = 0.18; // Zinkenabstand (T2 weiter als Gabel I, Platz für die Linse)

/** Hinterkamm (Seitenprofil z/y): wächst aus dem Kuppelscheitel, wölbt sich und läuft nach hinten unten spitz aus. */
const FIN: Vec2[] = [
  [0.0, 0.46],
  [-0.04, 0.6],
  [-0.12, 0.7],
  [-0.24, 0.74],
  [-0.36, 0.68],
  [-0.45, 0.54],
  [-0.36, 0.58],
  [-0.26, 0.61],
  [-0.16, 0.57],
  [-0.1, 0.47],
];

export default defineModel({
  id: 'f4:str_t2_pd',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...trefoil(),
        // Pechglas-Drehkranz im Zentrum des Dreipasses
        cylinder({ radius: 0.21, height: 0.08, segments: 6, caps: 'top', at: [0, RING_Y + 0.02, 0], mat: 'pitch', maxLod: 1, tag: 'ring' }),
        ...tonpunkte(2, 0.18),
      ],
    },
    {
      name: 'turret',
      pivot: [0, RING_Y + 0.06, 0],
      anim: 'yaw',
      shapes: [
        // Bernstein-Kuppel (Lafette), weich
        ellipsoid({ radii: DOME_R, half: true, segments: 8, rings: 2, at: DOME_C, mat: 'amber', keep: true, smooth: true, tag: 'keel' }),
        // Gabel: zwei gerade, waagerechte Sechskant-Zinken (Ø 0,17) mit Steg, ragen über den Sockel hinaus
        cylinder({ radius: 0.085, height: 0.54, segments: 6, axis: 'z', caps: 'top', at: [TX, FORK_Y, 0.25], mat: 'amberedge', keep: true, tag: 'fork' }),
        cylinder({ radius: 0.085, height: 0.54, segments: 6, axis: 'z', caps: 'top', at: [-TX, FORK_Y, 0.25], mat: 'amberedge', keep: true, tag: 'fork' }),
        box({ size: [2 * TX + 0.17, 0.11, 0.12], at: [0, FORK_Y, 0.04], mat: 'pitch', keep: true, tag: 'fork' }),
        // Strahllinse zwischen den Zinkenspitzen (senkrecht, blickt nach vorn) an einem Quersteg; Phasen-Fokus vorn
        lens({ radius: 0.13, thickness: 0.1, segments: 8, rings: 3, axis: 'z', at: [0, FORK_Y, 0.42], mat: 'amberdeep', keep: true, smooth: true, tag: 'lens' }),
        cylinder({ radius: 0.035, height: 2 * TX, segments: 4, axis: 'x', caps: false, at: [0, FORK_Y, 0.42], mat: 'pitch', maxLod: 0, tag: 'fork' }),
        quad({ size: [0.09, 0.09], rot: [90, 0, 45], at: [0, FORK_Y, 0.476], mat: 'glyph', maxLod: 1, tag: 'lens' }),
        // Hinterkamm (Team), 0,17 WU dick
        extrude({ profile: FIN, depth: 0.17, mat: 'team', keep: true, tag: 'fin' }),
        sideGlyph(DOME_C, DOME_R, 1, 0.45, -0.8, 0.6),
        sideGlyph(DOME_C, DOME_R, -1, 0.45, -0.8, 0.6),
      ],
    },
  ],
  notes: 'v_pd: Gabel I + Strahllinse zwischen den Zinken, 2 Tonpunkte; Maßstab 2,0 / 2,4 aus dem Roster.',
});
