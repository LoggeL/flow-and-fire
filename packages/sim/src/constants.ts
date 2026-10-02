/**
 * Simulation constants (PLAN §3.4, §3.5). Every value here is part of the determinism contract:
 * changing one changes hashes (and must be treated like a format change).
 */
import { deg, fx, FX_ONE, FX_SHIFT } from '@faf/fixed';

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
 * timeout, Movers.best/stuck columns, spawn rejection counter in the world header);
 * ms2.0 → ms3.0 (nav regions in the arena (M5/M6), PathService phase 3, order queue with shift
 * (G7), group moves with offset preservation, SPK2 kinematics/steering/collision (G8/M7),
 * footprint cheat, passability per size class instead of the MS2 deep-water-only rule);
 * ms3.0 → ms4.0 (integer milli flow, priority/stall state, Q16 construction and building footprints).
 */
// ms6.2: paid stationary mass-extractor successors; prior builds remain available for replays.
// ms6.3: paid land-factory successors (no production while upgrading, Stop cancels only the
// upgrade), radar blips in frames, point defense and radar content.
// ms6.4: independent paid commander slots, preserving installed modules in every order.
export const SIM_BUILD = 'faf-sim/ms6.4-commander-enhancements';

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

// ---- MS3 movement (G8/M7): SPK2 parameter set (DECISIONS 22, tools/headless/src/spk2/params.ts),
// ported to Fx/Ang16 exactly once here (round half up via fx()/deg()). Per-blueprint values
// (speed, accel, brake, turn rate, radius, mass, turnInPlace) come from sim.bin (SimBpTable).
// Per-second SPK2 values are per tick here (10 Hz).

/** SPK2 startAngleDeg 70°: below this heading error a unit drives while turning. */
export const MOVE_START_ANGLE = deg(70); // 12743
/** SPK2 turnSlowdownMin 0.4: speed factor at MOVE_START_ANGLE (linear to 1 at 0°). */
export const MOVE_TURN_SLOWDOWN_MIN = fx(0.4); // 1638
/** SPK2 pivotCreepFraction 0.1: speed fraction while pivoting above MOVE_START_ANGLE. */
export const MOVE_PIVOT_CREEP = fx(0.1); // 410
/** SPK2 launchTicks 3 / launchBoost 2: start-up kick after a new order. */
export const MOVE_LAUNCH_TICKS = 3;
export const MOVE_LAUNCH_BOOST = 2;
/** SPK2 separationStrength 0.5 (weight of the separation vector; path direction = 1). */
export const SEPARATION_STRENGTH = fx(0.5); // 2048
/** SPK2 separationRangeFactor 1.5: separation reaches 1.5 × (ri + rj). */
export const SEPARATION_RANGE_FACTOR = fx(1.5); // 6144
/** Separation considers at most this many (nearest) neighbors per unit and tick (PLAN §3.8, SPK2 maxNeighbors). */
export const MAX_SEPARATION_NEIGHBORS = 8;
/** SPK2 clearanceMargin 0.5 WU / clearanceStrength 1.5: obstacle gradient (away from blocked cells). */
export const CLEARANCE_MARGIN = fx(0.5); // 2048
export const CLEARANCE_STRENGTH = fx(1.5); // 6144
/** SPK2 arrivalRadius 0.35 WU: a unit on its final leg within this distance of its slot has arrived. */
export const ARRIVAL_RADIUS = fx(0.35); // 1434
/** SPK2 contagionDistance 4 WU / contagionGap 0.3 WU / contagionStallTicks 10. */
export const CONTAGION_DISTANCE = fx(4); // 16384
export const CONTAGION_GAP = fx(0.3); // 1229
export const CONTAGION_STALL_TICKS = 10;
/** SPK2 returnDistance 1 WU / returnDelayTicks 10: pushed-off arrived units drive back to their slot. */
export const RETURN_DISTANCE = fx(1); // 4096
export const RETURN_DELAY_TICKS = 10;
/** SPK2 collisionIterations 2 / movingPriority 4 ("fahrend vor stehend"). */
export const COLLISION_ITERATIONS = 2;
export const MOVING_PRIORITY = 4;
/** SPK2 idleNudge (on), nudgeSpeedFraction 0.5, nudgeTicks 6. */
export const NUDGE_SPEED = fx(0.5); // 2048 (fraction of the top speed)
export const NUDGE_TICKS = 6;
/**
 * SPK2 stuckTicks 20 / stuckEpsilon 0.15 WU (PLAN §3.8 "Stuck (< ε über 20 Ticks)"): a moving unit
 * that does not get STUCK_EPSILON closer to its steering point within STUCK_TICKS ticks is stuck
 * ⇒ 1. repath (own path), 2. side-step by SIDESTEP_DISTANCE (or nearest reachable point), 3. give up.
 */
