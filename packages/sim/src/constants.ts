/**
 * Simulation constants (PLAN §3.4, §3.5). Every value here is part of the determinism contract:
 * changing one changes hashes (and must be treated like a format change).
 */
import { FX_ONE, FX_SHIFT } from '@faf/fixed';

/** Unit capacity (PLAN §3.4 "Kapazitäten"). */
export const CAP_UNITS = 8192;
/** Default side length of the flat test plane map in WU (formats TEST_PLANE_SIZE_WU). */
export const DEFAULT_MAP_SIZE_WU = 512;
/**
 * Smallest/largest supported map side: a power of two in 64..4096 — the same rule as the .rtsmap
 * format (formats MAP_MIN/MAX_SIZE_WU) and the renderer; every such size is a multiple of the
 * coarse cell.
 */
export const MIN_MAP_SIZE_WU = 64;
export const MAX_MAP_SIZE_WU = 4096;

/**
 * Version tag of the simulation code (part of simId, PLAN §3.1). Bump it whenever sim behaviour
 * or the arena layout changes so that old command logs/replays would diverge. Enforced by the L2
 * goldens: every golden stores the SIM_BUILD it was recorded with, the golden test fails when
 * they differ, and `goldens --update` refuses to rewrite a changed hash chain without a bump.
 * History: ms1.1 → ms1.2 (last rule hash moved to the derived region `hashlog`, Units.gen
 * column dropped, serial-number seq order in CommandApply); ms1.2 → ms2.0 (map in the static
 * arena area, y from the heightmap, deep water blocks land units with axis sliding and a stuck
 * timeout, Movers.best/stuck columns, spawn rejection counter in the world header).
 */
export const SIM_BUILD = 'faf-sim/ms2.0';

/**
 * Rule hash interval in ticks (PLAN §3.5; release: 50). Only the observation cadence: the hash is
 * stored in the derived region `hashlog`, so the interval does not change the simulated state.
 */
export const HASH_INTERVAL_TICKS = 10;

/** Spatial grids (PLAN §3.4 phase 8): fine 4 WU, coarse 32 WU cells. */
export const FINE_CELL_WU = 4;
export const COARSE_CELL_WU = 32;
/** Raw Fx → fine cell: x >> FINE_CELL_SHIFT. */
export const FINE_CELL_SHIFT = FX_SHIFT + 2;
/** Raw Fx → coarse cell: x >> COARSE_CELL_SHIFT. */
export const COARSE_CELL_SHIFT = FX_SHIFT + 5;
/** Radius queries up to this size (raw Fx) use the fine grid, larger ones the coarse grid. */
export const FINE_QUERY_MAX_RADIUS = 16 * FX_ONE;

/** Move arrival tolerance (raw Fx, 0.25 WU). */
export const ARRIVE_TOLERANCE = FX_ONE >> 2;
/**
 * Arrival contagion (MS1 minimal version of PLAN §3.8): a moving unit that touches an idle unit
 * which arrived at the same target counts as arrived if it is at most this far from the target.
 */
export const CONTAGION_MAX_DIST = 64 * FX_ONE;
/** Separation considers at most this many overlapping neighbors per unit and tick (PLAN §3.8). */
export const MAX_SEPARATION_NEIGHBORS = 8;

/**
 * Stuck rule (MS2 minimal form of PLAN §3.8 "Stuck (< ε über 20 Ticks) → Repath"): a moving unit
 * that tries to move (speed > 0, or its movement was cut by deep water) but did not get at least
 * STUCK_PROGRESS_RAW closer to its target for STUCK_TICKS such ticks ends its order (Idle). MS3
 * replaces the "give up" with repath/avoidance on passability grids + HPA* (M5).
 */
export const STUCK_TICKS = 20;
/** Minimum approach (raw Fx, 1/16 WU) that counts as progress towards the move target. */
export const STUCK_PROGRESS_RAW = FX_ONE >> 4;
/** Movers.best before the first distance sample of an order ("no distance yet"). */
export const NO_BEST_DIST = 0x7fffffff;

/** Salts of rng32 (one per purpose, PLAN §3.3). */
export const SALT_SPAWN_ANGLE = 0x53504e41; // 'SPNA'
export const SALT_SPAWN_RADIUS = 0x53504e52; // 'SPNR'
export const SALT_SPAWN_YAW = 0x53504e59; // 'SPNY'
export const SALT_SEPARATION = 0x53455041; // 'SEPA'

/** Units.state values. */
export const UnitState = {
  Idle: 0,
  Moving: 1,
} as const;
export type UnitState = (typeof UnitState)[keyof typeof UnitState];

/** Units.flags bits (sim-internal; not the frame UnitFlags). */
export const UnitBits = {
  /** Frame must not interpolate this tick (spawn / new handle in slot). */
  NoInterp: 1 << 0,
  /** Spawned during the current tick (NoInterp survives the Movement phase once). */
  Fresh: 1 << 1,
  /** Killed; the slot is freed in the Cleanup phase of this tick. */
  Dead: 1 << 2,
} as const;

/** Movers.state values. */
export const MoverState = {
  Idle: 0,
  Moving: 1,
} as const;

/** Movers.flags bits. */
export const MoverBits = {
  /** Touched an idle unit that arrived at the same target (arrival contagion). */
  TouchedArrived: 1 << 0,
  /**
   * Idle, standing still and without overlap in its last separation pass: skips its own
   * neighbor query until a neighbor overlaps it (wake-up) or it gets an order.
   */
  Asleep: 1 << 1,
  /**
   * Deep water cut the unit's movement (integration or separation push) in the last Movement
   * phase; read (and cleared) by the next Orders phase for the stuck rule.
   */
  WaterBlocked: 1 << 2,
} as const;

/** Map spot kinds in the static map region (same numbering as mapSimHash in @faf/formats). */
export const SpotKind = {
  Mass: 0,
  Hydro: 1,
} as const;
export type SpotKind = (typeof SpotKind)[keyof typeof SpotKind];

/** Value of unused i32 reference columns (orderHead, formation, builder, …). */
export const NO_REF = -1;
/** "No ack yet" marker of Armies.lastAckSeq (written as 0xFFFFFFFF into frames). */
export const NO_ACK = -1;
