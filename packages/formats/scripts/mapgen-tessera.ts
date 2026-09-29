/**
 * mapgen-tessera — deterministic procedural generator for the skirmish map "Tessera" (512 WU, 1v1),
 * an own design (no FA map as template). Source of every number: content/maps/src/tessera.spec.md
 * (§ references below).
 *
 *   pnpm maps     (root; writes content/maps/src/tessera/* and compiles content/maps/tessera.rtsmap)
 *
 * Layout (x = east, z = south; army 0 = SW (108, 404), army 1 = NO (404, 108) on the base axis
 * x + z = 512). The layout is D2-symmetric: point mirror P (x, z) → (512 − x, 512 − z), neutral axis
 * N (x, z) → (z, x) and base axis B (x, z) → (512 − z, 512 − x). Features are defined once in the
 * canonical quarter W = {z ≥ x, x + z ≤ 512} and mirrored ({@link orbit}); the fine noise is only
 * point-symmetric (§0).
 *   - flat base plates (28 WU, r ≈ 50) with a soft ramp onto the plain (24 ± 1.8 WU, gentle hills),
 *     hinterland rising to ≈ 31 WU towards the base corners (§3)
 *   - the "shard hollow" in the centre (floor 20 WU, r 40, rim r 90) with a diamond of 4 contested
 *     mex and the shard field (37 rock props) on dark slate plates (§2, §7.2, §9, §11)
 *   - two cliff bars along the base axis at v = ±95 (2 segments each, a 26-WU notch between them),
 *     four rock noses that split the way base → flank into two passages (40 / 47 WU), two
 *     impassable corner massifs NW / SE (§4)
 *   - two flanks (terrace 26 WU) with 3 mex and 1 hydro each, a small spring pond next to each flank
 *     hydro (≤ 1 WU deep, off every path; §5)
 *   - painted splat (late-summer steppe): dry grass, green grass in hollows, earth on the bases and
 *     faint tracks along the three lanes, dark slate plates (Voronoi) in the hollow floor, rock on
 *     steep faces, highland on the massif ridges, no sand (§11)
 *
 * Determinism: only +, −, ×, ÷, Math.sqrt/floor/round/min/max/abs (IEEE-exact) and rng32 lattice
 * noise, so the output is byte-identical on every run and engine. The height function is built
 * point-symmetric (symmetric noise, D2 feature lists), then the canonical half is mirrored
 * sample-exactly. Heights: u16 steps with heightScaleRaw 32 (1 step = 1/128 WU), water level 16 WU.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rng32 } from '@faf/fixed';
import { decodeHeightmapPng, encodeHeightmapPng, type HeightmapData } from './heightmap-io.ts';
import { MAPS_SRC_DIR } from './mapc.ts';
import { decodePng, encodePng } from './png.ts';

export const TESSERA = 'tessera';

const SIZE = 512;
const DIM = SIZE + 1;
const HALF = SIZE / 2;
/** Height steps per WU (heightScaleRaw 32 ⇒ 4096 / 32). */
const U = 128;
const SEED = 0x7e55e7a1;
/** Water level (WU, §1). */
export const TESSERA_WATER = 16;
const WATER = TESSERA_WATER;
/** Splat resolution (texels per edge, 4 WU per texel, §1). */
export const TESSERA_SPLAT_RES = 128;

// -------------------------------------------------------------------------------------------------
// Symmetry

type P = { readonly x: number; readonly z: number };

/** Point mirror P (swaps the players). */
export const mirrorP = (p: P): P => ({ x: SIZE - p.x, z: SIZE - p.z });
/** Neutral-axis mirror N (x = z; swaps the players). */
export const mirrorN = (p: P): P => ({ x: p.z, z: p.x });
/** Base-axis mirror B (x + z = 512; swaps the two flanks of a player). */
export const mirrorB = (p: P): P => ({ x: SIZE - p.z, z: SIZE - p.x });

/** D2 orbit of a point (identity, N, P, B), without duplicates (points on an axis map to themselves). */
export function orbit(p: P): P[] {
  const out: P[] = [];
  for (const q of [p, mirrorN(p), mirrorP(p), mirrorB(p)]) if (!out.some((o) => o.x === q.x && o.z === q.z)) out.push(q);
  return out;
}

// -------------------------------------------------------------------------------------------------
// Layout data (WU, spec §4–§9)

/** Starts §6: army 0 = SW (player in the MVP), army 1 = NO (point mirror). */
export const TESSERA_STARTS: readonly { army: number; x: number; z: number }[] = [
  { army: 0, x: 108, z: 404 },
  { army: 1, x: 404, z: 108 },
];