export const STUCK_TICKS = 20;
export const STUCK_EPSILON = fx(0.15); // 614
export const SIDESTEP_DISTANCE = fx(2.5); // 10240
/** SPK2 waypointRadius 1 WU / lookaheadTicks 5 (LOS skip of waypoints, staggered by slot). */
export const WAYPOINT_RADIUS = fx(1); // 4096
export const LOOKAHEAD_TICKS = 5;
/** SPK2 offset compression R(n) = offsetRadiusBase + offsetRadiusPerSqrtN · √n (2 + 1.1·√n WU). */
export const OFFSET_RADIUS_BASE = fx(2); // 8192
export const OFFSET_RADIUS_PER_SQRT_N = fx(1.1); // 4506
/** SPK2 offsetMinGap 0.15 WU: compressed slots are never closer than ri + rj + gap. */
export const OFFSET_MIN_GAP = fx(0.15); // 614
/**
 * Slope braking (PLAN §3.8 "Neigung bremst"; not part of SPK2, which had no slopes): top speed
 * factor in ‰ per nav cost level of the unit's cell (0 = flat … 3 = near the slope limit).
 */
export const SLOPE_SPEED_PERMILLE: readonly number[] = [1000, 900, 800, 700];

/** Offsets are stored packed with this precision (1/16 WU = 256 raw) in 16 bits per axis. */
export const OFFSET_QUANT_SHIFT = 8;
/** Largest stored offset per axis (raw Fx): ±2047 WU. */
export const OFFSET_MAX_RAW = 32767 << OFFSET_QUANT_SHIFT;

/** Movers.best before the first distance sample ("no distance yet"). */
export const NO_BEST_DIST = 0x7fffffff;

// ---- MS3 orders and paths (G7, M6) ----------------------------------------------------------

/** Order records (OrderPool slab, 32 B each) and the per-unit queue cap (overflow is dropped + counted). */
export const CAP_ORDERS = 32768;
export const MAX_ORDERS_PER_UNIT = 32;
/** Group records (Formations table): one per Move command (and queue entry). */
export const CAP_FORMATIONS = 4096;
/**
 * PathService expansion budget per tick (phase 3). Start value from the SPK3 nav measurement
 * (docs/status/ms3-p0-nav.md: 200 requests on 1,024 WU in 8 ticks, p95 3.4 ms) = @faf/nav
 * NAV_BUDGET_EXPANSIONS_PER_TICK.
 */
export const PATH_BUDGET_EXPANSIONS = 20000;
/**
 * Lazy refinement in phase 7 (Movement): at most this many path segments are refined per tick
 * (each ≤ 2 sectors, typically 50–300 expansions). Units whose next segment is not refined yet
 * steer towards the next abstract node in the meantime.
 */
export const REFINE_SEGMENTS_PER_TICK = 32;
/** Rings of the nearest-reachable spiral search for blocked group slots (cells = WU). */
export const SLOT_SEARCH_MAX_RADIUS = 64;

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

/** Order record types (OrderPool word 0, low byte; same numbering as protocol WatchOrderType). */
export const OrderType = {
  Move: 1,
  Stop: 2,
  Build: 3,
  Attack:4, Assist:5, Patrol:6, AttackMove:7, AttackGround:8, Repair:9, Guard:10, Reclaim:11, Upgrade:12,
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

/** Order record flags (OrderPool word 0, bits 8+). */
export const OrderBits = {
  /** begin() ran (the order is the unit's active order). */
  Begun: 1,
} as const;

/** Formations.state values. */
export const FormationState = {
  /** Created; the path request is issued when the first member begins the order. */
  Waiting: 0,
  /** Path requested (pending in the PathService FIFO). */
  Requested: 1,
  /** Path finished (ready, direct or failed); effective anchor gx/gz known. */
  Ready: 2,
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
  UnderConstruction: 1 << 3,
  Footprint: 1 << 4,
  DeathProcessed:1 << 5,
} as const;

/** Movers.state values. */
export const MoverState = {
  Idle: 0,
  /** Executing a Move order. */
  Moving: 1,
  /** Idle unit driving back to its slot after being pushed off (SPK2 slot return; no order). */
  Returning: 2,
} as const;

/** Movers.flags bits (u16). */
export const MoverBits = {
  /**
   * Idle, standing still and without overlap in its last collision pass: skips its own neighbor
   * queries until a neighbor overlaps it (wake-up) or it gets an order.
   */
  Asleep: 1 << 0,
  /** Reached its slot (or arrival contagion) in Movement; the next Orders phase completes the order. */
  Arrived: 1 << 1,
  /** Movers.path is an own path of the active order (stuck repath), not the group path. */
  OwnPath: 1 << 2,
  /** Final leg: steering straight to the slot (goal sector, free LOS or path end). */
  FinalLeg: 1 << 3,
  /** The slot is provisional (group path not finished at begin); finalised when it is. */
  SlotPending: 1 << 4,
  /** Steering to a side-step point (wx/wz) first (stuck chain stage 2). */
  Detour: 1 << 5,
  /** No progress for STUCK_TICKS ticks (set in Movement, handled by the next Orders phase). */
  Stuck: 1 << 6,
  /** Idle unit that remembers its slot (tx/tz) and drives back when pushed off. */
  HasSlot: 1 << 7,
  /** The movement of this tick was cut by impassable cells (diagnostics). */
  Blocked: 1 << 8,
  /** The slot/goal of the active order was retargeted (unreachable or blocked target). */
  Retargeted: 1 << 9,
  /** wx/wz hold the (offset-checked) steering point of waypoint index `wp` (cache). */
  WpCached: 1 << 10,
  /** Heading error above MOVE_START_ANGLE this tick: turning on the spot (not counted as stuck). */
  Pivoting: 1 << 11,
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
