/**
 * SPK2 movement prototype (Float64, 10 Hz), PLAN §3.8 "Steering" without RVO/ORCA:
 *
 * per tick
 *   1. spatial grid rebuild (2-WU cells)
 *   2. per moving unit: path following (waypoint + periodic LOS look-ahead) → desired direction
 *      + separation from ≤ maxNeighbors nearest units + obstacle (distance-field) gradient;
 *      tracked kinematics: turn rate limit, turn in place above startAngle, drive while turning
 *      below it (slowed), accel/brake limits with a start-up kick, braking curve to the slot;
 *      arrival radius and arrival contagion (touching an arrived unit of the same order)
 *   3. idle units: brake to a stop; idle nudge (step aside when a moving unit pushes them)
 *   4. position-based collision resolution by mass and priority (moving units weigh
 *      movingPriority × more than standing ones), then obstacle push-out and map clamp
 *   5. stuck detection (< stuckEpsilon progress along the remaining path in stuckTicks):
 *      1st → repath, 2nd → side-step waypoint + repath, then alternate
 *
 * Group orders keep offsets: offset = position − centroid, compressed uniformly to R(n); one group
 * path (A* from the centroid, class = largest class); each unit follows the group waypoints
 * shifted by its offset where passable for its class, otherwise the waypoint itself, and heads
 * for its slot (target + offset) at the end.
 */
import { Spk2Grid } from './grid.ts';
import { offsetRadius, type Spk2Params } from './params.ts';

/** Unit type (values mirror the core blueprints, see scenarios.ts). */
export interface Spk2UnitType {
  readonly name: string;
  readonly radius: number;
  /** WU/s */
  readonly speed: number;
  /** WU/s² */
  readonly accel: number;
  /** WU/s² (default: brakeFactor × accel) */
  readonly brake?: number;
  /** °/s */
  readonly turnRateDeg: number;
  readonly sizeClass: number;
  /** Collision mass (default by size class). */
  readonly mass?: number;
}

export const UnitState = { Idle: 0, Moving: 1, Arrived: 2 } as const;

/** Per-tick observer (metrics, traces). */
export interface Spk2Observer {
  tick(sim: Spk2Sim): void;
}

const TAU = Math.PI * 2;

