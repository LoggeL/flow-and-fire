/**
 * Generated scenario maps (MS3): @faf/nav test maps built as @faf/formats RtsMaps in memory, so
 * scenarios and the cross-engine harness use them without a file system (formats is only read).
 * Cached per (kind, size, seed): the generator is deterministic.
 */
import { createRtsMap, type RtsMap } from '@faf/formats';
import { generateNavTestMap, type NavTestMap, type NavTestMapKind } from '@faf/nav/testmap';

const cache: Record<string, { map: RtsMap; nav: NavTestMap }> = {};

/** A nav test map as RtsMap plus the generator output (choke position, base footprints). */
export function navTestRtsMap(kind: NavTestMapKind, sizeWu: number, seed: number): { map: RtsMap; nav: NavTestMap } {
  const key = `${kind}-${sizeWu}-${seed}`;
  const hit = cache[key];
  if (hit !== undefined) return hit;
  const nav = generateNavTestMap({ sizeWu, seed, kind });
  const map = createRtsMap({
    sizeWu,
    name: nav.name,
    heights: nav.heights,
    heightScaleRaw: nav.heightScaleRaw,
    waterLevelRaw: nav.waterLevelRaw,
    starts: nav.starts.map((s) => ({ army: s.army, x: s.x, z: s.z })),
  });
  const entry = { map, nav };
  cache[key] = entry;
  return entry;
}

/** The 3-WU choke map of the MS3 golden `choke-3wu` (128 WU, seed 3). */
export function chokeMap(): { map: RtsMap; nav: NavTestMap } {
  return navTestRtsMap('choke', 128, 3);
}
