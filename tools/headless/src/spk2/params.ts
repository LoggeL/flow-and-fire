/**
 * SPK2 result (PLAN §4 "Bewegungsgefühl", §3.8 Steering): the movement parameter set that runs
 * all six SPK2 scenarios without deadlock (DECISIONS 22). ms3-p2 ports these values to Fx in the
 * deterministic sim (constants with an origin comment, converted exactly once).
 *
 * Units: WU (1 WU ≈ 19.5 m), WU/s, WU/s², degrees, ticks (10 Hz). Per-blueprint values (speed,
 * accel, turn rate, radius, mass, brake) come from the unit blueprints; everything here is global.
 */

export interface Spk2Params {
  /** Sim rate (PLAN §3.4). */
  readonly tickHz: number;

  // ---- kinematics / start-up profile (SPK6 follow-up, DECISIONS 8/11) -------------------------
  /** Default braking deceleration = brakeFactor × accel (blueprint `motion.brake` overrides). */
  readonly brakeFactor: number;
  /**
   * Heading error (°) below which a tracked unit drives while still turning; above it the unit
   * turns in place (speed target 0). Also the first-tick behaviour: turning starts in the tick
   * after the command, so the first visible motion (yaw) happens after 1 tick.
   */
  readonly startAngleDeg: number;
  /** Speed factor at `startAngleDeg` (linear to 1 at 0° error). */
  readonly turnSlowdownMin: number;
  /**
   * Speed fraction while pivoting above `startAngleDeg` (tracks roll slightly while turning, so
   * every unit changes position within the first ticks after an order: MS3 "alle fahren < 1 s los").
   */
  readonly pivotCreepFraction: number;
  /** Ticks after a new order during which the acceleration is boosted (start-up kick). */
  readonly launchTicks: number;
  /** Acceleration multiplier during the launch ticks. */
  readonly launchBoost: number;

  // ---- separation (≤ maxNeighbors nearest over a grid) ---------------------------------------
  /** Weight of the separation vector relative to the (unit) path direction. */
  readonly separationStrength: number;
  /** Separation range = (ri + rj) × factor (WU). */
  readonly separationRangeFactor: number;
  /** Nearest neighbours considered for separation (PLAN §3.8: ≤ 8). */
  readonly maxNeighbors: number;

  // ---- obstacle / clearance gradient -----------------------------------------------------------
  /** Gradient acts when the obstacle distance is below radius + margin (WU). */
  readonly clearanceMargin: number;
  /** Weight of the gradient vector. */
  readonly clearanceStrength: number;

  // ---- arrival -----------------------------------------------------------------------------------
  /** A unit is at its slot within this distance (WU). */
  readonly arrivalRadius: number;
  /**
   * Arrival contagion: a moving unit touching an arrived unit of the same order counts as arrived
   * if it is within this distance of its own slot (WU).
   */
  readonly contagionDistance: number;
  /** "Touching" = centre distance ≤ ri + rj + contagionGap (WU). */
  readonly contagionGap: number;
  /**
   * Contagion only applies when the unit's own slot is taken by a standing unit, or when it made
   * no progress for this many ticks (keeps distinct group slots exact).
   */
  readonly contagionStallTicks: number;

  /** An arrived unit pushed farther than this from its slot drives back (WU). */
  readonly returnDistance: number;
  /** … once no moving unit pushed it for this many ticks and the slot is free. */
  readonly returnDelayTicks: number;

  // ---- collision resolution (position based, by mass and priority) ----------------------------
  /** Relaxation passes per tick. */
  readonly collisionIterations: number;
  /** Effective mass multiplier of moving units against standing ones ("fahrend vor stehend"). */
  readonly movingPriority: number;

  // ---- idle nudge ----------------------------------------------------------------------------------
  /** Idle units pushed by a moving unit step aside on their own (true) or only get pushed. */
  readonly idleNudge: boolean;
  /** Nudge speed as a fraction of the unit's top speed. */
  readonly nudgeSpeedFraction: number;
  /** Duration of a nudge move (ticks). */
  readonly nudgeTicks: number;

