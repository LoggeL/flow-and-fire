/**
 * mapgen-setons — deterministic procedural generator for the map "Setons" (1,024 WU, 8 players),
 * an own rebuild after the layout of the FA classic *Seton's Clutch* (DECISIONS "Erste Karte:
 * Setons"). Source of every number: content/maps/src/setons.spec.md (§ references below). No
 * original file is used; heights, splat and props are built here from the layout description.
 *
 *   pnpm maps     (root; writes content/maps/src/setons/* and compiles content/maps/setons.rtsmap)
 *
 * Layout (x = east, z = south, exactly point-symmetric around (512, 512); team NO = upper right is
 * the canonical half, team SW its 180° mirror):
 *   - two big, deep lakes NW and SE (spec §3.1 polygons, own shorelines by domain-warped signed
 *     distance fields), shelf profile: wide shallow shelf along the beach coasts and the bridge,
 *     narrow shelf at the rock coasts (§3.2)
 *   - one diagonal land bridge in the centre = the only ground route between the teams (§5)
 *   - small elevated islands with a cliff ring and no ramp (§6), ridged corner massifs behind the
 *     air starts, a rock field of rugged ribs at the rock starts, flat boulders at the SE bay tip
 *     (§4.2), edge bays and noisy ponds (§3.1); rolling hinterland hills (§4.1, 24–36 WU)
 *   - 8 starts (army 0/1 = Mid vs Mid), 4 start mex each + 38 terrain mex per team (108 total),
 *     8 hydros (§7–§9); flat base areas (r 40 ± 8 WU, wide ramp) and flat spot pads
 *   - painted splat that fully covers the renderer's auto-splat: sand only at the beach coasts,
 *     mud on the lake beds, olive meadow with earth/dry-grass patches, rock on steep faces
 *
 * Determinism: only +, −, ×, ÷, Math.sqrt/floor/round/min/max/abs (IEEE-exact) and rng32 lattice
 * noise, so the output is byte-identical on every run and engine. The height function is built
 * symmetric (symmetric noise, mirrored feature lists), then the canonical half is mirrored
 * sample-exactly. Heights: u16 steps with heightScaleRaw 32 (1 step = 1/128 WU), water level 20 WU.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rng32 } from '@faf/fixed';
import { decodeHeightmapPng, encodeHeightmapPng, type HeightmapData } from './heightmap-io.ts';
import { MAPS_SRC_DIR } from './mapc.ts';
import { decodePng, encodePng } from './png.ts';

export const SETONS = 'setons';

const SIZE = 1024;
const DIM = SIZE + 1;
/** Height steps per WU (heightScaleRaw 32 ⇒ 4096 / 32). */
const U = 128;
const SEED = 0x5e7045c1;
const WATER = 20;
/** Splat resolution (texels per edge, 4 WU per texel). */
export const SETONS_SPLAT_RES = 256;

// -------------------------------------------------------------------------------------------------
// Layout data (canonical team NO; the SW team is the point mirror). WU unless noted.

type P = { readonly x: number; readonly z: number };

const mirror = (p: P): P => ({ x: SIZE - p.x, z: SIZE - p.z });

/** Starts §7 (NO armies 1, 3, 5, 7; SW = mirror with army − 1). */
export const SETONS_STARTS_NO: readonly { army: number; role: string; x: number; z: number }[] = [
  { army: 1, role: 'mid', x: 670, z: 346 },
  { army: 3, role: 'air', x: 922, z: 102 },
  { army: 5, role: 'rock', x: 854, z: 434 },
  { army: 7, role: 'beach', x: 658, z: 167 },
];

/** Terrain mass spots §8.2 of team NO (33 on the mainland, 5 on the island); edge spots pulled in to 12 WU. */
export const SETONS_MASS_NO: readonly P[] = [
  // Air: pair at the hydro, triangle towards mid, pond, chain towards rock
  { x: 880, z: 52 },
  { x: 882, z: 76 },
  { x: 796, z: 126 },
  { x: 776, z: 158 },
  { x: 804, z: 158 },
  { x: 830, z: 226 },
  { x: 936, z: 170 },
  { x: 936, z: 206 },
  { x: 900, z: 227 },
  // Beach: north edge cluster, hinterland, west coast, hydro, towards mid
  { x: 549, z: 16 },
  { x: 565, z: 14 },
  { x: 561, z: 33 },
  { x: 726, z: 56 },
  { x: 672, z: 118 },
  { x: 602, z: 130 },
  { x: 718, z: 174 },
  { x: 684, z: 228 },
  // Mid: north/east of the start, bridgehead, own bridge half, bridge centre (contested)
  { x: 670, z: 296 },
  { x: 720, z: 332 },
  { x: 636, z: 392 },
  { x: 676, z: 398 },
  { x: 598, z: 460 },
  { x: 654, z: 462 },
  { x: 530, z: 490 },
  // Rock: north towards air, north of the start, rock cluster, south coast, map edge at the bay
  { x: 922, z: 298 },
  { x: 992, z: 263 },
  { x: 866, z: 378 },
  { x: 902, z: 388 },
  { x: 914, z: 426 },
  { x: 936, z: 432 },
  { x: 961, z: 454 },
  { x: 858, z: 500 },
  { x: 982, z: 512 },
];

/** The 5 mass spots on the SE island (team NO, §8.2). */
export const SETONS_ISLAND_MASS_NO: readonly P[] = [
  { x: 968, z: 698 },
  { x: 980, z: 716 },
  { x: 1012, z: 718 },
  { x: 968, z: 732 },
  { x: 1012, z: 731 },
];

/** Hydros §9 (air, beach, mid, rock). */
export const SETONS_HYDRO_NO: readonly P[] = [
  { x: 899, z: 78 },
  { x: 691, z: 173 },
  { x: 722, z: 285 },
  { x: 910, z: 371 },
];

/** Start-ring radius of the 4 start mex (§8.1). */
export const START_MEX_RADIUS = 16;

/** Island of team NO (§6): elliptical plateau at the map edge. */
export const SETONS_ISLAND_NO = { x: 994, z: 722, rx: 50, rz: 54, top: 40 } as const;

/**
 * NW lake shoreline (§3.1, normalised, clockwise), without the island notch (the island is modelled
 * separately). Border points (≤ 0.011 / ≥ 0.995) are pushed beyond the map edge.
 */
const NW_LAKE: readonly (readonly [number, number])[] = [
  [0.01, 0.01],
  [0.01, 0.46],
  [0.06, 0.46],
  [0.17, 0.49],
  [0.21, 0.53],
  [0.2, 0.6],
  [0.23, 0.64],
  [0.29, 0.63],
  [0.32, 0.6],
  [0.34, 0.53],
  [0.36, 0.51],
  [0.44, 0.51],
  [0.53, 0.43],
  [0.57, 0.41],
  [0.58, 0.35],
  [0.62, 0.27],
  [0.6, 0.16],
  [0.56, 0.15],
  [0.51, 0.1],
  [0.51, 0.01],
];

/**
 * East edge bay next to the NO rock start (§3.1, x ≥ 0.96, z 0.38–0.44): a half ellipse opening to
 * the map edge (centre z, reach from the edge, half width; WU) – no axis-parallel edges that would
 * show as a rectangular deep core (review R2 P2-5).
 */
const BAY_O = { z: 420, reach: 40, half: 31 } as const;

