/**
 * Brunnen I (f3:str_t1_mex) – Sael-Massebohrung T1; Grundform der Brunnen-Familie (II/III importieren `mexParts`).
 * Enthält außerdem die Sockel-Helfer der Sael-Wirtschaftsgebäude (`cushion`, `squircle`), die Laterne, Quellbogen,
 * Zisterne, Schrein und die Kapitel importieren.
 *
 * Roster: „Ring um den Spot, schwebender Kelch (kleine Schale auf Stiel) mit Goldkern und Tropfen-Takt, niedrig.“
 * faction.md §5.2 Brunnen: `ring` um den Spot + schwebender Kelch mit Goldkern, niedrig, bleibt auf 2×2; T3 mit
 * doppeltem Ring; keine Laterne. §3.2 Gebäude: flaches Kissen (gerundete Ecken, keine Fasen, keine rechten Winkel),
 * Footprint 100 % gefüllt; das Rollen-Element schwebt über dem Sockel. §4.2: Teamfarbe am Kissen-Sockelrand
 * (20–30 % der Draufsicht). In-Place-Upgrade: II/III wachsen nur in der Höhe (Roster-Maßstab y 1,2 / 1,4).
 * Pflichtpaare: Brunnen↔Laterne (flacher Kelch gegen stehende Linse), Brunnen III↔Quellbogen (Doppelring ohne Bögen).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull  – Kissen 2×2 (Emaille-Rand, Perlmutt-Einlage), dunkler Spot, Kranz (Perlglanz) um den Spot, goldener
 *           Stiel, Tech-Streifen (Tiefjade) hinten; II/III: Seitenschalen links/rechts; III: zweiter, goldener Kranz
 *   kelch – schwebender Kelch (Perlmutt-Schale) mit Goldkern-Perle, nickt im Tropfen-Takt (Pitch)   (PartStream 1)
 */
import {
  cylinder,
  defineModel,
  disc,
  ellipsoid,
  loftShape,
  quad,
  sphere,
  stripes,
  torus,
  type PartDef,
  type Shape,
  type Vec2,
} from '@faf/modelkit';