  // ---- stuck handling --------------------------------------------------------------------------
  /** Window (ticks) of the stuck test (PLAN §3.8: 20). */
  readonly stuckTicks: number;
  /** Progress towards the waypoint below this distance over the window ⇒ stuck (WU). */
  readonly stuckEpsilon: number;
  /** Second stuck in a row: side-step waypoint this far to the side (WU), then repath. */
  readonly sidestepDistance: number;

  // ---- path following ----------------------------------------------------------------------------
  /** Waypoint reached within this distance (WU). */
  readonly waypointRadius: number;
  /** Look-ahead: every n ticks a unit skips waypoints it has clearance LOS to. */
  readonly lookaheadTicks: number;

  // ---- groups (offset preservation) -----------------------------------------------------------
  /**
   * Offset compression: offsets (position − group centroid) are scaled uniformly so the largest
   * one is at most R(n) = offsetRadiusBase + offsetRadiusPerSqrtN · √n (WU).
   */
  readonly offsetRadiusBase: number;
  readonly offsetRadiusPerSqrtN: number;
  /**
   * Lower bound of the compression: no pair of slots closer than ri + rj + offsetMinGap (WU), so
   * compressed slots never overlap (the scale is raised until the tightest pair fits, max 1).
   */
  readonly offsetMinGap: number;

  /** Default collision mass by size class (blueprint `motion.mass` overrides). */
  readonly massBySizeClass: readonly number[];
}

/** R(n): maximum offset radius of a group of n units (WU). */
export function offsetRadius(p: Spk2Params, n: number): number {
  return p.offsetRadiusBase + p.offsetRadiusPerSqrtN * Math.sqrt(n);
}

/**
 * The chosen parameter set (DECISIONS 22). Measured with `pnpm bench:spk2`; every scenario runs
 * without deadlock (choke: 100 units ≤ 60 s, cross-map: ≥ 95 % without stuck > 3 s).
 */
export const SPK2_PARAMS: Spk2Params = {
  tickHz: 10, // PLAN §3.4
  brakeFactor: 2, // brake = 2 × accel: stops within half the start-up distance
  startAngleDeg: 70, // drive while turning below 70° heading error, pivot above
  turnSlowdownMin: 0.4, // 40 % speed at 70° error, 100 % when aligned
  pivotCreepFraction: 0.1, // 10 % speed while pivoting (turn radius ≈ 0.2 WU for a T1 tank)
  launchTicks: 3, // start-up kick for 0.3 s after an order
  launchBoost: 2, // double acceleration during the kick
  separationStrength: 0.5, // separation vector weight (path direction = 1)
  separationRangeFactor: 1.5, // separation reaches 1.5 × (ri + rj)
  maxNeighbors: 8, // PLAN §3.8
  clearanceMargin: 0.5, // WU beyond the radius
  clearanceStrength: 1.5, // obstacle gradient weight
  arrivalRadius: 0.35, // WU
  contagionDistance: 4, // WU from the own slot
  contagionGap: 0.3, // WU
  contagionStallTicks: 10, // 1 s without progress next to an arrived unit ⇒ arrived
  returnDistance: 1.0, // WU off the slot ⇒ drive back
  returnDelayTicks: 10, // 1 s after the last push
  collisionIterations: 2, // passes per tick
  movingPriority: 4, // moving units weigh 4× against standing ones
  idleNudge: true, // idle units step aside actively
  nudgeSpeedFraction: 0.5, // at half their top speed
  nudgeTicks: 6, // for 0.6 s
  stuckTicks: 20, // PLAN §3.8
  stuckEpsilon: 0.15, // WU progress per 20 ticks
  sidestepDistance: 2.5, // WU
  waypointRadius: 1.0, // WU
  lookaheadTicks: 5, // LOS skip every 0.5 s
  offsetRadiusBase: 2, // R(n) = 2 + 1.1 · √n WU (n = 100 ⇒ 13 WU)
  offsetRadiusPerSqrtN: 1.1,
  offsetMinGap: 0.15, // WU between compressed slots
  massBySizeClass: [1, 2, 4, 8], // matches DEFAULT_MASS_BY_SIZE_CLASS in @faf/blueprints
};
