/**
 * mapgen-braidwater — deterministic procedural generator for the map "Braidwater" (512 WU, 1v1),
 * an own design for the MS9 skirmish map set (map B). Source of every number:
 * content/maps/src/braidwater.spec.md (§ references below; deviations in §13 there).
 *
 *   pnpm --filter @faf/formats mapgen braidwater   (writes content/maps/src/braidwater/* and
 *                                                   compiles content/maps/braidwater.rtsmap)
 *
 * Layout (x = east, z = south; exactly mirror-symmetric at the river axis z = 256; the south team,
 * army 0, is the canonical half z ≥ 256, the north team its mirror (x, 512 − z)):
 *   - one river along the axis that separates the teams: narrow west section with the west ford
 *     (short route), a 48-WU middle section between the two bluffs (no crossing), then it braids
 *     around the river island ("Zopfinsel") with one ford per channel (long route) and opens into a
 *     deep estuary basin at the east edge (§3)
 *   - per side: base plateau (28 WU) with a west and an east ramp and a small ramp down into the
 *     west hollow, watch plateau (30 WU) over the west ford whose ramp joins the base's west ramp,
 *     bluff (24 WU) over the river with a single back ramp, knoll (28 WU) over the island ford with a
 *     single back ramp, rugged corner rocks (§4)
 *   - 2 starts, 36 mass (17 per side + 2 on the island), 5 hydros, 64 rock props (§6–§9)
 *   - painted 8-layer splat that fully covers the renderer's auto-splat
 *
 * Determinism: only +, −, ×, ÷, Math.sqrt/floor/round/min/max/abs (IEEE-exact) and rng32 lattice
 * noise, so the output is byte-identical on every run and engine. Only the canonical half is
 * computed (with noise symmetric in z, so there is no crease on the axis); the other half is its
 * sample-exact mirror. Heights: u16 steps with heightScaleRaw 32 (1 step = 1/128 WU), water 12 WU.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rng32 } from '@faf/fixed';
import { decodeHeightmapPng, encodeHeightmapPng, type HeightmapData } from './heightmap-io.ts';
import { MAPS_SRC_DIR } from './mapc.ts';
import { decodePng, encodePng } from './png.ts';

export const BRAIDWATER = 'braidwater';

const SIZE = 512;
const DIM = SIZE + 1;
/** Height steps per WU (heightScaleRaw 32 ⇒ 4096 / 32). */
const U = 128;
const SEED = 0xb2a1d7e5;
/** Water level (WU, §1). */
export const BRAIDWATER_WATER = 12;
const WATER = BRAIDWATER_WATER;
/** Mirror axis (z, WU). */
const AXIS = 256;
/** Splat resolution (texels per edge, 2 WU per texel). */
export const BRAIDWATER_SPLAT_RES = 256;

// -------------------------------------------------------------------------------------------------
// Layout data (canonical = south team, army 0; the north team is the mirror). WU unless noted.

type P = { readonly x: number; readonly z: number };

const mirror = (p: P): P => ({ x: p.x, z: SIZE - p.z });

/** Starts §6 (army 0 = south, army 1 = its mirror). */
export const BRAIDWATER_START_S: P = { x: 154, z: 446 };
/** Start-ring radius of the 4 start mex (§7). */
export const START_MEX_RADIUS = 16;

/** Terrain mass spots of the south side (§7 without the start ring, in spec order). */
export const BRAIDWATER_MASS_S: readonly { x: number; z: number; zone: string }[] = [
  { x: 108, z: 468, zone: 'backyard' },
  { x: 124, z: 494, zone: 'backyard' },
  { x: 44, z: 432, zone: 'hollow' },
  { x: 30, z: 336, zone: 'watch' },
  { x: 48, z: 352, zone: 'watch' },
  { x: 84, z: 304, zone: 'ford' },
  { x: 180, z: 298, zone: 'bluff' },
  { x: 236, z: 298, zone: 'bluff' },
  { x: 350, z: 392, zone: 'eastfield' },
  { x: 372, z: 410, zone: 'eastfield' },
  { x: 346, z: 420, zone: 'eastfield' },
  { x: 452, z: 392, zone: 'estuary' },
  { x: 474, z: 410, zone: 'estuary' },
];

/** The 2 island mass spots on the axis (§7). */
export const BRAIDWATER_ISLAND_MASS: readonly P[] = [
  { x: 300, z: 256 },
  { x: 400, z: 256 },
];

/** Hydros §8: base and ford of the south side; the island hydro sits on the axis. */
export const BRAIDWATER_HYDRO_S: readonly P[] = [
  { x: 186, z: 470 },
  { x: 120, z: 296 },
];
export const BRAIDWATER_ISLAND_HYDRO: P = { x: 350, z: 256 };

/** Plateaus §4.2 (south side). */
export const BRAIDWATER_PLATEAUS = {
  /** Rounded rectangle, the south side runs beyond the map edge. */
  base: { x0: 84, z0: 388, x1: 236, z1: 600, r: 24, top: 28 },
  watch: { x: 36, z: 340, r: 44, top: 30 },
  /** Rounded rectangle whose north edge is the river bank (top edge {@link BLUFF_SETBACK} WU behind the shore). */
  bluff: { x0: 152, z0: 200, x1: 262, z1: 330, r: 12, top: 24 },
  knoll: { x: 318, z: 360, r: 20, top: 28 },
} as const;

