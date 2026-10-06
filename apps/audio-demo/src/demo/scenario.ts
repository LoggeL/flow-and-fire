/**
 * Deterministic battle generator 'gefecht' of the audio demo (TRACK-AUDIOENG, audioeng-c2).
 *
 * Two armies of 150 units (bots, tanks, mortars, gunships, defence structures and one commander
 * each) fight along two moving fronts on a 512 × 512 WU field; destroyed units are replaced from
 * the base (reinforcements walk back to the front). Per sim tick (10 Hz) {@link GefechtScenario.step}
 * writes the tick's sim events into a reused {@link ArrayEventSource} with the provisional
 * `DEFAULT_EVENT_TYPES`:
 *
 * - `weaponFire` — exactly `shotsPerSecond` per second (fractional budget carried over), visual =
 *   weapon visual id ({@link visualName} → real `core:wpn_*` refs), random subTick;
 * - `projectileImpact` after the projectile's flight time, aux = surface (ground, metal on a unit
 *   hit, water in the ponds, structure on a building hit);
 * - `unitDeath` (aux = size class, flags STRUCTURE / AIR), `commanderDeath` now and then;
 * - `buildComplete` when a destroyed defence structure of the player army was rebuilt;
 * - `alert` (aux = alert index) with position: base attacked, commander in danger, enemy
 *   commander spotted.
 *
 * The per-army build loop ('bld_pour_loop') is driven through a {@link ScenarioLoopSink}
 * (`engine.setLoop`). The generator is pure logic (no DOM, no engine, no clock): the same seed and
 * options always yield the same event stream. It uses no trigonometry, so the stream is identical
 * in every JS engine. Hot path without allocations: typed arrays for units, lanes and projectiles
 * (the projectile pool grows only when it runs full), one reused PlayRequest per loop key.
 */

import { ArrayEventSource, FX_ONE, type PlayRequest } from '@faf/audio';
import { DEFAULT_EVENT_TYPES, EVENT_FLAG_AIR, EVENT_FLAG_STRUCTURE, alertKindIndex } from '@faf/audio/events';

/** Sim tick length in seconds (10 Hz, PLAN §3.2). */
export const TICK_S = 0.1;
/** Edge length of the square battlefield in WU. */
export const FIELD_SIZE = 512;
/** Default shots per second of the 'gefecht' scenario. */
export const DEFAULT_SHOTS_PER_SECOND = 200;
/** Index of the player army (alerts are raised from its point of view). */
export const PLAYER_ARMY = 0;

// ---------------------------------------------------------------------------------------------
// Data tables
// ---------------------------------------------------------------------------------------------

/** One weapon of the demo armies (real roster refs, sounds via the event map). */
export interface WeaponSpec {
  readonly ref: string;
  /** Projectile speed in WU/s (flight time = distance / speed + `arcS`). */
  readonly speed: number;
  /** Extra flight time of ballistic weapons in s. */
  readonly arcS: number;
  readonly damage: number;
  /** Preferred engagement range in WU (shooters look for a target within it). */
  readonly range: number;
  /** Miss radius in WU. */
  readonly scatter: number;
  /** Hit probability. */
  readonly accuracy: number;
}

/** Weapons; visual id = index + 1. */
export const WEAPONS: readonly WeaponSpec[] = [
  { ref: 'core:wpn_mg_t1', range: 60, speed: 162, arcS: 0, damage: 5, scatter: 3, accuracy: 0.6 },
  { ref: 'core:wpn_spark_mg_t1', range: 55, speed: 180, arcS: 0, damage: 4, scatter: 3, accuracy: 0.6 },
  { ref: 'core:wpn_cannon_t1', range: 75, speed: 108, arcS: 0, damage: 15, scatter: 2.5, accuracy: 0.55 },
  { ref: 'core:wpn_bolt_cannon_t1', range: 80, speed: 117, arcS: 0, damage: 14, scatter: 2.5, accuracy: 0.55 },
  { ref: 'core:wpn_slag_mortar_t1', range: 150, speed: 81, arcS: 0.8, damage: 26, scatter: 6, accuracy: 0.35 },
  { ref: 'core:wpn_cannon_t2', range: 85, speed: 126, arcS: 0, damage: 30, scatter: 2, accuracy: 0.6 },
  { ref: 'core:wpn_kestrel_gun_t1', range: 50, speed: 216, arcS: 0, damage: 5, scatter: 3, accuracy: 0.5 },
  { ref: 'core:wpn_reeve_cannon', range: 70, speed: 126, arcS: 0, damage: 45, scatter: 1.5, accuracy: 0.7 },
];

