/**
 * Pelikan (f3:exp_air_carrier) – Schwebeträger, Großschale (T4, Post-MVP).
 *
 * Roster/experimentals.md §5: zwei teamfarbene Ovalschwingen-Hälften mit Goldkante (Spannweite 20 WU, Tiefe 9 WU,
 * keine Pfeilung), mittig eine hochgewölbte Rückenkuppel aus Perlmutt, um sie ein waagerechter Schildring (Ø 7 WU,
 * dreht langsam); darunter hängt der teamfarbene Kehlsack (9 WU lang, ragt vorn 1 WU über die Schwinge), an seinem
 * Heck das goldene Hangartor mit Goldkern (FACTORY, Flow-Ausnahme). Die Kehlsack-Unterseite trägt die
 * Jade-Lichtnaht des Senkstoßes. Keine Lanze, keine Perle. **Monopol:** Kehlsack-Schwinge. **Pflichtpaar:**
 * Pelikan ↔ Tölpel (gleiche Familie Ovalschwinge + Bauch-Gondel; Pelikan mit Kuppel, Ring, Hangartor und
 * fünffacher Spannweite im Spielmaß).
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`, Maße in WU), Unterkante Kehlsack auf y = 0 (Flughöhe setzt das
 * Spiel). Die Registry liest seit dem Review 2026-09-29 auch `experimentals[]`
 * aus dem Roster (Abgleich von Icon und Footprint per Warnung); Name, Rolle, Klasse, Tech, Footprint und Icon stehen
 * trotzdem explizit im Modell.
 *
 * Aufbau (y = Boden, +Z = Bug, +X = linke Seite):
 *   hull – Ovalschwingen-Hälften (Emaille oben, Rinde unten, Goldkante vorn), Rückenkuppel (Perlmutt, Perlglanz-
 *          Scheitel), Kehlsack (Emaille, Rinde unten) mit Jade-Lichtnaht, Hangartor (Gold) mit Goldkern,
 *          Klammerbögen (Tiefjade)
 *   ring – Schildring um die Kuppel, dreht langsam um +Y                  (PartStream 1, yaw)
 */
