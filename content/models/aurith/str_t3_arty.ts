/**
 * Großhorn (f4:str_t3_arty) – Schwere Artilleriestellung T3, 8×8 (Roster-Maßstab xz 4,0 / y 4,67, Basis = Fanfare auf
 * 2×2; alle Maße unten in Basis-Einheiten, im Spiel ×4 bzw. ×4,67).
 *
 * Roster: „Fanfare-Silhouette auf 8×8 mit überlangem Trichter (Länge ≥ 2 × Öffnung) und zweitem Kamm, 3 Tonpunkte;
 * kein Kristall.“ Gleiche Grundform wie die Fanfare (Dreipass, Dreibein-Lafette, Gegengewichts-Kamm, Trichter 45–55°);
 * T3 = überlanger Trichter (L 1,62 = 2,1 × Öffnung, 55° steil, Zapfen nach hinten versetzt, damit er im Footprint
 * bleibt), Doppelkamm (zweiter, teamfarbener Kamm parallel über dem Gegengewicht), 3 Tonpunkte, riesiger Maßstab.
 * Paartest Großhorn ↔ Resonator III: schräger Trichter gegen stehende Kristalle.
 *
 * Fanfare:
 * Roster: „Großer Trichter auf Lafette über dem Dreipass-Sockel, Kamm als Gegengewicht; keine Gabel.“ faction.md
 * §5.2: statische Artillerie = großer offener Trichter (Öffnung : Hals = 2,5 : 1, Ø 0,76 ≥ 0,5 WU) auf einer
 * Dreibein-Lafette, in Ruhe 50° geneigt (Winkel-Code schräg = indirekt), Kamm als Gegengewicht nach hinten. Der
 * Trichter ist außen teamfarben, innen dunkel (Pechglas-Mündung), Waffe = gerade und flat. Dreibein-Lafette = zwei
 * schräge Wangen-Streben zu den Schildzapfen + der Gegengewichts-Kamm als drittes Bein. Kein Kristall, keine Gabel.
 * Glyphenbänder auf den Flanken des Kamms.
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe, +X = links):
 *   hull – Dreipass-Sockel (3 Linsen: Team-Rand + Bernstein-Kuppe), 3 Tonpunkte
 *   boom – Lafette: Drehteller (Bernstein-Kante), zwei Wangen-Streben, Schildzapfen-Achse, Gegengewichts-Kamm
 *          (Bernstein) mit Glyphenbändern, zweiter Kamm (Team); Yaw (PartStream 1)
 *   horn – überlanger Trichter (Team, außen) mit Becherrand und dunkler Mündung; Pitch um die Schildzapfen
 *          (PartStream 2)
 */
import { cylinder, defineModel, ellipsoid, extrude, frustum, glyphStrip, strut, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

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
    cylinder({ radius: 0.06, height: 0.04, segments: 5, caps: 'top', at: [(i - (n - 1) / 2) * 0.2, y, -LD - rho], mat: 'pearl', maxLod: 1, tag: 'tone' }),
  );
}

const RING_Y = 0.15; // Oberkante der Linsen-Überlappung im Zentrum
const DECK_Y = RING_Y + 0.12; // Oberkante Drehteller
const TRUN: Vec3 = [0, 0.86, -0.2]; // Schildzapfen (Pitch-Achse), nach hinten versetzt
const ELEV = 55; // Trichterneigung in Ruhe (45–55°)
const HORN_L = 1.62; // ≥ 2 × Öffnung
const THROAT = 0.15;
const MOUTH = 0.38; // Öffnung Ø 0,76 (Mündung : Hals ≈ 2,5 : 1)
const TX = 0.3; // halbe Wangenbreite

const E_RAD = (ELEV * Math.PI) / 180;
const DIR: Vec3 = [0, Math.sin(E_RAD), Math.cos(E_RAD)];
const along = (d: number): Vec3 => [TRUN[0] + DIR[0] * d, TRUN[1] + DIR[1] * d, TRUN[2] + DIR[2] * d];
const H0 = -0.14; // Hals beginnt hinter den Zapfen

