/**
 * Test map generator of @faf/nav (`@faf/nav/testmap`, contract for ms3-p2/p5 and the SPK3 bench).
 * Integer-only (rng32 value noise, isqrt, sinA LUT), deterministic for (sizeWu, seed, kind).
 *
 *   'bases'  cliff plateaus with two ramps at every start, a river with fords, cliff ridges with
 *            narrow gaps (chokes), scattered mesas, and FA-like bases as footprint rectangles
 *   'choke'  flat, one cliff wall across the map (cell rows size/2 − 1 and size/2, no walkable top)
 *            with exactly one 3-WU gap
 *   'open'   gentle rolling terrain, no water, no cliffs
 *
 * Heights are u16 steps with heightScaleRaw 32 (128 steps per WU), compatible with
 * rules.Heightfield; starts are Fx raw like formats.MapStart, so tools can build an RtsMap
 * (`createRtsMap({ sizeWu, heights, heightScaleRaw, waterLevelRaw, starts, name })`).
 */

import { isqrt, rng32, sinA, type Ang16 } from '@faf/fixed';

export type NavTestMapKind = 'bases' | 'choke' | 'open';

export interface NavTestMapOptions {
  /** Power of two, 64..1024 (the plan uses 256, 512, 1024). */
  readonly sizeWu: number;
  readonly seed: number;
  readonly kind: NavTestMapKind;
}

/** Cell rectangle [x, x + w) × [z, z + h) in WU. */
export interface Rect {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
}

export interface NavTestStart {
  readonly army: number;
  /** Fx raw (like formats.MapStart). */
  readonly x: number;
  readonly z: number;
}

export interface NavTestMap {
  readonly name: string;
  readonly sizeWu: number;
  readonly dim: number;
  readonly heights: Uint16Array;
  readonly heightScaleRaw: number;
  readonly waterLevelRaw: number | null;
  readonly starts: readonly NavTestStart[];
  /** Base buildings (all starts), to be stamped as footprints. Empty except for 'bases'. */
  readonly baseFootprints: readonly Rect[];
  /** 'choke': first gap cell x, wall sample row z (blocked cell rows z − 1 and z) and gap width. */
  readonly choke?: { readonly x: number; readonly z: number; readonly gapWu: number };
}

const U = 128; // height steps per WU
const SCALE = 32; // heightScaleRaw
const LAND = 20 * U;
const FX = 4096;

function fdiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function lerp(a: number, b: number, t: number): number {
  return a + fdiv((b - a) * t, 256);
}

function smooth(t: number): number {
  return fdiv(t * t * (768 - 2 * t), 65536);
}

function lattice(seed: number, octave: number, i: number, j: number): number {
  return (rng32(seed, j, i, octave + 17) >>> 21) - 1024;
}

/** Value noise in steps; `amps` per octave (cell sizes 64, 32, 16 WU). */
function noise(seed: number, x: number, z: number, amps: readonly number[]): number {
  let sum = 0;
  for (let o = 0; o < amps.length; o++) {
    const shift = 6 - o;
    const cell = 1 << shift;
    const i = x >> shift;
    const j = z >> shift;
    const tx = smooth(((x & (cell - 1)) << 8) >> shift);
    const tz = smooth(((z & (cell - 1)) << 8) >> shift);
    const a = lerp(lattice(seed, o, i, j), lattice(seed, o, i + 1, j), tx);
    const b = lerp(lattice(seed, o, i, j + 1), lattice(seed, o, i + 1, j + 1), tx);
    sum += fdiv(lerp(a, b, tz) * amps[o]!, 1024);
  }
  return sum;
}

/** Distance in 1/16 WU. */
function dist16(dx: number, dz: number): number {
  return isqrt(dx * dx * 256 + dz * dz * 256);
}

function checkOptions(o: NavTestMapOptions): void {
  const s = o.sizeWu;
  if (!Number.isInteger(s) || s < 64 || s > 1024 || (s & (s - 1)) !== 0) {
    throw new RangeError(`testmap: sizeWu must be a power of two in 64..1024, got ${String(s)}`);
  }
  if (!Number.isInteger(o.seed)) throw new RangeError('testmap: seed must be an integer');
}

