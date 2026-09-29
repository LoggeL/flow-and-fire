/**
 * Brandung (f3:str_t2_arty) – Artilleriestellung T2, 2×2.
 *
 * Roster: „Großes Horn auf Lafette über Kissen-Sockel, Gegenschale.“ faction.md §5.2 Artillerie: Horn (Kegelstumpf
 * mit weiter Mündung, 50°) als Monopol, Pflicht Gegenschale am Heck; verboten: Perle, waagerechte Lanze, Laterne,
 * dünne Stacheln. Horn 1,5 WU lang, Mündung Ø 0,74 WU (≥ 2 × Stachel-Ø), Mündung nie teamfarben.
 * Teamfarbe (§4.2): Emaille-Band des Kissens + Lafettenkuppel (Dachschale). Gold als Mündungskante und Wiegenbügel,
 * Jade-Lichtnaht an der Hornwurzel. Kein Goldkern.
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull – Kissen 2×2, 2 Streifen
 *   boom – Lafette: Kuppel (Team), goldener Wiegenbügel, Gegenschale (Perlmutt) am Heck; Yaw (PartStream 1)
 *   horn – Horn (Perlmutt) 50° mit Goldkante, dunklem Schlund und Lichtnaht; Pitch um die Bügelenden (PartStream 2)
 *
 * Exportiert `lafette()` und `horn()` für die Sintflut (gleiche Formen in Spielmaßen, andere Größe).
 */
import { cylinder, defineModel, ellipsoid, frustum, stripes, torusArc, type Shape, type Vec3 } from '@faf/modelkit';
import { kissen } from './str_t1_pd.ts';

export const HORN_ELEV = 50;

export interface HornSpec {
  /** Drehpunkt (Pitch-Achse) [0, y, z]. */
  readonly pivot: Vec3;
  /** Radius am Schlund (hinten) und an der Mündung. */
  readonly throat: number;
  readonly mouth: number;
  /** Gesamtlänge und Anteil hinter dem Drehpunkt. */
  readonly length: number;
  readonly back: number;
}

/** Richtung der Hornachse bei 50° Elevation. */
const DIR: Vec3 = [0, Math.sin((HORN_ELEV * Math.PI) / 180), Math.cos((HORN_ELEV * Math.PI) / 180)];
const along = (p: Vec3, t: number): Vec3 => [p[0], p[1] + DIR[1] * t, p[2] + DIR[2] * t];

/** Horn: Kegelstumpf (8 Seiten) mit ausgestellter Goldmündung, dunkler Schlund, Jade-Lichtnaht an der Wurzel. */
export function horn(h: HornSpec): Shape[] {
  const rot: Vec3 = [90 - HORN_ELEV, 0, 0]; // y-Achse → 50° nach vorn oben
  const t0 = -h.back;
  const t1 = h.length - h.back;
  const flare = h.length * 0.12;
  const neck = h.mouth * 0.74;
  const tf = t1 - flare;
  return [
    frustum({ radius: h.throat, radiusTop: neck, height: h.length - flare, segments: 8, caps: 'bottom', rot, at: along(h.pivot, (t0 + tf) / 2), mat: 'nacre', keep: true, tag: 'horn' }),
    // ausgestellte Mündung mit Goldkante (Trichter), dunkler Schlund im Trichterhals
    frustum({ radius: neck, radiusTop: h.mouth, height: flare, segments: 8, caps: false, rot, at: along(h.pivot, tf + flare / 2), mat: 'gold', keep: true, tag: 'horn' }),
    cylinder({ radius: neck * 1.02, height: 0.01, segments: 8, caps: 'top', rot, at: along(h.pivot, tf + 0.006), mat: 'rind', maxLod: 1, tag: 'horn' }),
    // Jade-Lichtnaht an der Hornwurzel
    cylinder({ radius: h.throat * 1.08, height: h.throat * 0.3, segments: 8, caps: false, rot, at: along(h.pivot, t0 + h.length * 0.3), mat: 'seam', maxLod: 0, tag: 'seam' }),
  ];
}

export interface LafetteSpec {
  /** Mittelpunkt der Lafette auf dem Deck [0, y, z]. */
  readonly base: Vec3;
  readonly domeR: number;
  readonly domeH: number;
  /** Höhe der Pitch-Achse und halbe Bügelbreite. */
  readonly pivotY: number;
  readonly yoke: number;
  readonly yokeTube: number;
  /** Gegenschale: Halbachsen [x, y, Tiefe] und Abstand hinter der Achse. */
  readonly counter: Vec3;
  readonly counterZ: number;
}

/** Lafette: Kuppel (Team), goldener Wiegenbügel (Halbring unter der Achse), Gegenschale (Perlmutt) am Heck. */
export function lafette(l: LafetteSpec): Shape[] {
  const [x, y, z] = l.base;
  return [
    ellipsoid({ radii: [l.domeR, l.domeH, l.domeR], half: true, segments: 10, rings: 2, at: [x, y + l.domeH / 2, z], mat: 'enamel', keep: true, tag: 'shell' }),
    // Wiegenbügel: Halbring quer zur Schussrichtung, Enden auf Achshöhe
    torusArc({ radius: l.yoke, tube: l.yokeTube, arc: 180, startDeg: 0, segments: 6, sides: 4, axis: 'z', at: [x, l.pivotY, z], mat: 'gold', keep: true, tag: 'mast' }),
    // Gegenschale am Heck: Halbschale, Wölbung nach hinten, steht auf der Kuppel
    ellipsoid({
      radii: l.counter,
      half: true,
      drop: 0.2,
      segments: 8,
      rings: 2,
      axis: 'z',
      rot: [0, 180, 0],
      at: [x, l.pivotY - l.counter[1] * 0.15, z - l.counterZ],
      mat: 'nacre',
      keep: true,
      tag: 'shell',
    }),
  ];
}

const H = 0.22;
const TOP = H + 0.04;
const LZ = -0.22;
const PIV_Y = TOP + 0.5;

export default defineModel({
  id: 'f3:str_t2_arty',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        ...kissen({ size: [1.94, 1.94], height: H, bevel: 0.1, corner: 0.42, rim: 0.1, deck: 0.04, round: 1 }),
        stripes({ count: 2, width: 0.2, stripe: 0.12, gap: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.005, -0.66] }),
      ],
    },
    {
      name: 'boom',
      pivot: [0, TOP, LZ],
      anim: 'yaw',
      smooth: true,
      shapes: lafette({ base: [0, TOP, LZ], domeR: 0.6, domeH: 0.3, pivotY: PIV_Y, yoke: 0.34, yokeTube: 0.07, counter: [0.4, 0.3, 0.2], counterZ: 0.42 }),
    },
    {
      name: 'horn',
      parent: 'boom',
      pivot: [0, PIV_Y, LZ],
      anim: 'pitch',
      smooth: true,
      shapes: horn({ pivot: [0, PIV_Y, LZ], throat: 0.13, mouth: 0.37, length: 1.5, back: 0.3 }),
    },
  ],
  notes: 'v_arty_struct: Lafette-Yaw + Horn-Pitch (2 animierte Parts). Horn 1,5 WU, 50°, Mündung Ø 0,74.',
});