import { defineModel, ellipsoid, glyphStrip, lens, sweep, torus, torusArc, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

type Sec = readonly [number, number];

const TOP: Vec2[] = [
  [1, 0],
  [0.6, 0.8],
  [0, 1],
  [-0.6, 0.8],
  [-1, 0],
];
const BOT: Vec2[] = [
  [-1, 0],
  [-0.5, -0.8],
  [0.5, -0.8],
  [1, 0],
];
const TOP_LOW: Vec2[] = [
  [1, 0],
  [0.4, 0.9],
  [-0.4, 0.9],
  [-1, 0],
];
const BOT_LOW: Vec2[] = [
  [-1, 0],
  [0, -0.8],
  [1, 0],
];

// Ovalschwinge: elliptischer Grundriss über die ganze Spannweite, geteilt durch die Kuppel
const WING_Y = 1.72;
const HALF_SPAN = 10;
const CHORD = 9;
const THICK = 0.62;
const ROOT_X = 1.6; // Wurzel steckt unter der Kuppel
const WING_Z = 0.2;

function wingAt(x: number): { p: Vec3; s: Sec } {
  const q = x / HALF_SPAN;
  const f = Math.sqrt(Math.max(0, 1 - q * q));
  // leichte V-Stellung: Spitzen 0,9 WU höher als die Wurzel (Gleitflug)
  return { p: [x, WING_Y + 0.9 * q * q, WING_Z], s: [(CHORD / 2) * Math.max(f, 0.02), (THICK / 2) * Math.max(f, 0.05)] };
}
function wingPath(n: number, x0 = ROOT_X, x1 = HALF_SPAN - 0.02): { path: Vec3[]; sec: Sec[] } {
  const path: Vec3[] = [];
  const sec: Sec[] = [];
  for (let i = 0; i <= n; i++) {
    // dichter zur Spitze hin (dort ändert sich die Sehne schnell)
    const t = x1 >= HALF_SPAN - 0.1 ? Math.sin((Math.PI / 2) * (i / n)) : i / n;
    const w = wingAt(x0 + (x1 - x0) * t);
    path.push(w.p);
    sec.push(w.s);
  }
  return { path, sec };
}

/** Schwingenspitzen ab hier Perlmutt (die äußerste Schicht, wie Federspitzen); innen Emaille. */
const TIP_X = 7.3;

type Lod = { readonly maxLod?: 0 | 1 | 2; readonly minLod?: 0 | 1 | 2 };

/** Eine Schwingen-Hälfte (linke Seite +X; `side` −1 spiegelt). */
function wingHalf(side: 1 | -1, n: number, top: Vec2[], bot: Vec2[], lod: Lod): Shape[] {
  const mirror = (v: Vec3): Vec3 => [side * v[0], v[1], v[2]];
  const g = `wing${side}`;
  const nIn = Math.max(2, Math.round(n * 0.6));
  const inner = wingPath(nIn, ROOT_X, TIP_X);
  const outer = wingPath(Math.max(2, n - nIn), TIP_X, HALF_SPAN - 0.02);
  return [
    sweep({ ...lod, path: inner.path.map(mirror), radius: inner.sec, profile: top, open: true, smoothGroup: g, mat: 'enamel', keep: true, tag: 'wing' }),
    sweep({ ...lod, path: outer.path.map(mirror), radius: outer.sec, profile: top, open: true, smoothGroup: g, mat: 'nacre', keep: true, tag: 'wing' }),
    sweep({ ...lod, path: inner.path.map(mirror), radius: inner.sec, profile: bot, open: true, smoothGroup: g, mat: 'rind', keep: true, tag: 'wing' }),
    sweep({ ...lod, path: outer.path.map(mirror), radius: outer.sec, profile: bot, open: true, smoothGroup: g, mat: 'rind', keep: true, tag: 'wing' }),
  ];
}

/** Goldkante: Band auf der Oberseite entlang der Vorderkante. */
function goldEdge(side: 1 | -1): Shape {
  const xs = [2.4, 3.6, 4.8, 6.0, 7.2];
  const pts = xs.map((x) => {
    const w = wingAt(x);
    return { p: [side * x, w.p[1] + w.s[1] * 0.3, w.p[2] + w.s[0] * 0.92] as Vec3, n: [0, 0.7, 0.7] as Vec3 };
  });
  return glyphStrip({ path: pts.map((q) => q.p), normal: pts.map((q) => q.n), width: 0.26, pattern: [20], widths: [1], lift: 0.04, mat: 'gold', maxLod: 1, tag: 'wing' });
}

// Rückenkuppel
const DOME: Vec3 = [2.7, 2.25, 3.3];
const DOME_Y0 = WING_Y - 0.1;
const RING_Y = WING_Y + 0.75;

/** Punkt/Normale auf der Kuppel über (x, y), hinten. */
function onDome(x: number, y: number): { p: Vec3; n: Vec3 } {
  const u = x / DOME[0];
  const v = (y - DOME_Y0) / DOME[1];
  const w = Math.sqrt(Math.max(0, 1 - u * u - v * v));
  const p: Vec3 = [x, y, -DOME[2] * w];
  const n: Vec3 = [x / DOME[0] ** 2, (y - DOME_Y0) / DOME[1] ** 2, -w / DOME[2]];
  const l = Math.hypot(n[0], n[1], n[2]);
  return { p, n: [n[0] / l, n[1] / l, n[2] / l] };
}

/** Tech-Marker T4: „[“ links, „]“ rechts am hinteren Kuppelrand (Tiefjade-Decal). */
function bracket(side: 1 | -1): Shape[] {
  const x0 = side * 0.55;
  const x1 = side * 1.0;
  const y0 = DOME_Y0 + 0.28;
  const y1 = DOME_Y0 + 0.8;
  const lines: [number, number, number, number][] = [
    [x0, y1, x1, y1],
    [x1, y1, x1, y0],
    [x1, y0, x0, y0],
  ];
  return lines.map(([ax, ay, bx, by]) => {
    const a = onDome(ax, ay);
    const b = onDome(bx, by);
    const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
    return glyphStrip({ path: [a.p, b.p], normal: [a.n, b.n], width: 0.2, pattern: [len + 0.1], widths: [1], lift: 0.05, mat: 'jade', maxLod: 1, tag: 'techmarker' });
  });
}

// Kehlsack: 9 WU lang, Nase 1 WU vor der Schwingen-Vorderkante (WING_Z + CHORD / 2)
const SACK_NOSE = WING_Z + CHORD / 2 + 1;
const SACK_TAIL = SACK_NOSE - 9;
const SACK_N = 10;
/** Querschnitt des Kehlsacks entlang t ∈ [0, 1] (Heck → Nase): vorn tief und bauchig, zum Heck schmal. */
function sackSec(t: number): Sec {
  const s = Math.sin(Math.PI * Math.min(1, Math.max(0, 0.06 + 0.94 * t)) ** 0.8) ** 0.55;
  return [Math.max(0.05, 1.7 * s), Math.max(0.05, 1.0 * s * (0.75 + 0.35 * t))];
}
function sackPath(n: number): { path: Vec3[]; sec: Sec[] } {
  const path: Vec3[] = [];
  const sec: Sec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = sackSec(t);
    // Oberkante bündig unter der Schwinge, der Sack hängt nach unten durch
    path.push([0, WING_Y - 0.1 - s[1] * 0.95, SACK_TAIL + 9 * t]);
    sec.push(s);
  }
  return { path, sec };
}
function sack(n: number, top: Vec2[], bot: Vec2[], lod: Lod): Shape[] {
  const { path, sec } = sackPath(n);
  return [
    sweep({ ...lod, path, radius: sec, profile: top, open: true, smoothGroup: 'sack', mat: 'enamel', keep: true, tag: 'shell' }),
    sweep({ ...lod, path, radius: sec, profile: bot, open: true, smoothGroup: 'sack', mat: 'enamel', keep: true, tag: 'shell' }),
  ];
}
/** Lichtnaht (Senkstoß-Telegraph) längs unter dem Kehlsack. */
const SEAM_PTS = [0.35, 0.5, 0.65, 0.8].map((t) => {
  const { path, sec } = sackPath(40);
  const i = Math.round(t * 40);
  return { p: [0, path[i]![1] - sec[i]![1] * 0.8, path[i]![2]] as Vec3, n: [0, -1, 0] as Vec3 };
});
const TAIL_Y = WING_Y - 0.1 - sackSec(0.1)[1] * 0.95;

