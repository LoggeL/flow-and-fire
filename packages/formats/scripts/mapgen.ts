/**
 * mapgen — deterministic procedural generator for the MS2 map "Hollow Ridge" (512 WU, 2 players,
 * own design) and registry of all generated maps (Setons: ./mapgen-setons.ts). Integer-only (value noise from rng32 of @faf/fixed, no Math.random, no float
 * trigonometry), so the output is byte-identical on every run and engine.
 *
 *   pnpm --filter @faf/formats mapgen            (writes content/maps/src/hollow-ridge/* and
 *                                                  compiles content/maps/hollow-ridge.rtsmap)
 *
 * Layout (x = east, z = south; point-symmetric around the map centre (256, 256)):
 *   - start plateaus NW (96, 96) and SE (416, 416): 24 WU, flat radius 52 WU, cliffs to 58 WU,
 *     two ramps each (NW: east and south; SE: west and north)
 *   - mesas (the "hollow ridge") NW-side (120, 250) and SE-side (392, 262): 36 WU, flat radius
 *     22 WU, cliffs to 27 WU, one ramp each (towards their base, 48 WU long)
 *   - a river along the anti-diagonal x + z = 512 (NE corner to SW corner) that widens into a lake
 *     in the centre; deep channel (bed 6.5 WU, water 10 WU), two fords (bed 9.75 WU) at
 *     (356, 156) and (156, 356)
 *   - 16 mass spots (4 on each start plateau, 2 on each mesa, 1 on each bank at each ford),
 *     2 hydro spots (one per side)
 *
 * Heights are u16 steps with heightScaleRaw 32 (1 step = 1/128 WU); the water level is 10 WU.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isqrt, rng32, sinA, type Ang16 } from '@faf/fixed';
import { encodeHeightmapPng, decodeHeightmapPng, type HeightmapData } from './heightmap-io.ts';
import { compileMapSource, MAPS_DIR, MAPS_SRC_DIR } from './mapc.ts';
import { SETONS, writeSetonsSources } from './mapgen-setons.ts';

export const HOLLOW_RIDGE = 'hollow-ridge';

const SIZE = 512;
const DIM = SIZE + 1;
/** Height steps per WU (heightScaleRaw 32 ⇒ 4096 / 32). */
const U = 128;
const SEED = 0x0badc0de;

const WATER = 10 * U; // 1280 steps
const BED = 6.5 * U; // 832
const FORD_BED = 9.75 * U; // 1248: 0.25 WU deep
const LAND = 14 * U; // 1792

/** River geometry in rotated coordinates u = x + z − 512 (across), v = x − z (along); 1 unit = 1/√2 WU. */
const MEANDER_AMP = 16;
const MEANDER_PERIOD = 400;
const LAKE_HALF_LENGTH = 100;
const LAKE_EXTRA = 40;
const DEEP_HALF = 14;
const BANK_HALF = 30;
const FORD_V = 200;
const FORD_CORE = 10;
const FORD_FADE = 22;

export const HOLLOW_RIDGE_FEATURES = {
  starts: [
    { army: 0, x: 96, z: 96 },
    { army: 1, x: 416, z: 416 },
  ],
  plateau: { topWu: 24, flatRadiusWu: 52, cliffOuterWu: 58, rampHalfWidthWu: 6, rampStartWu: 52, rampEndWu: 86 },
  mesa: { centre: { x: 120, z: 250 }, topWu: 36, flatRadiusWu: 22, cliffOuterWu: 27, rampHalfWidthWu: 6, rampStartWu: 22, rampEndWu: 70 },
  fords: [
    { x: 356, z: 156 },
    { x: 156, z: 356 },
  ],
} as const;

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** a + (b − a)·t/256 for t in [0, 256]. */
function lerp(a: number, b: number, t: number): number {
  return a + floorDiv((b - a) * t, 256);
}

/** Smoothstep on [0, 256] → [0, 256]. */
function smooth(t: number): number {
  return floorDiv(t * t * (768 - 2 * t), 65536);
}

/** Lattice value in [−1024, 1023]. */
function lattice(octave: number, i: number, j: number): number {
  return (rng32(SEED, j, i, octave) >>> 21) - 1024;
}

const OCTAVES: readonly { shift: number; amp: number }[] = [
  { shift: 6, amp: 2 * U }, // 64 WU cells, ±2 WU
  { shift: 5, amp: U }, // 32 WU, ±1 WU
  { shift: 4, amp: U >> 1 }, // 16 WU, ±0.5 WU
  { shift: 3, amp: U >> 2 }, // 8 WU, ±0.25 WU
];

function valueNoise(x: number, z: number): number {
  let sum = 0;
  for (let o = 0; o < OCTAVES.length; o++) {
    const { shift, amp } = OCTAVES[o]!;
    const cell = 1 << shift;
    const i = x >> shift;
    const j = z >> shift;
    const tx = smooth(((x & (cell - 1)) << 8) >> shift);
    const tz = smooth(((z & (cell - 1)) << 8) >> shift);
    const a = lerp(lattice(o, i, j), lattice(o, i + 1, j), tx);
    const b = lerp(lattice(o, i, j + 1), lattice(o, i + 1, j + 1), tx);
    sum += floorDiv(lerp(a, b, tz) * amp, 1024);
  }
  return sum;
}

