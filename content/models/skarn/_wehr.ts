/**
 * Gemeinsame Bauteile der Skarn-Verteidigungs- und Support-Strukturen (Falle, Schlehe, Igel, Hecke, Fühler, Kokon,
 * Schierling, Bilsenkraut). Keine Modelldatei (Präfix `_`).
 *
 * `crust` – die facettierte **Kruste** (faction.md §3.2 „Gebäude“, Kitbash-Part `crust`): Achteck-Sockel, der den
 * Footprint füllt, mit geböschten Wänden (Krustengrau), unregelmäßig gezackter Oberkante, einem teamfarbenen
 * Randband, das von den Zacken nach innen abfällt, und einem vertieften Boden (Schwarzchitin). Das Rollen-Element
 * sitzt auf dem Boden (`floor`). Der Generator erzeugt die Polygone selbst (`primNode`), weil die Zacken je Punkt
 * eine eigene Höhe brauchen; LOD2 lässt die Kantenmitten weg (8 statt 12 Punkte).
 */
import { dot, limb, newell, primNode, spike, strut, sweep, type Poly, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

export interface CrustOpts {
  /** Ausdehnung des Fußes [x, z] (Footprint-Kante × 0,96–0,98). */
  readonly size: Vec2;
  /** mittlere Höhe der Zacken (Oberkante). */
  readonly h: number;
  /** Eckfase als Anteil der halben Kante (0 = Quadrat, Standard 0,32). */
  readonly cut?: number;
  /** Böschung: Rücksprung der Oberkante gegenüber dem Fuß (WU, Standard 5 % der Kante). */
  readonly batter?: number;
  /** Breite des Randbands in der Draufsicht (WU, Standard 11 % der Kante); 0 = kein Band (Hecke). */
  readonly rim?: number;
  /** Tiefe des Bodens unter der mittleren Zackenhöhe (WU, Standard 30 % von h). */
  readonly sink?: number;
  /** Zackenhub ± (WU, Standard 22 % von h). */
  readonly jag?: number;
  /** Zufallssaat der Zacken (deterministisch). */
  readonly seed?: number;
  /** Kantenmitten als zusätzliche Zacken (Standard true, LOD2 immer ohne). */
  readonly mid?: boolean;
  /** Materialien (Standard: Wände `crust`, Band `team`, Boden `chitin`). */
  readonly wallMat?: string;
  readonly rimMat?: string;
  readonly floorMat?: string;
  readonly tag?: string;
}

export interface Crust {
  readonly shapes: Shape[];
  /** Höhe des Bodens (Oberseite, auf der das Rollen-Element steht). */
  readonly floor: number;
  /** höchste Zacke. */
  readonly top: number;
  /** halbe Innenkante des Bodens [x, z] (Platz für Tech-Kerben). */
  readonly inner: Vec2;
}

/** kleiner deterministischer Zufallsgenerator (LCG), [0, 1). */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function oriented(poly: Vec3[], expected: Vec3): Poly {
  return dot(newell(poly), expected) < 0 ? poly.slice().reverse() : poly;
}

/** Umriss (Achteck mit Fasen + optional Kantenmitten), gegen den Uhrzeigersinn von oben. */
function outline(hx: number, hz: number, cut: number, mid: boolean): Vec2[] {
  const c = cut * Math.min(hx, hz);
  const pts: Vec2[] = [];
  const corner = (sx: number, sz: number): Vec2[] =>
    c > 1e-9
      ? [
          [sx * hx, sz * (hz - c)],
          [sx * (hx - c), sz * hz],
        ]
      : [[sx * hx, sz * hz]];
  // Reihenfolge +x → +z → −x → −z (θ steigend, x = cos, z = sin)
  if (mid) pts.push([hx, 0]);
  pts.push(...corner(1, 1));
  if (mid) pts.push([0, hz]);
  pts.push(...corner(-1, 1).reverse());
  if (mid) pts.push([-hx, 0]);
  pts.push(...corner(-1, -1));
  if (mid) pts.push([0, -hz]);
  pts.push(...corner(1, -1).reverse());
  return pts;
}

export function crust(o: CrustOpts): Crust {
  const [w, d] = o.size;
  const hx = w / 2;
  const hz = d / 2;
  const edge = Math.min(w, d);
  const cut = o.cut ?? 0.32;
  const batter = o.batter ?? 0.05 * edge;
  const rim = o.rim ?? 0.11 * edge;
  const sink = o.sink ?? 0.3 * o.h;
  const jag = o.jag ?? 0.22 * o.h;
  const mid = o.mid ?? true;
  const floor = o.h - sink;
  const tag = o.tag ?? 'crust';
  const rand = rng(o.seed ?? 1);
  // Zackenhöhen für den vollen Umriss (12 Punkte); LOD2 nimmt die Ecken daraus
  const full = outline(hx, hz, cut, mid);
  const heights = full.map((_, i) => o.h + jag * (i % 2 === 0 ? 0.35 + 0.65 * rand() : -(0.2 + 0.6 * rand())));
  // Kantenmitten liegen auf einer Achse (x = 0 oder z = 0), die Ecken nie
  const cornerIdx = full.map((_, i) => i).filter((i) => !mid || (Math.abs(full[i]![0]) > 1e-9 && Math.abs(full[i]![1]) > 1e-9));

  const ring = (lod: number): { foot: Vec2[]; hs: number[] } => {
    if (lod < 2 || !mid) return { foot: full, hs: heights };
    return { foot: cornerIdx.map((i) => full[i]!), hs: cornerIdx.map((i) => heights[i]!) };
  };
  const inset = (p: Vec2, by: number): Vec2 => {
    const sx = (hx - by) / hx;
    const sz = (hz - by) / hz;
    return [p[0] * sx, p[1] * sz];
  };

  const walls = primNode('crust', { mat: o.wallMat ?? 'crust', keep: true, tag }, (lod) => {
    const { foot, hs } = ring(lod);
    const out: Poly[] = [];
    const n = foot.length;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const a = foot[i]!;
      const b = foot[k]!;
      const ta = inset(a, batter);
      const tb = inset(b, batter);
      const outward: Vec3 = [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2];
      out.push(oriented([[a[0], 0, a[1]], [b[0], 0, b[1]], [tb[0], hs[k]!, tb[1]]], outward));
      out.push(oriented([[a[0], 0, a[1]], [tb[0], hs[k]!, tb[1]], [ta[0], hs[i]!, ta[1]]], outward));
    }
    if (rim <= 0) {
      // ohne Band: Deckel als Fächer um einen Mittelpunkt auf mittlerer Höhe
      const c: Vec3 = [0, o.h - 0.25 * jag, 0];
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n;
        const ta = inset(foot[i]!, batter);
        const tb = inset(foot[k]!, batter);
        out.push(oriented([c, [ta[0], hs[i]!, ta[1]], [tb[0], hs[k]!, tb[1]]], [0, 1, 0]));
      }
    }
    return out;
  });
  const shapes: Shape[] = [walls];
  if (rim > 0) {
    shapes.push(
      primNode('crust', { mat: o.rimMat ?? 'team', keep: true, tag }, (lod) => {
        const { foot, hs } = ring(lod);
        const out: Poly[] = [];
        const n = foot.length;
        for (let i = 0; i < n; i++) {
          const k = (i + 1) % n;
          const ta = inset(foot[i]!, batter);
          const tb = inset(foot[k]!, batter);
          const ia = inset(foot[i]!, batter + rim);
          const ib = inset(foot[k]!, batter + rim);
          out.push(oriented([[ta[0], hs[i]!, ta[1]], [tb[0], hs[k]!, tb[1]], [ib[0], floor, ib[1]]], [0, 1, 0]));
          out.push(oriented([[ta[0], hs[i]!, ta[1]], [ib[0], floor, ib[1]], [ia[0], floor, ia[1]]], [0, 1, 0]));
        }
        return out;
      }),
      primNode('crust', { mat: o.floorMat ?? 'chitin', keep: true, tag }, (lod) => {
        const { foot } = ring(lod);
        return [oriented(foot.map((p): Vec3 => {
          const q = inset(p, batter + rim);
          return [q[0], floor, q[1]];
        }), [0, 1, 0])];
      }),
    );
  }
  const top = Math.max(...heights);
  return { shapes, floor, top, inner: [hx - batter - rim, hz - batter - rim] };
}

