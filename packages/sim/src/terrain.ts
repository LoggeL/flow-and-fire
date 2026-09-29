/**
 * Terrain in the sim (MS2: M1 height, M2 deep water, M4 spots): height and water queries over the
 * static map area, the land placement rule of the Movement phase and read-only map queries
 * (starts, spots) for later systems (MS4 mex placement, AI static data).
 *
 * Heights come from @faf/rules `sampleHeightRaw` — the one formula shared bit-identically with
 * the client (picking) and the GPU (TERRAIN_HEIGHT_GLSL). Everything is integer math and
 * allocation-free.
 *
 * M2 minimal form (until passability grids + HPA* in MS3, M5): a land unit never enters a point
 * whose water depth exceeds LAND_MAX_WATER_DEPTH_RAW (0.5 WU). A candidate position that would be
 * deep is replaced by axis-separated sliding — full move, else only x, else only z, else stay —
 * for the integration step and for the separation push alike.
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

/** True if a unit of motion layer `layer` must not stand at (x, z) (M2: land in deep water). */
export function isBlockedFor(w: World, layer: number, x: number, z: number): boolean {
  if (layer !== MotionLayer.Land || !w.hasWater) return false;
  return w.waterLevel - sampleHeightRaw(w.terrain, x, z) > LAND_MAX_WATER_DEPTH_RAW;
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
 * Moves unit slot `u` from (x0, z0) towards the candidate (nx, nz) under the layer rules and sets
 * Units.x/z/y. Land units on maps with water slide axis-separated around deep water (see module
 * comment); every other case takes the candidate. Returns the Placement. Allocation-free.
 */
export function placeUnit(w: World, u: number, x0: number, z0: number, nx: number, nz: number): Placement {
  const U = w.units.col;
  const hf = w.terrain;
  const layer = U.layer[u]!;
  if (layer !== MotionLayer.Land || !w.hasWater) {
    U.x[u] = nx;
    U.z[u] = nz;
    U.y[u] = surfaceY(w, layer, sampleHeightRaw(hf, nx, nz));
    return Placement.Full;
  }
  // Deep ⇔ waterLevel − ground > LAND_MAX_WATER_DEPTH_RAW (rules.isDeepWaterForLand).
  const level = w.waterLevel;
  let g = sampleHeightRaw(hf, nx, nz);
  if (level - g <= LAND_MAX_WATER_DEPTH_RAW) {
    U.x[u] = nx;
    U.z[u] = nz;
    U.y[u] = g;
    return Placement.Full;
  }
  if (nx !== x0) {
    g = sampleHeightRaw(hf, nx, z0);
    if (level - g <= LAND_MAX_WATER_DEPTH_RAW) {
      U.x[u] = nx;
      U.y[u] = g;
      return Placement.XOnly;
    }
  }
  if (nz !== z0) {
    g = sampleHeightRaw(hf, x0, nz);
    if (level - g <= LAND_MAX_WATER_DEPTH_RAW) {
      U.z[u] = nz;
      U.y[u] = g;
      return Placement.ZOnly;
    }
  }
  return Placement.Blocked;
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