/** Point-symmetric noise (same value at (x, z) and (512 − x, 512 − z)). */
function noise(x: number, z: number): number {
  return floorDiv(valueNoise(x, z) + valueNoise(SIZE - x, SIZE - z), 2);
}

/** Distance in 1/16 WU. */
function dist16(dx: number, dz: number): number {
  return isqrt(dx * dx * 256 + dz * dz * 256);
}

/**
 * Round feature with a flat top, a steep cliff and straight ramps. `ramps` are unit axis
 * directions (dx, dz). Returns the new height at (x, z) given the land height `land`.
 */
function mound(
  land: number,
  x: number,
  z: number,
  cx: number,
  cz: number,
  top: number,
  flat: number,
  outer: number,
  ramps: readonly (readonly [number, number])[],
  rampHalf: number,
  rampStart: number,
  rampEnd: number,
): number {
  const dx = x - cx;
  const dz = z - cz;
  const r = dist16(dx, dz);
  let h = land;
  if (r <= flat * 16) h = top;
  else if (r < outer * 16) h = lerp(top, land, smooth(floorDiv((r - flat * 16) * 256, (outer - flat) * 16)));
  for (const [rx, rz] of ramps) {
    const along = dx * rx + dz * rz; // WU along the ramp axis
    const across = Math.abs(dx * rz - dz * rx);
    if (along < 0 || across >= rampHalf + 3) continue;
    let ramp: number;
    if (along <= rampStart) ramp = top;
    else if (along >= rampEnd) ramp = land;
    else ramp = lerp(top, land, floorDiv((along - rampStart) * 256, rampEnd - rampStart));
    const w = across <= rampHalf ? 256 : floorDiv((rampHalf + 3 - across) * 256, 3);
    h = Math.max(h, lerp(land, Math.max(land, ramp), w));
  }
  return h;
}

/** Meander offset (in u units) of the river centre line at along-coordinate v; odd in v. */
function meander(v: number): number {
  const ang = floorDiv(v * 65536, MEANDER_PERIOD) & 0xffff;
  return floorDiv(MEANDER_AMP * sinA(ang as Ang16), 4096);
}

/** Distance from the river centre line in u units, reduced by the lake widening (0 = channel centre). */
function riverQ(u: number, v: number): number {
  const av = Math.abs(v);
  const extra = av < LAKE_HALF_LENGTH ? floorDiv((LAKE_HALF_LENGTH - av) * LAKE_EXTRA, LAKE_HALF_LENGTH) : 0;
  return Math.max(0, Math.abs(u - meander(v)) - extra);
}

/** River/lake bed height at river distance q and along-coordinate v. */
function riverBed(q: number, v: number): number {
  let bed: number;
  if (q <= DEEP_HALF) bed = BED;
  else if (q <= BANK_HALF) bed = BED + floorDiv((q - DEEP_HALF) * (WATER - BED), BANK_HALF - DEEP_HALF);
  else bed = WATER + (q - BANK_HALF) * (U >> 2); // banks rise 0.25 WU per unit
  const fd = Math.min(Math.abs(v - FORD_V), Math.abs(v + FORD_V));
  if (fd < FORD_FADE && bed < FORD_BED) {
    const w = fd <= FORD_CORE ? 256 : floorDiv((FORD_FADE - fd) * 256, FORD_FADE - FORD_CORE);
    bed = lerp(bed, FORD_BED, w);
  }
  return bed;
}

/** Height (steps) of the NW half before mirroring. */
function heightAt(x: number, z: number): number {
  const n = noise(x, z);
  const land = LAND + n;
  const P = HOLLOW_RIDGE_FEATURES.plateau;
  const M = HOLLOW_RIDGE_FEATURES.mesa;
  let h = mound(
    land,
    x,
    z,
    96,
    96,
    P.topWu * U + (n >> 3),
    P.flatRadiusWu,
    P.cliffOuterWu,
    [
      [1, 0],
      [0, 1],
    ],
    P.rampHalfWidthWu,
    P.rampStartWu,
    P.rampEndWu,
  );
  h = mound(h, x, z, M.centre.x, M.centre.z, M.topWu * U + (n >> 3), M.flatRadiusWu, M.cliffOuterWu, [[0, -1]], M.rampHalfWidthWu, M.rampStartWu, M.rampEndWu);
  const v = x - z;
  const q = riverQ(x + z - SIZE, v);
  if (q < 62) {
    // Blend the river profile into the land over the outer 16 units so banks have no seams.
    const w = q <= 46 ? 256 : floorDiv((62 - q) * 256, 16);
    h = lerp(h, Math.min(h, riverBed(q, v)), w);
  }
  return Math.max(0, Math.min(0xffff, h));
}

