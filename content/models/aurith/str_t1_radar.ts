/**
 * Widerhall I (f4:str_t1_radar) – Radar T1, 2×2 (Roster-Maßstab 1,0: Maße unten sind Spielmaße).
 *
 * Roster: „Hoher dünner Mast mit 35° gekippter Muschel-Schale, rotierend; kein Reif.“ faction.md §5.2 Winkel-Code:
 * Mast + Muschel-Schale = Intel (Mast + waagerechter Reif = Schild, Paartest Widerhall I ↔ Dämpfer II). Die Schale
 * ist eine hohle Bernstein-Kappe (`domeShell`), deren Öffnung 35° über die Waagerechte nach vorn blickt; sie sitzt mit
 * dem Scheitel an der Mastnabe und dreht sich. Hoch und dünn: Mast Ø 0,18 bis 2,2 WU über dem Dreipass-Sockel.
 * Kein Kristall (kein Flow-Gebäude), Glyphenbänder auf der Kern-Kuppel, 1 Tonpunkt.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = links):
 *   hull – Dreipass-Sockel (3 Linsen: Team-Rand + Bernstein-Kuppe), Bernstein-Kern-Kuppel, Mastfuß, Mast (Pechglas),
 *          Glyphenbänder, 1 Tonpunkt
 *   dish – Lagernabe, Muschel-Schale (Bernstein, 35°), Speisedorn; Yaw (PartStream 1)
 */
import { cylinder, defineModel, domeShell, ellipsoid, frustum, glyphStrip, spike, type Shape, type Vec3 } from '@faf/modelkit';

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

const SY = 1; // Roster-Höhenfaktor (T1 1,0): die Schalenneigung wird vorverzerrt, damit sie im Spiel 35° beträgt
const TILT = (Math.atan(Math.tan((35 * Math.PI) / 180) / SY) * 180) / Math.PI;
const RING_Y = 0.15;
const DOME_R: Vec3 = [0.42, 0.3, 0.42];
const DOME_C: Vec3 = [0, RING_Y + 0.02 + DOME_R[1] / 2, 0];
const MR = 0.09; // Mast-Radius
const MAST_TOP = 2.2;

/**
 * Muschel-Schale (hohle Kappe, Öffnung blickt `elev`° über die Waagerechte in Richtung `dirY`°), mit dem Scheitel an
 * `hub`. `domeShell` ist auf die Bounding-Box zentriert: Scheitel liegt `off` über der Mitte (lokale Pol-Achse +Y).
 */
function shell(hub: Vec3, radius: number, arc: number, elev: number, dirY: number, rings = 2): Shape {
  const th = 0.05;
  const a = (arc * Math.PI) / 180;
  const ymin = Math.min(radius * Math.cos(a), (radius - th) * Math.cos(a));
  const off = radius - (ymin + radius) / 2; // Scheitel über der Box-Mitte
  const e = (elev * Math.PI) / 180;
  const d = (dirY * Math.PI) / 180;
  // Pol zeigt entgegen der Öffnung: −(cos e · (sin d, 0, cos d) + sin e · Y)
  const pole: Vec3 = [-Math.cos(e) * Math.sin(d), -Math.sin(e), -Math.cos(e) * Math.cos(d)];
  return domeShell({
    radius,
    thickness: th,
    arc,
    segments: 9,
    rings,
    rot: [-(90 + elev), dirY, 0],
    at: [hub[0] - pole[0] * off * 0.92, hub[1] - pole[1] * off * 0.92, hub[2] - pole[2] * off * 0.92],
    mat: 'amber',
    keep: true,
    smooth: true,
    tag: 'shell',
  });
}

const HUB: Vec3 = [0, MAST_TOP + 0.08, 0];

export default defineModel({
  id: 'f4:str_t1_radar',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...trefoil(),
        ellipsoid({ radii: DOME_R, half: true, segments: 8, rings: 2, at: DOME_C, mat: 'amber', keep: true, smooth: true, tag: 'keel' }),
        frustum({ radius: 0.2, radiusTop: MR * 1.2, height: 0.3, segments: 6, caps: false, at: [0, DOME_C[1] + DOME_R[1] / 2 + 0.1, 0], mat: 'pitch', maxLod: 1, tag: 'mast' }),
        cylinder({ radius: MR, height: MAST_TOP - DOME_C[1], segments: 6, caps: 'top', at: [0, (MAST_TOP + DOME_C[1]) / 2, 0], mat: 'pitch', keep: true, tag: 'mast' }),
        sideGlyph(DOME_C, DOME_R, 1, 0.4, -0.7, 0.7, 0.07, 2),
        sideGlyph(DOME_C, DOME_R, -1, 0.4, -0.7, 0.7, 0.07, 2),
        ...tonpunkte(1, 0.3),
      ],
    },
    {
      name: 'dish',
      pivot: [0, MAST_TOP, 0],
      anim: 'yaw',
      shapes: [
        cylinder({ radius: 0.15, height: 0.3, segments: 6, caps: 'top', at: [HUB[0], HUB[1] - 0.05, HUB[2]], mat: 'pitch', keep: true, tag: 'mast' }),
        shell(HUB, 0.62, 62, TILT, 0),
        // Speisedorn: gerade, dünn, vom Scheitel in die Öffnung (Richtung der Schale)
        spike({ from: HUB, to: [0, HUB[1] + 0.42 * Math.sin((TILT * Math.PI) / 180), 0.42 * Math.cos((TILT * Math.PI) / 180)], radius: 0.05, sides: 4, mat: 'pitch', maxLod: 1, tag: 'mast' }),
      ],
    },
  ],
  notes: 'v_radar: Muschel-Schale 35° (Öffnung nach vorn oben) am Mastkopf, dreht sich; kein Reif.',
});