/** Generates a test map. */
export function generateNavTestMap(o: NavTestMapOptions): NavTestMap {
  checkOptions(o);
  switch (o.kind) {
    case 'open':
      return openMap(o.sizeWu, o.seed);
    case 'choke':
      return chokeMap(o.sizeWu, o.seed);
    case 'bases':
      return basesMap(o.sizeWu, o.seed);
  }
}

function openMap(size: number, seed: number): NavTestMap {
  const dim = size + 1;
  const heights = new Uint16Array(dim * dim);
  const amps = [3 * U, (3 * U) >> 1, U >> 1];
  for (let z = 0; z < dim; z++) {
    for (let x = 0; x < dim; x++) heights[z * dim + x] = LAND + noise(seed, x, z, amps);
  }
  const q = size >> 2;
  return {
    name: `nav-open-${size}-${seed}`,
    sizeWu: size,
    dim,
    heights,
    heightScaleRaw: SCALE,
    waterLevelRaw: null,
    starts: [
      { army: 0, x: q * FX, z: q * FX },
      { army: 1, x: 3 * q * FX, z: 3 * q * FX },
    ],
    baseFootprints: [],
  };
}

function chokeMap(size: number, seed: number): NavTestMap {
  const dim = size + 1;
  const heights = new Uint16Array(dim * dim);
  const zc = size >> 1;
  // gap position: middle third, varied by seed
  const third = fdiv(size, 3);
  const gx = third + (rng32(seed, 0, 0, 91) % third);
  for (let z = 0; z < dim; z++) {
    for (let x = 0; x < dim; x++) {
      let h = LAND;
      if (z === zc && (x < gx || x > gx + 3)) h = LAND + 8 * U;
      heights[z * dim + x] = h;
    }
  }
  const q = size >> 2;
  return {
    name: `nav-choke-${size}-${seed}`,
    sizeWu: size,
    dim,
    heights,
    heightScaleRaw: SCALE,
    waterLevelRaw: null,
    starts: [
      { army: 0, x: (size >> 1) * FX, z: q * FX },
      { army: 1, x: (size >> 1) * FX, z: 3 * q * FX },
    ],
    baseFootprints: [],
    choke: { x: gx, z: zc, gapWu: 3 },
  };
}

interface Plateau {
  readonly cx: number;
  readonly cz: number;
  /** flat radius (WU) */
  readonly r: number;
  /** ramp directions towards the map centre: ±1 along x and z */
  readonly rx: number;
  readonly rz: number;
}

/** Land level of 'bases' (≥ 20.75 WU with noise: dry except for the river). */
const LAND_BASES = 24 * U;
const PLATEAU_RISE = 6 * U;
const CLIFF_WU = 3;
const RAMP_LEN = 22;
const RAMP_HALF = 5;
const RIDGE_RISE = 8 * U;
const WATER = 19 * U;
const BED = 17 * U;
const FORD_BED = 18 * U + 102; // ≈ 18.8 WU: 0.2 WU deep

function startPositions(size: number): { x: number; z: number }[] {
  const q = size >> 2;
  if (size <= 256) {
    return [
      { x: q, z: q },
      { x: size - q, z: size - q },
    ];
  }
  if (size < 1024) {
    return [
      { x: q, z: q },
      { x: size - q, z: size - q },
      { x: size - q, z: q },
      { x: q, z: size - q },
    ];
  }
  // 1,024 WU: two rows of four (x = 1/8, 3/8, 5/8, 7/8; z = 1/4, 3/4)
  const e = size >> 3;
  const out: { x: number; z: number }[] = [];
  for (const z of [q, size - q]) for (const x of [e, 3 * e, 5 * e, 7 * e]) out.push({ x, z });
  return out;
}