/** Visual id → weapon blueprint ref (`CreateAudioEngineOptions.visualName`). */
export function visualName(visual: number): string | undefined {
  return WEAPONS[visual - 1]?.ref;
}

/** Visual id of weapon `w`. */
export function weaponVisual(w: number): number {
  return w + 1;
}

/** Visual ids of unit kinds (info only for the router) start here. */
export const UNIT_VISUAL_BASE = 100;

/** Role of a unit kind. */
export type UnitRole = 'land' | 'artillery' | 'air' | 'structure' | 'commander';

/** One unit kind; `count` units of it per army. */
export interface UnitKindSpec {
  readonly name: string;
  readonly role: UnitRole;
  /** Index into {@link WEAPONS}. */
  readonly weapon: number;
  readonly hp: number;
  /** Death size class 0 small … 3 huge (unitDeath aux). */
  readonly size: 0 | 1 | 2 | 3;
  readonly count: number;
  /** Movement speed in WU/s. */
  readonly speed: number;
  /** Radius drawn by the renderer (WU). */
  readonly radius: number;
}

/** Composition of one army (150 units). */
export const UNIT_KINDS: readonly UnitKindSpec[] = [
  { name: 'lightBot', role: 'land', weapon: 0, hp: 96, size: 0, count: 34, speed: 3, radius: 1.2 },
  { name: 'sparkBot', role: 'land', weapon: 1, hp: 88, size: 0, count: 22, speed: 3.5, radius: 1.1 },
  { name: 'tank', role: 'land', weapon: 2, hp: 208, size: 1, count: 30, speed: 2.5, radius: 1.8 },
  { name: 'boltTank', role: 'land', weapon: 3, hp: 224, size: 1, count: 20, speed: 2.5, radius: 1.8 },
  { name: 'mortar', role: 'artillery', weapon: 4, hp: 128, size: 1, count: 18, speed: 2, radius: 1.6 },
  { name: 'heavyTank', role: 'land', weapon: 5, hp: 480, size: 2, count: 10, speed: 1.8, radius: 2.4 },
  { name: 'gunship', role: 'air', weapon: 6, hp: 112, size: 0, count: 8, speed: 9, radius: 1.6 },
  { name: 'defence', role: 'structure', weapon: 2, hp: 672, size: 2, count: 7, speed: 0, radius: 3 },
  { name: 'commander', role: 'commander', weapon: 7, hp: 2560, size: 3, count: 1, speed: 1.5, radius: 3 },
];

/** Units per army (Σ count). */
export const UNITS_PER_ARMY = UNIT_KINDS.reduce((n, k) => n + k.count, 0);

/** Circular ponds (impacts inside hit water). */
export const PONDS: readonly { x: number; z: number; r: number }[] = [
  { x: 205, z: 118, r: 22 },
  { x: 300, z: 392, r: 28 },
];

/** Base centre of each army. */
export const BASES: readonly { x: number; z: number }[] = [
  { x: 60, z: 256 },
  { x: 452, z: 256 },
];

/** Sounds the scenario needs besides the event map (loaded by the demo). */
export const BUILD_LOOP_SOUND = 'bld_pour_loop';

// Surfaces (projectileImpact aux, a1 §4).
const SURFACE_GROUND = 0;
const SURFACE_METAL = 1;
const SURFACE_WATER = 2;
const SURFACE_STRUCTURE = 4;

const T_WEAPON_FIRE = DEFAULT_EVENT_TYPES.weaponFire;
const T_IMPACT = DEFAULT_EVENT_TYPES.projectileImpact;
const T_DEATH = DEFAULT_EVENT_TYPES.unitDeath;
const T_COMMANDER_DEATH = DEFAULT_EVENT_TYPES.commanderDeath;
const T_BUILD_COMPLETE = DEFAULT_EVENT_TYPES.buildComplete;
const T_ALERT = DEFAULT_EVENT_TYPES.alert;

/** Alerts the scenario raises, with their minimum spacing in ticks (the alert queue adds its own interval). */
export const SCENARIO_ALERTS = ['alt_base_attacked', 'alt_commander_danger', 'alt_enemy_commander_spotted'] as const;
export type ScenarioAlert = (typeof SCENARIO_ALERTS)[number];
const ALERT_INDEX = SCENARIO_ALERTS.map((n) => {
  const i = alertKindIndex(n);
  if (i < 0) throw new Error(`alert ${n} missing in ALERT_KINDS`);
  return i;
});
const ALERT_SPACING_TICKS = [20, 50, 200];
const A_BASE = 0;
const A_COMMANDER = 1;
const A_SPOTTED = 2;