/**
 * Pond NO (§3.1) as capsules (a → b, radius): main body at (0.84–0.86 | 0.26–0.29) and a spur to the
 * west (≈ 0.80); the outline is broken up by a domain warp ({@link pondDist}).
 */
const POND_NO: readonly (readonly [number, number, number, number, number])[] = [
  [866, 282, 874, 276, 15],
  [856, 285, 824, 281, 8],
];

/**
 * Corner mountains behind the NO air start (§4.2): footprint capsules (a → b, radius). The massif
 * inside is ridged noise that rises towards the map edge, with terraced flanks ({@link mountainAdd}).
 */
const MOUNTAINS_NO: readonly (readonly [number, number, number, number, number])[] = [
  [1046, 176, 1006, 44, 60],
  [1006, 44, 892, -14, 48],
];

/**
 * Rock field of the NO rock start (§4.2, (0.85–0.97 | 0.43–0.55)): rugged rock ribs (capsules a → b,
 * radius) with passages ≥ 12 WU to the rock-cluster and edge mex between them.
 */
const ROCK_RIBS_NO: readonly (readonly [number, number, number, number, number])[] = [
  [889, 470, 916, 534, 11],
  [940, 478, 950, 534, 9],
  [1016, 544, 1040, 492, 14],
  [970, 550, 990, 556, 7],
  [902, 552, 930, 560, 7],
];
/**
 * Rock group at the north tip of the SE lake bay (§4.2): broad, flat boulders (x, z, radius, height
 * above the ground ≤ 6 WU).
 */
const BOULDERS_NO: readonly (readonly [number, number, number, number])[] = [
  [736, 373, 10, 5.5],
  [752, 384, 9, 4.5],
  [765, 368, 8, 5],
  [746, 358, 7, 3.5],
];
/** Beach coast of team NO (§2/§3.2: NW-lake east coast x ≈ 0.50–0.62, z < 0.30); sand only here. */
const BEACH_NO = { x0: 512, x1: 635, z1: 307 } as const;
/** Width of the sand seam at the beach coast (WU, land side). */
const BEACH_WIDTH = 9;
/** Deep pocket in the NW-lake shelf (§3.2), (x, z, radius); the SE pocket is its mirror. */
const DEEP_POCKETS: readonly (readonly [number, number, number])[] = [[430, 113, 36]];

/** Bridge centre and axis (§5). */
export const BRIDGE_CENTRE: P = { x: 512, z: 512 };

// -------------------------------------------------------------------------------------------------
// Math helpers (IEEE-exact operations only)

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smoothstep on [0, 1] (argument clamped). */
function S(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth minimum (polynomial, blend width k): no crease where two distance fields meet. */
function smin(a: number, b: number, k: number): number {
  if (a === Infinity) return b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = clamp01(t);
  const ex = px - (ax + t * dx);
  const ez = pz - (az + t * dz);
  return Math.sqrt(ex * ex + ez * ez);
}

// -------------------------------------------------------------------------------------------------
// Noise: value noise on rng32 lattices (precomputed tables), symmetric variants.

class Lattice {
  readonly n: number;
  readonly v: Float64Array;
  constructor(
    readonly cell: number,
    salt: number,
  ) {
    // Covers −2 cells … SIZE + 2 cells (warped positions leave the map slightly).
    this.n = Math.floor(SIZE / cell) + 6;
    this.v = new Float64Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.v[j * this.n + i] = (rng32(SEED, j, i, salt) >>> 8) / 8388608 - 1;
  }

  /** Value noise in [−1, 1] at (x, z) WU. */
  at(x: number, z: number): number {
    const gx = x / this.cell + 2;
    const gz = z / this.cell + 2;
    let i = Math.floor(gx);
    let j = Math.floor(gz);
    let fx = gx - i;
    let fz = gz - j;
    const n = this.n;
    if (i < 0) {
      i = 0;
      fx = 0;
    }
    if (j < 0) {
      j = 0;
      fz = 0;
    }
    if (i > n - 2) {
      i = n - 2;
      fx = 1;
    }
    if (j > n - 2) {
      j = n - 2;
      fz = 1;
    }
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const k = j * n + i;
    const a = this.v[k]! + (this.v[k + 1]! - this.v[k]!) * sx;
    const b = this.v[k + n]! + (this.v[k + n + 1]! - this.v[k + n]!) * sx;
    return a + (b - a) * sz;
  }

  /** Point-symmetric value noise: same value at p and its mirror. */
  sym(x: number, z: number): number {
    return (this.at(x, z) + this.at(SIZE - x, SIZE - z)) * 0.5;
  }

  /** Point-antisymmetric noise: negated at the mirror (for domain warps). */
  anti(x: number, z: number): number {
    return (this.at(x, z) - this.at(SIZE - x, SIZE - z)) * 0.5;
  }
}

const N = {
  warpX1: new Lattice(96, 1),
  warpZ1: new Lattice(96, 2),
  warpX2: new Lattice(36, 3),
  warpZ2: new Lattice(36, 4),
  warpX3: new Lattice(12, 18),
  warpZ3: new Lattice(12, 19),
  hill1: new Lattice(160, 5),
  hill3: new Lattice(24, 7),
  hillA: new Lattice(52, 20),
  hillB: new Lattice(26, 21),
  hillR: new Lattice(64, 22),
  rough1: new Lattice(40, 8),
  rough2: new Lattice(16, 9),
  deep: new Lattice(96, 10),
  mottle: new Lattice(34, 30),
  shelf: new Lattice(80, 11),
  ridge2: new Lattice(14, 13),
  ridgeA: new Lattice(40, 32),
  ridgeB: new Lattice(18, 33),
  ridgeC: new Lattice(8, 34),
  mtn1: new Lattice(44, 23),
  mtn2: new Lattice(20, 24),
  mtn3: new Lattice(9, 25),
  rib: new Lattice(12, 26),
  pondX: new Lattice(16, 27),
  pondZ: new Lattice(16, 28),
  baseR: new Lattice(30, 29),
  island: new Lattice(20, 14),
  islandA: new Lattice(26, 35),
  islandB: new Lattice(15, 36),
  shoreA: new Lattice(11, 37),
  shoreB: new Lattice(6, 38),
  patch: new Lattice(48, 15),
  patch2: new Lattice(20, 16),
  patch3: new Lattice(72, 31),
  moss: new Lattice(32, 17),
} as const;

// -------------------------------------------------------------------------------------------------
// Signed distance to polygons (negative inside).

class Poly {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  /** 1 = segment (j → i) lies beyond one map edge: counts for inside/outside, not as shoreline. */
  readonly border: Uint8Array;
  constructor(pts: readonly P[]) {
    this.xs = Float64Array.from(pts.map((p) => p.x));
    this.zs = Float64Array.from(pts.map((p) => p.z));
    const n = pts.length;
    this.border = new Uint8Array(n);
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = pts[j]!;
      const b = pts[i]!;
      const out = (a.x < 0 && b.x < 0) || (a.z < 0 && b.z < 0) || (a.x > SIZE && b.x > SIZE) || (a.z > SIZE && b.z > SIZE);
      this.border[i] = out ? 1 : 0;
    }
  }

  /**
   * Signed distance to the shoreline (negative inside). Segments beyond the map edge are no shore:
   * the depth keeps growing up to the map edge (§3.2: the deep core reaches the border).
   */
  sdf(px: number, pz: number): number {
    const xs = this.xs;
    const zs = this.zs;
    const n = xs.length;
    let best = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = xs[j]!;
      const az = zs[j]!;
      const bx = xs[i]!;
      const bz = zs[i]!;
      if (this.border[i] === 0) {
        const d = segDist(px, pz, ax, az, bx, bz);
        if (d < best) best = d;
      }
      if (az > pz !== bz > pz && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) inside = !inside;
    }
    return inside ? -best : best;
  }
}