/** Start-ring radius of the 4 start mex (§7.1). */
export const TESSERA_START_MEX_RADIUS = 16;

/** Safe mass spots of army 0 besides the start ring (§7.1): fore field, corner yard, west and south wing. */
export const TESSERA_SAFE_MASS_SW: readonly P[] = [
  { x: 160, z: 336 },
  { x: 176, z: 352 },
  { x: 30, z: 466 },
  { x: 46, z: 482 },
  { x: 40, z: 316 },
  { x: 56, z: 300 },
  { x: 196, z: 472 },
  { x: 212, z: 456 },
];

/** Contested mass spots (§7.2): the centre diamond (neutral tips, front tips) and both flank triangles. */
export const TESSERA_CONTESTED_MASS: readonly P[] = [
  { x: 234, z: 234 },
  { x: 278, z: 278 },
  { x: 242, z: 270 },
  { x: 270, z: 242 },
  { x: 132, z: 132 },
  { x: 106, z: 138 },
  { x: 138, z: 106 },
  { x: 380, z: 380 },
  { x: 406, z: 374 },
  { x: 374, z: 406 },
];

/** Hydros §8: base SW, base NO, flank NW, flank SO. */
export const TESSERA_HYDRO: readonly P[] = [
  { x: 80, z: 432 },
  { x: 432, z: 80 },
  { x: 96, z: 96 },
  { x: 416, z: 416 },
];

/** Centre of the shard hollow and the diamond (§2). */
export const TESSERA_CENTRE: P = { x: HALF, z: HALF };
/** Shard hollow (§3): floor height and radius, rim radius (back on the plain). */
export const TESSERA_HOLLOW = { floor: 20, floorR: 40, rimR: 90 } as const;
/** Base plate height (§3). */
export const TESSERA_BASE_HEIGHT = 28;
/** Plain height (§3). */
const PLAIN = 24;

type Capsule = readonly [number, number, number, number];
const capsuleOrbit = (c: Capsule): Capsule[] => {
  const a = { x: c[0], z: c[1] };
  const b = { x: c[2], z: c[3] };
  return [mirrorN, mirrorP, mirrorB].reduce<Capsule[]>(
    (acc, m) => {
      const ma = m(a);
      const mb = m(b);
      acc.push([ma.x, ma.z, mb.x, mb.z]);
      return acc;
    },
    [c],
  );
};

/**
 * Cliff bar segments (§4, axis v = ±95): canonical SW segment of the NW bar; the orbit gives the NO
 * segment of the NW bar and both segments of the SO bar.
 */
export const TESSERA_BAR_SEGMENTS: readonly Capsule[] = capsuleOrbit([128, 250, 170, 207]);
/** Foot radius and core radius (crest) of the cliff bars (§3/§4). */
export const TESSERA_BAR = { foot: 13, core: 6, crest: 12 } as const;
/** Rock noses (flank gates, §4): SW-west, SW-south, NO-east, NO-north. */
export const TESSERA_NOSES: readonly P[] = orbit({ x: 54, z: 246 });
/** Rock-nose radius (foot), core radius and crest height (§3/§4). */
export const TESSERA_NOSE = { foot: 14, core: 6, crest: 10 } as const;
/** Corner massifs NW / SE: foot line x + z = 100 resp. 924 (§3/§4). */
export const TESSERA_MASSIF_FOOT = 100;
/** Spring ponds next to the flank hydros (§5): centre and radius. */
export const TESSERA_PONDS: readonly P[] = [
  { x: 62, z: 62 },
  { x: 450, z: 450 },
];
const POND_R = 12.5;
/** Flank terraces (§3): centre at u = 0, v = ±190. */
const TERRACE_C = HALF - (190 * Math.SQRT2) / 2;
const TERRACES: readonly P[] = [
  { x: TERRACE_C, z: TERRACE_C },
  { x: SIZE - TERRACE_C, z: SIZE - TERRACE_C },
];

/** Notch centres (§4): between the two segments of each bar, on the neutral axis. */
export const TESSERA_NOTCHES: readonly P[] = [
  { x: 188.5, z: 188.5 },
  { x: 323.5, z: 323.5 },
];
const NOTCHES = TESSERA_NOTCHES;

