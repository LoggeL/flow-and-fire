/**
 * Klangschale (f4:exp_resource) – Experimenteller Resonanzgenerator der Aurith (T4, Endgame-Eco, Post-MVP).
 *
 * experimentals.md §4.5 / roster.json `experimentals[4].kitbash`: „Dreipass-Sockel 8 × 8 WU, darin eine flache
 * Riesenschale: Linse als Boden und waagerechter Amber-Reif Ø 6,5 WU als Rand (Reif ohne Mast = Flow-Anschluss).
 * Drei stehende Kristalle (Höhe 5 WU) im Dreieck außen um die Schale (Resonator-Grammatik, drei = höchste Stufe), ein
 * kleinerer Kristall als „Klöppel“ kreist langsam auf dem Rand (spin, nur View; beim Einschwingen schneller). Kein
 * Mast, keine Muschel, keine Pfeifen.“
 *
 * Flow-Einheit (ECONOMIC): Kristalle erlaubt (Resonanz-Monopol). Pflichtpaare: Klangschale ↔ Resonator III (drei
 * Kristalle: mit Schale gegen ohne), Klangschale ↔ Stimmstock III (Reif um die Mitte in zwei Größen).
 * Die Kristalle stehen auf den drei Sockel-Lappen, jeweils mit Bernstein-Fassung unten, damit der Resonanzkern als
 * Spitze liest und die Leuchtfläche im Rahmen bleibt.
 *
 * Struktur: T4 stehen nicht in `roster.units`: Name, Klasse, Tech, Footprint und Icon stehen im Modell, Maßstab 1.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull    – Dreipass-Sockel (drei Linsen, Teamfarbe), flache Schale (Bernstein) mit teamfarbenem Glyphenfeld auf
 *             der Innenwand, Schalenboden-Linse (Bernstein-Tiefe), Amber-Reif Ø 6,5 WU, drei stehende Kristalle
 *             (Resonanzkern) in Bernstein-Fassungen auf den Lappen, Glyphenring
 *   striker – Klöppel: kleiner Kristall auf dem Rand, kreist um die Mitte (spin)
 */
import { crystal, defineModel, domeShell, frustum, glyphStrip, lens, polygonProfile, sweep, torus, type Shape, type Vec3 } from '@faf/modelkit';

const LOBE_D = 1.6; // Abstand der Linsen vom Mittelpunkt
const LOBE_R = 2.45;
const TOP = 0.6; // Oberkante Sockel-Linsen
const RIM_R = 3.25; // Reif Ø 6,5 WU
const BOWL_ARC = 42; // flache Schale
const BOWL_R = RIM_R / Math.sin((BOWL_ARC * Math.PI) / 180); // Kugelradius ≈ 4,86
const BOWL_T = 0.18;
const BOWL_IN = BOWL_R - BOWL_T;
const POLE = 0.5; // Scheitel (Außenseite) der Schale
const COS_A = Math.cos((BOWL_ARC * Math.PI) / 180);
const RIM_Y = POLE + BOWL_R * (1 - COS_A);
/** Höhe der Schalen-Innenfläche beim Radius r. */
const bowlIn = (r: number): number => POLE + BOWL_T + BOWL_IN - Math.sqrt(BOWL_IN * BOWL_IN - r * r);
const CRYSTAL_D = 3.6;
const CRYSTAL_H = 5.0;
const CRYSTAL_BASE = 0.95;
const LOBES = [90, 210, 330];

/** Dreipass-Linse (Teamfarbe; der Mittelteil liegt unter der Schale) in Richtung `deg` (von +X nach +Z). */
function lobe(deg: number): Shape {
  const a = (deg * Math.PI) / 180;
  return lens({ radius: LOBE_R, thickness: TOP, segments: 18, rings: 4, at: [LOBE_D * Math.cos(a), TOP / 2, LOBE_D * Math.sin(a)], mat: 'team', keep: true, tag: 'lens' });
}

/** Stehender Resonanzkristall auf dem Lappen `deg`: Bernstein-Fassung + Kristall (5 WU über der Fassung). */
function pillar(deg: number): Shape[] {
  const a = (deg * Math.PI) / 180;
  const p: [number, number] = [CRYSTAL_D * Math.cos(a), CRYSTAL_D * Math.sin(a)];
  const tip = 0.9;
  const body = CRYSTAL_H - tip;
  return [
    frustum({ radius: 0.5, radiusTop: 0.38, height: CRYSTAL_BASE + 0.9, segments: 6, caps: 'top', at: [p[0], (CRYSTAL_BASE + 0.9) / 2 + 0.2, p[1]], mat: 'amberedge', keep: true, smooth: false, tag: 'crystal' }),
    crystal({ radius: 0.28, height: body, tip, taper: 0.72, at: [p[0], CRYSTAL_BASE + CRYSTAL_H / 2, p[1]], mat: 'phase', keep: true, smooth: false, tag: 'crystal' }),
  ];
}