export default defineModel({
  id: 'f3:exp_air_carrier',
  name: 'Pelikan',
  role: 'Schwebeträger',
  class: 'air',
  tech: 4,
  footprint: [16, 16],
  icon: 'air_direct_t4',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Ovalschwingen-Hälften (Teamfarbe oben, Rinde unten)
        ...wingHalf(1, 12, TOP, BOT, { maxLod: 0 }),
        ...wingHalf(-1, 12, TOP, BOT, { maxLod: 0 }),
        ...wingHalf(1, 7, TOP_LOW, BOT_LOW, { minLod: 1, maxLod: 1 }),
        ...wingHalf(-1, 7, TOP_LOW, BOT_LOW, { minLod: 1, maxLod: 1 }),
        ...wingHalf(1, 5, TOP_LOW, BOT_LOW, { minLod: 2 }),
        ...wingHalf(-1, 5, TOP_LOW, BOT_LOW, { minLod: 2 }),
        goldEdge(1),
        goldEdge(-1),
        // Rückenkuppel (Perlmutt) mit Perlglanz-Scheitel
        ellipsoid({ radii: DOME, half: true, segments: 16, rings: 4, at: [0, DOME_Y0 + DOME[1] / 2, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        ellipsoid({ radii: [1.1, 0.34, 1.3], half: true, segments: 10, rings: 2, at: [0, DOME_Y0 + DOME[1] - 0.12 + 0.17, 0], mat: 'lustre', maxLod: 1, tag: 'shell' }),
        // Kehlsack (Teamfarbe), hängt unter der Schwinge, ragt 1 WU vor
        ...sack(SACK_N, TOP, BOT, { maxLod: 0 }),
        ...sack(6, TOP_LOW, BOT_LOW, { minLod: 1 }),
        glyphStrip({ path: SEAM_PTS.map((q) => q.p), normal: SEAM_PTS.map((q) => q.n), width: 0.2, pattern: [0.9, -0.35], widths: [1], lift: 0.05, mat: 'seam', maxLod: 0, tag: 'seam' }),
        // Hangartor am Kehlsack-Heck: Goldbogen mit Goldkern
        torusArc({ radius: 0.72, tube: 0.16, arc: 200, startDeg: 170, segments: 8, sides: 4, axis: 'z', at: [0, TAIL_Y - 0.25, SACK_TAIL + 0.55], mat: 'gold', keep: true, tag: 'arch' }),
        lens({ radius: 0.46, thickness: 0.18, axis: 'z', segments: 8, at: [0, TAIL_Y - 0.12, SACK_TAIL + 0.5], mat: 'light', keep: true, tag: 'core' }),
        // Tech-Marker T4
        ...bracket(1),
        ...bracket(-1),
      ],
    },
    {
      name: 'ring',
      pivot: [0, RING_Y, 0],
      anim: 'yaw',
      smooth: true,
      shapes: [
        // Schildring Ø 7 WU (Blasen-Schild ab K10), dreht langsam
        torus({ radius: 3.5, tube: 0.2, segments: 20, sides: 4, at: [0, RING_Y, 0], mat: 'lustre', keep: true, tag: 'ring' }),
      ],
    },
  ],
  notes: 'v_exp_pelican: Schildring-Yaw (1 animierter Part). Keine Lanze, keine Perle; der Senkstoß kommt aus dem Kehlsack.',
});
