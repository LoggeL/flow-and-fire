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
  /** Optional terrain samples, used to avoid nav-blocked cliff cells in flight spawns. */
  readonly heightfield?: { readonly dim: number; readonly heights: Uint16Array; readonly heightScaleRaw: number };
  /** Water depth (raw) at a point; ≤ 0 = dry. */
  waterDepthRaw(xRaw: number, zRaw: number): number;
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
 * samples never leaves the range of the cell corners).
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
      const hf = src.heightfield;
      if (hf !== undefined) {
        if (x < 1 || z < 1 || x >= size - 1 || z >= size - 1) return false;
        const k = z * hf.dim + x;
        const a = hf.heights[k]!; const b = hf.heights[k + 1]!;
        const c = hf.heights[k + hf.dim]!; const d = hf.heights[k + hf.dim + 1]!;
        // Same class-1 land slope limit as nav.terrainCell: 0.75 WU per cell.
        if ((Math.max(a, b, c, d) - Math.min(a, b, c, d)) * hf.heightScaleRaw > 3072) return false;
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
