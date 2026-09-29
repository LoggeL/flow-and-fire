/**
 * Horn (f4:lnd_t1_arty) – Aurith-Artilleriegleiter T1.
 *
 * Roster: „Kiel mit großem offenem Trichter (Öffnung Ø 0,6 WU, 50° geneigt) auf Schwenkfuß, Kamm als Gegengewicht
 * weit nach hinten; keine Gabel.“
 * faction.md §5.2 Artillerie: offener Trichter 45–55° geneigt, Öffnung ≥ 0,5 WU, Kamm als Gegengewicht; verboten
 * Gabel, Pfeifen. Winkel-Code: schräg = indirekt. Trichter außen Teamfarbe (Roster `horn:team`), Innenseite nie
 * teamfarben: eine Innenschale aus Pechglas zeigt die offene Mündung. Paartest Horn↔Posaune: weit offener
 * Kegelstumpf gegen geschlossene dicke Spindel.
 *
 * Aufbau (y = Boden, +Z = Bug; Gleiter, GLIDE_HEIGHT):
 *   hull – Kiel 1,25 × 0,84 WU, langer Gegengewicht-Kamm (Team), Glyphenbänder, 1 Tonpunkt
 *   ring – Schwenkfuß (Pechglas-Reif mit Lager), dreht um +Y   (PartStream 1)
 *   horn – Trichter (Hals Ø 0,24 → Öffnung Ø 0,6 WU, 50°) mit Innenschale (Pechglas), kippt (PartStream 2)
 */
import { defineModel, domeShell, frustum, GLIDE_HEIGHT, lens, torus, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';
import { crest, keel, shellGlyphs, toneDots } from './lnd_t1_tank.ts';

/**
 * Offener Trichter (faction.md §3.3 `horn`, Öffnung : Hals ≈ 2,5 : 1): Hals bei `neck`, Achse um `elev` Grad über die
 * Waagerechte nach vorn geneigt. Außen `mat` (Team), innen eine Pechglas-Schale, die zur Mündung offen ist (dunkle Mündung = offener Trichter im Bild).
 */
export function hornShapes(o: { neck: Vec3; elev: number; len: number; r0: number; r1: number; mat?: string; segments?: number }): Shape[] {
  const e = (o.elev * Math.PI) / 180;
  const dir: Vec3 = [0, Math.sin(e), Math.cos(e)];
  const at = (d: number): Vec3 => [o.neck[0] + dir[0] * d, o.neck[1] + dir[1] * d, o.neck[2] + dir[2] * d];
  const tilt = 90 - o.elev;
  const segs = o.segments ?? 8;
  // Innenschale: flache Kugelkappe (40°, flach = liest sich als dunkle Öffnung statt als Kugel), Öffnung zur Mündung
  const cap = 40;
  const R = o.r1 / Math.sin((cap * Math.PI) / 180);
  const depth = R * (1 - Math.cos((cap * Math.PI) / 180));
  return [
    frustum({ radius: o.r0, radiusTop: o.r1, height: o.len, segments: segs, caps: 'bottom', at: at(o.len / 2), rot: [tilt, 0, 0], mat: o.mat ?? 'team', keep: true, tag: 'horn' }),
    domeShell({ radius: R, thickness: 0.035, arc: cap, segments: segs, rings: 2, at: at(o.len - depth / 2 + 0.005), rot: [tilt + 180, 0, 0], mat: 'pitch', keep: true, tag: 'horn' }),
  ];
}

/** Schwenkfuß: flacher Pechglas-Reif mit Lagerlinse. */
export function swivel(o: { at: Vec3; radius: number; tube?: number }): Shape[] {
  return [
    torus({ radius: o.radius, tube: o.tube ?? 0.05, segments: 6, sides: 3, at: o.at, mat: 'pitch', keep: true, tag: 'ring' }),
    lens({ radius: o.radius * 0.8, thickness: 0.1, segments: 8, rings: 2, at: [o.at[0], o.at[1] + 0.02, o.at[2]], mat: 'amberdeep', smooth: true, tag: 'ring' }),
  ];
}

const K = keel({ len: 1.25, width: 0.84, height: 0.3, drop: 0.4, cap: { rx: 0.62, rz: 0.62, dz: -0.14 } });
const TOP = K.shape.capTop;
const PIVOT: Vec3 = [0, TOP + 0.06, 0.08];

/** Gegengewicht-Kamm: flach ansteigend, weit über das Heck hinaus (z = −1,0). */
const CREST: Vec2[] = [
  [-0.14, 0.38],
  [-0.34, 0.54],
  [-0.58, 0.7],
  [-0.82, 0.76],
  [-1.0, 0.66],
  [-1.02, 0.52],
  [-0.84, 0.5],
  [-0.62, 0.36],
  [-0.46, 0.24],
  [-0.24, 0.3],
];

export default defineModel({
  id: 'f4:lnd_t1_arty',
  hover: GLIDE_HEIGHT,
  parts: [
    {
      name: 'hull',
      shapes: [...K.shapes, ...crest(CREST), ...shellGlyphs(K.shape, { th1: 40 }), ...toneDots(1, { from: [-0.78, 0.62] })],
    },
    { name: 'ring', pivot: PIVOT, anim: 'yaw', smooth: true, shapes: swivel({ at: [PIVOT[0], PIVOT[1] - 0.03, PIVOT[2]], radius: 0.22 }) },
    {
      name: 'horn',
      parent: 'ring',
      pivot: PIVOT,
      anim: 'pitch',
      shapes: hornShapes({ neck: [PIVOT[0], PIVOT[1] - 0.02, PIVOT[2] - 0.06], elev: 50, len: 0.62, r0: 0.12, r1: 0.3 }),
    },
  ],
  notes: 'v_arty: Schwenkfuß-Yaw + Trichter-Pitch (2 animierte Parts wie im Roster).',
});