/**
 * Normalised polygon → WU, border points pushed out by 60 WU, corners rounded (Chaikin ×3, vertex
 * form; ×2 left visible kinks every 20–40 WU, review R2 P2-4). Vertices beyond the map edge stay fixed, so the rounding never cuts a map corner off the
 * lake (that left a tiny land corner and a shallow rim along the border).
 */
function polyWu(pts: readonly (readonly [number, number])[]): P[] {
  const out0 = (v: number): number => (v <= 0.011 ? -60 : v >= 0.995 ? SIZE + 60 : v * SIZE);
  const outside = (p: P): boolean => p.x < 0 || p.z < 0 || p.x > SIZE || p.z > SIZE;
  let p: P[] = pts.map(([x, z]) => ({ x: out0(x), z: out0(z) }));
  for (let it = 0; it < 3; it++) {
    const q: P[] = [];
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const v = p[i]!;
      if (outside(v)) {
        q.push(v);
        continue;
      }
      const a = p[(i + n - 1) % n]!;
      const b = p[(i + 1) % n]!;
      q.push({ x: v.x * 0.75 + a.x * 0.25, z: v.z * 0.75 + a.z * 0.25 });
      q.push({ x: v.x * 0.75 + b.x * 0.25, z: v.z * 0.75 + b.z * 0.25 });
    }
    p = q;
  }
  return p;
}

const LAKE_NW = new Poly(polyWu(NW_LAKE));
const LAKE_SE = new Poly(polyWu(NW_LAKE).map(mirror));
/** Half-ellipse bay at the east edge (15° steps), closed by two points beyond the edge. */
function bayPoly(b: { z: number; reach: number; half: number }): P[] {
  const pts: P[] = [{ x: SIZE + 60, z: b.z - b.half }];
  for (let k = -6; k <= 6; k++) {
    const a = (k * Math.PI) / 12;
    // SIZE + 4: the ellipse ends just beyond the edge, so the mouth meets the border at full width.
    pts.push({ x: SIZE + 4 - (b.reach + 4) * Math.cos(a), z: b.z + b.half * Math.sin(a) });
  }
  pts.push({ x: SIZE + 60, z: b.z + b.half });
  return pts;
}

const BAY_E = new Poly(bayPoly(BAY_O));
const BAY_W = new Poly(bayPoly(BAY_O).map(mirror));

type Capsule = readonly [number, number, number, number, number];
const mirrorCapsule = (c: Capsule): Capsule => [SIZE - c[0], SIZE - c[1], SIZE - c[2], SIZE - c[3], c[4]];
const both = <T>(list: readonly T[], m: (v: T) => T): T[] => [...list, ...list.map(m)];

const PONDS = both(POND_NO, mirrorCapsule);
const MOUNTAINS = both(MOUNTAINS_NO, mirrorCapsule);
const ROCK_RIBS = both(ROCK_RIBS_NO, mirrorCapsule);
const BOULDERS = both(BOULDERS_NO, (b) => [SIZE - b[0], SIZE - b[1], b[2], b[3]] as const);
const POCKETS = both(DEEP_POCKETS, (b) => [SIZE - b[0], SIZE - b[1], b[2]] as const);
const ISLANDS = [SETONS_ISLAND_NO, { ...SETONS_ISLAND_NO, ...mirror(SETONS_ISLAND_NO) }];
const STARTS_ALL: P[] = both(SETONS_STARTS_NO as readonly P[], mirror);
/** Rock-start centres (rugged terrain around them). */
const ROCK_STARTS: P[] = both([SETONS_STARTS_NO[2]!], mirror);

function capsuleDist(c: Capsule, x: number, z: number): number {
  return segDist(x, z, c[0], c[1], c[2], c[3]) - c[4];
}

/** Every mass/hydro spot (both teams), start ring included; `island` marks the island spots. */
export function setonsSpots(): { kind: 'mass' | 'hydro'; x: number; z: number; island: boolean }[] {
  const out: { kind: 'mass' | 'hydro'; x: number; z: number; island: boolean }[] = [];
  const teamNo: { kind: 'mass' | 'hydro'; x: number; z: number; island: boolean }[] = [];
  for (const s of SETONS_STARTS_NO) {
    const r = START_MEX_RADIUS;
    for (const [dx, dz] of [
      [r, 0],
      [0, r],
      [-r, 0],
      [0, -r],
    ] as const) {
      teamNo.push({ kind: 'mass', x: s.x + dx, z: s.z + dz, island: false });
    }
  }
  for (const p of SETONS_MASS_NO) teamNo.push({ kind: 'mass', ...p, island: false });
  for (const p of SETONS_ISLAND_MASS_NO) teamNo.push({ kind: 'mass', ...p, island: true });
  for (const p of SETONS_HYDRO_NO) teamNo.push({ kind: 'hydro', ...p, island: false });
  for (const s of teamNo) out.push(s);
  for (const s of teamNo) out.push({ ...s, ...mirror(s) });
  return out;
}

const SPOTS = setonsSpots();
const LAND_SPOTS = SPOTS.filter((s) => !s.island);
const ISLAND_SPOTS = SPOTS.filter((s) => s.island);

// -------------------------------------------------------------------------------------------------
// Height function

interface Water {
  /** Signed distance to lakes + bays (after protection), negative inside. */
  readonly lake: number;
  /** Signed distance to the ponds, negative inside. */
  readonly pond: number;
  /** Shelf width of the nearest lake at this point. */
  readonly shelf: number;
  /** True if the nearest water body is a bay (narrow shelf). */
  readonly bay: boolean;
}

/** Shelf width (§3.2) for a point of the NW lake: wide along the beach coast and the bridge flank. */
function shelfNw(x: number, z: number): number {
  const xn = x / SIZE;
  return 20 + 50 * S((xn - 0.33) / 0.14) + 8 * N.shelf.at(x, z);
}

/** Signed distance to the ponds (negative inside); the capsule outline is domain-warped (§3.1, P3-1). */
function pondDist(x: number, z: number): number {
  const wx = x + 7 * N.pondX.at(x, z);
  const wz = z + 7 * N.pondZ.at(x, z);
  let d = Infinity;
  for (const c of PONDS) d = Math.min(d, capsuleDist(c, wx, wz));
  return d + 1.5 * N.rib.at(x, z);
}

/**
 * Fine shoreline noise (WU, symmetric), added to the lake/bay signed distance. Half amplitude at the
 * bridge neck plus a small land bias there (keeps its narrowest point at 72–80 WU), none around the
 * starts (the flat base areas need their land margin). `dc` = distance to the bridge centre.
 */
function shoreNoise(x: number, z: number, dc: number): number {
  let keep = 1;
  for (const s of STARTS_ALL) {
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < 120 * 120) keep = Math.min(keep, S((Math.sqrt(dx * dx + dz * dz) - 70) / 50));
  }
  const neck = 1 - S((dc - 40) / 100);
  return (9 * N.shoreA.sym(x, z) + 4 * N.shoreB.sym(x, z)) * keep * (1 - 0.5 * neck) + BRIDGE_BIAS * neck;
}
/** Land bias (WU) of the shoreline at the bridge neck. */
const BRIDGE_BIAS = 2.5;

