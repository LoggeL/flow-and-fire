/**
 * Egel I (f2:str_t1_mex) – Skarn-Massenextraktor T1; Grundform der Egel-Familie (II/III importieren `mexParts`).
 * Enthält außerdem die Gebäude-Helfer der Skarn-Eco-/Fabrikgruppe: `crust` (Kruste mit gezackter Teamkante),
 * `webRing` (Netzring als Sechseck-Sweep) und `druse` (Kristalldruse mit LOD-Stufen).
 *
 * Roster: „Netzring um den Spot, zentrale Druse mit Glutkern (Saug-Puls-Animation), niedrig.“
 * faction.md §5.2 Mex: Netzring um den Spot + zentrale Druse (Glutkern), niedrig, bleibt 2×2; T3 mit doppeltem Ring;
 * verboten: Schwanz. §3.2 Gebäude: jedes Gebäude wächst aus einer facettierten Kruste (Sockel mit unregelmäßig
 * gezackter Oberkante, Footprint = Grid). Teamfarbe: Oberkante der Kruste + Netzring (20–30 % der Draufsicht).
 *
 * Aufbau (y = Boden, +Z = vorn), Basismaß 2×2 (II/III wachsen nur in der Höhe, Roster y 1,2 / 1,4):
 *   hull  – Kruste (Achteck, schräge Facetten, Krustengrau) mit gezackter Teamkante, Netzring (Team) mit drei
 *           Sehnen-Speichen, Saugmund aus Granatglas, Tech-Streifen (Quarz) hinten; II: vier Seitenplatten an den
 *           Ecken; III: zweiter Netzring (Sehne) über dem ersten
 *   druse – Herzdruse (Glut), kippt beim Saug-Puls (Pitch)          (PartStream 1)
 */
