/**
 * Stimmstock I (f4:str_t1_mex) – Aurith-Massenextraktor T1; Grundform der Stimmstock-Familie (II/III importieren
 * `mexParts`) und **Heimat der Gebäude-Helfer** der Aurith-Wirtschaft (`dreipass`, `socketY`, `tonpunkte`), die
 * Resonator, Äolsharfe, Kammern und Hallen mitbenutzen.
 *
 * Roster: „Niedriger Dreipass-Sockel, Reif um den Spot, zentraler Kristall (pulsiert als gezupfte Saite).“
 * faction.md §5.2 Stimmstock: Reif um den Spot + ein zentraler Kristall, niedrig, T3 mit doppeltem Reif.
 * Gebäude (§3.2): dreizählig radialsymmetrisch, Dreipass-Sockel (drei überlappende flache Linsen) füllt den Footprint;
 * Teamfarbe nur als Sockelrand (20–30 % der Draufsicht, §4.2); Tonpunkte Perlglas auf dem hinteren Sockelrand
 * (§3.4); Resonanzkern (`phase`) nur als Kristall, Glyphenbänder (`glyph`) ≤ 3 %.
 *
 * Aufbau (y = Boden, +Z = vorn, eine Sockel-Linse zeigt nach vorn):
 *   hull    – Dreipass-Sockel (Rand team, Kuppe Bernstein, gemeinsam geglättet), Reif aus Pechglas mit Glyphenband,
 *             drei Bernstein-Stege vom Reif zum Stimmstock, Tonpunkte; III: zweiter, höherer Reif (Bernstein-Kante)
 *   crystal – Stimmstock-Fuß (Pechglas) und zentraler Resonanzkristall; kippt als gezupfte Saite (PartStream 1)
 */
import {
  arcPoints,
  crystal,
  cylinder,
  defineModel,
  glyphStrip,
  loftShape,
  strut,
  torus,
  type PartDef,
  type Shape,
  type Vec2,
} from '@faf/modelkit';

// ---------------------------------------------------------------------------------------------------------------
// Dreipass-Sockel: drei überlappende Linsen (Lappen vorn, links hinten, rechts hinten), als Loft über den Umriss

/** Lappen-Abstand und -Radius relativ zur halben Footprint-Kante: Ausdehnung 2,00 × 1,92 der Kante (100 % / 96 %). */
const LOBE_D = 0.36;
const LOBE_R = 0.69;
const LOBE_DEG = [90, 210, 330] as const;
/** Schwerpunktverschiebung, damit der Umriss in z mittig liegt (vorn ein Lappen, hinten zwei). */
const LOBE_DZ = -0.25 * LOBE_D;

function lobeCenters(h: number): Vec2[] {
  return LOBE_DEG.map((a): Vec2 => [h * LOBE_D * Math.cos((a * Math.PI) / 180), h * (LOBE_D * Math.sin((a * Math.PI) / 180) + LOBE_DZ)]);
}

/** Abstand vom Ursprung bis zum Rand des Dreipass-Umrisses in Richtung `th` (Bogenmaß). */
function trefoilR(h: number, th: number): number {
  const u: Vec2 = [Math.cos(th), Math.sin(th)];
  let best = 0;
  for (const c of lobeCenters(h)) {
    const cu = c[0] * u[0] + c[1] * u[1];
    const disc = (h * LOBE_R) ** 2 - (c[0] ** 2 + c[1] ** 2) + cu * cu;
    if (disc >= 0) best = Math.max(best, cu + Math.sqrt(disc));
  }
  return best;
}

/** Umrisspunkte [x, z] mit steigendem Winkel; je Lappen `m` Punkte, die Kerben liegen genau auf Stützpunkten. */
function trefoilPts(h: number, m: number): Vec2[] {
  const cs = lobeCenters(h);
  const r = h * LOBE_R;
  const norm = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Kerbe zwischen Lappen i und i+1 = äußerer Schnittpunkt der beiden Kreise
  const cusp = (i: number): number => {
    const a = cs[i]!;
    const b = cs[(i + 1) % 3]!;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const hh = Math.sqrt(r * r - (len / 2) ** 2);
    const p1: Vec2 = [mx - (dz / len) * hh, mz + (dx / len) * hh];
    const p2: Vec2 = [mx + (dz / len) * hh, mz - (dx / len) * hh];
    const p = Math.hypot(...p1) > Math.hypot(...p2) ? p1 : p2;
    return norm(Math.atan2(p[1], p[0]));
  };
  const pts: Vec2[] = [];
  // Lappen i liegt zwischen Kerbe i-1 und Kerbe i; Start beim vorderen Lappen (i = 0)
  let start = cusp(2);
  for (let i = 0; i < 3; i++) {
    let end = cusp(i);
    if (end <= start) end += 2 * Math.PI;
    for (let k = 0; k < m; k++) {
      const th = start + ((end - start) * k) / m;
      const t = trefoilR(h, th);
      pts.push([t * Math.cos(th), t * Math.sin(th)]);
    }
    start = end;
  }
  // nach Winkel sortieren (Loft-Konvention), Start bei der kleinsten Richtung
  return pts.map((p) => ({ p, a: norm(Math.atan2(p[1], p[0])) })).sort((x, y) => x.a - y.a).map((x) => x.p);
}