/** Every mass/hydro spot: 4 + 8 safe per army (army 0 first, army 1 = point mirror), 10 contested, 4 hydros. */
export function tesseraSpots(): { kind: 'mass' | 'hydro'; x: number; z: number }[] {
  const out: { kind: 'mass' | 'hydro'; x: number; z: number }[] = [];
  const r = TESSERA_START_MEX_RADIUS;
  const safeSw: P[] = [];
  const s0 = TESSERA_STARTS[0]!;
  for (const [dx, dz] of [
    [-r, 0],
    [r, 0],
    [0, -r],
    [0, r],
  ] as const) {
    safeSw.push({ x: s0.x + dx, z: s0.z + dz });
  }
  safeSw.push(...TESSERA_SAFE_MASS_SW);
  for (const p of safeSw) out.push({ kind: 'mass', ...p });
  for (const p of safeSw) out.push({ kind: 'mass', ...mirrorP(p) });
  for (const p of TESSERA_CONTESTED_MASS) out.push({ kind: 'mass', ...p });
  for (const p of TESSERA_HYDRO) out.push({ kind: 'hydro', ...p });
  return out;
}

const SPOTS = tesseraSpots();

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

function dist(x: number, z: number, p: P): number {
  return Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z));
}

/** Along the base axis (SW start u ≈ −209, NO start u ≈ +209). */
function axisU(x: number, z: number): number {
  return (x - z) / Math.SQRT2;
}

// -------------------------------------------------------------------------------------------------
// Noise: value noise on rng32 lattices (precomputed tables), point-symmetric variants.