function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Deterministic PRNG (mulberry32) for scenario setup. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Spk2Sim {
  readonly grid: Spk2Grid;
  readonly p: Spk2Params;
  readonly dt: number;
  tick = 0;
  count = 0;
  readonly cap: number;
  // ---- state (SoA) ---------------------------------------------------------------------------
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly yaw: Float64Array;
  readonly v: Float64Array;
  readonly radius: Float64Array;
  readonly vmax: Float64Array;
  readonly accel: Float64Array;
  readonly brake: Float64Array;
  readonly turnRate: Float64Array;
  readonly cls: Uint8Array;
  readonly mass: Float64Array;
  readonly state: Uint8Array;
  readonly order: Int32Array;
  readonly slotX: Float64Array;
  readonly slotZ: Float64Array;
  readonly paths: number[][];
  readonly wp: Int32Array;
  readonly launchLeft: Int32Array;
  readonly nudgeX: Float64Array;
  readonly nudgeZ: Float64Array;
  readonly nudgeLeft: Int32Array;
  readonly typeIndex: Int32Array;
  // stuck handling
  readonly refLen: Float64Array;
  readonly refTick: Int32Array;
  readonly stuckStreak: Int32Array;
  // metrics bookkeeping (not used for steering)
  readonly metricRefLen: Float64Array;
  readonly metricRefTick: Int32Array;
  readonly maxNoProgress: Int32Array;
  readonly orderTick: Int32Array;
  readonly orderX: Float64Array;
  readonly orderZ: Float64Array;
  readonly orderYaw: Float64Array;
  readonly firstVisibleTick: Int32Array;
  readonly firstMoveTick: Int32Array;
  readonly arrivedTick: Int32Array;
  readonly lastDYaw: Float64Array;
  /** Last tick a moving unit pushed this unit (idle/arrived units). */
  readonly pushedTick: Int32Array;
  /** Counters. */
  stats = { repaths: 0, sidesteps: 0, stuckEvents: 0, nudges: 0, contagionArrivals: 0, slotReturns: 0, pathExpansions: 0, pathRequests: 0, orderRequests: 0 };
  /** Global progress: last tick any moving unit made progress (deadlock detection). */
  lastAnyProgressTick = 0;
  private nextOrder = 1;
  // spatial grid
  private readonly cellSize = 2;
  private readonly gw: number;
  private readonly gh: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly cellOf: Int32Array;
  private readonly tmp = new Float64Array(2);
  private readonly nbIdx: Int32Array;
  private readonly nbDist: Float64Array;
  private readonly pushedBy: Int32Array;

  constructor(grid: Spk2Grid, params: Spk2Params, cap: number) {
    this.grid = grid;
    this.p = params;
    this.dt = 1 / params.tickHz;
    this.cap = cap;
    const f = (): Float64Array => new Float64Array(cap);
    const i = (): Int32Array => new Int32Array(cap);
    this.x = f();
    this.z = f();
    this.yaw = f();
    this.v = f();
    this.radius = f();
    this.vmax = f();
    this.accel = f();
    this.brake = f();
    this.turnRate = f();
    this.cls = new Uint8Array(cap);
    this.mass = f();
    this.state = new Uint8Array(cap);
    this.order = i();
    this.slotX = f();
    this.slotZ = f();
    this.paths = Array.from({ length: cap }, () => []);
    this.wp = i();
    this.launchLeft = i();
    this.nudgeX = f();
    this.nudgeZ = f();
    this.nudgeLeft = i();
    this.typeIndex = i();
    this.refLen = f();
    this.refTick = i();
    this.stuckStreak = i();
    this.metricRefLen = f();
    this.metricRefTick = i();
    this.maxNoProgress = i();
    this.orderTick = i().fill(-1);
    this.orderX = f();
    this.orderZ = f();
    this.orderYaw = f();
    this.firstVisibleTick = i().fill(-1);
    this.firstMoveTick = i().fill(-1);
    this.arrivedTick = i().fill(-1);
    this.lastDYaw = f();
    this.pushedTick = i().fill(-1000);
    this.gw = Math.ceil(grid.width / this.cellSize);
    this.gh = Math.ceil(grid.height / this.cellSize);
    this.cellStart = new Int32Array(this.gw * this.gh + 1);
    this.cellItems = new Int32Array(cap);
    this.cellOf = new Int32Array(cap);
    this.nbIdx = new Int32Array(64);
    this.nbDist = new Float64Array(64);
    this.pushedBy = new Int32Array(cap).fill(-1);
  }

  /** Adds a unit; returns its index. */
  spawn(type: Spk2UnitType, typeIndex: number, x: number, z: number, yawRad: number): number {
    if (this.count >= this.cap) throw new RangeError('spk2: unit cap reached');
    const k = this.count++;
    const p = this.p;
    this.x[k] = x;
    this.z[k] = z;
    this.yaw[k] = yawRad;
    this.v[k] = 0;
    this.radius[k] = type.radius;
    this.vmax[k] = type.speed;
    this.accel[k] = type.accel;
    this.brake[k] = type.brake ?? type.accel * p.brakeFactor;
    this.turnRate[k] = (type.turnRateDeg * Math.PI) / 180;
    this.cls[k] = Math.max(1, Math.min(3, type.sizeClass));
    this.mass[k] = type.mass ?? p.massBySizeClass[Math.min(type.sizeClass, p.massBySizeClass.length - 1)]!;
    this.state[k] = UnitState.Idle;
    this.typeIndex[k] = typeIndex;
    return k;
  }

  private pathLength(k: number): number {
    const path = this.paths[k]!;
    let len = 0;
    let px = this.x[k]!;
    let pz = this.z[k]!;
    for (let i = this.wp[k]! * 2; i < path.length; i += 2) {
      len += Math.hypot(path[i]! - px, path[i + 1]! - pz);
      px = path[i]!;
      pz = path[i + 1]!;
    }
    return len;
  }

  private beginOrder(k: number, order: number, sx: number, sz: number, path: number[]): void {
    this.order[k] = order;
    this.slotX[k] = sx;
    this.slotZ[k] = sz;
    this.paths[k] = path;
    this.wp[k] = 0;
    this.state[k] = UnitState.Moving;
    this.launchLeft[k] = this.p.launchTicks;
    this.nudgeLeft[k] = 0;
    this.stuckStreak[k] = 0;
    this.refTick[k] = this.tick;
    this.refLen[k] = this.pathLength(k);
    this.metricRefTick[k] = this.tick;
    this.metricRefLen[k] = this.refLen[k]!;
    this.orderTick[k] = this.tick;
    this.orderX[k] = this.x[k]!;
    this.orderZ[k] = this.z[k]!;
    this.orderYaw[k] = this.yaw[k]!;
    this.firstVisibleTick[k] = -1;
    this.firstMoveTick[k] = -1;
    this.arrivedTick[k] = -1;
  }

  private requestPath(cls: number, ax: number, az: number, bx: number, bz: number): number[] | null {
    const st = { expansions: 0 };
    const path = this.grid.findPath(cls, ax, az, bx, bz, st);
    this.stats.pathRequests++;
    this.stats.pathExpansions += st.expansions;
    return path;
  }

  /** New order id (units with the same order share arrival contagion). */
  newOrder(): number {
    return this.nextOrder++;
  }

  /** Individual move (one path per unit); `order` lets several calls share one order id. */
  moveEach(units: readonly number[], tx: number, tz: number, order = this.nextOrder++): void {
    for (const k of units) {
      const path = this.requestPath(this.cls[k]!, this.x[k]!, this.z[k]!, tx, tz) ?? [tx, tz];
      this.stats.orderRequests++;
      this.beginOrder(k, order, path[path.length - 2]!, path[path.length - 1]!, path);
    }
  }

  /**
   * Group move with offset preservation (one path request). Returns the compressed offsets
   * (x, z per unit, in `units` order) for metrics.
   */
  moveGroup(units: readonly number[], tx: number, tz: number, keepOffsets = true): Float64Array {
    const order = this.nextOrder++;
    const n = units.length;
    let cx = 0;
    let cz = 0;
    let cls = 1;
    for (const k of units) {
      cx += this.x[k]!;
      cz += this.z[k]!;
      cls = Math.max(cls, this.cls[k]!);
    }
    cx /= n;
    cz /= n;
    const offs = new Float64Array(n * 2);
    let maxOff = 0;
    units.forEach((k, i) => {
      offs[i * 2] = keepOffsets ? this.x[k]! - cx : 0;
      offs[i * 2 + 1] = keepOffsets ? this.z[k]! - cz : 0;
      maxOff = Math.max(maxOff, Math.hypot(offs[i * 2]!, offs[i * 2 + 1]!));
    });
    const R = offsetRadius(this.p, n);
    // Uniform compression to R(n), but never tighter than touching + offsetMinGap for any pair
    // (mixed sizes: a T2 must still fit between compressed T1 slots).
    let sMin = 0;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const d = Math.hypot(offs[a * 2]! - offs[b * 2]!, offs[a * 2 + 1]! - offs[b * 2 + 1]!);
        const need = this.radius[units[a]!]! + this.radius[units[b]!]! + this.p.offsetMinGap;
        if (d > 1e-9) sMin = Math.max(sMin, need / d);
      }
    }
    const s = Math.min(1, Math.max(maxOff > R ? R / maxOff : 1, sMin));
    for (let i = 0; i < offs.length; i++) offs[i] = offs[i]! * s;
    // One request from the unit nearest to the centroid.
    let lead = units[0]!;
    let best = Infinity;
    for (const k of units) {
      const d = Math.hypot(this.x[k]! - cx, this.z[k]! - cz);
      if (d < best) {
        best = d;
        lead = k;
      }
    }
    const group = this.requestPath(cls, this.x[lead]!, this.z[lead]!, tx, tz) ?? [tx, tz];
    this.stats.orderRequests++;
    units.forEach((k, i) => {
      const ox = offs[i * 2]!;
      const oz = offs[i * 2 + 1]!;
      const c = this.cls[k]!;
      // Shifted waypoint only where it is passable for the unit's class AND in clearance LOS of
      // the previous waypoint (otherwise the shifted leg could cut through a cliff/wall).
      const path: number[] = [];
      let px = this.x[k]!;
      let pz = this.z[k]!;
      for (let w = 0; w + 2 < group.length; w += 2) {
        const wx = group[w]! + ox;
        const wz = group[w + 1]! + oz;
        if (this.grid.passable(c, Math.floor(wx), Math.floor(wz)) && this.grid.lineOfSight(c, px, pz, wx, wz)) {
          path.push(wx, wz);
          px = wx;
          pz = wz;
        } else {
          path.push(group[w]!, group[w + 1]!);
          px = group[w]!;
          pz = group[w + 1]!;
        }
      }
      let sx = group[group.length - 2]! + ox;
      let sz = group[group.length - 1]! + oz;
      if (!this.grid.passable(c, Math.floor(sx), Math.floor(sz))) {
        const np = this.grid.nearestPassable(c, sx, sz);
        if (np !== null) {
          sx = np[0] + 0.5;
          sz = np[1] + 0.5;
        }
      }
      path.push(sx, sz);
      this.beginOrder(k, order, sx, sz, path);
    });
    return offs;
  }

  /** Stops a unit (idle, brakes). */
  stop(k: number): void {
    this.state[k] = UnitState.Idle;
    this.paths[k] = [];
  }

  private rebuildGrid(): void {
    const { gw, gh, cellStart, cellItems, cellOf } = this;
    cellStart.fill(0);
    for (let k = 0; k < this.count; k++) {
      const cx = Math.min(gw - 1, Math.max(0, Math.floor(this.x[k]! / this.cellSize)));
      const cz = Math.min(gh - 1, Math.max(0, Math.floor(this.z[k]! / this.cellSize)));
      const c = cz * gw + cx;
      cellOf[k] = c;
      cellStart[c + 1]!++;
    }
    for (let c = 0; c < gw * gh; c++) cellStart[c + 1]! += cellStart[c]!;
    const fill = cellStart.slice(0, gw * gh);
    for (let k = 0; k < this.count; k++) cellItems[fill[cellOf[k]!]!++] = k;
  }

  /** Visits units within `r` of (px, pz) (grid snapshot of this tick). */
  private forNear(px: number, pz: number, r: number, fn: (j: number) => void): void {
    const cs = this.cellSize;
    const x0 = Math.max(0, Math.floor((px - r) / cs));
    const x1 = Math.min(this.gw - 1, Math.floor((px + r) / cs));
    const z0 = Math.max(0, Math.floor((pz - r) / cs));
    const z1 = Math.min(this.gh - 1, Math.floor((pz + r) / cs));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * this.gw + cx;
        for (let i = this.cellStart[c]!; i < this.cellStart[c + 1]!; i++) fn(this.cellItems[i]!);
      }
    }
  }

  /** Nearest ≤ maxNeighbors neighbours of k within `range`; returns the count (nbIdx/nbDist). */
  private neighbours(k: number, range: number): number {
    const max = this.p.maxNeighbors;
    let n = 0;
    const px = this.x[k]!;
    const pz = this.z[k]!;
    this.forNear(px, pz, range, (j) => {
      if (j === k) return;
      const d = Math.hypot(this.x[j]! - px, this.z[j]! - pz);
      if (d > range + this.radius[j]!) return;
      if (n < max) {
        this.nbIdx[n] = j;
        this.nbDist[n] = d;
        n++;
      } else {
        let worst = 0;
        for (let i = 1; i < n; i++) if (this.nbDist[i]! > this.nbDist[worst]!) worst = i;
        if (d < this.nbDist[worst]!) {
          this.nbIdx[worst] = j;
          this.nbDist[worst] = d;
        }
      }
    });
    return n;
  }

  /** Advances one tick. */
  step(observer?: Spk2Observer): void {
    this.tick++;
    const p = this.p;
    const dt = this.dt;
    this.rebuildGrid();
    const startAngle = (p.startAngleDeg * Math.PI) / 180;
    const prevYaw = this.yaw.slice(0, this.count);
    let anyProgress = false;
    let anyMoving = false;

    // ---- steering + kinematics ------------------------------------------------------------------
    for (let k = 0; k < this.count; k++) {
      const r = this.radius[k]!;
      if (this.state[k] !== UnitState.Moving) {
        // Idle/arrived: brake, optional nudge slide.
        const v = this.v[k]!;
        this.v[k] = Math.max(0, v - this.brake[k]! * dt);
        const s = (this.v[k]! + v) * 0.5 * dt;
        this.x[k] = this.x[k]! + Math.cos(this.yaw[k]!) * s;
        this.z[k] = this.z[k]! + Math.sin(this.yaw[k]!) * s;
        if (this.nudgeLeft[k]! > 0) {
          const ns = this.vmax[k]! * p.nudgeSpeedFraction * dt;
          this.x[k] = this.x[k]! + this.nudgeX[k]! * ns;
          this.z[k] = this.z[k]! + this.nudgeZ[k]! * ns;
          this.nudgeLeft[k]!--;
        }
        continue;
      }
      anyMoving = true;
      const path = this.paths[k]!;
      const last = path.length / 2 - 1;
      let wp = this.wp[k]!;
      // Periodic look-ahead (staggered by index): skip waypoints in clearance LOS.
      if ((this.tick + k) % p.lookaheadTicks === 0) {
        while (wp < last && this.grid.lineOfSight(this.cls[k]!, this.x[k]!, this.z[k]!, path[(wp + 1) * 2]!, path[(wp + 1) * 2 + 1]!)) wp++;
      }
      let tx = path[wp * 2]!;
      let tz = path[wp * 2 + 1]!;
      while (wp < last && Math.hypot(tx - this.x[k]!, tz - this.z[k]!) < p.waypointRadius) {
        wp++;
        tx = path[wp * 2]!;
        tz = path[wp * 2 + 1]!;
      }
      this.wp[k] = wp;
      let dx = tx - this.x[k]!;
      let dz = tz - this.z[k]!;
      const dTarget = Math.hypot(dx, dz);
      if (dTarget > 1e-9) {
        dx /= dTarget;
        dz /= dTarget;
      }
      // Separation (≤ maxNeighbors nearest).
      let sx = 0;
      let sz = 0;
      const n = this.neighbours(k, (r + 1.5) * p.separationRangeFactor);
      for (let i = 0; i < n; i++) {
        const j = this.nbIdx[i]!;
        const d = this.nbDist[i]!;
        const range = (r + this.radius[j]!) * p.separationRangeFactor;
        if (d >= range) continue;
        let ux: number;
        let uz: number;
        if (d < 1e-6) {
          const a = ((k * 2654435761) % 6283) / 1000;
          ux = Math.cos(a);
          uz = Math.sin(a);
        } else {
          ux = (this.x[k]! - this.x[j]!) / d;
          uz = (this.z[k]! - this.z[j]!) / d;
        }
        const w = 1 - d / range;
        sx += ux * w;
        sz += uz * w;
      }
      sx *= p.separationStrength;
      sz *= p.separationStrength;
      // Near the slot, separation fades out (lets the unit settle instead of orbiting).
      if (wp === last && dTarget < 2 * r) {
        const f = dTarget / (2 * r);
        sx *= f;
        sz *= f;
      }
      // Obstacle gradient.
      const od = this.grid.sampleDist(this.x[k]!, this.z[k]!);
      let gx = 0;
      let gz = 0;
      if (od < r + p.clearanceMargin) {
        this.grid.gradient(this.x[k]!, this.z[k]!, this.tmp);
        const w = p.clearanceStrength * (1 - Math.max(0, od - r) / p.clearanceMargin);
        gx = this.tmp[0]! * w;
        gz = this.tmp[1]! * w;
      }
      let fx = dx + sx + gx;
      let fz = dz + sz + gz;
      const fl = Math.hypot(fx, fz);
      if (fl < 1e-6) {
        fx = dx;
        fz = dz;
      } else {
        fx /= fl;
        fz /= fl;
      }
      const want = Math.atan2(fz, fx);
      const err0 = wrapAngle(want - this.yaw[k]!);
      const maxTurn = this.turnRate[k]! * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, err0));
      this.yaw[k] = wrapAngle(this.yaw[k]! + turn);
      const err = Math.abs(wrapAngle(want - this.yaw[k]!));
      let target: number;
      if (err > startAngle) target = this.vmax[k]! * p.pivotCreepFraction;
      else target = this.vmax[k]! * (1 - (1 - p.turnSlowdownMin) * (err / startAngle));
      // Braking curve towards the slot (only on the final leg).
      if (wp === last) {
        const vArr = Math.sqrt(2 * this.brake[k]! * Math.max(0, dTarget - p.arrivalRadius * 0.5));
        target = Math.min(target, vArr);
      }
      const a = this.accel[k]! * (this.launchLeft[k]! > 0 ? p.launchBoost : 1);
      if (this.launchLeft[k]! > 0) this.launchLeft[k]!--;
      const v0 = this.v[k]!;
      const v1 = v0 + Math.max(-this.brake[k]! * dt, Math.min(a * dt, target - v0));
      this.v[k] = Math.max(0, v1);
      const step = (v0 + this.v[k]!) * 0.5 * dt;
      this.x[k] = this.x[k]! + Math.cos(this.yaw[k]!) * step;
      this.z[k] = this.z[k]! + Math.sin(this.yaw[k]!) * step;
    }

    // ---- collision resolution (mass + priority) --------------------------------------------------
    this.pushedBy.fill(-1, 0, this.count);
    for (let it = 0; it < p.collisionIterations; it++) {
      this.rebuildGrid();
      for (let k = 0; k < this.count; k++) {
        const rk = this.radius[k]!;
        this.forNear(this.x[k]!, this.z[k]!, rk + 2.5, (j) => {
          if (j <= k) return;
          const dx = this.x[j]! - this.x[k]!;
          const dz = this.z[j]! - this.z[k]!;
          const d = Math.hypot(dx, dz);
          const min = rk + this.radius[j]!;
          if (d >= min) return;
          let ux: number;
          let uz: number;
          if (d < 1e-9) {
            const a = (((k * 7919 + j * 104729) % 6283) + 1) / 1000;
            ux = Math.cos(a);
            uz = Math.sin(a);
          } else {
            ux = dx / d;
            uz = dz / d;
          }
          const mk = this.mass[k]! * (this.state[k] === UnitState.Moving ? p.movingPriority : 1);
          const mj = this.mass[j]! * (this.state[j] === UnitState.Moving ? p.movingPriority : 1);
          const pen = min - d;
          const shareK = mj / (mk + mj);
          this.x[k] = this.x[k]! - ux * pen * shareK;
          this.z[k] = this.z[k]! - uz * pen * shareK;
          this.x[j] = this.x[j]! + ux * pen * (1 - shareK);
          this.z[j] = this.z[j]! + uz * pen * (1 - shareK);
          if (this.state[k] === UnitState.Moving && this.state[j] !== UnitState.Moving) {
            this.pushedBy[j] = k;
            this.pushedTick[j] = this.tick;
          }
          if (this.state[j] === UnitState.Moving && this.state[k] !== UnitState.Moving) {
            this.pushedBy[k] = j;
            this.pushedTick[k] = this.tick;
          }
        });
      }
    }
    // Obstacles and map bounds.
    for (let k = 0; k < this.count; k++) this.resolveObstacles(k);

    // ---- idle nudge: step aside out of the pusher's lane ------------------------------------------
    if (p.idleNudge) {
      for (let k = 0; k < this.count; k++) {
        const m = this.pushedBy[k]!;
        if (m < 0 || this.nudgeLeft[k]! > 0) continue;
        const hx = Math.cos(this.yaw[m]!);
        const hz = Math.sin(this.yaw[m]!);
        const side = (this.x[k]! - this.x[m]!) * -hz + (this.z[k]! - this.z[m]!) * hx >= 0 ? 1 : -1;
        this.nudgeX[k] = -hz * side;
        this.nudgeZ[k] = hx * side;
        this.nudgeLeft[k] = p.nudgeTicks;
        this.stats.nudges++;
      }
    }

    // ---- arrival, contagion, stuck ------------------------------------------------------------------
    this.rebuildGrid();
    for (let k = 0; k < this.count; k++) {
      if (this.state[k] === UnitState.Arrived) {
        // Pushed off the slot: drive back once the pusher is gone and the slot is free.
        if (
          this.tick - this.pushedTick[k]! > p.returnDelayTicks &&
          this.nudgeLeft[k] === 0 &&
          Math.hypot(this.slotX[k]! - this.x[k]!, this.slotZ[k]! - this.z[k]!) > p.returnDistance &&
          !this.slotTaken(k)
        ) {
          const direct = this.grid.lineOfSight(this.cls[k]!, this.x[k]!, this.z[k]!, this.slotX[k]!, this.slotZ[k]!);
          const path = direct ? [this.slotX[k]!, this.slotZ[k]!] : (this.requestPath(this.cls[k]!, this.x[k]!, this.z[k]!, this.slotX[k]!, this.slotZ[k]!) ?? [this.slotX[k]!, this.slotZ[k]!]);
          const keepOrderTick = this.orderTick[k]!;
          const keep = [this.firstVisibleTick[k]!, this.firstMoveTick[k]!, this.maxNoProgress[k]!];
          this.beginOrder(k, this.order[k]!, this.slotX[k]!, this.slotZ[k]!, path);
          // Metrics stay with the original order.
          this.orderTick[k] = keepOrderTick;
          [this.firstVisibleTick[k], this.firstMoveTick[k], this.maxNoProgress[k]] = keep as [number, number, number];
          this.launchLeft[k] = 0;
          this.stats.slotReturns++;
        }
        continue;
      }
      if (this.state[k] !== UnitState.Moving) continue;
      const path = this.paths[k]!;
      const last = path.length / 2 - 1;
      const dSlot = Math.hypot(this.slotX[k]! - this.x[k]!, this.slotZ[k]! - this.z[k]!);
      if (this.wp[k] === last && dSlot < p.arrivalRadius) {
        this.arrive(k);
        continue;
      }
      if (dSlot < p.contagionDistance && (this.tick - this.metricRefTick[k]! >= p.contagionStallTicks || this.slotTaken(k))) {
        let touched = false;
        this.forNear(this.x[k]!, this.z[k]!, this.radius[k]! + 2 + p.contagionGap, (j) => {
          if (touched || j === k || this.state[j] !== UnitState.Arrived || this.order[j] !== this.order[k]) return;
          const d = Math.hypot(this.x[j]! - this.x[k]!, this.z[j]! - this.z[k]!);
          if (d <= this.radius[k]! + this.radius[j]! + p.contagionGap) touched = true;
        });
        if (touched) {
          this.stats.contagionArrivals++;
          // The unit gives up its slot: where it stopped is its new slot (no return drive).
          this.slotX[k] = this.x[k]!;
          this.slotZ[k] = this.z[k]!;
          this.arrive(k);
          continue;
        }
      }
      const len = this.pathLength(k);
      if (len < this.metricRefLen[k]! - p.stuckEpsilon) {
        this.metricRefLen[k] = len;
        this.metricRefTick[k] = this.tick;
        anyProgress = true;
      }
      this.maxNoProgress[k] = Math.max(this.maxNoProgress[k]!, this.tick - this.metricRefTick[k]!);
      if (len < this.refLen[k]! - p.stuckEpsilon) {
        this.refLen[k] = len;
        this.refTick[k] = this.tick;
        this.stuckStreak[k] = 0;
      } else if (this.tick - this.refTick[k]! >= p.stuckTicks) {
        this.onStuck(k);
      }
    }
    if (anyProgress || !anyMoving) this.lastAnyProgressTick = this.tick;

    // ---- start-up metrics ------------------------------------------------------------------------
    for (let k = 0; k < this.count; k++) {
      const dy = wrapAngle(this.yaw[k]! - prevYaw[k]!);
      this.lastDYaw[k] = dy;
      if (this.orderTick[k]! < 0) continue;
      if (this.firstMoveTick[k]! < 0 && Math.hypot(this.x[k]! - this.orderX[k]!, this.z[k]! - this.orderZ[k]!) >= 0.05) {
        this.firstMoveTick[k] = this.tick - this.orderTick[k]!;
      }
      if (this.firstVisibleTick[k]! < 0) {
        const moved = Math.hypot(this.x[k]! - this.orderX[k]!, this.z[k]! - this.orderZ[k]!) >= 0.05;
        const turned = Math.abs(wrapAngle(this.yaw[k]! - this.orderYaw[k]!)) >= (2 * Math.PI) / 180;
        if (moved || turned) this.firstVisibleTick[k] = this.tick - this.orderTick[k]!;
      }
    }
    observer?.tick(this);
  }

  /** True if a non-moving unit stands on k's slot (it cannot get there). */
  private slotTaken(k: number): boolean {
    let taken = false;
    const sx = this.slotX[k]!;
    const sz = this.slotZ[k]!;
    this.forNear(sx, sz, this.radius[k]! + 2, (j) => {
      if (taken || j === k || this.state[j] === UnitState.Moving) return;
      if (Math.hypot(this.x[j]! - sx, this.z[j]! - sz) < this.radius[k]! + this.radius[j]! - 0.05) taken = true;
    });
    return taken;
  }

  private arrive(k: number): void {
    this.state[k] = UnitState.Arrived;
    this.arrivedTick[k] = this.tick;
  }

  private onStuck(k: number): void {
    const p = this.p;
    this.stats.stuckEvents++;
    const streak = ++this.stuckStreak[k]!;
    const c = this.cls[k]!;
    if (streak % 2 === 0) {
      // Side-step: waypoint to the side with more clearance, then the path from there.
      const hx = Math.cos(this.yaw[k]!);
      const hz = Math.sin(this.yaw[k]!);
      const lx = this.x[k]! - hz * p.sidestepDistance;
      const lz = this.z[k]! + hx * p.sidestepDistance;
      const rx = this.x[k]! + hz * p.sidestepDistance;
      const rz = this.z[k]! - hx * p.sidestepDistance;
      const left = this.grid.sampleDist(lx, lz);
      const right = this.grid.sampleDist(rx, rz);
      const pick = (streak / 2) % 2 === 1 ? left >= right : left < right;
      const [ax, az] = pick ? [lx, lz] : [rx, rz];
      const rest = this.requestPath(c, ax, az, this.slotX[k]!, this.slotZ[k]!);
      this.paths[k] = [ax, az, ...(rest ?? [this.slotX[k]!, this.slotZ[k]!])];
      this.stats.sidesteps++;
    } else {
      const path = this.requestPath(c, this.x[k]!, this.z[k]!, this.slotX[k]!, this.slotZ[k]!);
      if (path !== null) this.paths[k] = path;
      this.stats.repaths++;
    }
    this.wp[k] = 0;
    this.refTick[k] = this.tick;
    this.refLen[k] = this.pathLength(k);
    // The metric reference follows a longer new path without crediting progress.
    if (this.refLen[k]! > this.metricRefLen[k]!) this.metricRefLen[k] = this.refLen[k]!;
  }

  private resolveObstacles(k: number): void {
    const g = this.grid;
    const r = this.radius[k]!;
    let px = this.x[k]!;
    let pz = this.z[k]!;
    const cx = Math.floor(px);
    const cz = Math.floor(pz);
    if (g.isBlocked(cx, cz)) {
      const np = g.nearestPassable(1, px, pz);
      if (np !== null) {
        px = np[0] + 0.5;
        pz = np[1] + 0.5;
      }
    }
    const reach = Math.ceil(r) + 1;
    for (let z = Math.floor(pz) - reach; z <= Math.floor(pz) + reach; z++) {
      for (let x = Math.floor(px) - reach; x <= Math.floor(px) + reach; x++) {
        if (!g.isBlocked(x, z)) continue;
        const qx = Math.max(x, Math.min(x + 1, px));
        const qz = Math.max(z, Math.min(z + 1, pz));
        const dx = px - qx;
        const dz = pz - qz;
        const d = Math.hypot(dx, dz);
        if (d >= r || d < 1e-9) continue;
        px += (dx / d) * (r - d);
        pz += (dz / d) * (r - d);
      }
    }
    this.x[k] = Math.max(r, Math.min(g.width - r, px));
    this.z[k] = Math.max(r, Math.min(g.height - r, pz));
  }
}
