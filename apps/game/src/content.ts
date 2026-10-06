/**
 * Content and session glue of the game page: view.json → render visual table, start layout on the
 * map, land spawn clusters for the flight test (`?units=`). Pure (no DOM), unit-tested in
 * apps/game/test.
 */
import { parseViewJson } from '@faf/blueprints/view';
import { RAW_PER_WU, visualTableFromView, type ModelLookup, type VisualTable } from '@faf/client';

/** Spread radius (WU) so that `n` cubes of radius 0.3 have room: ≈ 4.5 WU² per cube. */
export function spawnSpreadWU(n: number): number {
  return Math.max(3, Math.sqrt(n * 1.45));
}

/**
 * view.json (text) → visual table; index = blueprint sim id = `UnitRecord.visual`. Visuals with
 * `view.mesh` use the pipeline's LOD meshes when `models` has them, else their placeholder.
 */
export function visualsFromViewJson(text: string, models?: ModelLookup): VisualTable {
  return visualTableFromView(parseViewJson(text), models);
}

/** A point in raw Q20.12 units. */
export interface PointRaw {
  readonly x: number;
  readonly z: number;
}

/** What the start layout needs from a map (ClientMap fits). */
export interface StartSource {
  readonly sizeWu: number;
  startOf(army: number): PointRaw | null;
}

export interface StartLayout {
  /** Centre of the own start army (raw); the camera starts here. */
  readonly own: PointRaw;
  /** Centre of the second army (raw). */
  readonly enemy: PointRaw;
}

/**
 * Start centres: the map's start of `playerArmy` and of the other army (a missing own start is the
 * map centre, a missing enemy start the point mirror of the own one). The generated test plane
 * carries the MS1 layout as its starts (formats createTestPlaneMap).
 */
export function startLayout(map: StartSource, playerArmy: number, enemyArmy: number): StartLayout {
  const edge = map.sizeWu * RAW_PER_WU;
  const own = map.startOf(playerArmy) ?? { x: edge / 2, z: edge / 2 };
  const enemy = map.startOf(enemyArmy) ?? { x: edge - own.x, z: edge - own.z };
  return { own: { x: own.x, z: own.z }, enemy: { x: enemy.x, z: enemy.z } };
}

/** Terrain query for land spawns (ClientMap fits). */
export interface LandSource {
  readonly sizeWu: number;
  /** Water depth (raw) at a point; ≤ 0 = dry. */
  waterDepthRaw(xRaw: number, zRaw: number): number;
  /**
   * Nav rule replica (MS3, M5: border, slope, deep water) of the 1-WU cell containing the point;
   * when present, land discs also avoid cells the sim would refuse a land spawn on.
   */
  landBlockedAtRaw?(xRaw: number, zRaw: number): boolean;
}

/** One cheat-spawn command of the flight test. */
export interface SpawnCluster {
  readonly army: number;
  readonly count: number;
  /** Centre (raw). */
  readonly x: number;
  readonly z: number;
  /** Spread radius (raw). */
  readonly spread: number;
}

/** Units per spawn cluster of the flight test. */
export const FLIGHT_CLUSTER_UNITS = 32;
/** Land spawns avoid everything deeper than this (raw): the 0.5 WU land limit minus 1/64 WU. */
const LAND_SPAWN_MAX_DEPTH_RAW = 2048 - 64;

/**
 * True if every height sample within `radiusWU + 1` of (x, z) WU is at most shallow water, so a
 * land unit spawned anywhere in the disc lies on passable ground (the bilinear height between
 * samples never leaves the range of the cell corners). With a nav replica (`landBlockedAtRaw`,
 * MS3) no cell touching that disc may be blocked either (slopes/cliffs: the sim rejects such
 * spawn points since MS3).
 */
export function discIsLand(src: LandSource, xWU: number, zWU: number, radiusWU: number): boolean {
  const r = radiusWU + 1;
  const size = src.sizeWu;
  const x0 = Math.max(0, Math.floor(xWU - r));
  const x1 = Math.min(size, Math.ceil(xWU + r));
  const z0 = Math.max(0, Math.floor(zWU - r));
  const z1 = Math.min(size, Math.ceil(zWU + r));
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - xWU;
      const dz = z - zWU;
      if (dx * dx + dz * dz > r * r) continue;
      if (src.waterDepthRaw(x * RAW_PER_WU, z * RAW_PER_WU) > LAND_SPAWN_MAX_DEPTH_RAW) return false;
    }
  }
  const blocked = src.landBlockedAtRaw;
  if (blocked !== undefined) {
    for (let z = Math.max(0, z0 - 1); z < Math.min(size, z1 + 1); z++) {
      for (let x = Math.max(0, x0 - 1); x < Math.min(size, x1 + 1); x++) {
        // Nearest point of cell [x, x+1) × [z, z+1) to the centre.
        const dx = Math.max(x - xWU, 0, xWU - (x + 1));
        const dz = Math.max(z - zWU, 0, zWU - (z + 1));
        if (dx * dx + dz * dz > r * r) continue;
        if (blocked.call(src, (x + 0.5) * RAW_PER_WU, (z + 0.5) * RAW_PER_WU)) return false;
      }
    }
  }
  return true;
}