function waterAt(x: number, z: number): Water {
  const dc = Math.sqrt((x - BRIDGE_CENTRE.x) * (x - BRIDGE_CENTRE.x) + (z - BRIDGE_CENTRE.z) * (z - BRIDGE_CENTRE.z));
  // Domain warp (antisymmetric ⇒ symmetric shorelines); calmer at the bridge.
  const amp = 15 * (0.2 + 0.8 * S((dc - 80) / 160));
  const wx = x + amp * (N.warpX1.anti(x, z) * 0.75 + N.warpX2.anti(x, z) * 0.35 + N.warpX3.anti(x, z) * 0.15);
  const wz = z + amp * (N.warpZ1.anti(x, z) * 0.75 + N.warpZ2.anti(x, z) * 0.35 + N.warpZ3.anti(x, z) * 0.15);
  const nw = LAKE_NW.sdf(wx, wz);
  const se = LAKE_SE.sdf(wx, wz);
  const be = BAY_E.sdf(wx, wz);
  const bw = BAY_W.sdf(wx, wz);
  const bay = Math.min(be, bw) < Math.min(nw, se);
  // Fine shoreline noise (≈ 15–30 WU wavelength, ±3–6 WU; symmetric ⇒ symmetric shores) on top of the
  // coarse warp: breaks up the straight shore pieces between the polygon corners (review R2 P2-4).
  let lake = Math.min(nw, se, be, bw) + shoreNoise(x, z, dc);
  // Keep every start (r 56) and land spot (r 16) on dry land.
  for (const s of STARTS_ALL) {
    const r = Math.sqrt((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z));
    if (56 - r > lake) lake = 56 - r;
  }
  for (const s of LAND_SPOTS) {
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < 256) {
      const r = Math.sqrt(dx * dx + dz * dz);
      if (16 - r > lake) lake = 16 - r;
    }
  }
  const shelf = bay ? 8 : nw <= se ? shelfNw(x, z) : shelfNw(SIZE - x, SIZE - z);
  return { lake, pond: pondDist(x, z), shelf, bay };
}

/** Lake/bay bed (WU) at depth-distance e > 0 inside the water. */
function lakeBed(e: number, w: Water, x: number, z: number): number {
  let bed: number;
  if (w.bay) {
    bed = e <= 3 ? WATER - 0.2 * e : 19.4 - 10.4 * S((e - 3) / 26);
    // Uneven bed like the lakes: no flat core that repeats the outline.
    bed += (1.8 * N.mottle.sym(x, z) + 1.2 * N.deep.sym(x, z)) * S((e - 5) / 14);
  } else {
    const W = w.shelf;
    if (e <= 4) bed = WATER - 0.15 * e;
    else if (e <= 4 + W) bed = 19.4 - 3.4 * S((e - 4) / W);
    else if (e <= 49 + W) bed = 16 - 5 * S((e - 4 - W) / 45);
    else bed = 11 - 5 * S((e - 49 - W) / 90);
    // Softly undulating bed (§4.1) → mottled deep water.
    bed += 2 * N.deep.sym(x, z) * S((e - W - 30) / 60) + 1.4 * N.mottle.sym(x, z) * S((e - W - 12) / 40);
    for (const [px, pz, r] of POCKETS) {
      const d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
      if (d < r) bed = Math.min(bed, lerp(bed, 9, 1 - S(d / r)));
    }
    if (bed < 4.4) bed = 4.4;
  }
  return bed;
}

/** Land height at distance d > 0 from the nearest water. */
function landRise(d: number): number {
  if (d <= 10) return WATER + 0.12 * d;
  if (d <= 70) return 21.2 + 4.8 * S((d - 10) / 60);
  return 26 + Math.min(4, 0.02 * (d - 70));
}

/** 1 on the land bridge (±190 WU along the axis from the centre, ±100 WU across), 0 away from it. */
function bridgeMask(x: number, z: number): number {
  const along = Math.abs(x - z) / Math.SQRT2;
  const across = Math.abs(x + z - SIZE) / Math.SQRT2;
  return (1 - S((along - 190) / 90)) * (1 - S((across - 100) / 60));
}

/**
 * Rolling hinterland hills (§4.1: 24–36 WU, slope < 0.4): main wavelength ≈ 100 WU (52-WU lattice),
 * a ridged component for visible hill crests, biased upwards and softly limited below.
 */
function hills(x: number, z: number): number {
  let v = 3 * N.hill1.sym(x, z) + 8 * N.hillA.sym(x, z) + 2.4 * N.hillB.sym(x, z) + 0.6 * N.hill3.sym(x, z);
  const r = 1 - Math.abs(N.hillR.sym(x, z));
  v += 3.2 * (r * r - 0.4) + 2.2;
  if (v < -3) v = -3 + 0.3 * (v + 3);
  return v;
}

/** Base terrain: lakes, bays, ponds, land with hills, islands (before flattening and rocks). */
function baseHeight(x: number, z: number): number {
  const w = waterAt(x, z);
  const d = Math.min(w.lake, w.pond);
  let h: number;
  if (w.lake < 0) h = lakeBed(-w.lake, w, x, z);
  else if (w.pond < 0) h = WATER - 1.5 * S(-w.pond / 3.5);
  else {
    h = landRise(d);
    h += hills(x, z) * S((d - 8) / 70) * (1 - 0.9 * bridgeMask(x, z));
    let rough = 0;
    for (const r of ROCK_STARTS) {
      const dr = Math.sqrt((x - r.x) * (x - r.x) + (z - r.z) * (z - r.z));
      rough = Math.max(rough, 1 - S((dr - 40) / 120));
    }
    if (rough > 0) h += rough * (2 * N.rough1.sym(x, z) + 0.8 * N.rough2.sym(x, z) + 1.5) * S((d - 6) / 30);
  }
  for (const isl of ISLANDS) h = Math.max(h, islandHeight(isl, x, z));
  return h;
}

type Island = { x: number; z: number; rx: number; rz: number; top: number };

/**
 * Signed distance-like plateau edge of an island (WU, negative on the plateau): the §6 ellipse with
 * 2–3 bulges and bays (noise ±10–15 WU, wavelength ≈ 30–60 WU, review R2 P2-6); the island mex keep
 * ≥ 20 WU of plateau around them. +∞ far away.
 */
function islandEdge(isl: Island, x: number, z: number): number {
  const dx = (x - isl.x) / isl.rx;
  const dz = (z - isl.z) / isl.rz;
  const q = Math.sqrt(dx * dx + dz * dz);
  if (q > 3) return Infinity;
  let s = (q - 1) * Math.min(isl.rx, isl.rz) + 26 * N.islandA.sym(x, z) + 3 * N.island.sym(x, z);
  for (const m of ISLAND_SPOTS) {
    const ex = x - m.x;
    const ez = z - m.z;
    if (ex * ex + ez * ez < 60 * 60) s = smin(s, Math.sqrt(ex * ex + ez * ez) - 20, 10);
  }
  return s;
}

/** Plateau edge of the nearest island (see {@link islandEdge}). */
function islandS(x: number, z: number): number {
  let s = Infinity;
  for (const isl of ISLANDS) s = Math.min(s, islandEdge(isl, x, z));
  return s;
}

