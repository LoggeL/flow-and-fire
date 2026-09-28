/**
 * State hashes of the arena (PLAN §3.5 "Hashing").
 *
 * - Rule hash: xxHash32 (streaming, seed 0) over the live ranges of every dynamic, non-derived
 *   region in registration order — table headers, live freelist entries, gen/alive and columns
 *   of slots [0, highWater), dense rows [0, count), slab records [0, highWater), raw regions whole.
 * - Full hash: the same over all dynamic regions including derived ones (spatial grids, caches).
 *
 * Both are allocation-free given a reusable `XxHash32`.
 */

import type { XxHash32 } from '@faf/fixed';
import type { Arena } from './arena.ts';
import type { ArenaRegion } from './region.ts';

function hashRegions(regions: readonly ArenaRegion[], bytes: Uint8Array, hasher: XxHash32, seed: number): number {
  hasher.reset(seed);
  for (let i = 0; i < regions.length; i++) regions[i]!.hashLive(hasher, bytes);
  return hasher.digest();
}

/** Rule hash (replay/desync check). */
export function ruleHash(arena: Arena, hasher: XxHash32, seed = 0): number {
  return hashRegions(arena.ruleRegions, arena.bytes, hasher, seed);
}

/** Full hash including derived state (desync-diff, restore tests). */
export function fullHash(arena: Arena, hasher: XxHash32, seed = 0): number {
  return hashRegions(arena.fullRegions, arena.bytes, hasher, seed);
}

/** Rule hash of a single region (desync-diff: find the first differing table). */
export function regionHash(region: ArenaRegion, arena: Arena, hasher: XxHash32, seed = 0): number {
  hasher.reset(seed);
  region.hashLive(hasher, arena.bytes);
  return hasher.digest();
}