/** Generates the heightmap (dim² u16 steps), exactly point-symmetric. */
export function generateHollowRidgeHeights(): HeightmapData {
  const samples = new Uint16Array(DIM * DIM);
  for (let z = 0; z < DIM; z++) {
    for (let x = 0; x < DIM; x++) {
      const s = x + z;
      if (s > SIZE || (s === SIZE && x > SIZE >> 1)) continue;
      samples[z * DIM + x] = heightAt(x, z);
    }
  }
  for (let z = 0; z < DIM; z++) {
    for (let x = 0; x < DIM; x++) {
      const s = x + z;
      if (s > SIZE || (s === SIZE && x > SIZE >> 1)) samples[z * DIM + x] = samples[(SIZE - z) * DIM + (SIZE - x)]!;
    }
  }
  return { dim: DIM, samples };
}

function mirror(p: { x: number; z: number }): { x: number; z: number } {
  return { x: SIZE - p.x, z: SIZE - p.z };
}

/** markers.json content (world units). */
export function hollowRidgeMarkers(): Record<string, unknown> {
  const nwMass = [
    { x: 116, z: 100 },
    { x: 100, z: 116 },
    { x: 78, z: 106 },
    { x: 106, z: 78 },
    // mesa top
    { x: 112, z: 244 },
    { x: 128, z: 256 },
    // ford banks: NW bank of the NE ford, NW bank of the SW ford
    { x: 328, z: 128 },
    { x: 128, z: 328 },
  ];
  const mass = [...nwMass, ...nwMass.map(mirror)];
  const hydro = [{ x: 200, z: 150 }, mirror({ x: 200, z: 150 })];
  const nwProps = [
    { id: 'core:rock_01', x: 180, z: 60, yawDeg: 30, scale: 1 },
    { id: 'core:rock_02', x: 230, z: 40, yawDeg: 75, scale: 1.5 },
    { id: 'core:rock_01', x: 60, z: 200, yawDeg: 120, scale: 1.25 },
    { id: 'core:rock_02', x: 40, z: 250, yawDeg: 200, scale: 1 },
    { id: 'core:rock_01', x: 200, z: 190, yawDeg: 300, scale: 1.5 },
    { id: 'core:rock_02', x: 260, z: 90, yawDeg: 15, scale: 1.25 },
  ];
  const props = [...nwProps, ...nwProps.map((p) => ({ ...p, ...mirror(p), yawDeg: (p.yawDeg + 180) % 360 }))];
  return {
    version: 1,
    name: 'Hollow Ridge',
    sizeWu: SIZE,
    heightScaleRaw: 4096 / U,
    waterLevel: WATER / U,
    starts: HOLLOW_RIDGE_FEATURES.starts,
    mass,
    hydro,
    props,
    light: { azimuthDeg: 215, elevationDeg: 48, sun: [255, 242, 220], ambient: [92, 104, 126] },
    strata: [
      { name: 'shore', color: [196, 182, 134] },
      { name: 'meadow', color: [96, 132, 72] },
      { name: 'cliff', color: [118, 110, 98] },
      { name: 'ridge', color: [214, 214, 206] },
    ],
  };
}

function samplesEqual(a: Uint16Array, b: Uint16Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Writes content/maps/src/hollow-ridge/{heightmap.png, markers.json}. The PNG is only rewritten
 * when its decoded samples differ, so a different zlib build never dirties the checked-in file.
 */
export function writeHollowRidgeSources(log: (msg: string) => void = () => {}): string {
  const dir = join(MAPS_SRC_DIR, HOLLOW_RIDGE);
  mkdirSync(dir, { recursive: true });
  const hm = generateHollowRidgeHeights();
  const pngPath = join(dir, 'heightmap.png');
  const same = existsSync(pngPath) && samplesEqual(decodeHeightmapPng(new Uint8Array(readFileSync(pngPath)), pngPath).samples, hm.samples);
  if (!same) writeFileSync(pngPath, encodeHeightmapPng(hm));
  writeFileSync(join(dir, 'markers.json'), `${JSON.stringify(hollowRidgeMarkers(), null, 2)}\n`);
  log(`mapgen: ${HOLLOW_RIDGE} sources in ${dir}${same ? ' (heightmap unchanged)' : ''}`);
  return dir;
}

/** All generated maps (name → source writer). */
export const GENERATORS: Readonly<Record<string, (log: (msg: string) => void) => string>> = {
  [HOLLOW_RIDGE]: writeHollowRidgeSources,
  [SETONS]: writeSetonsSources,
};

function main(): void {
  const names = process.argv.slice(2).filter((a) => a !== '--');
  const selected = names.length > 0 ? names : Object.keys(GENERATORS);
  for (const name of selected) {
    const gen = GENERATORS[name];
    if (gen === undefined) {
      console.error(`mapgen: unknown map '${name}' (known: ${Object.keys(GENERATORS).join(', ')})`);
      process.exitCode = 1;
      return;
    }
    const dir = gen((m) => console.log(m));
    const { map, bytes } = compileMapSource(dir);
    const out = join(MAPS_DIR, `${name}.rtsmap`);
    writeFileSync(out, bytes);
    console.log(`mapgen: ${name} -> ${out} (${bytes.length} B, ${map.meta.spots.length} spots)`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
