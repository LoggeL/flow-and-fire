/**
 * Terrain in the sim (MS2: M1 height, M2 deep water, M4 spots; MS3: M5 passability per size
 * class): height and water queries over the static map area, the land placement rule of the
 * Movement phase and read-only map queries (starts, spots) for later systems (MS4 mex placement,
 * AI static data).
 *
 * Heights come from @faf/rules `sampleHeightRaw` — the one formula shared bit-identically with
 * the client (picking) and the GPU (TERRAIN_HEIGHT_GLSL). Everything is integer math and
 * allocation-free.
 *
 * MS3 placement rule (replaces the MS2 deep-water-only rule, PLAN §3.8): a land unit of nav class
 * c only stands in nav cells passable for c (clearance ≥ c: terrain, water, slope, footprints)
 * and never on a point whose water is deeper than LAND_MAX_WATER_DEPTH_RAW (the nav judges the
 * water at the cell centre; the point rule keeps the MS2 guarantee between centres). A candidate
 * position that breaks the rule is replaced by axis-separated sliding — full move, else only x,
 * else only z, else stay — for integration, collision pushes and nudges alike. A unit that stands
 * on a cell not passable for it (fresh footprint, clearance lost) may move to cells that are not
 * worse, so it can always get out.
 */
import { LAND_MAX_WATER_DEPTH_RAW, MotionLayer, sampleHeightRaw } from '@faf/rules';
import { SpotKind } from './constants.ts';
import { MAP_POINT_WORDS, MT_SPOT_COUNT, MT_START_COUNT, WH_SPAWN_REJECTED } from './schema.ts';
import type { World } from './world.ts';

/** Result of `placeUnit`. */
export const Placement = {
  /** The candidate position was taken. */
  Full: 0,
  /** Only the x component was taken (z kept). */
  XOnly: 1,
  /** Only the z component was taken (x kept). */
  ZOnly: 2,
  /** Nothing was taken: the unit stays where it was. */
  Blocked: 3,
} as const;
export type Placement = (typeof Placement)[keyof typeof Placement];

/** Terrain height (Fx raw) at (x, z); positions outside the map use the edge height. */
export function terrainHeight(w: World, x: number, z: number): number {
  return sampleHeightRaw(w.terrain, x, z);
}

/** Water depth (Fx raw) at (x, z): > 0 under water, ≤ 0 dry (maps without water: −height). */
export function waterDepth(w: World, x: number, z: number): number {
  const g = sampleHeightRaw(w.terrain, x, z);
  return w.hasWater ? w.waterLevel - g : -g;
}

/** Nav cell index of a Fx position (clamped to the map). */
export function navCellOf(w: World, x: number, z: number): number {
  const m = w.mapSizeWu - 1;
  let cx = x >> 12;
  let cz = z >> 12;
  cx = cx < 0 ? 0 : cx > m ? m : cx;
  cz = cz < 0 ? 0 : cz > m ? m : cz;
  return (cz << w.navShift) | cx;
}

/** Clearance of the nav cell at a Fx position (0 = blocked). */
export function clearanceAtFx(w: World, x: number, z: number): number {
  return w.navClear[navCellOf(w, x, z)]!;
}

/**
 * True if a unit of motion layer `layer` and nav class `cls` must not stand at (x, z): for land
 * units a nav cell not passable for the class or a point in deep water (M2/M5).
 */
export function isBlockedFor(w: World, layer: number, x: number, z: number, cls = 1): boolean {
  if (layer !== MotionLayer.Land) return false;
  if (w.navClear[navCellOf(w, x, z)]! < cls) return true;
  return w.hasWater && w.waterLevel - sampleHeightRaw(w.terrain, x, z) > LAND_MAX_WATER_DEPTH_RAW;
}

/**
 * Height a unit of `layer` stands at over ground height `ground`: the ground for land, seabed,
 * amphibious and air units (no flight altitude before MS12), the water surface for hover and
 * naval units where it lies above the ground.
 */
export function surfaceY(w: World, layer: number, ground: number): number {
  if ((layer === MotionLayer.Hover || layer === MotionLayer.Water) && w.hasWater && w.waterLevel > ground) return w.waterLevel;
  return ground;
}

/**
 * Ground height of the last successful `standable` check (avoids a second sample for y). A typed
 * array instead of a module variable: storing a number there never boxes (no allocation).
 */
const LAST_GROUND = new Int32Array(1);

/**
 * True if a land unit of class `cls` may stand at (x, z), given the clearance `curClear` and the
 * deep-water state `curDeep` of its current position (lenient when the current spot is bad).
 */
