/**
 * Sub-hashes (PLAN §3.11 HASH chunk "Sub-Hashes alle 100 Ticks", §3.12 desync search): one xxHash32
 * per rule region of the arena — the dynamic, non-derived regions in registration order, i.e.
 * exactly the regions the rule hash covers (derived state such as spatial grids and the last-hash
 * record is not part of it, DECISIONS 14). A diverging rule hash plus the sub-hashes of the next
 * sub-hash tick name the table(s) that went wrong without a full dump.
 *
 * The region list is part of the arena layout (layoutHash), so a replay stores the names once
 * (HASH chunk `regionNames`) and a reader of the same layout gets the same order.
 */

import type { XxHash32 } from '@faf/fixed';
import { regionHash } from '@faf/heap';
import type { World } from '@faf/sim';

/** Names of the rule regions (dynamic, not derived) in registration order = sub-hash order. */
export function ruleRegionNames(world: World): string[] {
  const regions = world.arena.ruleRegions;
  const out = new Array<string>(regions.length);
  for (let i = 0; i < regions.length; i++) out[i] = regions[i]!.name;
  return out;
}

/** Number of sub-hashes of `world` (= ruleRegionNames(world).length). */
export function subHashCount(world: World): number {
  return world.arena.ruleRegions.length;
}

/**
 * Writes the rule hash of every rule region into `out[0 .. regions)` (u32, registration order).
 * Allocation-free with a reused `hasher`. Throws RangeError if `out` is too short.
 */
export function computeSubHashes(world: World, out: Uint32Array, hasher: XxHash32): void {
  const arena = world.arena;
  const regions = arena.ruleRegions;
  if (out.length < regions.length) throw new RangeError(`computeSubHashes: out has ${out.length} slots, the arena has ${regions.length} rule regions`);
  for (let i = 0; i < regions.length; i++) out[i] = regionHash(regions[i]!, arena, hasher) >>> 0;
}
