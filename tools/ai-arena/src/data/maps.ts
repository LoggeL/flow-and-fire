/**
 * Arena map loader: reads the compiled `.rtsmap` files from `content/maps` with `@faf/formats`
 * and converts the Fx-raw metadata into float world units (WU) for the headless test sim.
 *
 * Coordinates: x/z in WU, [0, sizeWu]. Heights: WU = raw step · heightScaleRaw / 4096.
 * All conversions are divisions by powers of two, i.e. exact in IEEE doubles.
 */

import { readFileSync } from 'node:fs';
import { MAP_FX_ONE, readRtsMap, type RtsMap } from '@faf/formats';
import { repoPath } from './repo.ts';

/** The maps the arena knows (tournament set: Setons plus the three 512-WU 1v1 maps). */
export const ARENA_MAPS = ['setons', 'hollow-ridge', 'tessera', 'braidwater'] as const;
export type ArenaMapName = (typeof ARENA_MAPS)[number];

/** Map class used by the opening weights (`ai-openings.json → weights.maps`). */
export type ArenaMapClass = 'setons' | 'size256' | 'size512' | 'size1024';

export interface ArenaStart {
  /** Army slot 0..15 (ascending in `ArenaMap.starts`). */
  readonly army: number;
  readonly x: number;
  readonly z: number;
}

export interface ArenaSpot {
  /** Position in the file order (all mass spots first, then all hydro spots, as mapc writes them). */
  readonly index: number;
  readonly kind: 'mass' | 'hydro';
  readonly x: number;
  readonly z: number;
}

export interface ArenaMap {
  /** File id, e.g. 'hollow-ridge' (also the key in `ai-openings.json → expect`). */
  readonly name: string;
  /** Display name from the map metadata, e.g. 'Hollow Ridge'. */
  readonly displayName: string;
  readonly sizeWu: number;
  /** Height grid edge length in samples (= sizeWu + 1, one sample per WU). */
  readonly dim: number;
  /** dim² u16 height steps, index z·dim + x. Shared with the map file: do not mutate. */
  readonly heights: Uint16Array;
  /** Fx raw per height step (1..32). */
  readonly heightScaleRaw: number;
  /** Water surface in Fx raw, or null (no water). */
  readonly waterLevelRaw: number | null;
  /** Water surface in WU, or null. */
  readonly waterLevelWu: number | null;
  readonly starts: readonly ArenaStart[];
  readonly spots: readonly ArenaSpot[];
  readonly mapClass: ArenaMapClass;
  /** Bilinear terrain height in WU at (x, z); positions outside the map are clamped to the edge. */
  heightAt(x: number, z: number): number;
  /** Water depth in WU at (x, z): max(0, water level − terrain height); 0 without water. */
  waterDepthAt(x: number, z: number): number;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Map class from file id and edge length. 'setons' is its own class; every other map is classed by
 * size, rounding up to the next known class (≤ 256 → size256, ≤ 512 → size512, else size1024).
 */
export function mapClassOf(name: string, sizeWu: number): ArenaMapClass {
  if (name === 'setons') return 'setons';
  if (sizeWu <= 256) return 'size256';
  if (sizeWu <= 512) return 'size512';
  return 'size1024';
}

/**
 * Bilinear height in WU on a (sizeWu + 1)² sample grid with one sample per WU.
 * Only IEEE-exact operations (floor, +, −, ×, ÷), so the result is identical on every engine.
 */
export function heightAtGrid(heights: Uint16Array, dim: number, heightScaleRaw: number, x: number, z: number): number {
  const max = dim - 1;
  const cx = x < 0 ? 0 : x > max ? max : x;
  const cz = z < 0 ? 0 : z > max ? max : z;
  let x0 = Math.floor(cx);
  let z0 = Math.floor(cz);
  if (x0 >= max) x0 = max - 1;
  if (z0 >= max) z0 = max - 1;
  const fx = cx - x0;
  const fz = cz - z0;
  const i = z0 * dim + x0;
  const h00 = heights[i] ?? 0;
  const h10 = heights[i + 1] ?? 0;
  const h01 = heights[i + dim] ?? 0;
  const h11 = heights[i + dim + 1] ?? 0;
  const top = h00 + (h10 - h00) * fx;
  const bottom = h01 + (h11 - h01) * fx;
  const raw = top + (bottom - top) * fz;
  return (raw * heightScaleRaw) / MAP_FX_ONE;
}

/** Height in WU at (x, z) of an arena map (same as `map.heightAt`). */
export function heightAt(map: ArenaMap, x: number, z: number): number {
  return heightAtGrid(map.heights, map.dim, map.heightScaleRaw, x, z);
}

/** Builds an ArenaMap from an already decoded `.rtsmap` (useful for synthetic test maps). */
export function arenaMapFromRtsMap(name: string, map: RtsMap): ArenaMap {
  const meta = map.meta;
  const dim = meta.sizeWu + 1;
  if (map.heights.length !== dim * dim) {
    throw new Error(`ai-arena: map '${name}' has ${map.heights.length} height samples, expected ${dim * dim}`);
  }
  const starts: ArenaStart[] = meta.starts.map((s) => ({ army: s.army, x: s.x / MAP_FX_ONE, z: s.z / MAP_FX_ONE }));
  const spots: ArenaSpot[] = meta.spots.map((s, index) => ({
    index,
    kind: s.kind,
    x: s.x / MAP_FX_ONE,
    z: s.z / MAP_FX_ONE,
  }));
  const heights = map.heights;
  const heightScaleRaw = meta.heightScaleRaw;
  const waterLevelRaw = meta.waterLevelRaw;
  const waterLevelWu = waterLevelRaw === null ? null : waterLevelRaw / MAP_FX_ONE;
  return {
    name,
    displayName: meta.name,
    sizeWu: meta.sizeWu,
    dim,
    heights,
    heightScaleRaw,
    waterLevelRaw,
    waterLevelWu,
    starts,
    spots,
    mapClass: mapClassOf(name, meta.sizeWu),
    heightAt(x: number, z: number): number {
      return heightAtGrid(heights, dim, heightScaleRaw, x, z);
    },
    waterDepthAt(x: number, z: number): number {
      if (waterLevelWu === null) return 0;
      const d = waterLevelWu - heightAtGrid(heights, dim, heightScaleRaw, x, z);
      return d > 0 ? d : 0;
    },
  };
}

/** Absolute path of `content/maps/<name>.rtsmap`. */
export function arenaMapPath(name: string): string {
  if (!NAME_RE.test(name)) throw new Error(`ai-arena: invalid map name '${name}'`);
  return repoPath('content', 'maps', `${name}.rtsmap`);
}

/** Reads and decodes `content/maps/<name>.rtsmap` (uncached; every call returns fresh arrays). */
export function loadArenaMap(name: string): ArenaMap {
  const bytes = readFileSync(arenaMapPath(name));
  const rts = readRtsMap(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return arenaMapFromRtsMap(name, rts);
}

const mapCache = new Map<string, ArenaMap>();

/**
 * Cached variant of `loadArenaMap` for tournament workers that play many games on the same map.
 * The returned object (including `heights`) is shared: treat it as read-only.
 */
export function getArenaMap(name: string): ArenaMap {
  const hit = mapCache.get(name);
  if (hit !== undefined) return hit;
  const map = loadArenaMap(name);
  mapCache.set(name, map);
  return map;
}