function standable(w: World, cls: number, x: number, z: number, curClear: number, curDeep: boolean): boolean {
  const c = w.navClear[navCellOf(w, x, z)]!;
  if (c < cls && c < curClear) return false;
  if (c === 0 && curClear > 0) return false;
  const g = sampleHeightRaw(w.terrain, x, z);
  LAST_GROUND[0] = g;
  if (w.hasWater && !curDeep && w.waterLevel - g > LAND_MAX_WATER_DEPTH_RAW) return false;
  return true;
}

/**
 * Moves unit slot `u` of nav class `cls` from (x0, z0) towards the candidate (nx, nz) under the
 * layer rules and sets Units.x/z/y. Land units slide axis-separated around impassable cells and
 * deep water (see module comment); every other case takes the candidate. Returns the Placement.
 * Allocation-free.
 */
export function placeUnit(w: World, u: number, x0: number, z0: number, nx: number, nz: number, cls: number): Placement {
  const U = w.units.col;
  const hf = w.terrain;
  const layer = U.layer[u]!;
  if (layer !== MotionLayer.Land) {
    U.x[u] = nx;
    U.z[u] = nz;
    U.y[u] = surfaceY(w, layer, sampleHeightRaw(hf, nx, nz));
    return Placement.Full;
  }
  const cc = w.navClear[navCellOf(w, x0, z0)]!;
  const curClear = cc >= cls ? cls : cc;
  const curDeep = w.hasWater && w.waterLevel - sampleHeightRaw(hf, x0, z0) > LAND_MAX_WATER_DEPTH_RAW;
  if (standable(w, cls, nx, nz, curClear, curDeep)) {
    U.x[u] = nx;
    U.z[u] = nz;
    U.y[u] = LAST_GROUND[0]!;
    return Placement.Full;
  }
  if (nx !== x0 && standable(w, cls, nx, z0, curClear, curDeep)) {
    U.x[u] = nx;
    U.y[u] = LAST_GROUND[0]!;
    return Placement.XOnly;
  }
  if (nz !== z0 && standable(w, cls, x0, nz, curClear, curDeep)) {
    U.z[u] = nz;
    U.y[u] = LAST_GROUND[0]!;
    return Placement.ZOnly;
  }
  return Placement.Blocked;
}

/** Sets a unit to (x, z) unconditionally (y from the terrain); eviction and setup. */
export function setUnitPosition(w: World, u: number, x: number, z: number): void {
  const U = w.units.col;
  U.x[u] = x;
  U.z[u] = z;
  U.y[u] = surfaceY(w, U.layer[u]!, sampleHeightRaw(w.terrain, x, z));
}

// ---- map queries (static area; read-only, allocation-free with caller-owned outputs) --------

/** Output of a start or spot query (Fx raw positions). */
export interface MapPointOut {
  /** Army (starts) or SpotKind (spots). */
  tag: number;
  x: number;
  z: number;
}

/** Number of start positions of the map. */
export function mapStartCount(w: World): number {
  return w.mapTerrain.i32[MT_START_COUNT]!;
}

/** Writes start `i` (tag = army) into `out`; false if `i` is out of range. */
export function mapStart(w: World, i: number, out: MapPointOut): boolean {
  if (i < 0 || i >= mapStartCount(w)) return false;
  const s = w.mapStarts.i32;
  const o = i * MAP_POINT_WORDS;
  out.tag = s[o]!;
  out.x = s[o + 1]!;
  out.z = s[o + 2]!;
  return true;
}

/** Writes the start of `army` into `out`; false if the map has none for it. */
export function mapStartOfArmy(w: World, army: number, out: MapPointOut): boolean {
  const n = mapStartCount(w);
  for (let i = 0; i < n; i++) {
    if (w.mapStarts.i32[i * MAP_POINT_WORDS] === army) return mapStart(w, i, out);
  }
  return false;
}

/** Number of resource spots (mass + hydro) of the map. */
export function mapSpotCount(w: World): number {
  return w.mapTerrain.i32[MT_SPOT_COUNT]!;
}

/** Writes spot `i` (tag = SpotKind) into `out`; false if `i` is out of range. */
export function mapSpot(w: World, i: number, out: MapPointOut): boolean {
  if (i < 0 || i >= mapSpotCount(w)) return false;
  const s = w.mapSpots.i32;
  const o = i * MAP_POINT_WORDS;
  out.tag = s[o]!;
  out.x = s[o + 1]!;
  out.z = s[o + 2]!;
  return true;
}

/** Number of spots of one kind. */
export function mapSpotCountOf(w: World, kind: SpotKind): number {
  const n = mapSpotCount(w);
  const s = w.mapSpots.i32;
  let c = 0;
  for (let i = 0; i < n; i++) if (s[i * MAP_POINT_WORDS] === kind) c++;
  return c;
}

/** Cheat-spawned units rejected so far because their point was blocked for their layer. */
export function spawnRejectedCount(w: World): number {
  return w.header.i32[WH_SPAWN_REJECTED]!;
}
