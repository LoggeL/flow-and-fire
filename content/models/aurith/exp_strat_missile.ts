/**
 * Tuba (f4:exp_strat_missile) – Experimenteller Strategiewerfer der Aurith (T4, Game-Ender, Post-MVP).
 *
 * experimentals.md §4.4 / roster.json `experimentals[3].kitbash`: „Dreipass-Sockel 6 × 6 WU, darauf ein Drehkranz
 * und ein riesiger offener Trichter (Öffnung Ø 3,6 WU, Länge 5 WU), 55° geneigt, also schräg = indirekt (nie ≥ 75°,
 * das wäre Flugabwehr). Solange eine Rakete geladen ist, ragt eine dicke Spindel (Ø 1,2 WU) aus der Trichteröffnung
 * (Zustand „geladen“ ohne HUD lesbar, nur View). Zwei Kämme als Gegengewicht nach hinten. Keine Kristalle.“
 *
 * Das GLB zeigt den Zustand „geladen“ (Spindel sichtbar, eigener Part `missile`, den der Renderer bei leerem Lager
 * ausblendet). Pflichtpaare: Tuba ↔ Großhorn (beide Trichter: Drehkranz, 55° und Spindel gegen Dreibein-Lafette,
 * flach und überlang), Tuba ↔ Hochorgel (schräge dicke Spindel gegen senkrechte Spindeln).
 *
 * Struktur: Dreipass füllt den Footprint (Teamfarbe am Sockelrand + Trichter-Außenhaut). T4 stehen nicht in
 * `roster.units`: Name, Klasse, Tech, Footprint und Icon stehen im Modell, Maßstab 1.
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe, +X = linke Seite):
 *   hull    – Dreipass-Sockel: drei Linsen (Rand Team, Deckel Bernstein), Glyphenbänder
 *   ring    – Drehkranz mit Lagerwangen und zwei Gegengewicht-Kämmen (links Team, rechts Pechglas) (yaw)
 *   horn    – Riesentrichter 55°, Länge 5 WU, Mündung Ø 3,6 WU, Zapfen (pitch)
 *   missile – Raketenspitze (Spindel Ø 1,2 WU) in der Mündung, Zustand „geladen“ (none, nur Sichtbarkeit)
 */
