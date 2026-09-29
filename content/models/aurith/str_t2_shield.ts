/**
 * Dämpfer II (f4:str_t2_shield) – Schildgenerator T2, 6×6 (Roster-Maßstab 1,0: Maße unten sind Spielmaße).
 *
 * Roster: „Mast mit waagerechtem Reif (Ø ≥ 0,8 × Footprint-Kante); keine Muschel.“ faction.md §5.2 Winkel-Code:
 * Mast + **waagerechter** Reif = Schild (Mast + Muschel = Intel, Paartest Widerhall I ↔ Dämpfer II). Der Reif
 * (Team, Ø 5,3 = 0,88 × Kante) ist der höchste Punkt und hängt an drei Speichen (dreizählig) an der Mastnabe.
 * Hoch und schlank: Mast Ø 0,4 bis 4,0 WU aus einer Bernstein-Generatorkuppel über dem Dreipass-Sockel.
 * Kein Kristall (kein Flow-Gebäude), Glyphenbänder auf der Kuppel, 2 Tonpunkte.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = links):
 *   hull – Dreipass-Sockel (3 Linsen: Team-Rand + Bernstein-Kuppe), Generatorkuppel (Bernstein), Mastfuß, Mast,
 *          Glyphenbänder, 2 Tonpunkte
 *   ring – Nabe, drei Speichen, waagerechter Reif (Team); dreht um +Y (PartStream 1)
 */
import { cylinder, defineModel, ellipsoid, frustum, glyphStrip, strut, torus, type Shape, type Vec3 } from '@faf/modelkit';

// Dreipass-Sockel für die Footprint-Kante E (Basis-Einheiten): Linsen-Radius 0,3 E, Abstand 0,2 E vom Zentrum.
const E = 6;
const LR = 0.3 * E;
const LD = 0.2 * E;
const LH = 0.5;
const LOBE_DEG = [0, 120, 240]; // 0° = hinten (−Z), 120°/240° = vorn links/rechts
const RIM_H = 0.2; // Teamfarben-Rand
const CAP_F = 0.86; // Kuppe: Anteil des Linsen-Radius
const LSEG = 6; // Sechskant-Linsen (Budget bei 6×6; weiche Normalen runden sie)

/** Dreipass: je Linse ein flacher Teamfarben-Rand (Kegel-Linse) und eine Bernstein-Kuppe darüber (weich, wie der Wirtschafts-Dreipass: hell oben, dunkel unten). */
function trefoil(): Shape[] {
  return LOBE_DEG.flatMap((a) => {
    const r = (a * Math.PI) / 180;
    const x = LD * Math.sin(r);
    const z = -LD * Math.cos(r);
    return [
      ellipsoid({ radii: [LR, RIM_H, LR], half: true, segments: LSEG, rings: 1, at: [x, RIM_H / 2, z], mat: 'team', keep: true, smooth: true, tag: 'lens' }),
      ellipsoid({ radii: [LR * CAP_F, LH, LR * CAP_F], half: true, segments: LSEG, rings: 2, at: [x, LH / 2, z], mat: 'amber', keep: true, smooth: true, tag: 'lens' }),
    ];
  });
}

/**
 * Tonpunkte (Perlglas) quer auf der Kuppe der hinteren Linse, `rho` = Abstand von ihrer Mitte nach hinten; auf 6×6
 * doppelt so groß (Ø 0,24, Abstand 0,16), damit sie aus der Spielkamera lesbar bleiben (wie die Varkan-Kerben).
 */
function tonpunkte(n: number, rho: number): Shape[] {
  const k = 2;
  const y = LH - (rho / (LR * CAP_F * Math.SQRT1_2)) * LH * (1 - Math.SQRT1_2); // Höhe der oberen Facette der Kuppe
  return Array.from({ length: n }, (_, i) =>
    cylinder({ radius: 0.06 * k, height: 0.06, segments: 5, caps: 'top', at: [(i - (n - 1) / 2) * 0.2 * k, y, -LD - rho], mat: 'pearl', maxLod: 1, tag: 'tone' }),
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

const RING_Y = 0.3; // Oberkante der Linsen-Überlappung im Zentrum
const DOME_R: Vec3 = [1.15, 0.85, 1.15];
const DOME_C: Vec3 = [0, RING_Y - 0.05 + DOME_R[1] / 2, 0];
const MR = 0.2; // Mast-Radius (Ø 0,4)
const MAST_TOP = 4.0;
const HOOP_R = 2.5; // Reif-Mittellinie; mit Rohr Ø 5,3
const HOOP_T = 0.15;
const HOOP_Y = MAST_TOP + 0.25; // Reif über der Nabe = höchster Punkt

export default defineModel({
  id: 'f4:str_t2_shield',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...trefoil(),
        ellipsoid({ radii: DOME_R, half: true, segments: 8, rings: 2, at: DOME_C, mat: 'amber', keep: true, smooth: true, tag: 'keel' }),
        frustum({ radius: 0.45, radiusTop: MR * 1.1, height: 0.6, segments: 6, caps: false, at: [0, DOME_C[1] + DOME_R[1] / 2 + 0.2, 0], mat: 'pitch', maxLod: 1, tag: 'mast' }),
        cylinder({ radius: MR, height: MAST_TOP - DOME_C[1], segments: 6, caps: false, at: [0, (MAST_TOP + DOME_C[1]) / 2, 0], mat: 'pitch', keep: true, tag: 'mast' }),
        sideGlyph(DOME_C, DOME_R, 1, 0.4, -0.7, 0.7, 0.14, 3),
        sideGlyph(DOME_C, DOME_R, -1, 0.4, -0.7, 0.7, 0.14, 3),
        ...tonpunkte(2, 0.7),
      ],
    },
    {
      name: 'ring',
      pivot: [0, MAST_TOP, 0],
      anim: 'yaw',
      shapes: [
        ellipsoid({ radii: [0.42, 0.3, 0.42], segments: 6, rings: 3, at: [0, MAST_TOP, 0], mat: 'pitch', keep: true, smooth: true, tag: 'mast' }),
        // drei Speichen (dreizählig), von der Nabe nach außen ansteigend
        ...[0, 120, 240].map((a) => {
          const r = (a * Math.PI) / 180;
          return strut({ from: [0, MAST_TOP, 0], to: [HOOP_R * Math.sin(r), HOOP_Y, -HOOP_R * Math.cos(r)], radius: 0.09, sides: 3, caps: false, mat: 'pitch', maxLod: 1, tag: 'ring' });
        }),
        // waagerechter Reif (Team), höchster Punkt der Silhouette
        torus({ radius: HOOP_R, tube: HOOP_T, segments: 12, sides: 3, at: [0, HOOP_Y, 0], mat: 'team', keep: true, tag: 'ring' }),
      ],
    },
  ],
  notes: 'v_shield: waagerechter Team-Reif Ø 5,3 (0,88 × Kante) auf 4 WU Mast, drei Speichen; keine Muschel.',
});