/**
 * Flight test (`?units=n`): n units split into clusters of ≤ {@link FLIGHT_CLUSTER_UNITS}, spread
 * over the land of the whole map, alternating between `armies` armies. Cluster centres come from a
 * jittered grid over the map (deterministic LCG from `seed`), keeping only discs that are land
 * throughout; if the map has fewer land discs than clusters, the discs are reused.
 */
export function flightClusters(src: LandSource, units: number, armies: readonly number[], seed = 1): SpawnCluster[] {
  if (units <= 0 || armies.length === 0) return [];
  const clusters = Math.ceil(units / FLIGHT_CLUSTER_UNITS);
  const spreadWU = spawnSpreadWU(FLIGHT_CLUSTER_UNITS);
  const margin = spreadWU + 2;
  const size = src.sizeWu;
  // Grid with ≈ 2 candidates per cluster (water removes some).
  const side = Math.max(1, Math.ceil(Math.sqrt(clusters * 2)));
  const cell = (size - 2 * margin) / side;
  let s = (seed >>> 0) || 1;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const candidates: { x: number; z: number; key: number }[] = [];
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const x = margin + (i + 0.2 + 0.6 * rnd()) * cell;
      const z = margin + (j + 0.2 + 0.6 * rnd()) * cell;
      candidates.push({ x, z, key: rnd() });
    }
  }
  const land = candidates.filter((c) => discIsLand(src, c.x, c.z, spreadWU));
  // Shuffle (stable by key) so a partial selection still covers the whole map.
  land.sort((a, b) => a.key - b.key);
  if (land.length === 0) throw new Error('flight test: the map has no land for spawn clusters');
  const out: SpawnCluster[] = [];
  let left = units;
  for (let k = 0; k < clusters; k++) {
    const c = land[k % land.length]!;
    const count = Math.min(FLIGHT_CLUSTER_UNITS, left);
    left -= count;
    out.push({
      army: armies[k % armies.length]!,
      count,
      x: Math.round(c.x * RAW_PER_WU),
      z: Math.round(c.z * RAW_PER_WU),
      spread: Math.round(spreadWU * RAW_PER_WU),
    });
  }
  return out;
}

/**
 * Placeholder-tank mix of the MS3 default scene (blueprint id, weight): mostly light tanks, some
 * artillery, scouts, medium and heavy tanks — all size classes 1–3 of the core land units.
 */
export const TANK_MIX: readonly (readonly [string, number])[] = [
  ['core:lnd_t1_tank', 5],
  ['core:lnd_t1_arty', 2],
  ['core:lnd_t1_scout', 2],
  ['core:lnd_t2_tank', 2],
  ['core:lnd_t3_heavy', 1],
];

/** What the tank plan needs from the blueprint table (SimBpTable fits). */
export interface TankBlueprints {
  indexOf(id: string): number;
  /** Collision radius (raw Fx). */
  radius(bp: number): number;
}

/** One cheat-spawn command of the tank scene. */
export interface TankSpawn extends SpawnCluster {
  readonly bp: number;
}

/**
 * Splits `total` tanks of `army` over {@link TANK_MIX} (largest remainder; blueprints missing from
 * the table are skipped) around (x, z) raw. All types share one spawn disc whose radius gives every
 * unit ≈ 2.2 × its footprint disc of room (the sim's collision pushes overlapping spawns apart and
 * rejects points that are blocked for the unit's size class). Empty if no mix blueprint exists.
 */
export function tankSpawnPlan(bp: TankBlueprints, total: number, army: number, x: number, z: number): TankSpawn[] {
  const mix = TANK_MIX.map(([id, w]) => ({ bp: bp.indexOf(id), w })).filter((m) => m.bp >= 0);
  if (total <= 0 || mix.length === 0) return [];
  const wsum = mix.reduce((a, m) => a + m.w, 0);
  const counts = mix.map((m) => Math.floor((total * m.w) / wsum));
  let left = total - counts.reduce((a, c) => a + c, 0);
  const order = mix
    .map((m, i) => ({ i, frac: (total * m.w) / wsum - counts[i]! }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k]!.i]!++;
  let area = 0;
  mix.forEach((m, i) => {
    const r = bp.radius(m.bp) / RAW_PER_WU + 0.3;
    area += counts[i]! * Math.PI * r * r * 2.2;
  });
  const spread = Math.max(4, Math.sqrt(area / Math.PI));
  const out: TankSpawn[] = [];
  mix.forEach((m, i) => {
    if (counts[i]! > 0) out.push({ bp: m.bp, army, count: counts[i]!, x, z, spread: Math.round(spread * RAW_PER_WU) });
  });
  return out;
}