/** Top edge of the bluff behind the (noisy) river shore; the cliff falls straight into the river. */
const BLUFF_SETBACK = 3;

/** River island (§3.1): ellipse on the axis. */
export const BRAIDWATER_ISLAND = { x: 350, z: 256, rx: 70, rz: 28 } as const;
/** Estuary basin at the east edge (§3.1). */
const ESTUARY = { x: 530, rx: 100, rz: 90 } as const;

/** Fords §3.2 (x ranges; the west ford spans the river, the island fords the two channels). */
export const BRAIDWATER_FORDS = {
  west: { x0: 64, x1: 96 },
  island: { x0: 380, x1: 412 },
  /** Ford bed (WU): 0.35 WU deep. */
  bed: 11.65,
} as const;
const FORD_FADE = 4;

export interface Ramp {
  readonly id: string;
  /** Top end (on the plateau edge) and foot, WU. */
  readonly a: P;
  readonly b: P;
  readonly width: number;
  readonly top: number;
  /** WU the foot height continues beyond `b` (the watch ramp runs on into the base's west ramp). */
  readonly runOn?: number;
}

/**
 * Ramps §4.3 (south side). `watch` descends east and merges into the side of `baseWest` at mid
 * height (Y junction: its foot follows the base ramp's surface and runs on under it), so the watch plateau is reached from the lower half of the base's west ramp;
 * `hollow` leads from the base plateau down into the west hollow (spec §13: the hollow is a dead end
 * behind the base, the watch plateau closes it off against the west meadow).
 */
export const BRAIDWATER_RAMPS: readonly Ramp[] = [
  { id: 'watch', a: { x: 76, z: 360 }, b: { x: 114, z: 360 }, width: 16, top: 30, runOn: 10 },
  { id: 'baseWest', a: { x: 128, z: 388 }, b: { x: 128, z: 342 }, width: 20, top: 28 },
  { id: 'baseEast', a: { x: 236, z: 410 }, b: { x: 284, z: 410 }, width: 24, top: 28 },
  { id: 'hollow', a: { x: 84, z: 448 }, b: { x: 36, z: 448 }, width: 16, top: 28 },
  { id: 'bluff', a: { x: 208, z: 330 }, b: { x: 208, z: 366 }, width: 20, top: 24 },
  { id: 'knoll', a: { x: 318, z: 380 }, b: { x: 318, z: 420 }, width: 16, top: 28 },
];
/** Width of the soft side band of a ramp (WU). */
const RAMP_SIDE = 3;

/** Corner rocks §4.4 (south side): quarter circles around the map corners. */
const CORNER_ROCKS: readonly (readonly [number, number, number])[] = [
  [0, 512, 50],
  [512, 512, 60],
];

/** Centre of the west hollow (a shallow basin, §4.1). */
const HOLLOW = { x: 40, z: 440 } as const;

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

function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Signed distance to a rounded rectangle (negative inside). */
function roundedRectSd(x: number, z: number, x0: number, z0: number, x1: number, z1: number, r: number): number {
  const qx = Math.abs(x - (x0 + x1) * 0.5) - ((x1 - x0) * 0.5 - r);
  const qz = Math.abs(z - (z0 + z1) * 0.5) - ((z1 - z0) * 0.5 - r);
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - r;
}

/** Approximate signed distance to an axis-aligned ellipse (negative inside), exact on the axes. */
function ellipseSd(dx: number, dz: number, rx: number, rz: number): number {
  const ax = dx / rx;
  const az = dz / rz;
  const k0 = Math.sqrt(ax * ax + az * az);
  const bx = dx / (rx * rx);
  const bz = dz / (rz * rz);
  const k1 = Math.sqrt(bx * bx + bz * bz);
  if (k1 === 0) return -Math.min(rx, rz);
  return (k0 * (k0 - 1)) / k1;
}

/** 1 inside [a, b], fading to 0 over `fade` WU outside. */
function rangeMask(v: number, a: number, b: number, fade: number): number {
  if (v >= a && v <= b) return 1;
  const o = v < a ? a - v : v - b;
  return 1 - S(o / fade);
}

// -------------------------------------------------------------------------------------------------
// Noise: value noise on rng32 lattices (precomputed tables), mirror-symmetric in z.

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

  /** Mirror-symmetric noise: same value at (x, z) and (x, 512 − z), no crease on the axis. */
  sym(x: number, z: number): number {
    return (this.at(x, z) + this.at(x, SIZE - z)) * 0.5;
  }
}

const N = {
  shoreA: new Lattice(26, 1),
  shoreB: new Lattice(11, 2),
  isl: new Lattice(18, 3),
  bed: new Lattice(40, 4),
  bed2: new Lattice(13, 5),
  hillA: new Lattice(34, 6),
  hillB: new Lattice(15, 7),
  hillC: new Lattice(7, 8),
  edgeA: new Lattice(36, 9),
  edgeB: new Lattice(8, 10),
  topA: new Lattice(24, 11),
  rockA: new Lattice(22, 12),
  rockB: new Lattice(9, 13),
  ridge: new Lattice(16, 14),
  ridge2: new Lattice(7, 15),
  gravel: new Lattice(10, 16),
  patch: new Lattice(30, 17),
  patch2: new Lattice(12, 18),
  patch3: new Lattice(44, 19),
  moss: new Lattice(20, 20),
} as const;

// -------------------------------------------------------------------------------------------------
// Spots

