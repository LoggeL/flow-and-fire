/**
 * Arena schema of the sim (PLAN §3.5). Registration order = layout order = hash order.
 *
 * Units carries the COMPLETE column set of §3.5 from MS1 on (unused columns stay 0, unused
 * references −1) so the layout is stable across milestones.
 */
import { MAX_ARMIES } from '@faf/fixed';
import { defineDense, defineRegion, defineSlab, defineTable } from '@faf/heap';
import { NAV_CAP_PATHS } from '@faf/nav';
import { CAP_FORMATIONS, CAP_ORDERS, CAP_UNITS } from './constants.ts';

/** World header words (Int32, raw region `world`). */
export const WH_TICK = 0;
export const WH_SEED = 1;
// Words 2 and 3 are reserved (always 0). They held the last rule hash up to simBuild ms1.1; the
// hash now lives in the derived region `hashlog` (not rule state, see HashLog below).
export const WH_ARMY_COUNT = 4;
export const WH_MAP_SIZE_WU = 5;
/** Monotonic spawn counter (rng32 entity index of cheat spawns). */
export const WH_SPAWN_SERIAL = 6;
/**
 * Cheat-spawned units rejected because their point was blocked for them (M2: deep water; MS3: a
 * nav cell not passable for their size class).
 */
export const WH_SPAWN_REJECTED = 7;
/** MS3: move orders given up by the stuck chain (repath → side-step → give up). */
export const WH_STUCK_GIVEUPS = 8;
/** MS3: order records dropped because the unit's queue (MAX_ORDERS_PER_UNIT) or the OrderPool was full. */
export const WH_ORDERS_DROPPED = 9;
/** MS3: Move commands dropped because the Formations table was full. */
export const WH_GROUPS_DROPPED = 10;
/** MS3: CheatSub.Footprint commands rejected (size out of 1..64, delta not ±1). */
export const WH_FOOTPRINT_REJECTED = 11;
/** MS3: path requests that could not be issued (nav path table full; the unit steers directly). */
export const WH_REQUESTS_FAILED = 12;
/** MS3: units pushed out of freshly blocked cells (footprints). */
export const WH_UNITS_EVICTED = 13;
/** Words reserved in the header (the rest is zero). */
export const WORLD_HEADER_WORDS = 16;

export const WorldHeader = defineRegion('world', WORLD_HEADER_WORDS * 4);

/**
 * Last rule hash and its tick (Int32 words of the raw region `hashlog`). Derived on purpose: the
 * hash is an observation of the state, not part of it, so neither the hash cadence
 * (HASH_INTERVAL_TICKS; PLAN §3.5 "Release: 50") nor the hash algorithm (rolling/WASM variant)
 * feeds back into the next rule hash. It is still part of snapshots (restore keeps the frame
 * header consistent) and of the full hash.
 */
export const HL_LAST_HASH_TICK = 0;
/** Stored as u32 bits (read through the u32 view). */
export const HL_LAST_HASH = 1;
export const HASH_LOG_WORDS = 4;
export const HashLog = defineRegion('hashlog', HASH_LOG_WORDS * 4, { derived: true });

/** Armies: 16 rows (G11). `lastAckSeq` = seq of the last processed command (−1 = none). */
export const Armies = defineTable('armies', MAX_ARMIES, {
  active: 'u8',
  unitCount: 'i32',
  unitCap: 'i32',
  lastAckSeq: 'i32',
});

/** Alliance matrix 16×16 u8 (row = army, column = other army); self is always allied. */
export const Alliance = defineRegion('alliance', MAX_ARMIES * MAX_ARMIES);

export const UNITS_SCHEMA = {
  bp: 'u16',
  army: 'u8',
  layer: 'u8',
  state: 'u8',
  flags: 'u32',
  // The generation of §3.5 (`gen:'u16'`) is the Table-DSL's own generation column (units.gen,
  // handle()); a second copy here would be a redundant, separately hashed truth (DECISIONS).
  x: 'i32',
  y: 'i32',
  z: 'i32',
  px: 'i32',
  py: 'i32',
  pz: 'i32',
  yaw: 'u16',
  pyaw: 'u16',
  bank: 'i8',
  vx: 'i32',
  vz: 'i32',
  hp: 'i32',
  buildDone: 'f64s',
  vetMass: 'f64s',
  vet: 'u8',
  lastHitBy: 'u32',
  orderHead: 'i32',
  orderTail: 'i32',
  weaponFirst: 'u16',
  weaponCount: 'u8',
  formation: 'i32',
  groupOffset: 'i32',
  mover: 'i32',
  air: 'i32',
  builder: 'i32',
  factory: 'i32',
  shield: 'i32',
  intel: 'i32',
  eco: 'i32',
} as const;

