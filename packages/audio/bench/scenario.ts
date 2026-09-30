/**
 * Scenario 'Gefecht-200' (battle): a deterministic stream of sim events for the engine, shared
 * by the engine integration tests (test/engine) and the Node benchmark (bench/run.ts).
 *
 * Per 10 Hz sim tick it emits weaponFire over six real weapon refs, projectileImpact (surface
 * ground/metal), unitDeath (size classes, air/structure flags), one commanderDeath and a few
 * located alerts, all with subTick staggering, into one reused ArrayEventSource. Positions are
 * two battle lines left/right of the camera focus plus a share of far-away events that the
 * spatial model culls. The driver runs frames at a fixed rate, feeds one batch per tick and
 * calls `engine.update` every frame.
 */

import { DEFAULT_EVENT_TYPES, EVENT_FLAG_AIR, EVENT_FLAG_STRUCTURE, alertKindIndex } from '../src/events/index.ts';
import { ArrayEventSource, FX_ONE, type AudioEngine, type ListenerState, type PlayRequest } from '../src/types.ts';

/** Weapon refs of the battle (visual id = index + 1). */
export const BATTLE_WEAPONS: readonly string[] = [
  'core:wpn_cannon_t1',
  'core:wpn_mg_t1',
  'core:wpn_spark_mg_t1',
  'core:wpn_slag_mortar_t1',
  'core:wpn_reeve_cannon',
  'core:wpn_bolt_cannon_t1',
];

/** Visual id → weapon ref of {@link BATTLE_WEAPONS} (pass as `visualName`). */
export function battleVisualName(visual: number): string | undefined {
  return BATTLE_WEAPONS[visual - 1];
}

/** A located alert raised at a fixed scenario time. */
export interface ScenarioAlert {
  atS: number;
  /** Alert sound name (index into ALERT_KINDS is derived). */
  kind: string;
  x: number;
  z: number;
}

export interface BattleConfig {
  /** Simulated duration in seconds. */
  seconds: number;
  /** Frame rate of the driver. */
  fps: number;
  /** weaponFire events per second. */
  shotsPerSecond: number;
  /** projectileImpact events per second (default 0.75 × shots). */
  impactsPerSecond?: number | undefined;
  /** unitDeath events per second (default 8). */
  deathsPerSecond?: number | undefined;
  /** Time of the single commanderDeath in s (default 0.6 × seconds; null = none). */
  commanderDeathAtS?: number | null | undefined;
  /** Located alerts (default: three, see {@link DEFAULT_BATTLE_ALERTS}). */
  alerts?: readonly ScenarioAlert[] | undefined;
  /** Keyed build loops started at frame 0 (default 2). */
  buildLoops?: number | undefined;
  /** Share of events far outside the view (culled by the spatial model; default 0.1). */
  farShare?: number | undefined;
  /** PRNG seed (default 1). */
  seed?: number | undefined;
}

/** {@link BattleConfig} with all defaults applied. */
export interface ResolvedBattleConfig {
  readonly seconds: number;
  readonly fps: number;
  readonly shotsPerSecond: number;
  readonly impactsPerSecond: number;
  readonly deathsPerSecond: number;
  readonly commanderDeathAtS: number | null;
  readonly alerts: readonly ScenarioAlert[];
  readonly buildLoops: number;
  readonly farShare: number;
  readonly seed: number;
}

export const DEFAULT_BATTLE_ALERTS: readonly ScenarioAlert[] = [
  { atS: 2, kind: 'alt_base_attacked', x: -30, z: 20 },
  { atS: 4.5, kind: 'alt_commander_danger', x: 12, z: -8 },
  { atS: 7, kind: 'alt_enemy_commander_spotted', x: 60, z: 45 },
];

/** Camera of the battle: focus at the origin, typical play height. */
export const BATTLE_LISTENER: Readonly<ListenerState> = Object.freeze({
  focusX: 0,
  focusZ: 0,
  height: 60,
  viewHalfWidth: 35,
  rightX: 1,
  rightZ: 0,
});

/** Sim tick rate (Hz). */
export const TICK_HZ = 10;

const T_FIRE = DEFAULT_EVENT_TYPES.weaponFire;
const T_IMPACT = DEFAULT_EVENT_TYPES.projectileImpact;
const T_DEATH = DEFAULT_EVENT_TYPES.unitDeath;
const T_COMMANDER = DEFAULT_EVENT_TYPES.commanderDeath;
const T_ALERT = DEFAULT_EVENT_TYPES.alert;