export interface BraidwaterSpot {
  readonly kind: 'mass' | 'hydro';
  readonly x: number;
  readonly z: number;
  /** On the mirror axis (island spots, shared). */
  readonly axis: boolean;
}

/**
 * Every mass/hydro spot in markers order: mass per §7 row (south, then north), island mass last;
 * hydro base S/N, ford S/N, island.
 */
export function braidwaterSpots(): BraidwaterSpot[] {
  const out: BraidwaterSpot[] = [];
  const s = BRAIDWATER_START_S;
  const r = START_MEX_RADIUS;
  const ring: P[] = [
    { x: s.x - r, z: s.z },
    { x: s.x + r, z: s.z },
    { x: s.x, z: s.z - r },
    { x: s.x, z: s.z + r },
  ];
  for (const p of [...ring, ...BRAIDWATER_MASS_S]) {
    out.push({ kind: 'mass', x: p.x, z: p.z, axis: false });
    out.push({ kind: 'mass', ...mirror(p), axis: false });
  }
  for (const p of BRAIDWATER_ISLAND_MASS) out.push({ kind: 'mass', x: p.x, z: p.z, axis: true });
  for (const p of BRAIDWATER_HYDRO_S) {
    out.push({ kind: 'hydro', x: p.x, z: p.z, axis: false });
    out.push({ kind: 'hydro', ...mirror(p), axis: false });
  }
  out.push({ kind: 'hydro', ...BRAIDWATER_ISLAND_HYDRO, axis: true });
  return out;
}

const SPOTS = braidwaterSpots();
/** Spots of the canonical half (z ≥ 256, axis spots included). */
const SPOTS_S = SPOTS.filter((p) => p.z >= AXIS);

// -------------------------------------------------------------------------------------------------
// Water

/** River half width (§3.1) before shoreline noise: 18 (west) → 24 (middle) → 58 (braid section). */
function riverHalfWidth(x: number): number {
  if (x < 120) return 18;
  if (x < 160) return 18 + 6 * S((x - 120) / 40);
  if (x < 250) return 24;
  return 24 + 34 * S((x - 250) / 50);
}

/** 1 around the fords (their outline stays exact), 0 away from them. */
function nearFord(x: number): number {
  const F = BRAIDWATER_FORDS;
  return Math.max(rangeMask(x, F.west.x0 - 8, F.west.x1 + 8, 14), rangeMask(x, F.island.x0 - 8, F.island.x1 + 8, 14));
}

/** Shoreline noise (WU, symmetric): ±4 WU, calmer at the bluffs, none at the fords. */
function shoreNoise(x: number, z: number): number {
  const calm = 1 - 0.7 * rangeMask(x, 150, 264, 16);
  return (3 * N.shoreA.sym(x, z) + 1.2 * N.shoreB.sym(x, z)) * calm * (1 - nearFord(x));
}

/**
 * Signed distance to the water (WU): positive on land (incl. the island), negative in the river or
 * the estuary. Land spots keep ≥ 16 WU of land, island spots ≥ 8 WU.
 */
function waterSd(x: number, z: number): number {
  const d = Math.abs(z - AXIS);
  const sn = shoreNoise(x, z);
  const river = d - riverHalfWidth(x) - sn;
  const est = ellipseSd(x - ESTUARY.x, d, ESTUARY.rx, ESTUARY.rz) - 1.3 * sn;
  let s = Math.min(river, est);
  const I = BRAIDWATER_ISLAND;
  const isl = ellipseSd(x - I.x, d, I.rx, I.rz) + (3.5 * N.isl.sym(x, z) + 1.2 * N.shoreB.sym(x, z)) * (1 - nearFord(x));
  if (-isl > s) s = -isl;
  for (const p of SPOTS_S) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz >= 400) continue;
    const keep = (p.axis ? 10 : 18) - Math.sqrt(dx * dx + dz * dz);
    if (keep > s) s = keep;
  }
  return s;
}

/** Ford mask (1 on the ford beds, lateral fade over {@link FORD_FADE} WU). */
function fordMask(x: number, z: number): number {
  const F = BRAIDWATER_FORDS;
  const d = Math.abs(z - AXIS);
  let m = 0;
  if (d < 40) m = rangeMask(x, F.west.x0, F.west.x1, FORD_FADE);
  if (d > 6 && d < 76) m = Math.max(m, rangeMask(x, F.island.x0, F.island.x1, FORD_FADE));
  return m;
}

/** River/estuary bed at depth distance e > 0 into the water (§3.3). */
function riverBed(e: number, x: number, z: number): number {
  const core = lerp(6, 4, S((x - 420) / 70)) + 0.9 * N.bed.sym(x, z) + 0.4 * N.bed2.sym(x, z);
  let b = e < 6 ? WATER - 3 * S(e / 6) : 9 - (9 - core) * S((e - 6) / 10);
  const fm = fordMask(x, z);
  if (fm > 0) b = lerp(b, Math.max(b, BRAIDWATER_FORDS.bed), fm);
  return b;
}

// -------------------------------------------------------------------------------------------------
// Land

/** Rolling midland hills (§4.1: wavelength ≈ 60 WU, slope p50 ≈ 0.08, max ≈ 0.3). */
function hills(x: number, z: number): number {
  return 2.8 * N.hillA.sym(x, z) + 1.0 * N.hillB.sym(x, z) + 0.25 * N.hillC.sym(x, z) + 0.2;
}