export const Units = defineTable('units', CAP_UNITS, UNITS_SCHEMA);

/** Dense movement component (back-pointer = Units slot; Units.mover points back). */
export const MOVERS_SCHEMA = {
  /** Slot = final target of the active move (Fx; anchor + offset, adjusted to a reachable cell). */
  tx: 'i32',
  tz: 'i32',
  /** Anchor = commanded target of the active/last move (Fx): identity of a group for arrival contagion. */
  ax: 'i32',
  az: 'i32',
  /** Current steering point (Fx): waypoint (+ offset), side-step point or slot. */
  wx: 'i32',
  wz: 'i32',
  /** Current scalar speed (Fx per tick, ≥ 0). */
  speed: 'i32',
  /** MoverState. */
  state: 'u8',
  /** MoverBits (u16). */
  flags: 'u16',
  /** Stuck rule: smallest distance to the steering point since the last progress (Fx; NO_BEST_DIST = none). */
  best: 'i32',
  /** Ticks without progress (stuck rule) and stage of the stuck chain (0 none, 1 repathed, 2 side-stepped). */
  stuck: 'u8',
  streak: 'u8',
  /** Smallest distance to the slot in the current order (Fx; NO_BEST_DIST = none): resets the stuck chain. */
  sbest: 'i32',
  /** Followed path id (@faf/nav, −1 = none): the group path of the order's formation or an own path. */
  path: 'i32',
  /** Waypoint index: group path = absolute index since the path start; own path = 0 (it is consumed directly). */
  wp: 'i32',
  /** Generation of the group path seen (Formations.gen; a repath resets wp). */
  pgen: 'u16',
  /** Start-up kick ticks left. */
  launch: 'u8',
  /** Idle nudge: ticks left and direction (Fx unit vector). */
  nudge: 'u8',
  ndx: 'i16',
  ndz: 'i16',
  /** Last tick a moving unit pushed this (idle) unit (slot return delay). */
  pushTick: 'i32',
  /** Number of queued order records (Units.orderHead … orderTail). */
  orders: 'u8',
} as const;

export const Movers = defineDense('movers', CAP_UNITS, MOVERS_SCHEMA);

/**
 * OrderPool (PLAN §3.5 "Order-Records à 32 B", G7): one slab record per queued order, linked per
 * unit (Units.orderHead → … → orderTail). Int32 words of a record:
 */
export const ORD_TYPE_FLAGS = 0; // OrderType (bits 0–7) | OrderBits << 8
export const ORD_TX = 1; // commanded target (Fx; the anchor of a group order)
export const ORD_TZ = 2;
export const ORD_FORMATION = 3; // Formations slot (−1 = none)
export const ORD_PATH = 4; // own path of this order (stuck repath; −1 = none)
export const ORD_NEXT = 5; // next record of the unit's queue (−1 = last)
export const ORD_OFFSET = 6; // packed group offset (x, z in 1/16 WU, i16 each)
export const ORD_TICK = 7; // tick the order was created
export const ORDER_RECORD_WORDS = 8;
export const OrderPool = defineSlab('orders', ORDER_RECORD_WORDS * 4, CAP_ORDERS);

/**
 * Formations (PLAN §3.5 "Anker/Slots", §3.8 "Gruppen"): one record per Move command (group of
 * n ≥ 1 own units; per queue entry), owner of the single path request of the group.
 */