/**
 * Island plateau with cliff ring and underwater skirt (§6, §4.1); −∞ far away. The cliff varies in
 * height (lower rim sections) and width (≈ 6–12 WU) and has a craggy face; low rock outcrops
 * (≤ 2 WU blobs) break up the top away from the mex.
 */
function islandHeight(isl: Island, x: number, z: number): number {
  const s = islandEdge(isl, x, z);
  if (s === Infinity) return -Infinity;
  const nb = N.islandB.sym(x, z);
  // Top: 40 inside, the rim dips or rises by up to ≈ 3 WU (varying cliff height).
  const top = isl.top + 1.2 * N.hill3.sym(x, z) * S(-s / 8) + 6 * nb * (1 - S(-s / 14));
  const foot = 17 + 3 * N.islandA.sym(x, z);
  const cw = 9 + 6 * N.island.sym(x, z);
  if (s <= 0) {
    let dm = Infinity;
    for (const m of ISLAND_SPOTS) dm = Math.min(dm, (x - m.x) * (x - m.x) + (z - m.z) * (z - m.z));
    const blob = 0.6 * N.islandB.sym(x, z) + 0.4 * N.mtn3.sym(x, z);
    const outcrop = (1.4 * S((blob - 0.12) / 0.2) + 0.5 * N.ridge2.sym(x, z)) * S((Math.sqrt(dm) - 9) / 6) * S(-s / 4);
    return top + outcrop;
  }
  if (s <= cw) {
    const t = s / cw;
    return top - (top - foot) * t + 1.8 * N.mtn3.sym(x, z) * (1 - Math.abs(2 * t - 1));
  }
  return foot - 0.3 * (s - cw);
}

/** Distance to the (noisy) mountain footprint, negative inside (outline ±12 WU around the capsules). */
function mountainDist(x: number, z: number): number {
  let d = Infinity;
  for (const c of MOUNTAINS) d = smin(d, capsuleDist(c, x, z), 40);
  if (d > 30) return d;
  return d + 2 + 7 * N.mtn1.at(x, z) + 3 * N.mtn2.at(x, z);
}

/** 0 within 40 WU of a start, 1 from 64 WU on: keeps the massif off the base areas. */
function awayFromStarts(x: number, z: number): number {
  let m = 1;
  for (const s of STARTS_ALL) {
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < 64 * 64) m = Math.min(m, S((Math.sqrt(dx * dx + dz * dz) - 40) / 24));
  }
  return m;
}

/**
 * Corner massif (§4.1: 45–75 WU, ridges higher towards the map edge): ridged multi-octave noise on
 * stepped flanks (foothills ≲ 0.7, main massif ≳ 1.5 instead of one wall). Height above the ground.
 */
function mountainAdd(x: number, z: number): number {
  const d = mountainDist(x, z);
  if (d >= 0) return 0;
  const t = clamp01(-d / 60);
  const e = Math.min(x, z, SIZE - x, SIZE - z);
  const edge = 1 - clamp01(e / 170);
  const r1 = 1 - Math.abs(N.ridgeA.at(x, z));
  const r2 = 1 - Math.abs(N.ridgeB.at(x, z));
  const r3 = 1 - Math.abs(N.ridgeC.at(x, z));
  const ridge = 0.55 * r1 * r1 + 0.3 * r2 * r2 * r1 + 0.15 * r3 * r2;
  // Stepped flanks: a foothill ramp (slope ≲ 0.7), then the steeper main massif (≳ 1.5) from a
  // noisy break line on.
  const foot = 10 * S(t / 0.35);
  const main = (6 + 16 * edge + 16 * ridge * (0.4 + 0.6 * edge)) * S((t - 0.22 - 0.12 * N.mtn2.at(x, z)) / 0.3);
  const a = (foot + main) * awayFromStarts(x, z);
  return a + 2.5 * N.mtn3.at(x, z) * t;
}

/** Position of (x, z) along a capsule's axis, 0 at a … 1 at b. */
function capsuleParam(c: Capsule, x: number, z: number): number {
  const dx = c[2] - c[0];
  const dz = c[3] - c[1];
  const len2 = dx * dx + dz * dz;
  return len2 === 0 ? 0.5 : clamp01(((x - c[0]) * dx + (z - c[1]) * dz) / len2);
}

/** Rock field around the NO rock ribs (§4.2, (0.85–0.97 | 0.43–0.55)): 1 inside, 0 outside. */
function rockFieldMask(x: number, z: number): number {
  let m = 0;
  for (const c of ROCK_RIBS) m = Math.max(m, 1 - S((capsuleDist(c, x, z) - 6) / 22));
  return m;
}

/**
 * Rock ribs of the rock field (§4.2, slope > 1): rugged capsules with a wobbling outline, tapered
 * ends and a ridged crest, plus low crags between them. Height above the ground.
 */
function ribAdd(x: number, z: number): number {
  let best = 0;
  for (const c of ROCK_RIBS) {
    const d0 = capsuleDist(c, x, z);
    if (d0 > 8) continue;
    const d = d0 + 3.5 * N.rib.at(x, z) + 1.8 * N.mtn3.at(x, z);
    if (d >= 0) continue;
    const t = clamp01(-d / c[4]);
    const u = capsuleParam(c, x, z);
    const taper = 1 - 0.45 * (2 * u - 1) * (2 * u - 1);
    const r = 1 - Math.abs(N.mtn2.at(x, z));
    const crag = 1 - Math.abs(N.ridgeC.at(x, z));
    const a = ((5 + 7 * r) * S(t * 1.5) + 3 * r * r * t) * taper + (2.2 * crag * crag - 0.8 + 1.4 * N.mtn3.at(x, z)) * S(t * 2);
    if (a > best) best = a;
  }
  // Crags between the ribs (≤ 2.5 WU, keeps the passages drivable).
  const field = rockFieldMask(x, z) * awayFromStarts(x, z);
  if (field > 0) {
    best = Math.max(best, field * 2.5 * S((N.ridgeB.at(x, z) - 0.3) / 0.35));
  }
  return best;
}

/** Broad, flat boulders of the rock group at the bay tip (§4.2), height above the ground (≤ 6 WU). */
function boulderAdd(x: number, z: number): number {
  let best = 0;
  for (const [bx, bz, r, hb] of BOULDERS) {
    const dx = x - bx;
    const dz = z - bz;
    if (dx * dx + dz * dz >= (r + 3) * (r + 3)) continue;
    const d = Math.sqrt(dx * dx + dz * dz) + 2.5 * N.rib.at(x, z) + 1.5 * N.mtn3.at(x, z);
    if (d >= r) continue;
    const t = 1 - d / r;
    const crag = 1 - Math.abs(N.ridgeC.at(x, z));
    const a = hb * S(t * 2.2) * (0.7 + 0.3 * crag) + (1.2 * N.mtn3.at(x, z) + 0.8 * N.ridge2.at(x, z)) * S(t * 2.5);
    if (a > best) best = a;
  }
  return best;
}

/** Rocks added on top of the flattened base: mountains, rock ribs, boulders. */
function rockAdd(x: number, z: number): number {
  return Math.max(mountainAdd(x, z), ribAdd(x, z), boulderAdd(x, z));
}

// -------------------------------------------------------------------------------------------------
// Heightfield assembly