/** Land height at distance s > 0 from the water: meadow 12 → 14.6 (30 WU), midland ≈ 18 ± 2. */
function landHeight(s: number, x: number, z: number): number {
  let h = WATER + 2.6 * S(s / 30) + 3.4 * S((s - 24) / 60);
  h += hills(x, z) * S((s - 10) / 50);
  // West hollow: a shallow basin (≈ 15–17 WU).
  const r = dist(x, z, HOLLOW.x, HOLLOW.z);
  if (r < 90) h -= 2.2 * (1 - S((r - 30) / 50));
  // River island: a low gravel ridge along its spine (up to ≈ 16 WU).
  const I = BRAIDWATER_ISLAND;
  const q = ellipseSd(x - I.x, Math.abs(z - AXIS), I.rx, I.rz);
  if (q < 0) h += 1.1 * S(-q / 16) * (0.6 + 0.4 * N.gravel.sym(x, z));
  return h;
}

/** Terrain without plateaus, ramps and rocks: river bed or land. */
function groundAt(x: number, z: number): number {
  const s = waterSd(x, z);
  return s < 0 ? riverBed(-s, x, z) : landHeight(s, x, z);
}

// -------------------------------------------------------------------------------------------------
// Plateaus and ramps

/** 0 near a ramp's top end (straight plateau edge there), 1 away from it. */
function awayFromRampTops(x: number, z: number): number {
  let m = 1;
  for (const r of BRAIDWATER_RAMPS) {
    const dd = dist(x, z, r.a.x, r.a.z) - r.width * 0.5 - 6;
    if (dd < 14) m = Math.min(m, S(dd / 14));
  }
  return m;
}

/** Outline noise of the plateau edges (±3 WU), none at the ramps. */
function edgeNoise(x: number, z: number): number {
  return (1.8 * N.edgeA.sym(x, z) + 1.0 * N.edgeB.sym(x, z)) * awayFromRampTops(x, z);
}

interface PlateauSample {
  /** Signed distance to the top edge (negative on the plateau). */
  readonly sd: number;
  readonly top: number;
}

function plateauSamples(x: number, z: number): PlateauSample[] {
  const Pl = BRAIDWATER_PLATEAUS;
  const en = edgeNoise(x, z);
  const tn = 0.3 * N.topA.sym(x, z);
  const B = Pl.base;
  const W = Pl.watch;
  const H = Pl.bluff;
  const K = Pl.knoll;
  const d = Math.abs(z - AXIS);
  const bluffRiver = riverHalfWidth(x) + shoreNoise(x, z) + BLUFF_SETBACK - d;
  return [
    { sd: roundedRectSd(x, z, B.x0, B.z0, B.x1, B.z1, B.r) + en, top: B.top },
    { sd: dist(x, z, W.x, W.z) - W.r + en, top: W.top + tn },
    { sd: Math.max(roundedRectSd(x, z, H.x0, H.z0, H.x1, H.z1, H.r) + 0.9 * en, bluffRiver), top: H.top + tn },
    { sd: dist(x, z, K.x, K.z) - K.r + 0.6 * en, top: K.top + tn },
  ];
}

/** Plateau with a flat top and a steep cliff band (slope ≥ 1.5 at its middle) down to `g`. */
function plateauHeight(p: PlateauSample, g: number): number {
  if (p.sd <= 0) return p.top;
  const drop = p.top - g;
  if (drop <= 0) return g;
  const cw = Math.min(6, Math.max(3, drop * 0.5));
  if (p.sd >= cw) return g;
  return p.top - drop * S(p.sd / cw);
}

/** Position of (x, z) relative to a ramp: along (WU from the top end), across (WU off the axis). */
function rampFrame(r: Ramp, x: number, z: number): { along: number; across: number; len: number } {
  const dx = r.b.x - r.a.x;
  const dz = r.b.z - r.a.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const ux = dx / len;
  const uz = dz / len;
  const px = x - r.a.x;
  const pz = z - r.a.z;
  return { along: px * ux + pz * uz, across: Math.abs(px * uz - pz * ux), len };
}

/** Ramp surface: linear from the top down to `foot` at the far end. */
function rampSurface(r: Ramp, t: number, foot: number): number {
  return r.top + (foot - r.top) * clamp01(t);
}

const RAMP_BASE_WEST = BRAIDWATER_RAMPS.find((r) => r.id === 'baseWest')!;

/** Run-out beyond a ramp's foot (WU): the constant foot height blends into the local ground. */
const RAMP_RUNOUT = 10;

/** Foot height of every ramp: the ground at its foot point, so the ramp has one constant slope. */
const RAMP_FOOT: ReadonlyMap<string, number> = new Map(BRAIDWATER_RAMPS.map((r) => [r.id, groundAt(r.b.x, r.b.z)]));

/** Height of the base's west ramp at (x, z) (the watch ramp ends on it). */
function baseWestSurface(x: number, z: number): number {
  const f = rampFrame(RAMP_BASE_WEST, x, z);
  return rampSurface(RAMP_BASE_WEST, f.along / f.len, RAMP_FOOT.get(RAMP_BASE_WEST.id)!);
}