/** Small deterministic PRNG (mulberry32), values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counters of emitted events. */
export interface BattleCounts {
  ticks: number;
  weaponFire: number;
  impacts: number;
  deaths: number;
  commanderDeaths: number;
  alerts: number;
}

/** Generates the per-tick event batches of the battle. */
export class BattleScenario {
  readonly batch = new ArrayEventSource(512);
  readonly counts: BattleCounts = { ticks: 0, weaponFire: 0, impacts: 0, deaths: 0, commanderDeaths: 0, alerts: 0 };
  readonly cfg: ResolvedBattleConfig;
  private readonly rnd: () => number;
  private shotAcc = 0;
  private impactAcc = 0;
  private deathAcc = 0;
  private commanderDone = false;
  private alertNext = 0;
  private readonly alertIndex: number[];

  constructor(cfg: BattleConfig) {
    this.cfg = {
      seconds: cfg.seconds,
      fps: cfg.fps,
      shotsPerSecond: cfg.shotsPerSecond,
      impactsPerSecond: cfg.impactsPerSecond ?? cfg.shotsPerSecond * 0.75,
      deathsPerSecond: cfg.deathsPerSecond ?? 8,
      commanderDeathAtS: cfg.commanderDeathAtS === undefined ? cfg.seconds * 0.6 : cfg.commanderDeathAtS,
      alerts: cfg.alerts ?? DEFAULT_BATTLE_ALERTS,
      buildLoops: cfg.buildLoops ?? 2,
      farShare: cfg.farShare ?? 0.1,
      seed: cfg.seed ?? 1,
    };
    this.rnd = mulberry32(this.cfg.seed);
    this.alertIndex = this.cfg.alerts.map((a) => {
      const i = alertKindIndex(a.kind);
      if (i < 0) throw new RangeError(`scenario: unknown alert kind ${a.kind}`);
      return i;
    });
  }

  /** Fills and returns the batch of the next tick. */
  nextTick(): ArrayEventSource {
    const b = this.batch;
    const rnd = this.rnd;
    const tick = this.counts.ticks++;
    const tS = tick / TICK_HZ;
    b.clear();

    this.shotAcc += this.cfg.shotsPerSecond / TICK_HZ;
    while (this.shotAcc >= 1) {
      this.shotAcc -= 1;
      const side = rnd() < 0.5 ? -1 : 1;
      const visual = 1 + Math.floor(rnd() * BATTLE_WEAPONS.length);
      this.pushAt(T_FIRE, visual, tick, 0, side * (12 + rnd() * 30), 0);
      this.counts.weaponFire++;
    }
    this.impactAcc += this.cfg.impactsPerSecond / TICK_HZ;
    while (this.impactAcc >= 1) {
      this.impactAcc -= 1;
      const side = rnd() < 0.5 ? -1 : 1;
      const visual = 1 + Math.floor(rnd() * BATTLE_WEAPONS.length);
      const surface = rnd() < 0.7 ? 0 : 1;
      this.pushAt(T_IMPACT, visual, tick, 0, side * (8 + rnd() * 30), surface);
      this.counts.impacts++;
    }
    this.deathAcc += this.cfg.deathsPerSecond / TICK_HZ;
    while (this.deathAcc >= 1) {
      this.deathAcc -= 1;
      const r = rnd();
      const size = r < 0.6 ? 0 : r < 0.9 ? 1 : 2;
      const f = rnd();
      const flags = f < 0.1 ? EVENT_FLAG_AIR : f < 0.25 ? EVENT_FLAG_STRUCTURE : 0;
      const side = rnd() < 0.5 ? -1 : 1;
      this.pushAt(T_DEATH, 0, tick, flags, side * (5 + rnd() * 30), size);
      this.counts.deaths++;
    }
    const cd = this.cfg.commanderDeathAtS;
    if (!this.commanderDone && cd !== null && tS >= cd) {
      this.commanderDone = true;
      b.push(T_COMMANDER, 0, tick, 128, 0, Math.round(25 * FX_ONE), 0, Math.round(-10 * FX_ONE), 0, 1);
      this.counts.commanderDeaths++;
    }
    const alerts = this.cfg.alerts;
    while (this.alertNext < alerts.length && tS >= alerts[this.alertNext]!.atS) {
      const a = alerts[this.alertNext]!;
      b.push(T_ALERT, 0, tick, 0, 0, Math.round(a.x * FX_ONE), 0, Math.round(a.z * FX_ONE), this.alertIndex[this.alertNext]!, 0);
      this.alertNext++;
      this.counts.alerts++;
    }
    return b;
  }