import {
  crystal,
  cylinder,
  defineModel,
  loftShape,
  plate,
  stripes,
  strut,
  sweep,
  type PartDef,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

// ---------------------------------------------------------------------------------------------------------------
// Gebäude-Helfer (Skarn-Eco- und Fabrikgruppe)

/** Deterministischer Zufall (für Krusten-Zacken). */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ecken eines regelmäßigen n-Ecks (Kanten zeigen bei n = 8 nach ±X/±Z), Winkel von +X nach +Z. */
function ngon(n: number, r: number, phase = 0.5): Vec2[] {
  const out: Vec2[] = [];
  for (let j = 0; j < n; j++) {
    const t = ((j + phase) / n) * Math.PI * 2;
    out.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return out;
}

const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Geschlossener Ringpfad (Start/Ende in einer Kantenmitte, damit die Naht bündig schließt), optional mit Kantenmitten. */
function loopPath(pts: readonly Vec2[], y: number, mids: boolean): Vec3[] {
  const n = pts.length;
  const start = mid(pts[n - 1]!, pts[0]!);
  const out: Vec3[] = [[start[0], y, start[1]]];
  for (let j = 0; j < n; j++) {
    const p = pts[j]!;
    out.push([p[0], y, p[1]]);
    if (mids && j < n - 1) {
      const m = mid(p, pts[j + 1]!);
      out.push([m[0], y, m[1]]);
    }
  }
  out.push([start[0], y, start[1]]);
  return out;
}

/** Dreieckiger Zackenkamm (offenes Profil: zwei Flanken, keine Unterseite). */
const CREST: Vec2[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface CrustOpts {
  /** Umkreisradius des Achtecks (Ausdehnung über die Kanten = 1,848 × radius). */
  readonly radius: number;
  readonly height: number;
  /** Oberkante relativ zur Unterkante (schräge Facetten), Standard 0,92. */
  readonly topScale?: number;
  /** Zackenkamm (Teamfarbe): Höhe niedrig/hoch, Breite, Einrückung von der Oberkante. */
  readonly crest: { readonly lo: number; readonly hi: number; readonly width: number; readonly inset?: number };
  readonly seed?: number;
  /** Seiten, Standard 8 (Achteck) – 6 für Sechseck-Gebäude. */
  readonly sides?: number;
  /** Letzte LOD-Stufe mit Zackenkamm (Standard 2; 1 = in LOD2 entfällt der Kamm). */
  readonly crestMaxLod?: 1 | 2;
  /** Eigener konvexer Grundriss (WU, Winkel aufsteigend von +X nach +Z) statt des Achtecks; `radius` wird ignoriert. */
  readonly outline?: readonly Vec2[];
  /** Kamm entfällt vor dieser z-Kante (Ausgang/Rampe vorn), Standard: umlaufend. */
  readonly crestGapZ?: number;
  /** Zacken auch in den Kantenmitten (LOD0), Standard true; false = nur Ecken (spart die Hälfte). */
  readonly crestMids?: boolean;
}

/**
 * Kruste: facettiertes Achteck-Prisma (Wände Krustengrau, schräge Flanken, leicht unregelmäßige Ecken; Oberseite
 * Schwarzchitin) mit gezacktem, teamfarbenem Kamm auf der Oberkante. LOD0 Zacken an Ecken und Kantenmitten, LOD1/2 nur
 * an den Ecken.
 */
export function crust(o: CrustOpts): Shape[] {
  const n = o.sides ?? 8;
  const r = rand(o.seed ?? 3);
  const jit = ngon(n, 1).map((p): Vec2 => {
    const k = 1 + (r() - 0.5) * 0.05;
    return [p[0] * k, p[1] * k];
  });
  const base = o.outline !== undefined ? o.outline.slice() : jit.map((p): Vec2 => [p[0] * o.radius, p[1] * o.radius]);
  const ts = o.topScale ?? 0.92;
  const top = base.map((p): Vec2 => [p[0] * ts, p[1] * ts]);
  const inset = o.crest.inset ?? o.crest.width * 0.6;
  const crestPts = top.map((p): Vec2 => {
    const l = Math.hypot(p[0], p[1]);
    return [(p[0] * (l - inset)) / l, (p[1] * (l - inset)) / l];
  });
  const { lo, hi, width } = o.crest;
  const heights = (path: Vec3[], mids: boolean): [number, number][] =>
    path.map((p, i): [number, number] => {
      // Ecken hoch (unregelmäßig), Kantenmitten niedrig; Start/Ende = Kantenmitte; vor crestGapZ flach (versenkt)
      const corner = mids ? i % 2 === 1 : i > 0 && i < path.length - 1;
      // ohne Kantenmitten springen die Ecken abwechselnd hoch/halbhoch, damit der Kamm gezackt bleibt
      const k = mids || i % 2 === 1 ? 0.7 + 0.3 * r() : 0.35 + 0.2 * r();
      const h = corner ? hi * k : lo * (0.8 + 0.4 * r());
      return [width / 2, o.crestGapZ !== undefined && p[2] > o.crestGapZ ? 0.002 : h];
    });
  const mids = o.crestMids ?? true;
  const p0 = loopPath(crestPts, o.height - 0.01, mids);
  const h0 = heights(p0, mids);
  h0[h0.length - 1] = h0[0]!;
  const p1 = loopPath(crestPts, o.height - 0.01, false);
  const h1 = heights(p1, false);
  h1[h1.length - 1] = h1[0]!;
  return [
    // geböschte Wände (Krustengrau) + Oberseite (Schwarzchitin, wie der vertiefte Boden der Wehr-Krusten)
    loftShape({
      rings: [
        { y: 0, pts: base },
        { y: o.height, pts: top },
      ],
      caps: { bottom: false, top: false },
      mat: 'crust',
      keep: true,
      tag: 'crust',
    }),
    loftShape({ rings: [{ y: o.height, pts: top }], caps: { bottom: false }, mat: 'chitin', keep: true, tag: 'crust' }),
    sweep({ path: p0, radius: h0, profile: CREST, open: true, mat: 'team', keep: true, maxLod: 0, tag: 'crust' }),
    sweep({ path: p1, radius: h1, profile: CREST, open: true, mat: 'team', keep: true, minLod: 1, maxLod: o.crestMaxLod ?? 2, tag: 'crust' }),
  ];
}

/** Rhombischer Querschnitt des Netzrings. */
const RING: Vec2[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export interface WebRingOpts {
  readonly radius: number;
  readonly width: number;
  readonly height: number;
  readonly y: number;
  readonly mat: string;
  readonly sides?: number;
  /** Drehung in Grad um Y. */
  readonly yaw?: number;
  readonly maxLod?: 0 | 1 | 2;
  readonly minLod?: 0 | 1 | 2;
  readonly at?: Vec3;
  /** Querschnitt: 'rhombus' (4 Flächen) oder 'ridge' (offenes Dreieck, 2 Flächen, liegt auf einer Fläche auf). */
  readonly section?: 'rhombus' | 'ridge' | 'tri';
}

/** Netzring: flacher Sechseck-Ring (Sweep mit Rhombus-Querschnitt, eckig, keine Kurven). */
export function webRing(o: WebRingOpts): Shape {
  const n = o.sides ?? 6;
  const pts = ngon(n, o.radius, 0.5 + (o.yaw ?? 0) / (360 / n));
  const path = loopPath(pts, o.y, false).map((p): Vec3 => (o.at ? [p[0] + o.at[0], p[1], p[2] + o.at[2]] : p));
  return sweep({
    path,
    radius: path.map((): [number, number] => [o.width / 2, o.height / 2]),
    profile: o.section === 'ridge' || o.section === 'tri' ? CREST : RING,
    ...(o.section === 'ridge' ? { open: true } : { caps: false }),
    mat: o.mat,
    keep: true,
    tag: 'webring',
    ...(o.maxLod === undefined ? {} : { maxLod: o.maxLod }),
    ...(o.minLod === undefined ? {} : { minLod: o.minLod }),
  });
}

export interface DruseOpts {
  readonly at: Vec3;
  readonly radius: number;
  readonly height: number;
  /** Kristalle insgesamt (1 Glutkern in der Mitte + äußere), Standard 3. */
  readonly count?: number;
  readonly seed?: number;
  readonly lean?: number;
  readonly spread?: number;
  /** Material der äußeren Kristalle, Standard 'glow' (z. B. 'garnet': nur der Kern glüht). */
  readonly outer?: string;
  /** Kristallseiten in LOD0, Standard 6 (LOD1 4, LOD2 nur der Kern). */
  readonly sides?: number;
  /** Seiten der äußeren Kristalle in LOD0, Standard = `sides`. */
  readonly outerSides?: number;
  readonly maxLod?: 0 | 1 | 2;
}

/**
 * Druse: aufrechter Glutkristall in der Mitte, äußere Kristalle nach außen geneigt (deterministisch, wie
 * `crystalCluster`, aber mit eigenem Material für die äußeren). LOD0 `sides`, LOD1 Vierkant, LOD2 nur der Kern.
 */
export function druse(o: DruseOpts): Shape[] {
  const count = o.count ?? 3;
  const r0 = o.radius;
  const spread = o.spread ?? r0 * 1.5;
  const lean = o.lean ?? 24;
  const [x, y, z] = o.at;
  const out: Shape[] = [];
  const cap = o.maxLod ?? 2;
  const variants: { sides: number; minLod: 0 | 1 | 2; maxLod: 0 | 1 | 2; count: number }[] = [
    { sides: o.sides ?? 6, minLod: 0, maxLod: 0, count },
    { sides: 4, minLod: 1, maxLod: 1, count },
    { sides: 4, minLod: 2, maxLod: 2, count: 1 },
  ];
  for (const v of variants) {
    if (v.minLod > cap) continue;
    const rnd = rand(o.seed ?? 7);
    for (let i = 0; i < v.count; i++) {
      const outer = i > 0;
      const h = outer ? o.height * (0.5 + 0.25 * rnd()) : o.height;
      const rr = outer ? r0 * (0.72 + 0.15 * rnd()) : r0;
      const tip = rr * 1.5;
      const phiDeg = outer ? ((i - 1) / (count - 1)) * 360 + (rnd() - 0.5) * 30 + 20 : 0;
      const leanDeg = outer ? lean * (0.85 + 0.3 * rnd()) : 0;
      const phi = (phiDeg * Math.PI) / 180;
      const la = (leanDeg * Math.PI) / 180;
      const half = (h + tip) / 2;
      const sink = 0.06 * o.height;
      const bx = outer ? spread * Math.sin(phi) : 0;
      const bz = outer ? spread * Math.cos(phi) : 0;
      out.push(
        crystal({
          radius: rr,
          height: h,
          tip,
          sides: outer && v.minLod === 0 ? (o.outerSides ?? v.sides) : v.sides,
          at: [x + bx + Math.sin(la) * Math.sin(phi) * half, y - sink + Math.cos(la) * half, z + bz + Math.sin(la) * Math.cos(phi) * half],
          rot: [leanDeg, phiDeg, 0],
          mat: outer ? (o.outer ?? 'glow') : 'glow',
          keep: true,
          minLod: v.minLod,
          maxLod: Math.min(v.maxLod, cap) as 0 | 1 | 2,
          tag: 'druse',
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Egel

const CRUST_H = 0.2;
const RING_Y = CRUST_H + 0.07;

export function mexParts(tech: 1 | 2 | 3): PartDef[] {
  const hull: Shape[] = [
    ...crust({ radius: 1.07, height: CRUST_H, crest: { lo: 0.05, hi: 0.18, width: 0.12 }, seed: 11 }),
    // Netzring um den Spot (Team) + drei Sehnen-Speichen zur Druse
    webRing({ radius: 0.52, width: 0.16, height: 0.12, y: RING_Y, mat: 'team', maxLod: 0 }),
    webRing({ radius: 0.52, width: 0.16, height: 0.1, y: CRUST_H, mat: 'team', section: 'ridge', minLod: 1 }),
    // Saugmund: Granatglas-Sechseck, in dem die Druse sitzt
    cylinder({ radius: 0.24, height: 0.1, segments: 6, caps: 'top', at: [0, CRUST_H + 0.03, 0], mat: 'garnet', maxLod: 1, tag: 'druse' }),
    // Tech-Streifen (Quarz) hinten zwischen Ring und Kamm, quer
    stripes({ count: tech, width: 0.34, at: [0, CRUST_H + 0.004, -0.62], mat: 'quartz', maxLod: tech === 1 ? 1 : 0 }),
  ];
  // Speichen Ring → Druse (T3: ersetzt durch die Stützen des zweiten Rings)
  for (const a of tech === 3 ? [] : [90, 210, 330]) {
    const t = (a * Math.PI) / 180;
    hull.push(
      strut({
        from: [0.5 * Math.cos(t), RING_Y + 0.02, 0.5 * Math.sin(t)],
        to: [0.18 * Math.cos(t), CRUST_H + 0.1, 0.18 * Math.sin(t)],
        radius: 0.05,
        sides: 3,
        caps: false,
        mat: 'sinew',
        maxLod: 0,
        tag: 'webring',
      }),
    );
  }
  if (tech >= 2) {
    // Seitenplatten: vier Chitinschilde lehnen an den Diagonalflanken der Kruste und füllen die Footprint-Ecken
    for (const a of [45, 135, 225, 315]) {
      const t = (a * Math.PI) / 180;
      hull.push(
        plate({
          size: [0.66, 0.34],
          thickness: 0.05,
          arch: 0.04,
          point: 0.3,
          segments: [1, 1],
          at: [1.0 * Math.cos(t), 0.12, 1.0 * Math.sin(t)],
          rot: [-52, 270 - a, 0],
          mat: 'chitin',
          maxLod: 1,
          tag: 'carapace',
        }),
      );
    }
  }
  if (tech === 3) {
    // zweiter Netzring (Sehne), höher und um 30° gedreht
    hull.push(
      webRing({ radius: 0.36, width: 0.13, height: 0.12, y: CRUST_H + 0.26, mat: 'sinew', yaw: 30, section: 'tri', maxLod: 0 }),
      webRing({ radius: 0.36, width: 0.12, height: 0.08, y: CRUST_H + 0.27, mat: 'sinew', yaw: 30, section: 'ridge', minLod: 1, maxLod: 1 }),
    );
    for (const a of [30, 150, 270]) {
      const t = (a * Math.PI) / 180;
      hull.push(
        strut({
          from: [0.5 * Math.cos(t), RING_Y, 0.5 * Math.sin(t)],
          to: [0.36 * Math.cos(t), CRUST_H + 0.3, 0.36 * Math.sin(t)],
          radius: 0.05,
          sides: 3,
          mat: 'sinew',
          maxLod: 0,
          tag: 'webring',
        }),
      );
    }
  }
  return [
    { name: 'hull', shapes: hull },
    {
      name: 'druse',
      pivot: [0, CRUST_H + 0.05, 0],
      anim: 'pitch',
      shapes: druse({ at: [0, CRUST_H + 0.05, 0], radius: 0.11, height: 0.3, lean: 26, seed: 5, outer: 'garnet' }),
    },
  ];
}

export default defineModel({
  id: 'f2:str_t1_mex',
  parts: mexParts(1),
  notes: 'Grundform v_mex (Basismaß 2×2); Druse als Part (Saug-Puls = Kippen, Roster-Anim „tilt“ → pitch).',
});