/** Terrain heights (WU) of one canonical sample. */
function heightAt(x: number, z: number): number {
  const g = groundAt(x, z);
  let h = g;
  for (const p of plateauSamples(x, z)) h = Math.max(h, plateauHeight(p, g));
  for (const r of BRAIDWATER_RAMPS) {
    const f = rampFrame(r, x, z);
    if (f.along < -12 || f.along > f.len + (r.runOn ?? RAMP_RUNOUT) || f.across >= r.width * 0.5 + RAMP_SIDE) continue;
    const foot = r.runOn !== undefined ? baseWestSurface(x, z) : RAMP_FOOT.get(r.id)!;
    const rh = f.along <= f.len || r.runOn !== undefined ? rampSurface(r, f.along / f.len, foot) : lerp(foot, g, S((f.along - f.len) / RAMP_RUNOUT));
    const w = f.across <= r.width * 0.5 ? 1 : 1 - S((f.across - r.width * 0.5) / RAMP_SIDE);
    h = lerp(h, rh, w);
  }
  return rockAdd(x, z, h);
}

/** Corner rocks §4.4: ridged, unpassable (30–48 WU), with a steep rim. */
function rockAdd(x: number, z: number, h: number): number {
  let sd = Infinity;
  for (const [cx, cz, r] of CORNER_ROCKS) sd = Math.min(sd, dist(x, z, cx, cz) - r);
  if (sd > 14) return h;
  sd += 5 * N.rockA.sym(x, z) + 2 * N.rockB.sym(x, z);
  if (sd >= 2) return h;
  const t = S((2 - sd) / 12);
  const r1 = 1 - Math.abs(N.ridge.sym(x, z));
  const r2 = 1 - Math.abs(N.ridge2.sym(x, z));
  const top = 31 + 9 * r1 * r1 + 3 * r2 * r1 + 6 * clamp01(-sd / 40);
  return Math.max(h, lerp(h, top, t) + 1.2 * N.rockB.sym(x, z) * t);
}

// -------------------------------------------------------------------------------------------------
// Heightfield assembly

function mirrorFill(h: Float64Array): void {
  for (let z = 0; z < AXIS; z++) {
    const src = (SIZE - z) * DIM;
    const dst = z * DIM;
    for (let x = 0; x < DIM; x++) h[dst + x] = h[src + x]!;
  }
}

/**
 * Flattens discs on the canonical half: fully flat inside rFlat, blended out to rBlend, towards the
 * height at the centre; where discs overlap the disc with the highest weight wins.
 */
function flatten(h: Float64Array, centres: readonly (P & { rFlat: number; rBlend: number })[]): void {
  const targets = centres.map((c) => h[c.z * DIM + c.x]!);
  for (let z = AXIS; z < DIM; z++) {
    for (let x = 0; x < DIM; x++) {
      let best = 0;
      let bestK = -1;
      for (let k = 0; k < centres.length; k++) {
        const c = centres[k]!;
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz >= c.rBlend * c.rBlend) continue;
        const w = 1 - S((Math.sqrt(dx * dx + dz * dz) - c.rFlat) / (c.rBlend - c.rFlat));
        if (w > best) {
          best = w;
          bestK = k;
        }
      }
      if (bestK >= 0) h[z * DIM + x] = lerp(h[z * DIM + x]!, targets[bestK]!, best);
    }
  }
  mirrorFill(h);
}

/** Terrain heights in WU (float, exactly mirror-symmetric at z = 256). */
export function generateBraidwaterHeightsWu(): Float64Array {
  const h = new Float64Array(DIM * DIM);
  for (let z = AXIS; z < DIM; z++) for (let x = 0; x < DIM; x++) h[z * DIM + x] = heightAt(x, z);
  mirrorFill(h);
  // Spot pads (§7: mass r 4 flat, blend to 12; §8: hydro r 8 flat).
  flatten(
    h,
    SPOTS_S.map((p) => (p.kind === 'mass' ? { x: p.x, z: p.z, rFlat: 4, rBlend: 12 } : { x: p.x, z: p.z, rFlat: 8, rBlend: 15 })),
  );
  return h;
}

/** Generates the heightmap (dim² u16 steps), exactly mirror-symmetric. */
export function generateBraidwaterHeights(wu: Float64Array = generateBraidwaterHeightsWu()): HeightmapData {
  const samples = new Uint16Array(DIM * DIM);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(0, Math.min(0xffff, Math.round(wu[i]! * U)));
  for (let z = 0; z < AXIS; z++) for (let x = 0; x < DIM; x++) samples[z * DIM + x] = samples[(SIZE - z) * DIM + x]!;
  return { dim: DIM, samples };
}

// -------------------------------------------------------------------------------------------------
// Splat (8 layers in two RGBA planes, same layer set and encoding as Setons)
//   plane 0: R sand, G grass, B rock, A highland
//   plane 1: R dirt, G dry grass, B dark rock, A moss
// Plane 0 has R = 1 and covers the auto-splat completely; plane 1 reproduces layers 4–7 on top.

const L_SAND = 0;
const L_GRASS = 1;
const L_ROCK = 2;
const L_HIGH = 3;
const L_DIRT = 4;
const L_DRY = 5;
const L_DARK = 6;
const L_MOSS = 7;

function slopeAt(h: Float64Array, x: number, z: number): number {
  const xi = Math.max(1, Math.min(SIZE - 1, Math.round(x)));
  const zi = Math.max(1, Math.min(SIZE - 1, Math.round(z)));
  const gx = (h[zi * DIM + xi + 1]! - h[zi * DIM + xi - 1]!) * 0.5;
  const gz = (h[(zi + 1) * DIM + xi]! - h[(zi - 1) * DIM + xi]!) * 0.5;
  return Math.sqrt(gx * gx + gz * gz);
}