/** Abgerundetes Quadrat (Superellipse, Exponent `p`), Punkte nach Winkel geordnet (x = cos θ, z = sin θ). */
export function squircle(hx: number, hz: number, n = 12, p = 4): Vec2[] {
  const pts: Vec2[] = [];
  for (let j = 0; j < n; j++) {
    const a = ((j + 0.5) / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([Math.sign(c) * Math.abs(c) ** (2 / p) * hx, Math.sign(s) * Math.abs(s) ** (2 / p) * hz]);
  }
  return pts;
}

export interface CushionOpts {
  /** Kantenlänge (Footprint minus Fuge). */
  readonly size: number;
  readonly height: number;
  /** Breite des Emaille-Randes (Draufsicht), steuert den Team-Anteil. */
  readonly inset: number;
  /** Punkte pro Ring (12 kleine, 16 große Gebäude). */
  readonly points?: number;
  /** Ab welchem LOD die vereinfachte Vierkant-Scheibe den gerundeten Sockel ersetzt (Standard 2). */
  readonly simpleFrom?: 1 | 2;
}

/**
 * Kissen-Sockel: gerundetes Quadrat mit weich abfallendem Rand in Emaille (Teamfarbe) und einer leicht erhabenen
 * Perlmutt-Einlage. LOD2: gefaste Vierkant-Scheibe mit Einlage-Decal.
 */
export function cushion(o: CushionOpts): Shape[] {
  const n = o.points ?? 12;
  const h = o.height;
  const hs = o.size / 2;
  const hi = hs - o.inset;
  const simple = o.simpleFrom ?? 2;
  const full = (simple - 1) as 0 | 1;
  return [
    loftShape({
      rings: [
        { y: 0, pts: squircle(hs, hs, n) },
        { y: h * 0.5, pts: squircle(hs, hs, n) },
        { y: h, pts: squircle(hs - h * 0.5, hs - h * 0.5, n) },
      ],
      caps: { bottom: false },
      smooth: 50,
      mat: 'enamel',
      keep: true,
      maxLod: full,
      tag: 'shell',
    }),
    // Perlmutt-Einlage: einseitige Fläche knapp über der Kissen-Oberseite
    flatPoly(squircle(hi, hi, n), h + 0.006, 'nacre', full),
    disc({ radius: hs * Math.SQRT2, height: h, bevel: h / 3, segments: 4, at: [0, h / 2, 0], mat: 'enamel', keep: true, minLod: simple, tag: 'shell' }),
    quad({ size: [2 * hi, 2 * hi], at: [0, h + 0.006, 0], mat: 'nacre', keep: true, minLod: simple }),
  ];
}

/** Einseitige, waagerechte Fläche (nach +Y) mit beliebigem konvexem Umriss: Einlagen, Spots, Landescheiben. */
export function flatPoly(pts: readonly Vec2[], y: number, mat: string, maxLod: 0 | 1 | 2 = 2): Shape {
  return loftShape({ rings: [{ y, pts: pts.slice() }], caps: { bottom: false }, mat, keep: true, maxLod });
}

/** Kreis-Umriss für `flatPoly`. */
export function circlePts(r: number, n = 10, rz = r): Vec2[] {
  return squircle(r, rz, n, 2);
}

/** Oberkante der Kissen-Einlage (Brunnen). */
export const MEX_TOP = 0.2;
const CUSHION_H = 0.16;
const STALK_TOP = 0.6;
const KELCH_Y = 0.8; // Oberkante der Kelchschale

export function mexParts(tech: 1 | 2 | 3): PartDef[] {
  const hull: Shape[] = [
    ...cushion({ size: 1.96, height: CUSHION_H, inset: 0.14 }),
    // Spot (dunkel) im Kranz
    flatPoly(circlePts(0.4, 10), MEX_TOP + 0.004, 'rind', 1),
    // Kranz um den Spot (Perlglanz), flach
    torus({ radius: 0.5, tube: 0.09, segments: 10, sides: 4, scale: [1, 0.8, 1], at: [0, MEX_TOP + 0.06, 0], mat: 'gold', keep: true, tag: 'ring' }),
    // Stiel (Gold) vom Spot bis unter den Kelch
    cylinder({ radius: 0.075, height: STALK_TOP - MEX_TOP, segments: 6, caps: false, at: [0, (MEX_TOP + STALK_TOP) / 2, 0], mat: 'gold', keep: true, tag: 'mast' }),
    // Tech-Streifen (Tiefjade) hinter dem Kranz, quer gestellt
    stripes({ count: tech, width: 0.16, at: [0, MEX_TOP + 0.004, -0.77], rot: [0, 90, 0], mat: 'jade' }),
  ];
  if (tech >= 2) {
    // Seitenschalen links/rechts: flache Perlmutt-Halbschalen auf dem Kissenrand
    for (const x of [0.72, -0.72]) {
      hull.push(ellipsoid({ radii: [0.17, 0.2, 0.52], half: true, segments: 6, rings: 2, at: [x, MEX_TOP + 0.08, 0.05], mat: 'nacre', maxLod: 1, tag: 'shell' }));
    }
  }
  if (tech === 3) {
    // zweiter Kranz (Gold) über dem ersten: „doppelter Ring“
    hull.push(torus({ radius: 0.34, tube: 0.07, segments: 8, sides: 3, at: [0, MEX_TOP + 0.24, 0], mat: 'gold', keep: true, tag: 'ring' }));
  }
  const kelch: Shape[] = [
    // Kelch: umgedrehte Halbschale, flache Seite oben (schwebt 0,04 über dem Stiel)
    ellipsoid({ radii: [0.34, 0.18, 0.34], half: true, segments: 8, rings: 3, rot: [180, 0, 0], at: [0, KELCH_Y - 0.09, 0], mat: 'nacre', keep: true, tag: 'shell' }),
    // Goldkern-Perle, halb in die Schale gesenkt (umschlossen)
    sphere({ radius: 0.19, segments: 8, rings: 3, at: [0, KELCH_Y + 0.02, 0], mat: 'light', keep: true, tag: 'orb' }),
  ];
  return [
    { name: 'hull', smooth: true, shapes: hull },
    { name: 'kelch', pivot: [0, STALK_TOP, 0], anim: 'pitch', smooth: true, shapes: kelch },
  ];
}

export default defineModel({
  id: 'f3:str_t1_mex',
  parts: mexParts(1),
  notes: 'Grundform v_mex; Tropfen-Takt = Pitch des Kelchs (Roster-Anim „tilt“). Exportiert cushion()/squircle() für die Sael-Eco-Gebäude.',
});