/** Canonical half: x > z, or on the diagonal the half with x ≥ 512 (the centre maps to itself). */
function isCanonical(x: number, z: number): boolean {
  return x > z || (x === z && x >= SIZE >> 1);
}

function mirrorFill(h: Float64Array): void {
  for (let z = 0; z < DIM; z++) {
    for (let x = 0; x < DIM; x++) {
      if (!isCanonical(x, z)) h[z * DIM + x] = h[(SIZE - z) * DIM + (SIZE - x)]!;
    }
  }
}

function forCanonical(fn: (x: number, z: number, i: number) => void): void {
  for (let z = 0; z < DIM; z++) for (let x = 0; x < DIM; x++) if (isCanonical(x, z)) fn(x, z, z * DIM + x);
}

/**
 * Flattens discs: fully flat inside rFlat, blended out to rBlend, towards the height at the centre.
 * Where discs overlap, the disc with the highest weight wins (pads stay exactly flat).
 */
function flatten(h: Float64Array, centres: readonly P[], rFlat: number, rBlend: number, target: (hc: number) => number): void {
  const targets = centres.map((c) => target(h[c.z * DIM + c.x]!));
  forCanonical((x, z, i) => {
    let best = 0;
    let bestK = -1;
    for (let k = 0; k < centres.length; k++) {
      const c = centres[k]!;
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz >= rBlend * rBlend) continue;
      const w = 1 - S((Math.sqrt(dx * dx + dz * dz) - rFlat) / (rBlend - rFlat));
      if (w > best) {
        best = w;
        bestK = k;
      }
    }
    if (bestK >= 0) h[i] = lerp(h[i]!, targets[bestK]!, best);
  });
  mirrorFill(h);
}

/** Flat radius of the base areas (§4.1: r ≈ 40): 40 ± 6 WU, noisy so the bases show no circle stamp. */
function baseFlatRadius(x: number, z: number): number {
  return 40 + 8 * N.baseR.sym(x, z);
}
/** Width of the blend ramp around a base area (WU). */
const BASE_RAMP = 52;

/** Flat base areas (26–30 WU) with a noisy radius and a wide ramp (P2-6). */
function flattenBases(h: Float64Array): void {
  const targets = STARTS_ALL.map((c) => Math.min(29.5, Math.max(26.5, h[c.z * DIM + c.x]!)));
  const reach = 48 + BASE_RAMP;
  forCanonical((x, z, i) => {
    let best = 0;
    let bestK = -1;
    for (let k = 0; k < STARTS_ALL.length; k++) {
      const c = STARTS_ALL[k]!;
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz >= reach * reach) continue;
      const w = 1 - S((Math.sqrt(dx * dx + dz * dz) - baseFlatRadius(x, z)) / BASE_RAMP);
      if (w > best) {
        best = w;
        bestK = k;
      }
    }
    // Only land is levelled: the ramp never lifts the shore or the shelf out of the water.
    if (bestK >= 0) h[i] = lerp(h[i]!, targets[bestK]!, best * S((h[i]! - 20.6) / 2.5));
  });
  mirrorFill(h);
}

/**
 * Separable [1 2 1] / 4 blur, `passes` times (edges clamped). Symmetric kernel ⇒ a point-symmetric
 * field stays symmetric up to float rounding; callers mirror the canonical half again afterwards.
 */
function blur121(f: Float64Array, passes: number): void {
  const tmp = new Float64Array(f.length);
  for (let p = 0; p < passes; p++) {
    for (let z = 0; z < DIM; z++) {
      const row = z * DIM;
      for (let x = 0; x < DIM; x++) {
        const l = f[row + (x > 0 ? x - 1 : 0)]!;
        const r = f[row + (x < SIZE ? x + 1 : SIZE)]!;
        tmp[row + x] = (l + 2 * f[row + x]! + r) * 0.25;
      }
    }
    for (let z = 0; z < DIM; z++) {
      const up = (z > 0 ? z - 1 : 0) * DIM;
      const dn = (z < SIZE ? z + 1 : SIZE) * DIM;
      for (let x = 0; x < DIM; x++) f[z * DIM + x] = (tmp[up + x]! + 2 * tmp[z * DIM + x]! + tmp[dn + x]!) * 0.25;
    }
  }
}

/** Terrain heights in WU (float, exactly point-symmetric). */
export function generateSetonsHeightsWu(): Float64Array {
  const h = new Float64Array(DIM * DIM);
  forCanonical((x, z, i) => {
    h[i] = baseHeight(x, z);
  });
  mirrorFill(h);
  flattenBases(h);
  // Rocks are soft-edged before they are added (and quantised): steep capsule/rib/boulder flanks
  // otherwise show as saw-tooth edges on the 1-WU grid (review R2 P3-2).
  const rock = new Float64Array(DIM * DIM);
  forCanonical((x, z, i) => {
    rock[i] = rockAdd(x, z);
  });
  mirrorFill(rock);
  blur121(rock, 1);
  forCanonical((_x, _z, i) => {
    h[i] = h[i]! + rock[i]!;
  });
  mirrorFill(h);
  // Flat pads for mass/hydro spots (§11: r ≈ 6 WU).
  flatten(
    h,
    SPOTS.map((s) => ({ x: s.x, z: s.z })),
    4,
    16,
    (hc) => hc,
  );
  return h;
}

/** Generates the heightmap (dim² u16 steps), exactly point-symmetric. */
export function generateSetonsHeights(wu: Float64Array = generateSetonsHeightsWu()): HeightmapData {
  const samples = new Uint16Array(DIM * DIM);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(0, Math.min(0xffff, Math.round(wu[i]! * U)));
  // Mirror once more on the integer samples (bit-exact symmetry independent of float rounding).
  for (let z = 0; z < DIM; z++) {
    for (let x = 0; x < DIM; x++) if (!isCanonical(x, z)) samples[z * DIM + x] = samples[(SIZE - z) * DIM + (SIZE - x)]!;
  }
  return { dim: DIM, samples };
}

// -------------------------------------------------------------------------------------------------
// Splat (8 layers in two RGBA planes)
//   plane 0: R sand, G grass, B rock, A highland
//   plane 1: R dirt, G dry grass, B dark rock, A moss
// The renderer lerps the painted layers in channel order over its auto-splat. The generator first
// decides the final weight of every layer (sum 1) and then encodes lerp factors that reproduce them
// exactly: plane 0 has R = 1, so it covers the auto-splat (and its shore band) completely – the
// painted distribution alone decides (P1-3). Plane 1 reproduces layers 4–7 on top. Plane 0 holds a
// 4-layer approximation of the full mix (dirt → rock/grass, dry grass → sand/grass, dark rock →
// rock, moss → grass) for presets that only use 4 layers.

const L_SAND = 0;
const L_GRASS = 1;
const L_ROCK = 2;
const L_HIGH = 3;
const L_DIRT = 4;
const L_DRY = 5;
const L_DARK = 6;
const L_MOSS = 7;

/** Slope (height gradient) over ±2 samples, i.e. over one 4-WU splat texel. */
function slopeAt(h: Float64Array, x: number, z: number): number {
  const xi = Math.max(2, Math.min(SIZE - 2, Math.round(x)));
  const zi = Math.max(2, Math.min(SIZE - 2, Math.round(z)));
  const gx = (h[zi * DIM + xi + 2]! - h[zi * DIM + xi - 2]!) * 0.25;
  const gz = (h[(zi + 2) * DIM + xi]! - h[(zi - 2) * DIM + xi]!) * 0.25;
  return Math.sqrt(gx * gx + gz * gz);
}

