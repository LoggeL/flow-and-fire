export { repoRoot, repoPath } from './repo.ts';
export {
  ARENA_MAPS,
  arenaMapFromRtsMap,
  arenaMapPath,
  getArenaMap,
  heightAt,
  heightAtGrid,
  loadArenaMap,
  mapClassOf,
  type ArenaMap,
  type ArenaMapClass,
  type ArenaMapName,
  type ArenaSpot,
  type ArenaStart,
} from './maps.ts';
export {
  OPENINGS_SCHEMA,
  ROSTER_SCHEMA,
  checkOpeningsJson,
  checkRosterJson,
  loadOpeningsJson,
  loadRosterJson,
  type OpeningJson,
  type OpeningsJson,
  type RosterJson,
  type RosterUnitJson,
} from './design.ts';
export {
  FALLBACK_ASSUMPTIONS,
  buildRangeFor,
  getArenaAssumptions,
  getArenaBps,
  getArenaRoles,
  parseArenaAssumptions,
  type ArenaAssumptions,
  type BuildRangeRule,
} from './assumptions.ts';