// ---------------------------------------------------------------------------------------------------------------
// Schwanz (Kitbash-Part `tail` + `pod`): Artillerie-Monopol der Skarn (faction.md §3.2/§5.2)

export interface TailOpts {
  /** Gelenkkette Ansatz → … → Spitze (3 Segmente = 4 Punkte); das letzte Segment gibt die Kapselrichtung vor. */
  readonly joints: readonly Vec3[];
  /** Radius je Gelenk (4-Kant, Umkreis). */
  readonly radius: readonly number[];
  /** Kapsel: Länge des Sechskant-Prismas, Umkreisradius, Länge der Spitze. */
  readonly podLen: number;
  readonly podR: number;
  readonly podTip?: number;
  readonly mat?: string;
  readonly podMat?: string;
  /** Sehnen-Manschetten an den inneren Gelenken (Standard true, nur LOD0/1). */
  readonly collars?: boolean;
}

export interface Tail {
  readonly shapes: Shape[];
  /** Kapselachse: Start, Richtung (Einheitsvektor), Spitze. */
  readonly podStart: Vec3;
  readonly dir: Vec3;
  readonly tip: Vec3;
}

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const unit = (a: Vec3, b: Vec3): Vec3 => {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** Keil-Querschnitt des Schwanzes: Firstkante auf der Rückenseite (v > 0), flacher Bauch. */
const KEEL_PROFILE: Vec2[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [-0.55, -0.75],
  [0.55, -0.75],
];

/**
 * Schwanzkörper als ein Mesh (Kitbash `tail`): Keil-Querschnitt mit Firstkante entlang der Gelenkkette, an den
 * Gelenken auf Gehrung geschnitten (drei gebogene Keilsegmente). Der Rücken (Firstkante) zeigt beim Ansatz nach
 * hinten und folgt dann der Außenseite des Bogens (rotationsminimierende Rahmen). LOD2: Dreikant.
 */
export function tailBody(joints: readonly Vec3[], radius: readonly number[], mat = 'team'): Shape[] {
  const sec = radius.map((r): [number, number] => [r, r * 0.9]);
  const first = unit(joints[0]!, joints[1]!);
  // Rücken beim Ansatz: senkrecht zur ersten Richtung in der Längsebene, nach hinten (−Z); die Profil-v-Achse folgt
  // der Komponente dieses Hinweises senkrecht zur Tangente
  const upHint: Vec3 = [0, first[2], -first[1]];
  return [
    sweep({ path: joints, radius: sec, profile: KEEL_PROFILE, up: upHint, caps: 'end', mat, keep: true, maxLod: 1, tag: 'tail' }),
    sweep({ path: joints, radius: sec, sides: 3, up: upHint, caps: 'end', mat, keep: true, minLod: 2, tag: 'tail' }),
  ];
}

/**
 * Gegliederter Schwanz (Team, Keil-Querschnitt mit Firstkante) mit Sehnen-Manschetten und einer Sechskant-Kapsel
 * (Sehne) an der Spitze. LOD2: dreikantig, ohne Manschetten.
 */
export function tail(o: TailOpts): Tail {
  const j = o.joints;
  const n = j.length;
  const dir = unit(j[n - 2]!, j[n - 1]!);
  const podStart = add(j[n - 1]!, dir, -0.35 * o.podR);
  const podEnd = add(podStart, dir, o.podLen);
  const tip = add(podEnd, dir, o.podTip ?? o.podR * 1.1);
  const mat = o.mat ?? 'team';
  const podMat = o.podMat ?? 'sinew';
  const shapes: Shape[] = [
    ...tailBody(j, o.radius, mat),
    strut({ from: podStart, to: podEnd, radius: o.podR, sides: 6, caps: 'start', mat: podMat, keep: true, tag: 'pod' }),
    spike({ from: podEnd, to: tip, radius: o.podR, sides: 6, mat: podMat, keep: true, tag: 'pod' }),
  ];
  if (o.collars ?? true) {
    for (let i = 1; i < n - 1; i++) {
      const d = unit(j[i - 1]!, j[i + 1]!);
      shapes.push(strut({ from: add(j[i]!, d, -0.06), to: add(j[i]!, d, 0.06), radius: o.radius[i]! * 1.28, sides: 4, caps: false, mat: 'sinew', maxLod: 1, tag: 'tail' }));
    }
  }
  return { shapes, podStart, dir, tip };
}

/** Elevation in Grad vor dem Roster-Maßstab, damit sie nach dem Einbacken (y/xz verzerrt) `gameDeg` ergibt. */
export function baseElevation(gameDeg: number, sy: number, sxz: number): number {
  return (Math.atan(Math.tan((gameDeg * Math.PI) / 180) / (sy / sxz)) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------------------------------------------
// Fühler (Kitbash-Part `antenna`): Vierkantprisma, 2 Glieder, geknickt – Intel (Radar), Stützen (Kokon)

export interface FeelerOpts {
  /** Wurzel (Hüfte) des Fühlers. */
  readonly root: Vec3;
  /** Knie. */
  readonly knee: Vec3;
  /** Spitze. */
  readonly tip: Vec3;
  /** Umkreisradius an Wurzel, Knie, Spitze (4-Kant: Kantenbreite = r × √2). */
  readonly radius: readonly [number, number, number];
  readonly mat?: string;
  /** Sehnen-Manschetten an Wurzel und Knie (LOD0/1). */
  readonly collars?: boolean;
}

/** Ein geknickter Fühler: LOD0/1 vierkantig mit Kniedeckel, LOD2 dreikantig. */
export function feeler(o: FeelerOpts): Shape[] {
  const j = [o.root, o.knee, o.tip];
  const mat = o.mat ?? 'chitin';
  const out: Shape[] = [
    limb({ joints: j, radius: o.radius, sides: 4, hipCap: false, mat, keep: true, maxLod: 1, tag: 'antenna' }),
    limb({ joints: j, radius: o.radius, sides: 3, hipCap: false, jointCaps: false, mat, keep: true, minLod: 2, tag: 'antenna' }),
  ];
  if (o.collars ?? true) {
    const d0 = unit(o.root, o.knee);
    const d1 = unit(o.root, o.tip);
    const r0 = add(o.root, d0, 0.1);
    out.push(
      strut({ from: add(r0, d0, -0.07), to: add(r0, d0, 0.07), radius: o.radius[0] * 1.3, sides: 4, caps: false, mat: 'sinew', maxLod: 0, tag: 'antenna' }),
      strut({ from: add(o.knee, d1, -0.07), to: add(o.knee, d1, 0.07), radius: o.radius[1] * 1.3, sides: 4, caps: false, mat: 'sinew', maxLod: 0, tag: 'antenna' }),
    );
  }
  return out;
}

export interface FeelerPairOpts {
  /** Höhe der Wurzeln (Oberkante des Sockels). */
  readonly base: number;
  /** Spreizung der Spitzen in der Vorderansicht (Grad, gesamt). */
  readonly spread: number;
  /** Höhe der Spitzen über `base`. */
  readonly height: number;
  /** Kniehöhe als Anteil von `height`. */
  readonly knee: number;
  /** Vorlage der Spitzen nach +Z. */
  readonly forward: number;
  readonly radius: number;
  /** halber Abstand der Wurzeln (Standard 0,14). */
  readonly rootX?: number;
}

/** V aus zwei geknickten Fühlern (Radar): unteres Glied steil, oberes knickt nach vorn-außen. */
export function feelerPair(o: FeelerPairOpts): Shape[] {
  const rx = o.rootX ?? 0.14;
  const tx = rx + Math.tan(((o.spread / 2) * Math.PI) / 180) * o.height;
  const r = o.radius;
  const one = (s: 1 | -1): Shape[] =>
    feeler({
      root: [s * rx, o.base - 0.06, 0],
      knee: [s * (rx + (tx - rx) * 0.3), o.base + o.height * o.knee, -0.1],
      tip: [s * tx, o.base + o.height, o.forward],
      radius: [r, r * 0.9, r * 0.3],
    });
  return [...one(1), ...one(-1)];
}

// ---------------------------------------------------------------------------------------------------------------
// Netzring (Kitbash-Part `webring`): flacher Sechseck-Ring ohne LOD-Rundung (bleibt in allen LODs sechseckig)

export interface HexRingOpts {
  readonly outer: number;
  readonly inner: number;
  readonly height: number;
  readonly at: Vec3;
  readonly mat: string;
  /** Winkel der ersten Ecke (Grad, 0 = +X), Standard 30. */
  readonly startDeg?: number;
  readonly keep?: boolean;
  readonly maxLod?: 0 | 1 | 2;
  readonly tag?: string;
}

/** Sechseck-Ring: LOD0 geschlossen (48 Tris), LOD1 ohne Unterseite (36), LOD2 nur Oberseite + Außenwand (24). */
export function hexRing(o: HexRingOpts): Shape {
  const a0 = o.startDeg ?? 30;
  const pt = (r: number, i: number, y: number): Vec3 => {
    const a = ((a0 + 60 * i) * Math.PI) / 180;
    return [o.at[0] + r * Math.cos(a), o.at[1] + y, o.at[2] + r * Math.sin(a)];
  };
  const h = o.height / 2;
  const place = { mat: o.mat, keep: o.keep ?? true, tag: o.tag ?? 'webring', ...(o.maxLod === undefined ? {} : { maxLod: o.maxLod }) };
  return primNode('webring', place, (lod) => {
    const out: Poly[] = [];
    for (let i = 0; i < 6; i++) {
      const k = i + 1;
      const mid = pt((o.outer + o.inner) / 2, i + 0.5, 0);
      const radial: Vec3 = [mid[0] - o.at[0], 0, mid[2] - o.at[2]];
      out.push(oriented([pt(o.outer, i, h), pt(o.outer, k, h), pt(o.inner, k, h), pt(o.inner, i, h)], [0, 1, 0]));
      out.push(oriented([pt(o.outer, i, -h), pt(o.outer, k, -h), pt(o.outer, k, h), pt(o.outer, i, h)], radial));
      if (lod < 1) out.push(oriented([pt(o.outer, i, -h), pt(o.inner, i, -h), pt(o.inner, k, -h), pt(o.outer, k, -h)], [0, -1, 0]));
      if (lod < 2) out.push(oriented([pt(o.inner, i, -h), pt(o.inner, i, h), pt(o.inner, k, h), pt(o.inner, k, -h)], [-radial[0], 0, -radial[2]]));
    }
    return out;
  });
}