export const FORMATIONS_SCHEMA = {
  army: 'u8',
  /** Nav class of the group path = largest class of the members. */
  cls: 'u8',
  /** FormationState. */
  state: 'u8',
  flags: 'u8',
  /** Path generation (incremented on a corridor repath; members reset their waypoint index). */
  gen: 'u16',
  /** Units at creation / order records still referencing the group (freed at 0). */
  count: 'i32',
  refs: 'i32',
  /** Commanded target (Fx). */
  tx: 'i32',
  tz: 'i32',
  /** Effective anchor (Fx): the path goal (retargeted if unreachable), tx/tz before. */
  gx: 'i32',
  gz: 'i32',
  /** Start of the request (Fx): unit nearest to the centroid (queued: its previous slot). */
  sx: 'i32',
  sz: 'i32',
  /** Path id (−1 before the request / if the path table was full). */
  path: 'i32',
  /** Waypoints consumed on the shared path (nav cursor) = minimum over the members. */
  consumed: 'i32',
  /** Per-tick minimum of the members' waypoint indices (Movement). */
  minWp: 'i32',
} as const;
export const Formations = defineTable('formations', CAP_FORMATIONS, FORMATIONS_SCHEMA);

/**
 * Owner of every nav path slot (Int32 per path id): formation f ≥ 0, own path of unit slot u as
 * −2 − u, −1 = none. Rule state (paths are rule state in @faf/nav).
 */
export const PathOwner = defineRegion('paths.owner', NAV_CAP_PATHS * 4);
export const PATH_OWNER_NONE = -1;

/**
 * Static map area (PLAN §3.5 "Bereich statisch"): written once in createWorld, never hashed,
 * never part of a snapshot — its identity enters the simId through mapSimHash (PLAN §3.1).
 *
 * `map.terrain` (Int32 words):
 */
export const MT_SIZE_WU = 0;
export const MT_DIM = 1;
export const MT_HEIGHT_SCALE_RAW = 2;
/** 1 = the map has a water surface, 0 = none. */
export const MT_WATER_FLAG = 3;
/** Water surface (Fx raw), 0 without water. */
export const MT_WATER_LEVEL_RAW = 4;
export const MT_START_COUNT = 5;
export const MT_SPOT_COUNT = 6;
export const MAP_TERRAIN_WORDS = 16;
/** Words per start (army, x, z) and per spot (kind, x, z) in `map.starts` / `map.spots`. */
export const MAP_POINT_WORDS = 3;

const STATIC = { area: 'static' } as const;

export const MapTerrain = defineRegion('map.terrain', MAP_TERRAIN_WORDS * 4, STATIC);
/** One row per possible army (unused rows zero). */
export const MapStarts = defineRegion('map.starts', MAX_ARMIES * MAP_POINT_WORDS * 4, STATIC);

/** `map.heights`: dim² u16 height steps, index z·dim + x (the rules.Heightfield samples). */
export function mapHeightsRegion(dim: number) {
  return defineRegion('map.heights', dim * dim * 2, STATIC);
}

/** `map.spots`: spotCount × (kind, x, z) Int32 (at least one row so the region is never empty). */
export function mapSpotsRegion(spotCount: number) {
  return defineRegion('map.spots', (spotCount > 0 ? spotCount : 1) * MAP_POINT_WORDS * 4, STATIC);
}

/** Grid dimensions (cells per side) of a map. */
export function gridDims(mapSizeWu: number): { fine: number; coarse: number } {
  return { fine: mapSizeWu >> 2, coarse: mapSizeWu >> 5 };
}

/**
 * Derived spatial-grid regions (PLAN §3.4 phase 8, S5): counting-sort buckets.
 *   start  i32[cells + 1]  bucket begin offsets (start[cells] = item count)
 *   cursor i32[cells]      fill cursor (scratch of the counting sort)
 *   items  i32[CAP_UNITS]  unit slots, bucket-major, ascending slot inside a bucket
 *   cellOf i32[CAP_UNITS]  cell of each slot at rebuild time (−1 = not in the grid)
 */
export function gridRegions(prefix: string, cells: number) {
  return {
    start: defineRegion(`${prefix}.start`, (cells + 1) * 4, { derived: true }),
    cursor: defineRegion(`${prefix}.cursor`, cells * 4, { derived: true }),
    items: defineRegion(`${prefix}.items`, CAP_UNITS * 4, { derived: true }),
    cellOf: defineRegion(`${prefix}.cellOf`, CAP_UNITS * 4, { derived: true }),
  };
}