function byte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Paints `amount` of `layer` over the weights, like one lerp step of the renderer (sum stays 1). */
function paint(w: Float64Array, layer: number, amount: number): void {
  const a = clamp01(amount);
  if (a <= 0) return;
  for (let k = 0; k < 8; k++) w[k] = w[k]! * (1 - a);
  w[layer] = w[layer]! + a;
}

/** Lerp factor that gives weight `wk` out of the weight `rest` still uncovered. */
function factor(wk: number, rest: number): number {
  return rest > 1e-6 ? clamp01(wk / rest) : 0;
}

/** 1 along the beach coasts (§3.2; NO: x ≈ 0.50–0.62, z < 0.30, the SW beach is the mirror). */
function beachZone(x: number, z: number): number {
  return S((x - BEACH_NO.x0 + 10) / 20) * (1 - S((x - BEACH_NO.x1) / 20)) * (1 - S((z - BEACH_NO.z1) / 25));
}

/** Final weights of the 8 layers at a canonical point (sum 1). */
function splatWeights(w: Float64Array, heightsWu: Float64Array, x: number, z: number): void {
  const h = heightsWu[Math.round(z) * DIM + Math.round(x)]!;
  const slope = slopeAt(heightsWu, x, z);
  const wa = waterAt(x, z);
  const shore = Math.min(wa.lake, wa.pond);
  const patch = N.patch.sym(x, z) * 0.7 + N.patch2.sym(x, z) * 0.3;
  const patchB = N.patch3.sym(x, z) * 0.7 + N.moss.sym(x, z) * 0.3;
  const beach = beachZone(x, z);

  w.fill(0);
  w[L_GRASS] = 1;
  // Olive meadow with dry-grass and earth patches, moss in damp hollows.
  paint(w, L_DRY, 0.5 * S((patchB + 0.05) / 0.4));
  paint(w, L_DIRT, 0.42 * S((patch + 0.02) / 0.42));
  paint(w, L_MOSS, 0.35 * S((N.moss.sym(x, z) + 0.15) / 0.5) * (1 - S((h - 23) / 3)));
  // Non-beach shores (rock coasts, bridge flanks, ponds): moss and grass down to the water line.
  paint(w, L_MOSS, 0.5 * (1 - S((shore - 1) / 7)) * (1 - beach));
  // Trodden earth on the bases (noisy radius, wide soft edge – no circle stamp) and on the bridge.
  let base = 0;
  for (const s of STARTS_ALL) {
    const r = Math.sqrt((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z));
    if (r < 110) base = Math.max(base, 1 - S((r - 22 - 10 * N.baseR.sym(x, z)) / 40));
  }
  paint(w, L_DIRT, base * (0.3 + 0.25 * S((patch + 0.2) / 0.5)));
  paint(w, L_DIRT, bridgeMask(x, z) * (0.1 + 0.25 * S((patch + 0.2) / 0.6)));
  // Rock-start surroundings: patchy rock.
  let rockZone = 0;
  for (const r of ROCK_STARTS) rockZone = Math.max(rockZone, 1 - S((Math.sqrt((x - r.x) * (x - r.x) + (z - r.z) * (z - r.z)) - 60) / 110));
  paint(w, L_ROCK, rockZone * 0.45 * S((patch + 0.35) / 0.5));
  paint(w, L_ROCK, rockFieldMask(x, z) * 0.45);
  // Lake and pond bed: dark mud instead of sand (seen through the water).
  const under = S((WATER + 0.2 - h) / 0.8);
  paint(w, L_DIRT, under * 0.75);
  paint(w, L_MOSS, under * 0.35 * S((N.moss.sym(x, z) + 0.3) / 0.6));
  paint(w, L_DARK, under * 0.35 * S((WATER - 4 - h) / 6));
  // Sand: a narrow seam (≤ BEACH_WIDTH WU on land) along the beach coasts only, continuing a little
  // under the shallow water.
  const sandLand = 1 - S((wa.lake - (BEACH_WIDTH - 3)) / 3);
  const sandWater = 1 - S((-wa.lake - 8) / 8);
  paint(w, L_SAND, beach * (wa.lake >= 0 ? sandLand : sandWater) * 0.95);
  // Island tops: weathered rock and highland patches between the grass.
  // Island tops (review R2 P2-6): grey weathered rock and pale highland patches between the grass,
  // rock on the outcrops; grass kept around the mex.
  const isl = 1 - S((islandS(x, z) + 1) / 4);
  let dmi = Infinity;
  for (const m of ISLAND_SPOTS) dmi = Math.min(dmi, Math.sqrt((x - m.x) * (x - m.x) + (z - m.z) * (z - m.z)));
  const islRock = isl * S((dmi - 5 + 6 * N.moss.sym(x, z)) / 8);
  const blob = 0.6 * N.islandB.sym(x, z) + 0.4 * N.mtn3.sym(x, z);
  paint(w, L_ROCK, islRock * (0.35 + 0.45 * S((N.patch2.sym(x, z) + 0.15) / 0.5)));
  paint(w, L_HIGH, islRock * 0.5 * S((patch + 0.05) / 0.45));
  paint(w, L_DARK, islRock * 0.35 * S((blob - 0.1) / 0.25));
  // Corner massif, rock ribs, boulders.
  const mount = S(mountainAdd(x, z) / 6);
  paint(w, L_ROCK, mount * 0.6);
  const rib = S(ribAdd(x, z) / 5);
  paint(w, L_ROCK, rib * 0.85);
  paint(w, L_DARK, rib * 0.3 * S((N.ridge2.at(x, z) + 0.2) / 0.6));
  paint(w, L_ROCK, S(boulderAdd(x, z) / 2.5) * 0.9);
  // Steep faces: rock with darker streaks; high ridges: pale highland.
  const steep = S((slope - 0.55) / 0.45);
  paint(w, L_ROCK, steep * 0.9);
  paint(w, L_DARK, steep * 0.25 * S((patch + 0.2) / 0.6));
  paint(w, L_HIGH, mount * 0.85 * S((h - 50) / 14));
}

