/**
 * Standalone nav for tests and benchmarks: an own arena with exactly the regions the sim registers
 * (`defineNavRegions`), static terrain from the map and freshly built derived regions.
 */

import { ArenaBuilder, type Arena } from '@faf/heap';
import { Nav } from './nav.ts';
import { addNavRegions, defineNavRegions, type NavRegions } from './regions.ts';
import type { NavMapInput } from './static.ts';

export interface StandaloneNav {
  readonly arena: Arena;
  readonly regions: NavRegions;
  readonly nav: Nav;
}

/** Builds an arena with the nav regions for `map`, runs precomputeStatic and rebuildDerived. */
export function createStandaloneNav(map: NavMapInput): StandaloneNav {
  const b = new ArenaBuilder();
  const regions = addNavRegions(b, defineNavRegions(map.sizeWu));
  const arena = b.build();
  const nav = new Nav(regions);
  nav.precomputeStatic(map);
  nav.rebuildDerived();
  return { arena, regions, nav };
}