  /** Pushes one located event: near the front (x given) or, with `farShare`, far off-screen. */
  private pushAt(type: number, visual: number, tick: number, flags: number, x: number, aux: number): void {
    const rnd = this.rnd;
    let wx = x;
    let wz = (rnd() * 2 - 1) * 50;
    if (rnd() < this.cfg.farShare) {
      wx = x * 4;
      wz = (rnd() < 0.5 ? -1 : 1) * (250 + rnd() * 150);
    }
    const subTick = Math.floor(rnd() * 256);
    this.batch.push(type, visual, tick, subTick, flags, Math.round(wx * FX_ONE), 0, Math.round(wz * FX_ONE), aux, 0);
  }
}

/** Hooks of {@link runBattle} into the (fake) context and the observer. */
export interface BattleHooks {
  /** Advances the audio + wall clock by `ms` (fake context). */
  advance(ms: number): void;
  /** Wall clock in ms (the engine clock). */
  now(): number;
  /**
   * Stopwatch in ms (e.g. performance.now). When given, the driver sums the time spent inside
   * the engine calls of a frame (handleEvents + update; event generation excluded) and passes
   * it to `onFrame`.
   */
  timer?: (() => number) | undefined;
  /** Called right after `engine.update` of every frame (before the clock advances). */
  onFrame?: ((frame: number, tickFed: boolean, engineMs: number) => void) | undefined;
}

/** Build loop request of loop `i` (positions left/right of the focus). */
function buildLoopRequest(i: number): PlayRequest {
  return { sound: 'bld_pour_loop', x: i % 2 === 0 ? -20 : 20, z: -15 + i * 7 };
}

/**
 * Frame-by-frame driver of the battle: one batch per 100 ms of sim time, `engine.update(now)`
 * every frame, build loops and the listener set on the first step. No allocation per frame.
 */
export class BattleDriver {
  /** Frames stepped so far. */
  frame = 0;
  readonly frameMs: number;
  private readonly tickMs = 1000 / TICK_HZ;
  private nextTickMs = 0;
  private simMs = 0;
  private started = false;

  constructor(
    readonly engine: AudioEngine,
    readonly scenario: BattleScenario,
    private readonly hooks: BattleHooks,
  ) {
    this.frameMs = 1000 / scenario.cfg.fps;
  }

  /** Total frames of the configured duration. */
  get frames(): number {
    return Math.round(this.scenario.cfg.seconds * this.scenario.cfg.fps);
  }

  /** Runs one frame; returns true if a sim batch was fed in it. */
  step(): boolean {
    const engine = this.engine;
    const hooks = this.hooks;
    const timer = hooks.timer;
    if (!this.started) {
      this.started = true;
      engine.setListener(BATTLE_LISTENER);
      for (let i = 0; i < this.scenario.cfg.buildLoops; i++) engine.setLoop(`build:${i}`, buildLoopRequest(i));
    }
    const f = this.frame;
    let fed = false;
    let engineMs = 0;
    while (this.nextTickMs <= this.simMs) {
      const batch = this.scenario.nextTick();
      if (timer === undefined) {
        engine.handleEvents(batch);
      } else {
        const t0 = timer();
        engine.handleEvents(batch);
        engineMs += timer() - t0;
      }
      this.nextTickMs += this.tickMs;
      fed = true;
    }
    if (timer === undefined) {
      engine.update(hooks.now());
    } else {
      const t0 = timer();
      engine.update(hooks.now());
      engineMs += timer() - t0;
    }
    hooks.onFrame?.(f, fed, timer === undefined ? Number.NaN : engineMs);
    hooks.advance(this.frameMs);
    this.simMs += this.frameMs;
    this.frame = f + 1;
    return fed;
  }
}

/** Drives `engine` through the whole configured duration; returns the frame count. */
export function runBattle(engine: AudioEngine, scenario: BattleScenario, hooks: BattleHooks): number {
  const d = new BattleDriver(engine, scenario, hooks);
  const frames = d.frames;
  for (let f = 0; f < frames; f++) d.step();
  return frames;
}