/** Two RGBA8 planes (res² texels) derived from the heights and the layout. */
export function generateSetonsSplat(heightsWu: Float64Array, res = SETONS_SPLAT_RES): [Uint16Array, Uint16Array] {
  const p0 = new Uint16Array(res * res * 4);
  const p1 = new Uint16Array(res * res * 4);
  const step = SIZE / res;
  const w = new Float64Array(8);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      // Texel centre; evaluate at the canonical point so the splat is point-symmetric as well.
      let x = (i + 0.5) * step;
      let z = (j + 0.5) * step;
      if (!(x > z || (x === z && x >= SIZE / 2))) {
        x = SIZE - x;
        z = SIZE - z;
      }
      splatWeights(w, heightsWu, x, z);
      const o = (j * res + i) * 4;
      // Plane 1 (dirt, dry, dark, moss), lerped last: factors from the back.
      let rest = 1;
      const fMoss = factor(w[L_MOSS]!, rest);
      rest -= w[L_MOSS]!;
      const fDark = factor(w[L_DARK]!, rest);
      rest -= w[L_DARK]!;
      const fDry = factor(w[L_DRY]!, rest);
      rest -= w[L_DRY]!;
      const fDirt = factor(w[L_DIRT]!, rest);
      p1[o] = byte(fDirt);
      p1[o + 1] = byte(fDry);
      p1[o + 2] = byte(fDark);
      p1[o + 3] = byte(fMoss);
      // Plane 0: 4-layer approximation (sum 1), R = 1 covers the auto-splat.
      const qSand = w[L_SAND]! + 0.5 * w[L_DRY]!;
      const qGrass = w[L_GRASS]! + 0.5 * w[L_DIRT]! + 0.5 * w[L_DRY]! + w[L_MOSS]!;
      const qRock = w[L_ROCK]! + 0.5 * w[L_DIRT]! + w[L_DARK]!;
      const qHigh = w[L_HIGH]!;
      let r0 = qSand + qGrass + qRock + qHigh;
      const fHigh = factor(qHigh, r0);
      r0 -= qHigh;
      const fRock = factor(qRock, r0);
      r0 -= qRock;
      const fGrass = factor(qGrass, r0);
      p0[o] = 255;
      p0[o + 1] = byte(fGrass);
      p0[o + 2] = byte(fRock);
      p0[o + 3] = byte(fHigh);
    }
  }
  // Mirror the texel grid exactly (texel (i, j) ↔ (res−1−i, res−1−j)).
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const o = (j * res + i) * 4;
      const m = ((res - 1 - j) * res + (res - 1 - i)) * 4;
      if (i > j || (i === j && i >= res / 2)) continue;
      for (let c = 0; c < 4; c++) {
        p0[o + c] = p0[m + c]!;
        p1[o + c] = p1[m + c]!;
      }
    }
  }
  return [p0, p1];
}

// -------------------------------------------------------------------------------------------------
// markers.json

/** Deterministic reclaim rocks (props, §10): pond rocks, rock ridge, rock group, mountain edge. */
function setonsProps(heightsWu: Float64Array): { id: string; x: number; z: number; yawDeg: number; scale: number }[] {
  const groups: { cx: number; cz: number; r: number; n: number; salt: number }[] = [
    { cx: 850, cz: 282, r: 34, n: 12, salt: 1 }, // pond NO (§10 "Felsen am Teich")
    { cx: 890, cz: 470, r: 50, n: 10, salt: 2 }, // rock ridge
    { cx: 748, cz: 372, r: 22, n: 6, salt: 3 }, // rock group at the bay tip
    { cx: 960, cz: 140, r: 60, n: 8, salt: 4 }, // mountain edge
  ];
  const no: { id: string; x: number; z: number; yawDeg: number; scale: number }[] = [];
  for (const g of groups) {
    let k = 0;
    for (let attempt = 0; no.length < 1e4 && k < g.n && attempt < g.n * 40; attempt++) {
      const a = rng32(SEED, g.salt, attempt, 101);
      const b = rng32(SEED, g.salt, attempt, 102);
      const c = rng32(SEED, g.salt, attempt, 103);
      const x = Math.round(g.cx + ((a >>> 16) / 65536 - 0.5) * 2 * g.r);
      const z = Math.round(g.cz + ((a & 0xffff) / 65536 - 0.5) * 2 * g.r);
      if (x < 4 || z < 4 || x > SIZE - 4 || z > SIZE - 4) continue;
      const hh = heightsWu[z * DIM + x]!;
      if (hh < WATER + 0.5 || slopeAt(heightsWu, x, z) > 0.6) continue;
      if (SPOTS.some((s) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) < 12 * 12)) continue;
      if (STARTS_ALL.some((s) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) < 40 * 40)) continue;
      no.push({ id: (b & 1) === 0 ? 'core:rock_01' : 'core:rock_02', x, z, yawDeg: (b >>> 8) % 360, scale: 1 + ((c >>> 24) % 5) * 0.25 });
      k++;
    }
  }
  return [...no, ...no.map((p) => ({ ...p, ...mirror(p), yawDeg: (p.yawDeg + 180) % 360 }))];
}

/** markers.json content (world units). */
export function setonsMarkers(heightsWu: Float64Array = generateSetonsHeightsWu()): Record<string, unknown> {
  const starts: { army: number; x: number; z: number }[] = [];
  for (const s of SETONS_STARTS_NO) {
    starts.push({ army: s.army - 1, ...mirror(s) });
    starts.push({ army: s.army, x: s.x, z: s.z });
  }
  starts.sort((a, b) => a.army - b.army);
  const mass = SPOTS.filter((s) => s.kind === 'mass').map((s) => ({ x: s.x, z: s.z }));
  const hydro = SPOTS.filter((s) => s.kind === 'hydro').map((s) => ({ x: s.x, z: s.z }));
  return {
    version: 1,
    name: 'Setons',
    sizeWu: SIZE,
    heightScaleRaw: 4096 / U,
    waterLevel: WATER,
    starts,
    mass,
    hydro,
    props: setonsProps(heightsWu),
    light: { azimuthDeg: 225, elevationDeg: 44, sun: [255, 238, 212], ambient: [88, 102, 118] },
    strata: [
      { name: 'shore', color: [198, 180, 128] },
      { name: 'meadow', color: [84, 118, 58] },
      { name: 'earth', color: [112, 92, 64] },
      { name: 'cliff', color: [110, 102, 90] },
      { name: 'highland', color: [196, 194, 184] },
    ],
  };
}

// -------------------------------------------------------------------------------------------------
// Source writer

function samplesEqual(a: Uint16Array, b: Uint16Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** All generated source files (without writing): heightmap, splat planes, markers. */
export function generateSetonsSources(): { heightmap: HeightmapData; splat: [Uint16Array, Uint16Array]; markers: Record<string, unknown> } {
  const heightmap = generateSetonsHeights();
  // Splat and props read the quantised heights (what the map really contains).
  const q = new Float64Array(heightmap.samples.length);
  for (let i = 0; i < q.length; i++) q[i] = heightmap.samples[i]! / U;
  return { heightmap, splat: generateSetonsSplat(q), markers: setonsMarkers(q) };
}

/**
 * Writes content/maps/src/setons/{heightmap.png, splat-0.png, splat-1.png, markers.json}. PNGs are
 * only rewritten when their decoded samples differ (a different zlib build never dirties them).
 */
export function writeSetonsSources(log: (msg: string) => void = () => {}): string {
  const dir = join(MAPS_SRC_DIR, SETONS);
  mkdirSync(dir, { recursive: true });
  const src = generateSetonsSources();
  const pngPath = join(dir, 'heightmap.png');
  let unchanged = 0;
  if (existsSync(pngPath) && samplesEqual(decodeHeightmapPng(new Uint8Array(readFileSync(pngPath)), pngPath).samples, src.heightmap.samples)) unchanged++;
  else writeFileSync(pngPath, encodeHeightmapPng(src.heightmap));
  src.splat.forEach((plane, k) => {
    const path = join(dir, `splat-${k}.png`);
    if (existsSync(path) && samplesEqual(decodePng(new Uint8Array(readFileSync(path))).samples, plane)) unchanged++;
    else writeFileSync(path, encodePng({ width: SETONS_SPLAT_RES, height: SETONS_SPLAT_RES, bitDepth: 8, channels: 4, samples: plane }));
  });
  writeFileSync(join(dir, 'markers.json'), `${JSON.stringify(src.markers, null, 2)}\n`);
  log(`mapgen: ${SETONS} sources in ${dir}${unchanged === 3 ? ' (images unchanged)' : ''}`);
  return dir;
}