/**
 * Teamfarbenes Glyphenfeld als Band auf der Schalen-Innenwand (Emaille-Einlage, zeigt nach innen oben): Sweep entlang
 * der Achse mit umgekehrter Windung, knapp über der Innenfläche.
 */
function teamBand(r0: number, r1: number, sides: number, lod: 0 | 1 | 2): Shape {
  const rs = [r0, (r0 + r1) / 2, r1];
  return sweep({
    path: rs.map((r): Vec3 => [0, bowlIn(r) + 0.035, 0]),
    radius: rs,
    profile: polygonProfile(sides).reverse(),
    caps: false,
    mat: 'team',
    keep: true,
    minLod: lod,
    maxLod: lod,
    smooth: true,
    tag: 'lens',
  });
}

/** Glyphenring auf dem Schalenboden (Punkte auf einem Kreis). */
function glyphRing(): Shape {
  const pts: Vec3[] = [];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    pts.push([1.2 * Math.cos(a), bowlIn(1.2) + 0.02, 1.2 * Math.sin(a)]);
  }
  return glyphStrip({ path: pts, normal: [0, 1, 0], width: 0.2, pattern: [0.9, -0.3, 0.4, -0.3], mat: 'glyph', maxLod: 0, tag: 'glyphs' });
}

export default defineModel({
  id: 'f4:exp_resource',
  name: 'Klangschale',
  role: 'Experimenteller Resonanzgenerator',
  class: 'struct',
  tech: 4,
  footprint: [8, 8],
  icon: 'struct_mass_t4',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        ...LOBES.map(lobe),
        // Riesenschale (Bernstein): flache Kugelkappe, umgedreht (offen nach oben), Scheitel knapp über dem Boden
        domeShell({ radius: BOWL_R, thickness: BOWL_T, arc: BOWL_ARC, segments: 24, rings: 4, rot: [180, 0, 0], at: [0, POLE + (BOWL_R - BOWL_IN * COS_A) / 2, 0], mat: 'amber', keep: true, tag: 'lens' }),
        // Schalenboden-Linse (Bernstein-Tiefe) im Grund der Schale
        lens({ radius: 1.0, thickness: 0.24, segments: 12, rings: 3, at: [0, bowlIn(0) + 0.04, 0], mat: 'amberdeep', keep: true, tag: 'lens' }),
        // Glyphenfeld (Teamfarbe) als Band auf der Innenwand
        teamBand(2.4, 2.85, 24, 0),
        teamBand(2.4, 2.85, 14, 1),
        teamBand(2.4, 2.85, 9, 2),
        // Schalenrand: waagerechter Amber-Reif Ø 6,5 WU, ohne Mast
        torus({ radius: RIM_R, tube: 0.2, segments: 24, sides: 5, at: [0, RIM_Y, 0], mat: 'amberedge', keep: true, maxLod: 1, tag: 'ring' }),
        torus({ radius: RIM_R, tube: 0.22, segments: 10, sides: 3, at: [0, RIM_Y, 0], mat: 'amberedge', keep: true, minLod: 2, tag: 'ring' }),
        // drei stehende Kristalle (Resonanzkern, drei = höchste Stufe)
        ...LOBES.flatMap(pillar),
        glyphRing(),
      ],
    },
    {
      name: 'striker',
      pivot: [0, RIM_Y, 0],
      anim: 'spin',
      shapes: [
        // Klöppel: kleiner Doppelender-Kristall, liegt schräg auf dem Rand
        crystal({ radius: 0.26, height: 0.55, tip: 0.35, bottomTip: 0.35, at: [0, RIM_Y + 0.55, -RIM_R], rot: [0, 0, 25], mat: 'phase', keep: true, smooth: false, tag: 'crystal' }),
      ],
    },
  ],
  notes:
    'v_exp_resource: T4 nicht in roster.units → Name/Klasse/Tech/Footprint/Icon im Modell. Ein animierter Part (Klöppel, spin um die Schalenmitte).',
});
