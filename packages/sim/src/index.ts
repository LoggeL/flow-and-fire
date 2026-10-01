export * from './constants.ts';
export * from './phases.ts';
export {
  Alliance,
  Armies,
  Formations,
  FORMATIONS_SCHEMA,
  Movers,
  MOVERS_SCHEMA,
  OrderPool,
  ORDER_RECORD_WORDS,
  ORD_FORMATION,
  ORD_NEXT,
  ORD_OFFSET,
  ORD_PATH,
  ORD_TICK,
  ORD_TX,
  ORD_TYPE_FLAGS,
  ORD_TZ,
  PathOwner,
  PATH_OWNER_NONE,
  Units,
  UNITS_SCHEMA,
  WorldHeader,
  WH_FOOTPRINT_REJECTED,
  WH_GROUPS_DROPPED,
  WH_ORDERS_DROPPED,
  WH_REQUESTS_FAILED,
  WH_STUCK_GIVEUPS,
  WH_UNITS_EVICTED,
  HashLog,
  HASH_LOG_WORDS,
  HL_LAST_HASH,
  HL_LAST_HASH_TICK,
  WH_ARMY_COUNT,
  WH_MAP_SIZE_WU,
  WH_SEED,
  WH_SPAWN_REJECTED,
  WH_SPAWN_SERIAL,
  WH_TICK,
  MAP_POINT_WORDS,
  MAP_TERRAIN_WORDS,
  MT_DIM,
  MT_HEIGHT_SCALE_RAW,
  MT_SIZE_WU,
  MT_SPOT_COUNT,
  MT_START_COUNT,
  MT_WATER_FLAG,
  MT_WATER_LEVEL_RAW,
} from './schema.ts';
export * from './terrain.ts';
export {
  blueprintReloadProblem,
  createWorld,
  replaceBlueprints,
  SpatialGrid,
  World,
  WorldInitStage,
  type CreateWorldOptions,
  type WorldInitProbe,
} from './world.ts';
export { offsetX, offsetZ, packOffset, queueLength, unitClass } from './orders.ts';
export { fullHash, lastHash, lastHashTick, restore, ruleHash, snapshot, step, type StepCommands } from './step.ts';
export { hpToU8, writeFrame, type FrameMeta } from './frame.ts';
export { forEachInRadius, queryRadius, type UnitVisitor } from './spatial.ts';
export * from './query.ts';

export {initializeSkirmish, placementWorld, placementVerdict} from './economy.ts';
export {canSeePosition,visibleTo} from './intel.ts';
export {hasMatchEnded,matchResult,type MatchResult} from './combat.ts';
export { perceive, canPlaceForArmy, type SimPerception, type PerceivedUnit, type PerceivedOrder } from './perception.ts';

export { wreckHandle,resolveWreck } from './reclaim.ts';

export {spawnUnit} from './unit-storage.ts';
export {killUnit} from './lifecycle.ts';