export interface SocketSpec {
  /** Halbe Footprint-Kante (WU). */
  readonly half: number;
  /** Höhe des teamfarbenen Randbands. */
  readonly team: number;
  /** Höhe der Bernstein-Kuppe über dem Randband. */
  readonly amber: number;
  /** Maßstab des Umrisses an der Oberkante des Randbands (Standard 0,88 ⇒ ≈ 23 % Team in der Draufsicht). */
  readonly rim?: number;
  /** Punkte je Lappen in LOD0 (Standard 6, Vielfaches von 2: Kerbe und Lappenmitte liegen auf Stützpunkten). */
  readonly m?: number;
  /** Punkte je Lappen in LOD1 (Standard 4). */
  readonly m1?: number;
  /** Punkte je Lappen in LOD2 (Standard 2). */
  readonly m2?: number;
}

/** Querschnitts-Stufen [Maßstab des Umrisses, Höhe] des Sockels. */
function socketRings(s: SocketSpec): [number, number][] {
  return [
    [1, 0],
    [s.rim ?? 0.88, s.team],
    [0.6 * ((s.rim ?? 0.88) / 0.88), s.team + 0.7 * s.amber],
    [0, s.team + s.amber],
  ];
}

/** Dreipass-Sockel: teamfarbenes Randband + Bernstein-Kuppe (gemeinsam geglättet). */
export function dreipass(s: SocketSpec): Shape[] {
  const out: Shape[] = [];
  const st = socketRings(s);
  for (const [m, lod] of [
    [s.m ?? 6, { maxLod: 0 as const }],
    [s.m1 ?? 4, { minLod: 1 as const, maxLod: 1 as const }],
    [s.m2 ?? 2, { minLod: 2 as const }],
  ] as const) {
    const pts = trefoilPts(s.half, m);
    const ring = (i: number) => ({ y: st[i]![1], pts: pts.map(([x, z]): Vec2 => [x * st[i]![0], z * st[i]![0]]) });
    out.push(
      loftShape({ rings: [ring(0), ring(1)], caps: { bottom: false, top: false }, mat: 'team', smooth: true, smoothGroup: 'socket', keep: true, tag: 'lens', ...lod }),
      loftShape({ rings: [ring(1), ring(2), ring(3)], caps: { bottom: false, top: false }, mat: 'amber', smooth: true, smoothGroup: 'socket', keep: true, tag: 'lens', ...lod }),
    );
  }
  return out;
}

/** Höhe der Sockeloberfläche bei (x, z) (für aufgesetzte Teile und Tonpunkte). */
export function socketY(s: SocketSpec, x: number, z: number): number {
  const th = Math.atan2(z, x);
  const k = Math.hypot(x, z) / trefoilR(s.half, th);
  const st = socketRings(s);
  for (let i = 0; i + 1 < st.length; i++) {
    const [k0, y0] = st[i]!;
    const [k1, y1] = st[i + 1]!;
    if (k <= k0 && k >= k1) return y0 + ((y1 - y0) * (k0 - k)) / (k0 - k1);
  }
  return k > 1 ? 0 : s.team + s.amber;
}

/**
 * Tonpunkte (faction.md §3.4): `count` runde Perlglas-Punkte quer in einer Reihe bei (x = 0, z), Ø `dia`, Abstand
 * `gap`: flache Sechseck-Decals (4 Tris), an die Neigung der Fläche `surfaceY(x, z)` angelegt; nur LOD0.
 */