function basesMap(size: number, seed: number): NavTestMap {
  const dim = size + 1;
  const heights = new Uint16Array(dim * dim);
  const half = size >> 1;
  const amps = [2 * U, U, U >> 2];
  const pr = Math.min(40, Math.max(20, size >> 4));
  const plateaus: Plateau[] = startPositions(size).map((p) => ({
    cx: p.x,
    cz: p.z,
    r: pr,
    rx: p.x < half ? 1 : p.x > half ? -1 : 0,
    rz: p.z < half ? 1 : p.z > half ? -1 : 0,
  }));
  // river along z ≈ size/2 (meandering), fords at x = size/4 and 3·size/4 (+ centre on 1,024)
  const meanderAmp = size >> 5;
  const fords = size >= 1024 ? [size >> 2, half, size - (size >> 2)] : [size >> 2, size - (size >> 2)];
  // ridges along x = size/2 north and south of the river with gaps (chokes)
  const ridgeX = half + (size >> 4);
  const riverZ16 = (x: number): number => half * 16 + fdiv(meanderAmp * 16 * sinA((fdiv(x * 65536, size >> 1) & 0xffff) as Ang16), 4096);
  const ridgeRiverZ = riverZ16(ridgeX) >> 4;
  const gapsNorth = [
    { z: size >> 3, w: 3 },
    { z: (size >> 2) + (size >> 4), w: 8 },
  ];
  const gapsSouth = [
    { z: size - (size >> 3), w: 6 },
    { z: size - (size >> 2) - (size >> 4), w: 3 },
  ];
  // mesas (no ramps)
  const mesas: { x: number; z: number; r: number }[] = [];
  const nMesa = size >> 6;
  for (let k = 0; k < nMesa * 4 && mesas.length < nMesa; k++) {
    const mx = 16 + (rng32(seed, k, 1, 7) % (size - 32));
    const mz = 16 + (rng32(seed, k, 2, 7) % (size - 32));
    const r = 6 + (rng32(seed, k, 3, 7) % 14);
    let ok = true;
    for (const p of plateaus) {
      const d = dist16(mx - p.cx, mz - p.cz) >> 4;
      if (d < p.r + RAMP_LEN + r + 12) ok = false;
    }
    const zr = half - mz < 0 ? mz - half : half - mz;
    if (zr < r + meanderAmp + 24) ok = false;
    const xr = mx - ridgeX < 0 ? ridgeX - mx : mx - ridgeX;
    if (xr < r + 10) ok = false;
    if (ok) mesas.push({ x: mx, z: mz, r });
  }

  for (let z = 0; z < dim; z++) {
    for (let x = 0; x < dim; x++) {
      const n = noise(seed, x, z, amps);
      const land = LAND_BASES + n;
      let h = land;
      // plateaus with cliffs and two ramps
      for (const p of plateaus) {
        const dx = x - p.cx;
        const dz = z - p.cz;
        const r16 = dist16(dx, dz);
        const top = land + PLATEAU_RISE;
        let ph = -1;
        if (r16 <= p.r * 16) ph = top;
        else if (r16 < (p.r + CLIFF_WU) * 16) ph = lerp(top, land, smooth(fdiv((r16 - p.r * 16) * 256, CLIFF_WU * 16)));
        // ramps along x (direction rx) and z (direction rz)
        for (let a = 0; a < 2; a++) {
          const dirx = a === 0 ? p.rx : 0;
          const dirz = a === 0 ? 0 : p.rz;
          if (dirx === 0 && dirz === 0) continue;
          const along = dx * dirx + dz * dirz;
          const acrossRaw = dirx !== 0 ? dz : dx;
          const across = acrossRaw < 0 ? -acrossRaw : acrossRaw;
          if (along < p.r - 2 || along > p.r + RAMP_LEN || across > RAMP_HALF + 2) continue;
          const t = along <= p.r ? 0 : fdiv((along - p.r) * 256, RAMP_LEN);
          const rampH = lerp(top, land, t < 0 ? 0 : t > 256 ? 256 : t);
          const w = across <= RAMP_HALF ? 256 : fdiv((RAMP_HALF + 2 - across) * 256, 2);
          const rh = lerp(land, rampH, w);
          if (rh > ph) ph = rh;
        }
        if (ph > h) h = ph;
      }
      // mesas
      for (const m of mesas) {
        const r16 = dist16(x - m.x, z - m.z);
        if (r16 <= m.r * 16) h = Math.max(h, land + 7 * U);
        else if (r16 < (m.r + 2) * 16) h = Math.max(h, lerp(land + 7 * U, land, smooth(fdiv((r16 - m.r * 16) * 256, 32))));
      }
      // ridges with gaps
      const rdx = x - ridgeX < 0 ? ridgeX - x : x - ridgeX;
      if (rdx <= 2) {
        // the ridge runs into the deep water (|z − river centre| ≤ 8 is deep), sealing the bank
        const north = z < ridgeRiverZ - 8;
        const south = z > ridgeRiverZ + 8;
        if (north || south) {
          const gaps = north ? gapsNorth : gapsSouth;
          let inGap = false;
          for (const g of gaps) if (z >= g.z && z <= g.z + g.w) inGap = true;
          if (!inGap) h = Math.max(h, land + RIDGE_RISE);
        }
      }
      // river (distances in 1/16 WU so the meander does not leave steps in the banks)
      const zc16 = riverZ16(x);
      const d16 = z * 16 - zc16 < 0 ? zc16 - z * 16 : z * 16 - zc16;
      if (d16 < 24 * 16) {
        let bed: number;
        if (d16 <= 6 * 16) bed = BED;
        else if (d16 <= 12 * 16) bed = BED + fdiv((d16 - 96) * (WATER - BED), 96);
        else bed = WATER + fdiv((d16 - 192) * (land - WATER), 192);
        let fd = 0x7fffffff;
        for (const f of fords) {
          const d = x - f < 0 ? f - x : x - f;
          if (d < fd) fd = d;
        }
        if (fd < 14 && bed < FORD_BED) bed = fd <= 7 ? FORD_BED : lerp(FORD_BED, bed, fdiv((fd - 7) * 256, 7));
        if (bed < h) h = bed;
      }
      heights[z * dim + x] = h < 0 ? 0 : h > 0xffff ? 0xffff : h;
    }
  }

  // FA-like bases: slots of 10 WU on a lattice around each start that leaves the commander spot and
  // the ramp lanes (|offset| < 8 WU along both axes) free; slot centres on the plateau top. Each slot
  // holds a factory (8×8), a power cluster (4 × 2×2), a mass extractor (2×2) or a defence (3×3).
  const foot: Rect[] = [];
  for (let s = 0; s < plateaus.length; s++) {
    const p = plateaus[s]!;
    const lim = p.r - 1;
    const offs: number[] = [];
    for (let o = -18; o >= -lim; o -= 10) offs.unshift(o);
    for (let o = 8; o + 10 <= lim; o += 10) offs.push(o);
    for (const oz of offs) {
      for (const ox of offs) {
        if (dist16(ox + 5, oz + 5) > lim * 16) continue;
        if (p.rx !== 0 && oz < RAMP_HALF + 2 && oz + 10 > -RAMP_HALF - 2) continue;
        if (p.rz !== 0 && ox < RAMP_HALF + 2 && ox + 10 > -RAMP_HALF - 2) continue;
        const sx = p.cx + ox;
        const sz = p.cz + oz;
        const r = rng32(seed, s, (oz + 512) * 1024 + ox + 512, 29) % 10;
        if (r < 3) foot.push({ x: sx + 1, z: sz + 1, w: 8, h: 8 });
        else if (r < 6) {
          foot.push({ x: sx + 1, z: sz + 1, w: 2, h: 2 });
          foot.push({ x: sx + 5, z: sz + 1, w: 2, h: 2 });
          foot.push({ x: sx + 1, z: sz + 5, w: 2, h: 2 });
          foot.push({ x: sx + 5, z: sz + 5, w: 2, h: 2 });
        } else if (r < 8) foot.push({ x: sx + 4, z: sz + 4, w: 2, h: 2 });
        else foot.push({ x: sx + 3, z: sz + 3, w: 3, h: 3 });
      }
    }
  }
  return {
    name: `nav-bases-${size}-${seed}`,
    sizeWu: size,
    dim,
    heights,
    heightScaleRaw: SCALE,
    waterLevelRaw: WATER * SCALE,
    starts: plateaus.map((p, i) => ({ army: i, x: p.cx * FX, z: p.cz * FX })),
    baseFootprints: foot,
  };
}