import {
  bipyramid,
  cylinder,
  defineModel,
  extrude,
  glyphStrip,
  lens,
  lodSegments,
  polygonProfile,
  radial,
  sweep,
  torus,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

const LOBE_D = 1.0; // Abstand der Linsen vom Mittelpunkt
const LOBE_R = 2.0;
const TOP = 0.72; // Oberkante Sockel
const PIV: Vec3 = [0, 1.95, -1.15];
const ELEV = 55;
const DIR: Vec3 = [0, Math.sin((ELEV * Math.PI) / 180), Math.cos((ELEV * Math.PI) / 180)];
const along = (t: number): Vec3 => [PIV[0] + DIR[0] * t, PIV[1] + DIR[1] * t, PIV[2] + DIR[2] * t];

/**
 * Offener Trichter (wie Hymne/Ensemble): Außenhaut Team mit Glocke, Innenhaut Pechglas (umgekehrte Windung),
 * Bernstein-Rand. LOD2: gerader Kegelstumpf mit sechs Seiten, innen dunkel, ohne Rand.
 */
function horn(t0: number, len: number, rNeck: number, rMouth: number, sides: number, tag: string): Shape[] {
  const at = (f: number): Vec3 => along(t0 + len * f);
  const path = [0, 0.4, 0.7, 0.88, 1].map(at);
  const rr = [rNeck, rNeck * 1.08, rNeck + (rMouth - rNeck) * 0.3, rNeck + (rMouth - rNeck) * 0.6, rMouth];
  const inner = rr.map((r, i) => (i === rr.length - 1 ? r * 0.94 : r * 0.82));
  const ring = (k: number) => polygonProfile(k).reverse();
  const far = [at(0), at(0.7), at(1)];
  return [
    sweep({ path, radius: rr, sides, caps: 'start', mat: 'team', keep: true, maxLod: 1, tag }),
    sweep({ path, radius: inner, profile: ring(sides), caps: false, mat: 'pitch', keep: true, maxLod: 0, tag }),
    sweep({ path, radius: inner, profile: ring(lodSegments(sides, 1)), caps: false, mat: 'pitch', keep: true, minLod: 1, maxLod: 1, tag }),
    torus({ radius: rMouth * 0.97, tube: rMouth * 0.06, segments: sides, sides: 3, axis: 'z', rot: [-ELEV, 0, 0], at: at(1), mat: 'amberedge', keep: true, maxLod: 1, tag }),
    sweep({ path: far, radius: [rNeck, rNeck + (rMouth - rNeck) * 0.3, rMouth], sides: 6, caps: 'start', mat: 'team', keep: true, minLod: 2, tag }),
    sweep({ path: far, radius: [rNeck * 0.82, (rNeck + (rMouth - rNeck) * 0.3) * 0.82, rMouth * 0.94], profile: ring(6), caps: false, mat: 'pitch', keep: true, minLod: 2, tag }),
  ];
}

/** Lagerwange (Seitenprofil z/y) vom Drehkranz zum Zapfen. */
const CHEEK: Vec2[] = [
  [PIV[2] - 0.9, TOP + 0.3],
  [PIV[2] + 1.1, TOP + 0.3],
  [PIV[2] + 0.45, PIV[1] + 0.35],
  [PIV[2] - 0.35, PIV[1] + 0.45],
];

/** Gegengewicht-Kamm (Seitenprofil z/y): steigt hinter dem Zapfen auf und läuft weit nach hinten unten aus. */
const FIN: Vec2[] = [
  [PIV[2] - 0.1, PIV[1] + 0.2],
  [PIV[2] - 0.7, PIV[1] + 0.95],
  [-2.3, PIV[1] + 0.85],
  [-2.85, PIV[1] + 0.1],
  [-2.95, TOP + 0.45],
  [-2.45, TOP + 0.6],
  [-2.0, PIV[1] - 0.25],
  [PIV[2] - 0.5, PIV[1] - 0.2],
];
const FIN_LOW: Vec2[] = [FIN[0]!, FIN[1]!, FIN[3]!, FIN[4]!, FIN[6]!];

/** Dreipass-Linse (Rand Team, Deckel Bernstein) in Richtung `deg` (von +X nach +Z). */
function lobe(deg: number): Shape[] {
  const a = (deg * Math.PI) / 180;
  const c: [number, number] = [LOBE_D * Math.cos(a), LOBE_D * Math.sin(a)];
  return [
    lens({ radius: LOBE_R, thickness: 0.56, segments: 16, rings: 4, at: [c[0], 0.28, c[1]], mat: 'team', keep: true, tag: 'lens' }),
    lens({ radius: LOBE_R * 0.84, thickness: 0.6, segments: 16, rings: 4, at: [c[0], 0.42, c[1]], mat: 'amber', keep: true, tag: 'lens' }),
  ];
}

/** Glyphenband radial über den Linsendeckel. */
const glyph = glyphStrip({
  path: [
    [0, TOP + 0.005, 1.25],
    [0, TOP - 0.06, 2.1],
    [0, TOP - 0.2, 2.6],
  ],
  normal: [0, 1, 0.25],
  width: 0.16,
  pattern: [0.45, -0.12, 0.2, -0.12, 0.5],
  mat: 'glyph',
  maxLod: 0,
  tag: 'glyphs',
});

export default defineModel({
  id: 'f4:exp_strat_missile',
  name: 'Tuba',
  role: 'Experimenteller Strategiewerfer',
  class: 'struct',
  tech: 4,
  footprint: [6, 6],
  icon: 'struct_mml_t4',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [...lobe(90), ...lobe(210), ...lobe(330), radial(glyph, { count: 3, startDeg: 0 })],
    },
    {
      name: 'ring',
      pivot: [0, TOP, 0],
      anim: 'yaw',
      shapes: [
        // Drehkranz
        cylinder({ radius: 1.55, height: 0.32, segments: 14, caps: 'top', at: [0, TOP + 0.14, -0.2], mat: 'pitch', keep: true, tag: 'ring' }),
        torus({ radius: 1.55, tube: 0.14, segments: 14, sides: 4, at: [0, TOP + 0.3, -0.2], mat: 'amberedge', maxLod: 1, tag: 'ring' }),
        // Lagerwangen links/rechts
        extrude({ profile: CHEEK, depth: 0.34, at: [1.12, 0, 0], mat: 'pitch', keep: true, tag: 'ring' }),
        extrude({ profile: CHEEK, depth: 0.34, at: [-1.12, 0, 0], mat: 'pitch', keep: true, tag: 'ring' }),
        // zwei Gegengewicht-Kämme nach hinten, links Teamfarbe, rechts Pechglas
        extrude({ profile: FIN, depth: 0.36, at: [0.55, 0, 0], mat: 'team', keep: true, maxLod: 1, tag: 'fin' }),
        extrude({ profile: FIN, depth: 0.36, at: [-0.55, 0, 0], mat: 'pitch', keep: true, maxLod: 1, tag: 'fin' }),
        extrude({ profile: FIN_LOW, depth: 0.36, at: [0.55, 0, 0], mat: 'team', minLod: 2, tag: 'fin' }),
        extrude({ profile: FIN_LOW, depth: 0.36, at: [-0.55, 0, 0], mat: 'pitch', minLod: 2, tag: 'fin' }),
      ],
    },
    {
      name: 'horn',
      parent: 'ring',
      pivot: PIV,
      anim: 'pitch',
      shapes: [
        // Zapfen quer durch die Wangen
        cylinder({ radius: 0.36, height: 2.6, segments: 8, axis: 'x', at: PIV, mat: 'amberedge', keep: true, tag: 'horn' }),
        // Riesentrichter: 55°, Länge 5 WU, Hals Ø 1,44, Mündung Ø 3,6
        ...horn(-0.55, 5.0, 0.72, 1.8, 14, 'horn'),
      ],
    },
    {
      name: 'missile',
      parent: 'horn',
      pivot: along(4.45),
      anim: 'none',
      shapes: [
        // Raketenspitze (Spindel Ø 1,2 WU) ragt 1,4 WU aus der Mündung: Zustand „geladen“; Bernstein-Kante statt
        // Pechglas, damit sie sich vom dunklen Trichterinneren abhebt
        bipyramid({ radius: 0.6, length: 3.0, front: 0.62, sides: 6, axis: 'z', rot: [-ELEV, 0, 0], at: along(4.85), mat: 'amberedge', keep: true, tag: 'spindle' }),
        torus({ radius: 0.56, tube: 0.1, segments: 6, sides: 3, axis: 'z', rot: [-ELEV, 0, 0], at: along(4.55), mat: 'pitch', maxLod: 1, tag: 'spindle' }),
      ],
    },
  ],
  notes:
    'v_exp_strat_missile: T4 nicht in roster.units → Name/Klasse/Tech/Footprint/Icon im Modell. Drehkranz yaw, Trichter pitch; Part `missile` (anim none) = Zustand „geladen“, der Renderer blendet ihn bei leerem Lager aus.',
});