/** Lanes (z bands) for target selection. */
const LANES = 16;
const LANE_WIDTH = FIELD_SIZE / LANES;

// ---------------------------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------------------------

/** Seedable PRNG (mulberry32): deterministic, uniform in [0, 1). */
export class Prng {
  /**
   * Initialised in the declaration: a field declared without initialiser starts as `undefined`,
   * gets a tagged representation and then every uint32 state ≥ 2^31 is stored as a new HeapNumber.
   */
  private state = 0;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    return (this.nextI32() >>> 0) / 4294967296;
  }

  /**
   * Raw output as a signed int32 (a Smi): helpers that must not allocate build on this, since a
   * double returned from a non-inlined call is boxed into a fresh HeapNumber.
   */
  nextI32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return t ^ (t >>> 14);
  }

  /** `next() < p` without a double crossing a call boundary. */
  chance(p: number): boolean {
    return (this.nextI32() >>> 0) / 4294967296 < p;
  }

  /** Integer in 0..n−1. */
  int(n: number): number {
    return Math.floor(((this.nextI32() >>> 0) / 4294967296) * n);
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

/** Triangle wave in −1..1 with period `period` (used instead of sin: engine-independent). */
function tri(t: number, period: number): number {
  const p = t / period - Math.floor(t / period);
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
}

// ---------------------------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------------------------

/** Options of {@link GefechtScenario}. */
export interface ScenarioOptions {
  seed?: number | undefined;
  /** Shots per second (default 200). */
  shotsPerSecond?: number | undefined;
}

/** Receives the keyed build loops (the engine's `setLoop`). */
export interface ScenarioLoopSink {
  setLoop(key: string, req: PlayRequest | null): void;
}

/** Running totals of the generator (mutated in place; copy for snapshots). */
export interface ScenarioStats {
  tick: number;
  simTimeS: number;
  shots: number;
  impacts: number;
  hits: number;
  deaths: number;
  /** Deaths per size class 0..3 (without commanders). */
  deathsBySize: number[];
  airDeaths: number;
  structureDeaths: number;
  commanderDeaths: number;
  buildCompletes: number;
  alerts: number;
  alertsByKind: Record<ScenarioAlert, number>;
  /** All events written. */
  events: number;
  eventsLastTick: number;
  maxEventsPerTick: number;
  /** Projectiles in flight. */
  inFlight: number;
  /** setLoop calls (updates, starts, stops). */
  loopCalls: number;
  alive: number[];
}

/** Snapshot copy of {@link ScenarioStats}. */
export function copyScenarioStats(s: ScenarioStats): ScenarioStats {
  return { ...s, deathsBySize: [...s.deathsBySize], alertsByKind: { ...s.alertsByKind }, alive: [...s.alive] };
}

const BUILD_KEYS = ['build:0', 'build:1'];

export class GefechtScenario {
  readonly seed: number;
  readonly shotsPerSecond: number;
  readonly stats: ScenarioStats;

  // Units (index = army × UNITS_PER_ARMY + slot).
  readonly unitCount = 2 * UNITS_PER_ARMY;
  readonly ux = new Float64Array(this.unitCount);
  readonly uz = new Float64Array(this.unitCount);
  readonly uhp = new Float64Array(this.unitCount);
  readonly ukind = new Uint8Array(this.unitCount);
  readonly uarmy = new Uint8Array(this.unitCount);
  /** 1 = alive, 0 = dead (waiting for respawn). */
  readonly ualive = new Uint8Array(this.unitCount);
  /** Unit id carried in event handles; changes on every respawn. */
  readonly uhandle = new Uint32Array(this.unitCount);
  private readonly uhomeZ = new Float64Array(this.unitCount);
  private readonly udepth = new Float64Array(this.unitCount);
  private readonly uphase = new Float64Array(this.unitCount);
  private readonly urespawn = new Int32Array(this.unitCount);
  private readonly commanderIdx = [0, 0];
  private readonly structures: number[][] = [[], []];

  // Lanes: counting sort of alive units per (army, lane).
  private readonly laneStart = new Int32Array(2 * LANES + 1);
  private readonly laneFill = new Int32Array(2 * LANES);
  private readonly laneUnits = new Int32Array(this.unitCount);

  // Projectile pool (dense, swap-remove).
  private cap = 0;
  inFlight = 0;
  pWeapon = new Uint8Array(0);
  pTarget = new Int32Array(0);
  pTargetHandle = new Uint32Array(0);
  pSx = new Float64Array(0);
  pSz = new Float64Array(0);
  pTx = new Float64Array(0);
  pTz = new Float64Array(0);
  /** Fire / impact time in sim seconds. */
  pT0 = new Float64Array(0);
  pT1 = new Float64Array(0);

  private readonly rng: Prng;
  private tickNo = 0;
  private shotBudget = 0;
  /**
   * Front lines of both armies for the current tick (set once per `fire`). Kept in fields instead
   * of passing the sim time into the per-try helpers: double arguments of non-inlined calls are
   * boxed into a fresh HeapNumber each time (the generator would allocate per shot).
   */
  private front0 = 0.5;
  private front1 = 0.5;
  private handleSeq = 1;
  private readonly lastAlertTick = new Int32Array(SCENARIO_ALERTS.length).fill(-1_000_000);
  private readonly loopReq: PlayRequest[] = [0, 1].map(() => ({
    sound: BUILD_LOOP_SOUND,
    faction: undefined,
    x: undefined,
    z: undefined,
    gain: undefined,
    rate: undefined,
    when: undefined,
    priorityBoost: undefined,
    loop: undefined,
  }));
  private readonly loopOn = [false, false];

  constructor(opts: ScenarioOptions = {}) {
    this.seed = (opts.seed ?? 1) >>> 0;
    const sps = opts.shotsPerSecond ?? DEFAULT_SHOTS_PER_SECOND;
    if (!(sps >= 0 && sps <= 5000)) throw new RangeError(`shotsPerSecond ${sps} outside 0..5000`);
    this.shotsPerSecond = sps;
    this.rng = new Prng(this.seed);
    this.stats = {
      tick: 0,
      simTimeS: 0,
      shots: 0,
      impacts: 0,
      hits: 0,
      deaths: 0,
      deathsBySize: [0, 0, 0, 0],
      airDeaths: 0,
      structureDeaths: 0,
      commanderDeaths: 0,
      buildCompletes: 0,
      alerts: 0,
      alertsByKind: { alt_base_attacked: 0, alt_commander_danger: 0, alt_enemy_commander_spotted: 0 },
      events: 0,
      eventsLastTick: 0,
      maxEventsPerTick: 0,
      inFlight: 0,
      loopCalls: 0,
      alive: [UNITS_PER_ARMY, UNITS_PER_ARMY],
    };
    this.grow(Math.max(64, Math.ceil(sps * 2)));
    this.spawnArmies();
  }

  /** Current sim tick (number of completed steps). */
  get tick(): number {
    return this.tickNo;
  }

  /** Sim time in seconds. */
  get simTimeS(): number {
    return this.tickNo * TICK_S;
  }

  /** Front line x of army `a` at sim time `t` (army 1 stands 30 WU east of army 0). */
  frontX(a: number, t: number): number {
    const f0 = 236 + 22 * tri(t, 90);
    return a === 0 ? f0 : f0 + 30;
  }

  kind(i: number): UnitKindSpec {
    return UNIT_KINDS[this.ukind[i]!]!;
  }

  // -------------------------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------------------------

  private spawnArmies(): void {
    const rng = this.rng;
    for (let a = 0; a < 2; a++) {
      let slot = 0;
      for (let k = 0; k < UNIT_KINDS.length; k++) {
        const spec = UNIT_KINDS[k]!;
        for (let n = 0; n < spec.count; n++) {
          const i = a * UNITS_PER_ARMY + slot++;
          this.ukind[i] = k;
          this.uarmy[i] = a;
          this.uphase[i] = rng.next() * 40;
          if (spec.role === 'structure') {
            this.structures[a]!.push(i);
            this.uhomeZ[i] = 96 + (320 * (n + 0.5)) / spec.count;
            this.udepth[i] = 10 + rng.next() * 30;
          } else if (spec.role === 'commander') {
            this.commanderIdx[a] = i;
            this.uhomeZ[i] = 256;
            this.udepth[i] = 40;
          } else {
            this.uhomeZ[i] = 24 + rng.next() * (FIELD_SIZE - 48);
            this.udepth[i] = spec.role === 'artillery' ? 25 + rng.next() * 35 : spec.role === 'air' ? rng.next() * 30 : rng.next() * 22;
          }
          this.revive(i, true);
        }
      }
    }
  }

  /** (Re)spawns unit i: at its post (initial) or at the base (reinforcement). */
  private revive(i: number, initial: boolean): void {
    const spec = this.kind(i);
    const a = this.uarmy[i]!;
    this.ualive[i] = 1;
    this.uhp[i] = spec.hp;
    this.uhandle[i] = this.handleSeq++;
    if (spec.role === 'structure') {
      const base = BASES[a]!;
      this.ux[i] = a === 0 ? base.x - 20 + this.udepth[i]! : base.x + 20 - this.udepth[i]!;
      this.uz[i] = this.uhomeZ[i]!;
    } else if (initial) {
      this.ux[i] = this.targetX(i, 0);
      this.uz[i] = this.uhomeZ[i]!;
    } else {
      const base = BASES[a]!;
      this.ux[i] = base.x + this.rng.range(-12, 12);
      this.uz[i] = base.z + this.rng.range(-60, 60);
    }
  }

  private targetX(i: number, t: number): number {
    const a = this.uarmy[i]!;
    const d = this.udepth[i]!;
    const f = this.frontX(a, t);
    return a === 0 ? f - d : f + d;
  }

  private grow(min: number): void {
    const cap = Math.max(min, this.cap * 2);
    const n = this.inFlight;
    const cp = <T extends Float64Array | Int32Array | Uint32Array | Uint8Array>(old: T, make: (n: number) => T): T => {
      const next = make(cap);
      next.set(old.subarray(0, n));
      return next;
    };
    this.pWeapon = cp(this.pWeapon, (c) => new Uint8Array(c));
    this.pTarget = cp(this.pTarget, (c) => new Int32Array(c));
    this.pTargetHandle = cp(this.pTargetHandle, (c) => new Uint32Array(c));
    this.pSx = cp(this.pSx, (c) => new Float64Array(c));
    this.pSz = cp(this.pSz, (c) => new Float64Array(c));
    this.pTx = cp(this.pTx, (c) => new Float64Array(c));
    this.pTz = cp(this.pTz, (c) => new Float64Array(c));
    this.pT0 = cp(this.pT0, (c) => new Float64Array(c));
    this.pT1 = cp(this.pT1, (c) => new Float64Array(c));
    this.cap = cap;
  }

  // -------------------------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------------------------

  /**
   * Advances one sim tick: clears `out` and writes this tick's events into it; drives the build
   * loops through `loops` (may be null).
   */
  step(out: ArrayEventSource, loops: ScenarioLoopSink | null): void {
    out.clear();
    const tick = ++this.tickNo;
    const t = tick * TICK_S;
    // Hot helpers take the integer tick, not the sim time: a double argument of a non-inlined
    // call is boxed into a fresh HeapNumber.
    this.move(tick);
    this.buildLanes();
    this.impacts(out, tick);
    this.fire(out, tick);
    this.respawns(out, tick);
    this.spotting(out, tick);
    if (loops !== null) this.buildLoops(loops, tick);
    const st = this.stats;
    st.tick = tick;
    st.simTimeS = t;
    st.events += out.count;
    st.eventsLastTick = out.count;
    if (out.count > st.maxEventsPerTick) st.maxEventsPerTick = out.count;
    st.inFlight = this.inFlight;
  }

  /** Stops the build loops (scenario end). */
  stopLoops(loops: ScenarioLoopSink): void {
    for (let a = 0; a < 2; a++) {
      if (!this.loopOn[a]) continue;
      loops.setLoop(BUILD_KEYS[a]!, null);
      this.loopOn[a] = false;
      this.stats.loopCalls++;
    }
  }

  private move(tick: number): void {
    const t = tick * TICK_S;
    for (let i = 0; i < this.unitCount; i++) {
      if (this.ualive[i] === 0) continue;
      const spec = this.kind(i);
      if (spec.role === 'structure') continue;
      let tx = this.targetX(i, t);
      let tz = this.uhomeZ[i]! + 6 * tri(t + this.uphase[i]!, 17);
      if (spec.role === 'air') {
        // Gunships sweep over the enemy front in a figure following two triangle waves.
        const a = this.uarmy[i]!;
        tx = this.frontX(1 - a, t) + (a === 0 ? 10 : -10) + 18 * tri(t + this.uphase[i]!, 7);
        tz = this.uhomeZ[i]! + 30 * tri(t + this.uphase[i]!, 11);
      }
      const dx = tx - this.ux[i]!;
      const dz = tz - this.uz[i]!;
      const d = Math.sqrt(dx * dx + dz * dz);
      // Reinforcements far behind the front move five times as fast (convoy).
      const v = spec.speed * TICK_S * (d > 40 ? 5 : 1);
      if (d <= v) {
        this.ux[i] = tx;
        this.uz[i] = tz;
      } else {
        this.ux[i] = this.ux[i]! + (dx / d) * v;
        this.uz[i] = this.uz[i]! + (dz / d) * v;
      }
    }
  }

  private laneOf(z: number): number {
    const l = Math.floor(z / LANE_WIDTH);
    return l < 0 ? 0 : l >= LANES ? LANES - 1 : l;
  }

  private buildLanes(): void {
    const start = this.laneStart;
    start.fill(0);
    for (let i = 0; i < this.unitCount; i++) {
      if (this.ualive[i] === 0) continue;
      start[this.uarmy[i]! * LANES + this.laneOf(this.uz[i]!) + 1]!++;
    }
    for (let b = 1; b <= 2 * LANES; b++) start[b] = start[b]! + start[b - 1]!;
    const fill = this.laneFill;
    for (let b = 0; b < 2 * LANES; b++) fill[b] = start[b]!;
    for (let i = 0; i < this.unitCount; i++) {
      if (this.ualive[i] === 0) continue;
      const b = this.uarmy[i]! * LANES + this.laneOf(this.uz[i]!);
      this.laneUnits[fill[b]!++] = i;
    }
  }

  /**
   * Target in army `a` for a shooter at (x, z): the nearest of three random alive units from the
   * shooter's lane ±1; any alive unit of the army if those lanes are empty; −1 if none.
   */
  private pickTarget(a: number, shooter: number): number {
    const rng = this.rng;
    const x = this.ux[shooter]!;
    const z = this.uz[shooter]!;
    const lane = this.laneOf(z);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let tries = 0; tries < 3; tries++) {
      let l = lane + rng.int(3) - 1;
      if (l < 0) l = 0;
      if (l >= LANES) l = LANES - 1;
      const b = a * LANES + l;
      const s = this.laneStart[b]!;
      const n = this.laneStart[b + 1]! - s;
      if (n === 0) continue;
      const i = this.laneUnits[s + rng.int(n)]!;
      const dx = this.ux[i]! - x;
      const dz = this.uz[i]! - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) return best;
    const s = this.laneStart[a * LANES]!;
    const n = this.laneStart[(a + 1) * LANES]! - s;
    return n > 0 ? this.laneUnits[s + rng.int(n)]! : -1;
  }

  /**
   * A random alive shooter at the front (reinforcements on their way do not fire; structures only
   * when the enemy front is within 90 WU). Falls back to any alive unit so the shot rate stays exact.
   */
  private pickShooter(): number {
    const rng = this.rng;
    let any = -1;
    for (let tries = 0; tries < 48; tries++) {
      const i = rng.int(this.unitCount);
      if (this.ualive[i] === 0) continue;
      any = i;
      const spec = this.kind(i);
      if (spec.role === 'structure') {
        const enemyFront = this.uarmy[i] === 0 ? this.front1 : this.front0;
        if (Math.abs(enemyFront - this.ux[i]!) > 90) continue;
      } else if (spec.role !== 'air') {
        // targetX(i, t) with the cached fronts.
        const d = this.udepth[i]!;
        const tx = this.uarmy[i] === 0 ? this.front0 - d : this.front1 + d;
        if (Math.abs(tx - this.ux[i]!) > 30) continue;
      }
      return i;
    }
    return any;
  }

  /**
   * Target for `shooter`: 2 % of the shots go for the enemy commander, mortars and gunships go for
   * structures now and then (base attacks), otherwise a nearby enemy.
   */
  private pickTargetFor(shooter: number): number {
    const a = this.uarmy[shooter]!;
    const role = this.kind(shooter).role;
    const commander = this.commanderIdx[1 - a]!;
    if (this.ualive[commander] === 1 && this.rng.chance(0.02)) return commander;
    if ((role === 'artillery' || role === 'air') && this.rng.chance(0.15)) {
      const list = this.structures[1 - a]!;
      const cand = list[this.rng.int(list.length)]!;
      if (this.ualive[cand] === 1) return cand;
    }
    return this.pickTarget(1 - a, shooter);
  }

  private fire(out: ArrayEventSource, tick: number): void {
    const rng = this.rng;
    this.shotBudget += this.shotsPerSecond * TICK_S;
    const shots = Math.floor(this.shotBudget + 1e-9);
    this.shotBudget -= shots;
    const t = tick * TICK_S;
    this.front0 = 236 + 22 * tri(t, 90); // = frontX(0, t), without a double crossing a call
    this.front1 = this.front0 + 30;
    for (let s = 0; s < shots; s++) {
      // Look for a shooter with a target within its weapon range; after 8 attempts take the last pair.
      let shooter = -1;
      let target = -1;
      for (let attempt = 0; attempt < 8; attempt++) {
        const cand = this.pickShooter();
        if (cand < 0) break;
        const tgt = this.pickTargetFor(cand);
        if (tgt < 0) continue;
        shooter = cand;
        target = tgt;
        const dx = this.ux[tgt]! - this.ux[cand]!;
        const dz = this.uz[tgt]! - this.uz[cand]!;
        const r = WEAPONS[this.kind(cand).weapon]!.range;
        if (dx * dx + dz * dz <= r * r) break;
      }
      if (shooter < 0) break;
      const w = this.kind(shooter).weapon;
      const ws = WEAPONS[w]!;
      const sub = rng.int(256);
      const t0 = (tick + sub / 256) * TICK_S;
      const sx = this.ux[shooter]!;
      const sz = this.uz[shooter]!;
      let tx = this.ux[target]!;
      let tz = this.uz[target]!;
      const hit = rng.chance(ws.accuracy);
      if (!hit) {
        // = rng.range(-1, 1), computed here from the int32 output (no double returned by a call).
        tx += (-1 + 2 * ((rng.nextI32() >>> 0) / 4294967296)) * ws.scatter * 2;
        tz += (-1 + 2 * ((rng.nextI32() >>> 0) / 4294967296)) * ws.scatter * 2;
      }
      const dx = tx - sx;
      const dz = tz - sz;
      const flight = Math.sqrt(dx * dx + dz * dz) / ws.speed + ws.arcS;
      // Impacts land at the earliest in the next tick (this tick's impacts are already out).
      const t1 = Math.max(t0 + Math.max(flight, 0.03), (tick + 1) * TICK_S);
      // addProjectile, written out: its six double arguments would be boxed per shot whenever
      // V8 does not inline the call.
      if (this.inFlight === this.cap) this.grow(this.cap + 1);
      const p = this.inFlight++;
      this.pWeapon[p] = w;
      this.pTarget[p] = hit ? target : -1;
      this.pTargetHandle[p] = this.uhandle[target]!;
      this.pSx[p] = sx;
      this.pSz[p] = sz;
      this.pTx[p] = tx;
      this.pTz[p] = tz;
      this.pT0[p] = t0;
      this.pT1[p] = t1;
      out.push(T_WEAPON_FIRE, weaponVisual(w), tick, sub, 0, Math.round(sx * FX_ONE), 0, Math.round(sz * FX_ONE), 0, this.uhandle[shooter]!);
      this.stats.shots++;
    }
  }

  private removeProjectile(p: number): void {
    const last = --this.inFlight;
    if (p === last) return;
    this.pWeapon[p] = this.pWeapon[last]!;
    this.pTarget[p] = this.pTarget[last]!;
    this.pTargetHandle[p] = this.pTargetHandle[last]!;
    this.pSx[p] = this.pSx[last]!;
    this.pSz[p] = this.pSz[last]!;
    this.pTx[p] = this.pTx[last]!;
    this.pTz[p] = this.pTz[last]!;
    this.pT0[p] = this.pT0[last]!;
    this.pT1[p] = this.pT1[last]!;
  }

  private inPond(x: number, z: number): boolean {
    for (let k = 0; k < PONDS.length; k++) {
      const p = PONDS[k]!;
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.r * p.r) return true;
    }
    return false;
  }

  private impacts(out: ArrayEventSource, tick: number): void {
    const tEnd = (tick + 1) * TICK_S;
    let p = 0;
    while (p < this.inFlight) {
      const t1 = this.pT1[p]!;
      if (t1 >= tEnd) {
        p++;
        continue;
      }
      const w = this.pWeapon[p]!;
      const target = this.pTarget[p]!;
      const x = this.pTx[p]!;
      const z = this.pTz[p]!;
      let sub = Math.floor((t1 / TICK_S - tick) * 256);
      sub = sub < 0 ? 0 : sub > 255 ? 255 : sub;
      // A hit counts only if the target is still the same unit (not died and respawned meanwhile).
      const valid = target >= 0 && this.ualive[target] === 1 && this.uhandle[target] === this.pTargetHandle[p];
      let surface = SURFACE_GROUND;
      let flags = 0;
      if (valid) {
        const role = this.kind(target).role;
        if (role === 'structure') {
          surface = SURFACE_STRUCTURE;
          flags = EVENT_FLAG_STRUCTURE;
        } else {
          surface = SURFACE_METAL;
        }
      } else if (this.inPond(x, z)) {
        surface = SURFACE_WATER;
      }
      out.push(T_IMPACT, weaponVisual(w), tick, sub, flags, Math.round(x * FX_ONE), 0, Math.round(z * FX_ONE), surface, valid ? this.uhandle[target]! : 0);
      this.stats.impacts++;
      if (valid) {
        this.stats.hits++;
        this.damage(out, tick, sub, target, WEAPONS[w]!.damage);
      }
      this.removeProjectile(p);
    }
  }

  private damage(out: ArrayEventSource, tick: number, sub: number, i: number, amount: number): void {
    const spec = this.kind(i);
    const a = this.uarmy[i]!;
    const before = this.uhp[i]!;
    const hp = before - amount;
    this.uhp[i] = hp;
    const x = this.ux[i]!;
    const z = this.uz[i]!;
    if (a === PLAYER_ARMY) {
      if (spec.role === 'structure') this.raiseAlert(out, tick, A_BASE, x, z);
      if (spec.role === 'commander' && hp < spec.hp * 0.5) this.raiseAlert(out, tick, A_COMMANDER, x, z);
    }
    if (hp > 0) return;
    this.ualive[i] = 0;
    this.stats.alive[a]!--;
    const qx = Math.round(x * FX_ONE);
    const qz = Math.round(z * FX_ONE);
    const visual = UNIT_VISUAL_BASE + this.ukind[i]!;
    const st = this.stats;
    st.deaths++;
    if (spec.role === 'commander') {
      out.push(T_COMMANDER_DEATH, visual, tick, sub, 0, qx, 0, qz, 0, this.uhandle[i]!);
      st.commanderDeaths++;
      this.urespawn[i] = tick + 100;
      return;
    }
    let flags = 0;
    if (spec.role === 'structure') {
      flags = EVENT_FLAG_STRUCTURE;
      st.structureDeaths++;
      this.urespawn[i] = tick + 150 + this.rng.int(100);
    } else {
      if (spec.role === 'air') {
        flags = EVENT_FLAG_AIR;
        st.airDeaths++;
      }
      this.urespawn[i] = tick + 30 + this.rng.int(50);
    }
    st.deathsBySize[spec.size]!++;
    out.push(T_DEATH, visual, tick, sub, flags, qx, 0, qz, spec.size, this.uhandle[i]!);
  }

  private raiseAlert(out: ArrayEventSource, tick: number, which: number, x: number, z: number): void {
    if (tick - this.lastAlertTick[which]! < ALERT_SPACING_TICKS[which]!) return;
    this.lastAlertTick[which] = tick;
    out.push(T_ALERT, 0, tick, 0, 0, Math.round(x * FX_ONE), 0, Math.round(z * FX_ONE), ALERT_INDEX[which]!, 0);
    this.stats.alerts++;
    this.stats.alertsByKind[SCENARIO_ALERTS[which]!]++;
  }

  private respawns(out: ArrayEventSource, tick: number): void {
    for (let i = 0; i < this.unitCount; i++) {
      if (this.ualive[i] === 1 || this.urespawn[i]! > tick) continue;
      this.revive(i, false);
      const a = this.uarmy[i]!;
      this.stats.alive[a]!++;
      if (this.kind(i).role === 'structure' && a === PLAYER_ARMY) {
        out.push(T_BUILD_COMPLETE, UNIT_VISUAL_BASE + this.ukind[i]!, tick, 0, EVENT_FLAG_STRUCTURE, Math.round(this.ux[i]! * FX_ONE), 0, Math.round(this.uz[i]! * FX_ONE), 0, this.uhandle[i]!);
        this.stats.buildCompletes++;
      }
    }
  }

  /** The enemy commander is spotted every 20 s (first after 3 s). */
  private spotting(out: ArrayEventSource, tick: number): void {
    if (tick < 30) return;
    const c = this.commanderIdx[1 - PLAYER_ARMY]!;
    if (this.ualive[c] === 0) return;
    this.raiseAlert(out, tick, A_SPOTTED, this.ux[c]!, this.uz[c]!);
  }

  /**
   * Build loop per army at its base: gain follows the build power (triangle wave), the pitch the
   * build rate; every army pauses 5 s out of 45 s (loop stop with fade and restart).
   */
  private buildLoops(loops: ScenarioLoopSink, tick: number): void {
    if (tick % 10 !== 1) return;
    const t = tick * TICK_S;
    for (let a = 0; a < 2; a++) {
      const phase = (Math.floor(tick / 10) + a * 7) % 45;
      const on = phase < 40;
      if (!on) {
        if (this.loopOn[a]) {
          loops.setLoop(BUILD_KEYS[a]!, null);
          this.loopOn[a] = false;
          this.stats.loopCalls++;
        }
        continue;
      }
      const req = this.loopReq[a]!;
      const base = BASES[a]!;
      req.x = base.x + (a === 0 ? 14 : -14);
      req.z = base.z;
      req.gain = 0.7 + 0.3 * tri(t + a * 13, 23);
      req.rate = 1 + 0.06 * tri(t + a * 5, 31);
      loops.setLoop(BUILD_KEYS[a]!, req);
      this.loopOn[a] = true;
      this.stats.loopCalls++;
    }
  }
}