class Lattice {
  readonly n: number;
  readonly v: Float64Array;
  constructor(
    readonly cell: number,
    salt: number,
  ) {
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

  /** D2-symmetric value noise (P and N; used where the layout itself is described, e.g. pond outlines). */
  d2(x: number, z: number): number {
    return (this.sym(x, z) + this.sym(z, x)) * 0.5;
  }
}

const N = {
  hillA: new Lattice(64, 1),
  hillB: new Lattice(28, 2),
  hillC: new Lattice(11, 3),
  baseR: new Lattice(26, 4),
  pond: new Lattice(9, 5),
  barEdge: new Lattice(10, 6),
  barCrest: new Lattice(24, 7),
  crag: new Lattice(6, 8),
  gully: new Lattice(4, 18),
  massEdge: new Lattice(30, 9),
  ridgeA: new Lattice(34, 10),
  ridgeB: new Lattice(15, 11),
  ridgeC: new Lattice(7, 12),
  patch: new Lattice(46, 13),
  patch2: new Lattice(19, 14),
  patch3: new Lattice(70, 15),
  moss: new Lattice(28, 16),
  track: new Lattice(22, 17),
} as const;

// -------------------------------------------------------------------------------------------------
// Height function

/** Gentle plain hills (§3: 24 ± 1.8 WU, main wavelength ≈ 90 WU, slope ≤ 0.3). */
function hills(x: number, z: number): number {
  return 2.4 * N.hillA.sym(x, z) + 0.9 * N.hillB.sym(x, z) + 0.2 * N.hillC.sym(x, z);
}

/**
 * 1 in the hollow floor (r ≤ 40), 0 from the rim (r ≥ 90) on. Half linear, half smoothstep: the 4-WU
 * bowl stays ≤ 0.1 steep (§3) without a kink at the floor and the rim.
 */
function hollowWeight(x: number, z: number): number {
  const t = clamp01((dist(x, z, TESSERA_CENTRE) - TESSERA_HOLLOW.floorR) / (TESSERA_HOLLOW.rimR - TESSERA_HOLLOW.floorR));
  return 1 - 0.5 * (t + S(t));
}

/** Distance-like pond measure (WU; < POND_R = water), outline broken up by D2-symmetric noise (§5). */
function pondDist(x: number, z: number): number {
  let d = Infinity;
  for (const p of TESSERA_PONDS) d = Math.min(d, dist(x, z, p));
  if (d > 60) return d;
  return d + 3.2 * N.pond.d2(x, z) + 1.5 * N.hillC.d2(x, z);
}

/** Base terrain: plain, hills, hinterland, hollow, flank terraces, spring ponds (before plates and rocks). */
function baseHeight(x: number, z: number): number {
  const hw = hollowWeight(x, z);
  // Calm notch floors (§4: slope ≤ 0.1 through the notch).
  let dn = Infinity;
  for (const n of NOTCHES) dn = Math.min(dn, dist(x, z, n));
  const calm = Math.max(0.8 * hw, 0.6 * (1 - S((dn - 16) / 30)));
  let h = PLAIN + hills(x, z) * (1 - calm) - (PLAIN - TESSERA_HOLLOW.floor) * hw;
  // Base hinterland (§3): behind the starts (|u| > 209) up to the plate height, then 28 → 31 towards
  // the base corners (slope ≤ 0.1).
  const au = Math.abs(axisU(x, z));
  h += (TESSERA_BASE_HEIGHT - PLAIN) * S((au - 200) / 60) + 3 * S((au - 260) / 100);
  // Flank terraces (§3): +2 WU, 40 WU blend. Flat radius 60 instead of 70 WU: the blend then ends at
  // the notch and does not add to the hollow rim there (notch floor ≤ 0.1).
  let rt = Infinity;
  for (const t of TERRACES) rt = Math.min(rt, dist(x, z, t));
  h += 2 * (1 - S((rt - 60) / 40));
  // Spring ponds (§3/§5): depression 40 → 12 WU, bed ≥ 15 WU.
  const dp = pondDist(x, z);
  if (dp < 44) {
    const shore = 16.3;
    if (dp >= POND_R) h = lerp(shore, h, S((dp - POND_R) / (44 - POND_R)));
    else h = shore - 1.3 * S((POND_R - dp) / 3.5);
  }
  return h;
}

/** Cliff bars (§4): capsules with a flat crest (core r 6), steep flanks to the foot (r 13), craggy. */
function barAdd(x: number, z: number): number {
  let best = 0;
  const { foot, core, crest } = TESSERA_BAR;
  for (const c of TESSERA_BAR_SEGMENTS) {
    const d0 = segDist(x, z, c[0], c[1], c[2], c[3]);
    if (d0 > foot + 3) continue;
    const d = d0 + 1.2 * N.barEdge.sym(x, z);
    if (d >= foot) continue;
    // Gullies: the flank profile is shifted by fine noise, so the face is ribbed instead of a tube.
    const t = (foot - d) / (foot - core) + 0.22 * N.gully.sym(x, z);
    const top = crest + 2 * N.barCrest.sym(x, z);
    const crag = 1 - Math.abs(N.crag.sym(x, z));
    const a = top * S(t) + (2.6 * crag * crag - 0.9) * S((t - 0.5) * 2) + 0.9 * N.ridgeC.sym(x, z) * S(t);
    if (a > best) best = a;
  }
  return best;
}

/** Rock noses (§4): round capsules r 14 (core r 6), crest +10. */
function noseAdd(x: number, z: number): number {
  let best = 0;
  const { foot, core, crest } = TESSERA_NOSE;
  for (const p of TESSERA_NOSES) {
    const d0 = dist(x, z, p);
    if (d0 > foot + 3) continue;
    const d = d0 + 1.2 * N.barEdge.sym(x, z);
    if (d >= foot) continue;
    const t = (foot - d) / (foot - core);
    const crag = 1 - Math.abs(N.crag.sym(x, z));
    const a = (crest + 1.2 * N.barCrest.sym(x, z)) * S(t) + (1.4 * crag * crag - 0.4) * S(t - 0.6);
    if (a > best) best = a;
  }
  return best;
}

/** Depth inside the corner-massif foot line (WU, > 0 inside; §3: x + z = 100 resp. 924, ±8 WU noisy). */
function massifDepth(x: number, z: number): number {
  const s = x + z;
  const d = Math.max(TESSERA_MASSIF_FOOT - s, s - (2 * SIZE - TESSERA_MASSIF_FOOT)) / Math.SQRT2;
  if (d < -20) return d;
  return d + 11 * N.massEdge.sym(x, z) + 3.5 * N.ridgeB.sym(x, z);
}

/**
 * Corner massif (§3: foot band slope ≥ 1.2, ridges 50–65 WU towards the corner): a steep wall from the
 * foot line, then ridged multi-octave noise rising to the corner. Height above the ground.
 */
function massifAdd(x: number, z: number): number {
  const d = massifDepth(x, z);
  if (d <= -1) return 0;
  const r1 = 1 - Math.abs(N.ridgeA.sym(x, z));
  const r2 = 1 - Math.abs(N.ridgeB.sym(x, z));
  const r3 = 1 - Math.abs(N.ridgeC.sym(x, z));
  const ridge = 0.55 * r1 * r1 + 0.3 * r2 * r2 * r1 + 0.15 * r3 * r2;
  const wall = 13 * S((d + 1) / 8);
  const main = (12 + 16 * ridge) * S((d - 7) / 40);
  return wall + main + 1.5 * N.ridgeC.sym(x, z) * S(d / 10);
}

/** Rocks added on top of the flattened base: cliff bars, rock noses, corner massifs. */
function rockAdd(x: number, z: number): number {
  return Math.max(barAdd(x, z), noseAdd(x, z), massifAdd(x, z));
}

// -------------------------------------------------------------------------------------------------
// Heightfield assembly

/** Canonical half: x > z, or on the diagonal the half with x ≥ 256 (the centre maps to itself). */
function isCanonical(x: number, z: number): boolean {
  return x > z || (x === z && x >= HALF);
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
function flatten(h: Float64Array, centres: readonly { x: number; z: number; r: number }[], rBlend: number): void {
  const targets = centres.map((c) => h[c.z * DIM + c.x]!);
  forCanonical((x, z, i) => {
    let best = 0;
    let bestK = -1;
    for (let k = 0; k < centres.length; k++) {
      const c = centres[k]!;
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz >= rBlend * rBlend) continue;
      const w = 1 - S((Math.sqrt(dx * dx + dz * dz) - c.r) / (rBlend - c.r));
      if (w > best) {
        best = w;
        bestK = k;
      }
    }
    if (bestK >= 0) h[i] = lerp(h[i]!, targets[bestK]!, best);
  });
  mirrorFill(h);
}

/** Flat radius of the base plates (§3: r 48, edge ±6 WU noisy): 50 ± 5 WU. */
function plateRadius(x: number, z: number): number {
  return 50 + 5 * N.baseR.sym(x, z);
}
/** Width of the ramp from the base plate onto the plain (§3: r 48 → 88). */
const PLATE_RAMP = 44;

/** Flat base plates at exactly 28 WU with a noisy radius and a wide, soft ramp (§3). */
function flattenPlates(h: Float64Array): void {
  const reach = 56 + PLATE_RAMP;
  forCanonical((x, z, i) => {
    let best = 0;
    for (const c of TESSERA_STARTS) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz >= reach * reach) continue;
      best = Math.max(best, 1 - S((Math.sqrt(dx * dx + dz * dz) - plateRadius(x, z)) / PLATE_RAMP));
    }
    if (best > 0) h[i] = lerp(h[i]!, TESSERA_BASE_HEIGHT, best);
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
export function generateTesseraHeightsWu(): Float64Array {
  const h = new Float64Array(DIM * DIM);
  forCanonical((x, z, i) => {
    h[i] = baseHeight(x, z);
  });
  mirrorFill(h);
  flattenPlates(h);
  // Rocks are soft-edged before they are added (and quantised): steep capsule flanks otherwise show
  // as saw-tooth edges on the 1-WU grid (as Setons).
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
  // Flat pads for the spots (§3: mex r 4, hydro r 6, blend to r 16).
  flatten(
    h,
    SPOTS.map((s) => ({ x: s.x, z: s.z, r: s.kind === 'hydro' ? 6 : 4 })),
    16,
  );
  return h;
}

/** Generates the heightmap (dim² u16 steps), exactly point-symmetric. */
export function generateTesseraHeights(wu: Float64Array = generateTesseraHeightsWu()): HeightmapData {
  const samples = new Uint16Array(DIM * DIM);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(0, Math.min(0xffff, Math.round(wu[i]! * U)));
  // Mirror once more on the integer samples (bit-exact symmetry independent of float rounding).
  for (let z = 0; z < DIM; z++) {
    for (let x = 0; x < DIM; x++) if (!isCanonical(x, z)) samples[z * DIM + x] = samples[(SIZE - z) * DIM + (SIZE - x)]!;
  }
  return { dim: DIM, samples };
}

// -------------------------------------------------------------------------------------------------
// Splat (8 layers in two RGBA planes), late-summer steppe (§11)
//   plane 0: R sand, G grass, B rock, A highland
//   plane 1: R dirt, G dry grass, B dark rock, A moss
// Encoding as Setons: the generator decides the final weight of every layer (sum 1) and encodes lerp
// factors that reproduce them; plane 0 has R = 1 and covers the auto-splat completely. Plane 0 holds
// a 4-layer approximation for presets with 4 layers – without sand (§11 "kein Sand"): dry grass →
// grass/highland, dirt → grass/rock, dark rock → rock, moss → grass.

const L_SAND = 0;
const L_GRASS = 1;
const L_ROCK = 2;
const L_HIGH = 3;
const L_DIRT = 4;
const L_DRY = 5;
const L_DARK = 6;
const L_MOSS = 7;

/** Height gradient (x, z) over ±2 samples, i.e. over one 4-WU splat texel. */
function gradAt(h: Float64Array, x: number, z: number): [number, number] {
  const xi = Math.max(2, Math.min(SIZE - 2, Math.round(x)));
  const zi = Math.max(2, Math.min(SIZE - 2, Math.round(z)));
  return [(h[zi * DIM + xi + 2]! - h[zi * DIM + xi - 2]!) * 0.25, (h[(zi + 2) * DIM + xi]! - h[(zi - 2) * DIM + xi]!) * 0.25];
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

/** Cell size of the slate plates in the hollow floor (§11: Voronoi cells 10–18 WU). */
const PLATE_CELL = 14;

/**
 * Voronoi cell points of the slate plates: one jittered point per cell of a grid centred on the map
 * centre; cell (i, j) and its point mirror (−1 − i, −1 − j) share the jitter (negated), so the point
 * set – and with it the plate pattern – is point-symmetric.
 */
function platePoint(i: number, j: number): P {
  const canon = j > -1 - j || (j === -1 - j && i >= -1 - i);
  const ci = canon ? i : -1 - i;
  const cj = canon ? j : -1 - j;
  const r = rng32(SEED, ci + 1000, cj + 1000, 77);
  const jx = (((r >>> 16) & 0xffff) / 65536 - 0.5) * 0.7;
  const jz = ((r & 0xffff) / 65536 - 0.5) * 0.7;
  const sx = canon ? jx : -jx;
  const sz = canon ? jz : -jz;
  return { x: HALF + (i + 0.5 + sx) * PLATE_CELL, z: HALF + (j + 0.5 + sz) * PLATE_CELL };
}

/** Distance to the nearest joint between two slate plates (F2 − F1)/2 in WU. */
function plateJoint(x: number, z: number): number {
  const ci = Math.floor((x - HALF) / PLATE_CELL);
  const cj = Math.floor((z - HALF) / PLATE_CELL);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const p = platePoint(ci + di, cj + dj);
      const d = Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z));
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return (f2 - f1) * 0.5;
}

/** Faint tracks along the three lanes (§11): canonical polylines, mirrored by D2. */
const TRACKS: readonly Capsule[] = [
  // Centre lane (start to start along the base axis, both halves).
  [108, 404, 404, 108],
  // Flank lane: start → gate between rock nose and bar end → flank terrace → neutral axis.
  ...capsuleOrbit([108, 404, 94, 300]),
  ...capsuleOrbit([94, 300, 92, 250]),
  ...capsuleOrbit([92, 250, 110, 160]),
  ...capsuleOrbit([110, 160, 128, 128]),
];

function trackDist(x: number, z: number): number {
  let d = Infinity;
  for (const c of TRACKS) d = Math.min(d, segDist(x, z, c[0], c[1], c[2], c[3]));
  return d;
}

/** Final weights of the 8 layers at a canonical point (sum 1). */
function splatWeights(w: Float64Array, heightsWu: Float64Array, x: number, z: number): void {
  const h = heightsWu[Math.round(z) * DIM + Math.round(x)]!;
  const [gx, gz] = gradAt(heightsWu, x, z);
  const slope = Math.sqrt(gx * gx + gz * gz);
  const patch = N.patch.sym(x, z) * 0.7 + N.patch2.sym(x, z) * 0.3;
  const patchB = N.patch3.sym(x, z) * 0.7 + N.moss.sym(x, z) * 0.3;
  const hw = hollowWeight(x, z);
  const dp = pondDist(x, z);

  w.fill(0);
  // Dry-grass steppe as the ground tone, patches of green grass, a few earth spots.
  w[L_DRY] = 1;
  // Macro variation (overview readability): meadow drifts, pale straw on the hill crests.
  paint(w, L_GRASS, 0.62 * S((patchB + 0.02) / 0.35));
  paint(w, L_DIRT, 0.25 * S((patch - 0.2) / 0.3));
  paint(w, L_HIGH, 0.16 * S((h - PLAIN - 0.8) / 1.6) * S((0.1 - patchB) / 0.4));
  // Green grass in dips (below the plain), in the hollow and around the ponds.
  paint(w, L_GRASS, 0.6 * S((PLAIN + 0.2 - h) / 2.2) * (1 - hw));
  paint(w, L_GRASS, hw * (0.55 + 0.25 * S((patch + 0.2) / 0.5)));
  paint(w, L_GRASS, 0.75 * (1 - S((dp - POND_R - 6) / 22)));
  // Moss at the pond shore and on the north faces of the bars and noses (surface rises to the south).
  paint(w, L_MOSS, 0.6 * (1 - S((dp - POND_R - 1) / 7)));
  const rockNear = S((barAdd(x, z) + noseAdd(x, z)) / 3);
  paint(w, L_MOSS, 0.45 * rockNear * S(gz / 0.6) * S((N.moss.sym(x, z) + 0.4) / 0.6));
  // Trodden earth on the base plates (noisy radius, soft edge) and faint lane tracks (≤ 12 WU, ≤ 40 %).
  let base = 0;
  for (const s of TESSERA_STARTS) {
    const r = dist(x, z, s);
    if (r < 110) base = Math.max(base, 1 - S((r - 30 - 10 * N.baseR.sym(x, z)) / 36));
  }
  paint(w, L_DIRT, base * (0.35 + 0.25 * S((patch + 0.2) / 0.5)));
  const td = trackDist(x, z) + 2 * N.track.sym(x, z);
  paint(w, L_DIRT, 0.38 * (1 - S((td - 2) / 4)) * S((N.track.sym(x, z) + 0.6) / 0.5) * (1 - hw));
  // Slate plates in the hollow floor (§11): dark rock cells with earth joints.
  const floor = 1 - S((dist(x, z, TESSERA_CENTRE) - 46 - 6 * N.patch2.sym(x, z)) / 14);
  if (floor > 0) {
    const j = plateJoint(x, z);
    paint(w, L_DARK, floor * 0.85 * S((j - 0.9) / 1.4));
    paint(w, L_DIRT, floor * 0.75 * (1 - S((j - 0.2) / 1.2)));
  }
  // Pond bed: mud (earth + moss) seen through the water.
  const under = S((WATER + 0.3 - h) / 0.8);
  paint(w, L_DIRT, under * 0.7);
  paint(w, L_MOSS, under * 0.35);
  // Rocks: bars, noses and massifs rock, darker streaks; steep faces rock; massif ridges highland.
  const bar = S((barAdd(x, z) + noseAdd(x, z)) / 5);
  paint(w, L_ROCK, bar * 0.8);
  paint(w, L_DARK, bar * 0.3 * S((N.ridgeB.sym(x, z) + 0.2) / 0.6));
  const mount = S(massifAdd(x, z) / 6);
  paint(w, L_ROCK, mount * 0.65);
  const steep = S((slope - 0.55) / 0.45);
  paint(w, L_ROCK, steep * 0.9);
  paint(w, L_DARK, steep * 0.22 * S((patch + 0.2) / 0.6));
  paint(w, L_HIGH, mount * 0.85 * S((h - 44) / 12));
  paint(w, L_HIGH, S((barAdd(x, z) - 10.5) / 2) * 0.35);
}

/** Two RGBA8 planes (res² texels) derived from the heights and the layout. */
export function generateTesseraSplat(heightsWu: Float64Array, res = TESSERA_SPLAT_RES): [Uint16Array, Uint16Array] {
  const p0 = new Uint16Array(res * res * 4);
  const p1 = new Uint16Array(res * res * 4);
  const step = SIZE / res;
  const w = new Float64Array(8);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      // Texel centre; evaluate at the canonical point so the splat is point-symmetric as well.
      let x = (i + 0.5) * step;
      let z = (j + 0.5) * step;
      if (!(x > z || (x === z && x >= HALF))) {
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
      // Plane 0: 4-layer approximation without sand (sum 1), R = 1 covers the auto-splat.
      const qGrass = w[L_SAND]! + w[L_GRASS]! + 0.5 * w[L_DIRT]! + 0.65 * w[L_DRY]! + w[L_MOSS]!;
      const qRock = w[L_ROCK]! + 0.5 * w[L_DIRT]! + w[L_DARK]!;
      const qHigh = w[L_HIGH]! + 0.35 * w[L_DRY]!;
      let r0 = qGrass + qRock + qHigh;
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

type Prop = { id: string; x: number; z: number; yawDeg: number; scale: number };

/**
 * Canonical reclaim rocks in the quarter W (§9): the tessera stone in the centre (1×), the shard field
 * of the hollow, scree at the bar notches and at the massif feet; each mirrored by N, P and B.
 */
export const TESSERA_PROPS_CANONICAL: readonly (readonly [number, number, 1 | 2, number])[] = [
  [256, 256, 2, 2.2],
  // Shard field (hollow, r 30–86, ≥ 14 WU from every mex)
  [220, 256, 2, 1.6],
  [228, 266, 1, 1.0],
  [212, 276, 1, 1.2],
  [212, 236, 1, 1.2],
  [195, 267, 2, 1.3],
  [195, 243, 1, 1.0],
  [195, 297, 1, 1.1],
  [195, 215, 1, 1.1],
  [170, 256, 2, 1.4],
  // Notch scree (bar foot on both sides of the notch, not in the passage)
  [185, 214, 1, 1.2],
  [161, 195, 2, 1.2],
  [173, 235, 1, 0.9],
  // Massif scree (massif foot around the pond)
  [45, 62, 2, 1.5],
  [37, 85, 1, 1.1],
  [30, 109, 1, 1.3],
];

/** Reclaim rocks (props, §9): canonical list × D2 orbit; yaw from rng32, mirrored with the position. */
export function tesseraProps(): Prop[] {
  const out: Prop[] = [];
  TESSERA_PROPS_CANONICAL.forEach(([x, z, kind, scale], k) => {
    const id = kind === 1 ? 'core:rock_01' : 'core:rock_02';
    const yaw = (rng32(SEED, k, 0, 201) >>> 8) % 360;
    // Yaw under the mirrors: P turns by 180°, N and B reflect (yaw → 90° − yaw, 270° − yaw).
    const images: [P, number][] = [
      [{ x, z }, yaw],
      [mirrorN({ x, z }), (450 - yaw) % 360],
      [mirrorP({ x, z }), (yaw + 180) % 360],
      [mirrorB({ x, z }), (630 - yaw) % 360],
    ];
    const seen: P[] = [];
    for (const [p, y] of images) {
      if (seen.some((s) => s.x === p.x && s.z === p.z)) continue;
      seen.push(p);
      out.push({ id, x: p.x, z: p.z, yawDeg: y, scale });
    }
  });
  return out;
}

/** markers.json content (world units). */
export function tesseraMarkers(): Record<string, unknown> {
  return {
    version: 1,
    name: 'Tessera',
    sizeWu: SIZE,
    heightScaleRaw: 4096 / U,
    waterLevel: WATER,
    starts: TESSERA_STARTS.map((s) => ({ army: s.army, x: s.x, z: s.z })),
    mass: SPOTS.filter((s) => s.kind === 'mass').map((s) => ({ x: s.x, z: s.z })),
    hydro: SPOTS.filter((s) => s.kind === 'hydro').map((s) => ({ x: s.x, z: s.z })),
    props: tesseraProps(),
    light: { azimuthDeg: 300, elevationDeg: 40, sun: [255, 236, 205], ambient: [96, 104, 120] },
    strata: [
      { name: 'steppe', color: [168, 150, 96] },
      { name: 'meadow', color: [98, 122, 62] },
      { name: 'earth', color: [118, 94, 66] },
      { name: 'slate', color: [64, 66, 72] },
      { name: 'cliff', color: [122, 112, 98] },
      { name: 'highland', color: [192, 188, 176] },
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
export function generateTesseraSources(): { heightmap: HeightmapData; splat: [Uint16Array, Uint16Array]; markers: Record<string, unknown> } {
  const heightmap = generateTesseraHeights();
  // The splat reads the quantised heights (what the map really contains).
  const q = new Float64Array(heightmap.samples.length);
  for (let i = 0; i < q.length; i++) q[i] = heightmap.samples[i]! / U;
  return { heightmap, splat: generateTesseraSplat(q), markers: tesseraMarkers() };
}

/**
 * Writes content/maps/src/tessera/{heightmap.png, splat-0.png, splat-1.png, markers.json}. PNGs are
 * only rewritten when their decoded samples differ (a different zlib build never dirties them).
 */
export function writeTesseraSources(log: (msg: string) => void = () => {}): string {
  const dir = join(MAPS_SRC_DIR, TESSERA);
  mkdirSync(dir, { recursive: true });
  const src = generateTesseraSources();
  const pngPath = join(dir, 'heightmap.png');
  let unchanged = 0;
  if (existsSync(pngPath) && samplesEqual(decodeHeightmapPng(new Uint8Array(readFileSync(pngPath)), pngPath).samples, src.heightmap.samples)) unchanged++;
  else writeFileSync(pngPath, encodeHeightmapPng(src.heightmap));
  src.splat.forEach((plane, k) => {
    const path = join(dir, `splat-${k}.png`);
    if (existsSync(path) && samplesEqual(decodePng(new Uint8Array(readFileSync(path))).samples, plane)) unchanged++;
    else writeFileSync(path, encodePng({ width: TESSERA_SPLAT_RES, height: TESSERA_SPLAT_RES, bitDepth: 8, channels: 4, samples: plane }));
  });
  writeFileSync(join(dir, 'markers.json'), `${JSON.stringify(src.markers, null, 2)}\n`);
  log(`mapgen: ${TESSERA} sources in ${dir}${unchanged === 3 ? ' (images unchanged)' : ''}`);
  return dir;
}