function byte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

function paint(w: Float64Array, layer: number, amount: number): void {
  const a = clamp01(amount);
  if (a <= 0) return;
  for (let k = 0; k < 8; k++) w[k] = w[k]! * (1 - a);
  w[layer] = w[layer]! + a;
}

function factor(wk: number, rest: number): number {
  return rest > 1e-6 ? clamp01(wk / rest) : 0;
}

/** 1 on a ramp surface (incl. its side band), 0 elsewhere. */
function onRamp(x: number, z: number): number {
  let m = 0;
  for (const r of BRAIDWATER_RAMPS) {
    const f = rampFrame(r, x, z);
    if (f.along < -4 || f.along > f.len + 4) continue;
    m = Math.max(m, 1 - S((f.across - r.width * 0.5) / RAMP_SIDE));
  }
  return m;
}

/** Worn track in the middle third of a ramp, frayed by `fray` (≈ ±0,5) and fading out past the foot. */
function rampTrack(x: number, z: number, fray: number): number {
  let m = 0;
  for (const r of BRAIDWATER_RAMPS) {
    const f = rampFrame(r, x, z);
    const ends = (1 - S((-f.along - 2) / 4)) * (1 - S((f.along - f.len - 4 - 8 * fray) / 8));
    m = Math.max(m, ends * (1 - S((f.across - r.width * 0.16 - 3 * fray) / 3)));
  }
  return m;
}

/** Triangle wave in [0, 1] with period `p` (IEEE-exact, no trigonometry). */
function tri(v: number, p: number): number {
  const t = v / p - Math.floor(v / p);
  return Math.abs(2 * t - 1);
}

/** 1 on a plateau top (distance ≥ 2 WU inside the edge). */
function onPlateauTop(x: number, z: number, which: number): number {
  const p = plateauSamples(x, z)[which]!;
  return 1 - S((p.sd + 3) / 3);
}

/** Final weights of the 8 layers at a canonical point (sum 1). */
function splatWeights(w: Float64Array, hw: Float64Array, x: number, z: number): void {
  const h = hw[Math.round(z) * DIM + Math.round(x)]!;
  const slope = slopeAt(hw, x, z);
  const s = waterSd(x, z);
  const patch = N.patch.sym(x, z) * 0.7 + N.patch2.sym(x, z) * 0.3;
  const patchB = N.patch3.sym(x, z) * 0.7 + N.moss.sym(x, z) * 0.3;
  const moss = N.moss.sym(x, z);

  w.fill(0);
  w[L_GRASS] = 1;
  // Meadow with dry-grass and earth patches; the midland is drier than the river meadow.
  paint(w, L_DRY, 0.45 * S((patchB + 0.1) / 0.45) * S((h - 15) / 3));
  paint(w, L_DIRT, 0.35 * S((patch + 0.05) / 0.45));
  // River meadow (≤ 30 WU from the water): moss down to the waterline.
  paint(w, L_MOSS, 0.55 * (1 - S((s - 4) / 26)) * S((moss + 0.35) / 0.6));
  // Base plateau: a drier upland meadow with a trodden earth core around the start (not a bare slab).
  const fray = N.gravel.sym(x, z) * 0.6 + N.patch2.sym(x, z) * 0.4;
  const base = onPlateauTop(x, z, 0);
  const st = BRAIDWATER_START_S;
  const core = 1 - S((dist(x, z, st.x, st.z) - 34 - 22 * fray) / 14);
  paint(w, L_DRY, base * 0.45 * S((patchB + 0.2) / 0.5));
  paint(w, L_DIRT, base * core * (0.45 + 0.3 * S((patch + 0.2) / 0.5)));
  // Ramps: gravel verges, a worn earth track in the middle that frays out at the foot.
  const ramp = onRamp(x, z);
  paint(w, L_DRY, ramp * 0.35);
  paint(w, L_DIRT, rampTrack(x, z, fray) * 0.6);
  // Watch plateau and knoll: weathered tops with rock and highland patches.
  const high = Math.max(onPlateauTop(x, z, 1), onPlateauTop(x, z, 3));
  paint(w, L_ROCK, high * 0.5 * S((patch + 0.1) / 0.4));
  paint(w, L_HIGH, high * 0.35 * S((patchB + 0.05) / 0.4));
  paint(w, L_DRY, onPlateauTop(x, z, 2) * 0.35 * S((patchB + 0.2) / 0.5));
  // West hollow: scree (dark rock) and dry grass.
  const hollow = 1 - S((dist(x, z, HOLLOW.x, HOLLOW.z) - 30) / 40);
  paint(w, L_DARK, hollow * 0.35 * S((N.gravel.sym(x, z) - 0.05) / 0.4));
  // River bed: mud (earth, moss, dark rock) seen through the water.
  const under = S((WATER + 0.2 - h) / 0.8);
  paint(w, L_DIRT, under * 0.7);
  paint(w, L_MOSS, under * 0.3 * S((moss + 0.3) / 0.6));
  paint(w, L_DARK, under * 0.4 * S((WATER - 3 - h) / 4));
  // Gravel (sand layer) on the fords and, frayed, a few WU up their banks; patches on the river island.
  const I = BRAIDWATER_ISLAND;
  const onIsland = 1 - S((ellipseSd(x - I.x, Math.abs(z - AXIS), I.rx, I.rz) + 2) / 4);
  const Fd = BRAIDWATER_FORDS;
  // Bank gravel frays out in x with short-wave noise too (the bank strips are only a few WU deep).
  const fx = x + 10 * fray + 14 * (N.edgeB.sym(x, z) * 0.6 + N.ridge2.sym(x, z) * 0.4);
  const fordBand = Math.max(rangeMask(fx, Fd.west.x0, Fd.west.x1, 6), rangeMask(fx, Fd.island.x0, Fd.island.x1, 6));
  const ford = Math.max(fordMask(x, z) * S((WATER - 0.05 - h) / 0.25), fordBand * (1 - S((s - 2 - 6 * (fray + 0.5)) / 5)) * (1 - onIsland));
  paint(w, L_SAND, ford * 0.85);
  paint(w, L_SAND, onIsland * (0.35 + 0.4 * S((N.gravel.sym(x, z) + 0.1) / 0.4)));
  // Corner rocks, cliffs.
  const rock = S((h - 30) / 4) * (1 - base);
  paint(w, L_ROCK, rock * 0.8);
  paint(w, L_HIGH, rock * 0.6 * S((h - 38) / 6));
  const steep = S((slope - 0.55) / 0.45);
  paint(w, L_ROCK, steep * 0.9);
  // Strata: horizontal dark bands on the cliff faces (period 3,2 WU in height, slightly wavy).
  const band = S((tri(h + 0.8 * fray, 3.2) - 0.55) / 0.3);
  paint(w, L_DARK, steep * (0.2 * S((patch + 0.2) / 0.6) + 0.45 * band));
  // Cliff lip: a frayed rock rim just inside every plateau edge (not on the ramps).
  let lip = 0;
  for (let k = 0; k < 4; k++) {
    const sd = plateauSamples(x, z)[k]!.sd;
    lip = Math.max(lip, (1 - S((-sd - 1.5 - 2.5 * (fray + 0.5)) / 1.5)) * (1 - S(sd / 1.5)));
  }
  paint(w, L_ROCK, lip * (1 - ramp) * 0.55);
  // Spot pads: pale gravel under every mass/hydro spot so the markers read on any ground.
  for (const p of SPOTS_S) {
    const dd = dist(x, z, p.x, p.z);
    if (dd < 12) paint(w, L_SAND, (1 - S((dd - 4.5 - 2 * fray) / 2.5)) * 0.6);
  }
}