export function tonpunkte(count: number, z: number, surfaceY: (x: number, z: number) => number, dia = 0.12, gap = 0.08, mat = 'pearl'): Shape[] {
  const out: Shape[] = [];
  const step = dia + gap;
  const hex = Array.from({ length: 6 }, (_, i): Vec2 => [(dia / 2) * Math.cos((i * Math.PI) / 3), (dia / 2) * Math.sin((i * Math.PI) / 3)]);
  const e = 0.01;
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * step;
    const y = surfaceY(x, z);
    const gx = (surfaceY(x + e, z) - surfaceY(x - e, z)) / (2 * e);
    const gz = (surfaceY(x, z + e) - surfaceY(x, z - e)) / (2 * e);
    const deg = 180 / Math.PI;
    out.push(
      loftShape({
        rings: [{ y: 0, pts: hex }],
        caps: { bottom: false, top: true },
        at: [x, y + 0.012, z],
        rot: [Math.atan(gz) * deg, 0, -Math.atan(gx) * deg],
        mat,
        keep: true,
        maxLod: 0,
        tag: 'dots',
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Stimmstock

export const MEX_SOCKET: SocketSpec = { half: 1, team: 0.09, amber: 0.15 };
const RING_R = 0.52;

export function mexParts(tech: 1 | 2 | 3): PartDef[] {
  const s = MEX_SOCKET;
  const ringY = socketY(s, RING_R, 0) + 0.06;
  const hull: Shape[] = [
    ...dreipass(s),
    // Reif um den Spot (Pechglas) mit Glyphenband obenauf
    torus({ radius: RING_R, tube: 0.085, segments: 10, sides: 3, scale: [1, 0.85, 1], at: [0, ringY, 0], mat: 'pitch', keep: true, tag: 'ring' }),
    glyphStrip({
      path: arcPoints(RING_R, 0, 360, 24, 'y', [0, ringY + 0.075, 0]),
      width: 0.05,
      pattern: [0.3, -0.1, 0.1, -0.08],
      mat: 'glyph',
      maxLod: 0,
      tag: 'glyphs',
    }),
    ...tonpunkte(tech, -0.66, (x, z) => socketY(s, x, z)),
  ];
  // drei Bernstein-Stege vom Reif zum Stimmstock-Fuß (zwischen den Lappen, dreizählig)
  for (const a of [30, 150, 270]) {
    const c = Math.cos((a * Math.PI) / 180);
    const sn = Math.sin((a * Math.PI) / 180);
    hull.push(
      strut({ from: [c * (RING_R - 0.04), ringY, sn * (RING_R - 0.04)], to: [c * 0.15, ringY + 0.1, sn * 0.15], radius: 0.055, radiusEnd: 0.04, sides: 4, mat: 'amberedge', maxLod: 1, tag: 'ring' }),
    );
  }
  if (tech === 3) {
    // zweiter, höherer Reif (Bernstein-Kante) – doppelter Reif ist das Monopol des Stimmstocks III
    hull.push(torus({ radius: 0.36, tube: 0.07, segments: 9, sides: 3, at: [0, ringY + 0.24, 0], mat: 'amberedge', keep: true, tag: 'ring' }));
    for (const a of [90, 210, 330]) {
      const c = Math.cos((a * Math.PI) / 180);
      const sn = Math.sin((a * Math.PI) / 180);
      hull.push(strut({ from: [c * 0.48, ringY + 0.03, sn * 0.48], to: [c * 0.36, ringY + 0.22, sn * 0.36], radius: 0.045, sides: 3, caps: false, mat: 'pitch', maxLod: 1, tag: 'ring' }));
    }
  }
  const baseY = socketY(s, 0, 0);
  const crystalShapes: Shape[] = [
    // Stimmstock-Fuß (Pechglas)
    cylinder({ radius: 0.17, height: 0.18, segments: 6, caps: 'top', at: [0, baseY + 0.05, 0], mat: 'pitch', keep: true, tag: 'crystal' }),
    // zentraler Resonanzkristall
    crystal({ radius: 0.13, height: 0.24, tip: 0.2, at: [0, baseY + 0.14 + 0.22, 0], mat: 'phase', keep: true, tag: 'crystal' }),
  ];
  return [
    { name: 'hull', shapes: hull },
    { name: 'crystal', pivot: [0, baseY, 0], anim: 'pitch', shapes: crystalShapes },
  ];
}

export default defineModel({
  id: 'f4:str_t1_mex',
  parts: mexParts(1),
  notes: 'Grundform v_mex; gezupfte Saite = Pitch des Kristalls (Roster-Anim „tilt“). Exportiert die Gebäude-Helfer.',
});