/** Gegengewichts-Kamm (Seitenprofil z/y): steigt hinter dem Drehteller auf und läuft nach hinten unten aus. */
const FIN: Vec2[] = [
  [-0.05, DECK_Y],
  [-0.12, 0.69],
  [-0.3, 0.98],
  [-0.52, 1.05],
  [-0.7, 0.88],
  [-0.78, 0.57],
  [-0.62, 0.67],
  [-0.44, 0.64],
  [-0.3, 0.47],
  [-0.2, DECK_Y],
];
const FIN_T = 0.22;
/** Zweiter Kamm (Team, T3-Doppelkamm): schmales Bogenband parallel über dem Gegengewichts-Kamm. */
const FIN2: Vec2[] = [
  [-0.1, 0.91],
  [-0.3, 1.17],
  [-0.56, 1.24],
  [-0.84, 0.98],
  [-0.9, 0.62],
  [-0.78, 0.83],
  [-0.56, 1.1],
  [-0.32, 1.05],
];


/** Glyphenband auf einer Flanke (x = ±FIN_T/2) des Kamms, entlang seiner Mittellinie. */
function finGlyph(s: 1 | -1): Shape {
  const x = s * (FIN_T / 2);
  return glyphStrip({
    path: [
      [x, 0.5, -0.16],
      [x, 0.74, -0.3],
      [x, 0.83, -0.48],
      [x, 0.74, -0.64],
    ],
    normal: [s, 0, 0],
    width: 0.06,
    pattern: [0.16, -0.06, 0.06, -0.06, 0.24, -0.08],
    mat: 'glyph',
    maxLod: 0,
    tag: 'glyphs',
  });
}

export default defineModel({
  id: 'f4:str_t3_arty',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...trefoil(),
        ...tonpunkte(3, 0.34),
      ],
    },
    {
      name: 'boom',
      pivot: [0, DECK_Y, 0],
      anim: 'yaw',
      shapes: [
        // Drehteller der Lafette (Bernstein-Kante)
        cylinder({ radius: 0.46, height: 0.14, segments: 6, caps: 'top', at: [0, DECK_Y - 0.07, 0], mat: 'amberedge', keep: true, maxLod: 1, tag: 'ring' }),
        // zwei Wangen-Streben (gerade, Pechglas) zu den Schildzapfen
        strut({ from: [TX + 0.02, DECK_Y, -0.12], to: [TX, TRUN[1], TRUN[2]], radius: 0.1, sides: 3, mat: 'pitch', keep: true, tag: 'boom' }),
        strut({ from: [-TX - 0.02, DECK_Y, -0.12], to: [-TX, TRUN[1], TRUN[2]], radius: 0.1, sides: 3, mat: 'pitch', keep: true, tag: 'boom' }),
        // Gegengewichts-Kamm (drittes Lafettenbein), Bernstein, weich gerundete Kontur
        extrude({ profile: FIN, depth: FIN_T, mat: 'amber', keep: true, tag: 'fin' }),
        extrude({ profile: FIN2, depth: 0.13, mat: 'team', keep: true, tag: 'fin' }),
        finGlyph(1),
        finGlyph(-1),
      ],
    },
    {
      name: 'horn',
      parent: 'boom',
      pivot: TRUN,
      anim: 'pitch',
      shapes: [
        // Schildzapfen-Achse (quer, zwischen den Wangen)
        cylinder({ radius: 0.08, height: 2 * TX + 0.12, segments: 6, caps: false, axis: 'x', at: TRUN, mat: 'pitch', maxLod: 1, tag: 'horn' }),
        // Trichter: offener Kegelstumpf (Team außen), Hals hinter den Zapfen, Mündung vorn oben
        frustum({ radius: THROAT, radiusTop: MOUTH, height: HORN_L, segments: 8, caps: false, rot: [90 - ELEV, 0, 0], at: along(H0 + HORN_L / 2), mat: 'team', keep: true, tag: 'horn' }),
        // Schallbecher-Rand (Bernstein-Kante) rahmt die dunkle Mündung
        frustum({ radius: MOUTH, radiusTop: MOUTH * 1.08, height: 0.06, segments: 8, caps: false, rot: [90 - ELEV, 0, 0], at: along(H0 + HORN_L + 0.02), mat: 'amberedge', keep: true, tag: 'horn' }),
        // dunkle Mündung (Innenseite nie teamfarben)
        cylinder({ radius: MOUTH * 0.96, height: 0.02, segments: 8, caps: 'top', rot: [90 - ELEV, 0, 0], at: along(H0 + HORN_L - 0.02), mat: 'pitch', keep: true, tag: 'horn' }),
      ],
    },
  ],
  notes: 'v_arty_struct: Fanfare + überlanger Trichter 55° (Ø 0,76, L 1,62 Basis), Doppelkamm, 3 Tonpunkte; Maßstab 4,0 / 4,67.',
});
