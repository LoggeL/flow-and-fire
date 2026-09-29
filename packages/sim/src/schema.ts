/**
 * Arena schema of the sim (PLAN §3.5). Registration order = layout order = hash order.
 *
 * Units carries the COMPLETE column set of §3.5 from MS1 on (unused columns stay 0, unused
 * references −1) so the layout is stable across milestones.
 */
import { MAX_ARMIES } from '@faf/fixed';
import { defineDense, defineRegion, defineTable } from '@faf/heap';
import { CAP_UNITS } from './constants.ts';

/** World header words (Int32, raw region `world`). */
export const WH_TICK = 0;
export const WH_SEED = 1;
// Words 2 and 3 are reserved (always 0). They held the last rule hash up to simBuild ms1.1; the
// hash now lives in the derived region `hashlog` (not rule state, see HashLog below).
export const WH_ARMY_COUNT = 4;
export const WH_MAP_SIZE_WU = 5;
/** Monotonic spawn counter (rng32 entity index of cheat spawns). */
export const WH_SPAWN_SERIAL = 6;
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
  /** Move target (Fx). */
  tx: 'i32',
  tz: 'i32',
  /** Current scalar speed (Fx per tick, ≥ 0). */
  speed: 'i32',
  /** MoverState. */
  state: 'u8',
  /** MoverBits. */
  flags: 'u8',
} as const;

export const Movers = defineDense('movers', CAP_UNITS, MOVERS_SCHEMA);

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
