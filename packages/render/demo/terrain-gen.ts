/**
 * Procedural 512-WU test heightfield for the render demo/smoke (the real maps come from
 * @faf/formats, which render must not import): rolling hills, a ridge with steep flanks, a river
 * channel below the water level with two shallow fords, a lake, plateaus. Deterministic.
 *
 * Also the smoke's test support: {@link probePoints} (pseudo-random probe positions) and
 * {@link referenceHeights} (the JS reference of the height formula for the GPU/CPU comparison).
 */
import type { TerrainDecal, TerrainDesc } from '../src/index.ts';
import { sampleTerrainHeightRaw } from '../src/index.ts';

export const DEMO_MAP_WU = 512;
/** 1/128 WU per u16 step (like hollow-ridge). */
export const DEMO_HEIGHT_SCALE = 32;
export const DEMO_WATER_WU = 12;

export interface DemoSpot {
  readonly kind: 'mass' | 'hydro';
  readonly x: number;
  readonly z: number;
}

export interface DemoTerrain {
  readonly desc: TerrainDesc;
  readonly spots: readonly DemoSpot[];
  readonly decals: readonly TerrainDecal[];
  /** A point in deep water (raw), for pixel checks. */
  readonly deepWater: readonly [number, number];
}

function hash01(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x: number, z: number, cell: number, seed: number): number {
  const u = x / cell;
  const v = z / cell;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fx = u - i;
  const fz = v - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash01(i, j, seed);
  const b = hash01(i + 1, j, seed);
  const c = hash01(i, j + 1, seed);
  const d = hash01(i + 1, j + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Height in WU of the continuous demo landscape. */
function landscape(x: number, z: number): number {
  const S = DEMO_MAP_WU;
  let h = 17;
  h += 7 * (noise(x, z, 96, 1) - 0.5) + 3.5 * (noise(x, z, 40, 2) - 0.5) + 1.2 * (noise(x, z, 14, 3) - 0.5);
  // Ridge running diagonally through the north-east with steep flanks.
  const rd = Math.abs((x - 0.55 * S) * 0.6 - (z - 0.25 * S) * 0.8) / 1;
  h += 26 * (1 - smooth(4, 38, rd)) * smooth(0.1 * S, 0.3 * S, x);
  // Plateau in the south-west.
  const pd = Math.hypot(x - 0.2 * S, z - 0.78 * S);
  h += 9 * (1 - smooth(40, 58, pd));
  // River channel (west → east, meandering) below the water level, with two fords.
  const riverZ = 0.52 * S + 22 * Math.sin(x / 57) + 9 * Math.sin(x / 19 + 1.3);
  const dz = Math.abs(z - riverZ);
  const ford = Math.max(1 - smooth(6, 16, Math.abs(x - 0.3 * S)), 1 - smooth(6, 16, Math.abs(x - 0.72 * S)));
  const bed = DEMO_WATER_WU - (4.5 - ford * 4.2); // fords: 0.3 WU below the water surface
  const bank = smooth(7, 20, dz);
  h = h * bank + bed * (1 - bank);
  // Lake in the south-east.
  const ld = Math.hypot(x - 0.78 * S, z - 0.82 * S);
  const lake = 1 - smooth(22, 48, ld);
  h = h * (1 - lake) + (DEMO_WATER_WU - 6) * lake;
  return Math.max(0.5, h);
}

export function generateDemoTerrain(): DemoTerrain {
  const size = DEMO_MAP_WU;
  const dim = size + 1;
  const heights = new Uint16Array(dim * dim);
  const k = 4096 / DEMO_HEIGHT_SCALE; // u16 steps per WU (128)
  for (let z = 0; z < dim; z++) {
    for (let x = 0; x < dim; x++) heights[z * dim + x] = Math.min(65535, Math.round(landscape(x, z) * k));
  }
  const desc: TerrainDesc = {
    sizeWu: size,
    dim,
    heights,
    heightScaleRaw: DEMO_HEIGHT_SCALE,
    waterLevelRaw: DEMO_WATER_WU * 4096,
    light: { azimuthDeg: 35, elevationDeg: 48, sun: [255, 244, 222], ambient: [104, 118, 140] },
  };
  // 16 mass spots in pairs on dry land, 2 hydro spots (FA-like layout, deterministic).
  const spots: DemoSpot[] = [];
  const water = DEMO_WATER_WU * 4096;
  const dry = (x: number, z: number): boolean => sampleTerrainHeightRaw(desc, x, z) > water + 4096;
  let seed = 0;
  while (spots.length < 16 && seed < 4000) {
    const x = Math.round((40 + hash01(seed, 7, 11) * (size - 80)) * 4096);
    const z = Math.round((40 + hash01(seed, 9, 13) * (size - 80)) * 4096);
    seed++;
    if (!dry(x, z) || spots.some((s) => Math.hypot(s.x - x, s.z - z) < 40 * 4096)) continue;
    spots.push({ kind: 'mass', x, z });
  }
  spots.push({ kind: 'hydro', x: Math.round(0.14 * size * 4096), z: Math.round(0.2 * size * 4096) });
  spots.push({ kind: 'hydro', x: Math.round(0.86 * size * 4096), z: Math.round(0.45 * size * 4096) });
  const decals: TerrainDecal[] = spots.map((s) =>
    s.kind === 'mass'
      ? { kind: 'ring', x: s.x, z: s.z, radiusWU: 1.6, widthWU: 0.35, color: 0x40ff50, alpha: 0.95 }
      : { kind: 'ring', x: s.x, z: s.z, radiusWU: 2.6, widthWU: 0.45, color: 0x20e0ff, alpha: 0.95 },
  );
  return { desc, spots, decals, deepWater: [Math.round(0.78 * size * 4096), Math.round(0.82 * size * 4096)] };
}

/** `n` pseudo-random probe points (raw xz pairs), including some outside the map (clamping). */
export function probePoints(n: number, seed: number, sizeWu: number): Int32Array {
  const xz = new Int32Array(n * 2);
  let s = seed >>> 0 || 1;
  const next = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const span = sizeWu * 4096;
  for (let i = 0; i < n; i++) {
    xz[i * 2] = Math.floor((next() * 1.04 - 0.02) * span);
    xz[i * 2 + 1] = Math.floor((next() * 1.04 - 0.02) * span);
  }
  return xz;
}

/** JS reference heights (the formula's CPU mirror) for the probe comparison. */
export function referenceHeights(desc: TerrainDesc, xz: Int32Array): Int32Array {
  const n = xz.length >> 1;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = sampleTerrainHeightRaw(desc, xz[i * 2]!, xz[i * 2 + 1]!);
  return out;
}