/** Two RGBA8 planes (res² texels), mirror-symmetric at the axis. */
export function generateBraidwaterSplat(heightsWu: Float64Array, res = BRAIDWATER_SPLAT_RES): [Uint16Array, Uint16Array] {
  const p0 = new Uint16Array(res * res * 4);
  const p1 = new Uint16Array(res * res * 4);
  const step = SIZE / res;
  const w = new Float64Array(8);
  for (let j = res >> 1; j < res; j++) {
    for (let i = 0; i < res; i++) {
      splatWeights(w, heightsWu, (i + 0.5) * step, (j + 0.5) * step);
      const o = (j * res + i) * 4;
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
  // Mirror the texel rows (row j ↔ row res − 1 − j).
  for (let j = 0; j < res >> 1; j++) {
    const src = (res - 1 - j) * res * 4;
    const dst = j * res * 4;
    for (let k = 0; k < res * 4; k++) {
      p0[dst + k] = p0[src + k]!;
      p1[dst + k] = p1[src + k]!;
    }
  }
  return [p0, p1];
}

// -------------------------------------------------------------------------------------------------
// markers.json

type Prop = { id: string; x: number; z: number; yawDeg: number; scale: number };

/** Reclaim fields §9 (south side): centre/extent, count, scale range (tenths), salt. */
const PROP_FIELDS: readonly { name: string; pick: (u: number, v: number) => P; n: number; s0: number; s1: number; salt: number }[] = [
  { name: 'ford scree', pick: (u, v) => ({ x: 56 + 56 * u, z: 276 + 24 * v }), n: 6, s0: 8, s1: 13, salt: 1 },
  { name: 'west hollow', pick: (u, v) => ({ x: 10 + 70 * u, z: 400 + 100 * v }), n: 8, s0: 14, s1: 20, salt: 2 },
  {
    name: 'knoll foot',
    pick: (u, v) => {
      // Ring r 26–34 around the knoll (angle from u, no trigonometry: point on a square → normalised).
      const ax = 2 * u - 1;
      const az = v < 0.5 ? -(1 - Math.abs(ax)) : 1 - Math.abs(ax);
      const l = Math.sqrt(ax * ax + az * az);
      const rr = 26 + 8 * ((v * 2) % 1);
      return { x: 318 + (ax / l) * rr, z: 360 + (az / l) * rr };
    },
    n: 4,
    s0: 10,
    s1: 15,
    salt: 3,
  },
  { name: 'estuary shore', pick: (u, v) => ({ x: 430 + 70 * u, z: 340 + 100 * v }), n: 6, s0: 11, s1: 18, salt: 4 },
  { name: 'bluff back', pick: (u, v) => ({ x: 160 + 100 * u, z: 336 + 14 * v }), n: 3, s0: 8, s1: 12, salt: 5 },
  { name: 'island gravel', pick: (u, v) => ({ x: 300 + 100 * u, z: 264 + 8 * v }), n: 4, s0: 10, s1: 15, salt: 6 },
];

/** Deterministic reclaim rocks (§9), mirror-symmetric; 2 more on the axis at the island tips. */
function braidwaterProps(hw: Float64Array): Prop[] {
  const s: Prop[] = [];
  const start = BRAIDWATER_START_S;
  for (const f of PROP_FIELDS) {
    let k = 0;
    for (let attempt = 0; k < f.n && attempt < f.n * 60; attempt++) {
      const a = rng32(SEED, f.salt, attempt, 101);
      const b = rng32(SEED, f.salt, attempt, 102);
      const c = rng32(SEED, f.salt, attempt, 103);
      const p = f.pick((a >>> 16) / 65536, (a & 0xffff) / 65536);
      const x = Math.round(p.x);
      const z = Math.round(p.z);
      if (x < 6 || x > SIZE - 6 || z < AXIS + 8 || z > SIZE - 6) continue;
      const hh = hw[z * DIM + x]!;
      if (hh < WATER + 0.6 || slopeAt(hw, x, z) > 0.45) continue;
      if (SPOTS.some((q) => (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < 12 * 12)) continue;
      if ((start.x - x) * (start.x - x) + (start.z - z) * (start.z - z) < 45 * 45) continue;
      if (onRamp(x, z) > 0 || fordMask(x, z) > 0) continue;
      if (s.some((q) => (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < 6 * 6)) continue;
      const scale = (f.s0 + ((c >>> 16) % (f.s1 - f.s0 + 1))) / 10;
      s.push({ id: (b & 1) === 0 ? 'core:rock_01' : 'core:rock_02', x, z, yawDeg: (b >>> 8) % 360, scale });
      k++;
    }
  }
  const axis: Prop[] = [
    { id: 'core:rock_02', x: 288, z: AXIS, yawDeg: 90, scale: 1.3 },
    { id: 'core:rock_01', x: 412, z: AXIS, yawDeg: 270, scale: 1.2 },
  ];
  return [...s, ...s.map((p) => ({ ...p, ...mirror(p), yawDeg: (540 - p.yawDeg) % 360 })), ...axis];
}

/** markers.json content (world units). */
export function braidwaterMarkers(heightsWu: Float64Array = generateBraidwaterHeightsWu()): Record<string, unknown> {
  const mass = SPOTS.filter((p) => p.kind === 'mass').map((p) => ({ x: p.x, z: p.z }));
  const hydro = SPOTS.filter((p) => p.kind === 'hydro').map((p) => ({ x: p.x, z: p.z }));
  return {
    version: 1,
    name: 'Braidwater',
    sizeWu: SIZE,
    heightScaleRaw: 4096 / U,
    waterLevel: WATER,
    starts: [
      { army: 0, ...BRAIDWATER_START_S },
      { army: 1, ...mirror(BRAIDWATER_START_S) },
    ],
    mass,
    hydro,
    props: braidwaterProps(heightsWu),
    // Sun from the west, parallel to the axis (§10.1): both teams' river cliffs lit alike.
    light: { azimuthDeg: 270, elevationDeg: 45, sun: [255, 240, 216], ambient: [90, 104, 120] },
    strata: [
      { name: 'gravel', color: [176, 166, 138] },
      { name: 'meadow', color: [88, 122, 62] },
      { name: 'earth', color: [116, 94, 66] },
      { name: 'cliff', color: [112, 104, 92] },
      { name: 'highland', color: [192, 190, 180] },
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
export function generateBraidwaterSources(): { heightmap: HeightmapData; splat: [Uint16Array, Uint16Array]; markers: Record<string, unknown> } {
  const heightmap = generateBraidwaterHeights();
  const q = new Float64Array(heightmap.samples.length);
  for (let i = 0; i < q.length; i++) q[i] = heightmap.samples[i]! / U;
  return { heightmap, splat: generateBraidwaterSplat(q), markers: braidwaterMarkers(q) };
}

/**
 * Writes content/maps/src/braidwater/{heightmap.png, splat-0.png, splat-1.png, markers.json}. PNGs
 * are only rewritten when their decoded samples differ (a different zlib build never dirties them).
 */
export function writeBraidwaterSources(log: (msg: string) => void = () => {}): string {
  const dir = join(MAPS_SRC_DIR, BRAIDWATER);
  mkdirSync(dir, { recursive: true });
  const src = generateBraidwaterSources();
  const pngPath = join(dir, 'heightmap.png');
  let unchanged = 0;
  if (existsSync(pngPath) && samplesEqual(decodeHeightmapPng(new Uint8Array(readFileSync(pngPath)), pngPath).samples, src.heightmap.samples)) unchanged++;
  else writeFileSync(pngPath, encodeHeightmapPng(src.heightmap));
  src.splat.forEach((plane, k) => {
    const path = join(dir, `splat-${k}.png`);
    if (existsSync(path) && samplesEqual(decodePng(new Uint8Array(readFileSync(path))).samples, plane)) unchanged++;
    else writeFileSync(path, encodePng({ width: BRAIDWATER_SPLAT_RES, height: BRAIDWATER_SPLAT_RES, bitDepth: 8, channels: 4, samples: plane }));
  });
  writeFileSync(join(dir, 'markers.json'), `${JSON.stringify(src.markers, null, 2)}\n`);
  log(`mapgen: ${BRAIDWATER} sources in ${dir}${unchanged === 3 ? ' (images unchanged)' : ''}`);
  return dir;
}
