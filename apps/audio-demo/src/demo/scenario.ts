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

import { DEFAULT_EVENT_TYPES, EVENT_FLAG_AIR, EVENT_FLAG_STRUCTURE, alertKindIndex } from '@faf/audio/events';
import { ArrayEventSource, FX_ONE, type ListenerState } from '@faf/audio';

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

export const DEFAULT_BATTLE_ALERTS: readonly ScenarioAlert[] = [
  { atS: 2, kind: 'alt_base_attacked', x: -30, z: 20 },
  { atS: 4.5, kind: 'alt_commander_danger', x: 12, z: -8 },
  { atS: 7, kind: 'alt_enemy_commander_spotted', x: 60, z: 45 },
];

/** Camera of the battle: focus at the origin, typical play height. */
export const BATTLE_LISTENER: Readonly<ListenerState> = Object.freeze({
  focusX: 256,
  focusZ: 256,
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
  readonly cfg: { [K in keyof Omit<BattleConfig, 'commanderDeathAtS'>]-?: Exclude<BattleConfig[K], undefined> } & { commanderDeathAtS: number | null };
  private readonly rnd: () => number;
  private shotAcc = 0;
  private readonly pending = new Int32Array(2048 * 6);
  private pendingHead = 0;
  private pendingTail = 0;
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
      if (rnd() < this.cfg.impactsPerSecond / this.cfg.shotsPerSecond) {
        const e = b.events[b.count - 1]!;
        const offset = (this.pendingHead++ % 2048) * 6;
        this.pending[offset] = tick + 1 + Math.floor(rnd() * 4);
        this.pending[offset + 1] = visual;
        this.pending[offset + 2] = Math.floor(rnd() * 256);
        this.pending[offset + 3] = e.x + Math.round(side * -20 * FX_ONE);
        this.pending[offset + 4] = e.z;
        this.pending[offset + 5] = rnd() < .7 ? 0 : 1;
      }
    }
    // Flight time is 100–400 ms. Pending projectiles reuse a fixed ring.
    for (let i = this.pendingTail; i < this.pendingHead; i++) {
      const offset = (i % 2048) * 6;
      if (this.pending[offset]! < 0 || this.pending[offset]! > tick) continue;
      b.push(T_IMPACT, this.pending[offset + 1]!, tick, this.pending[offset + 2]!, 0, this.pending[offset + 3]!, 0, this.pending[offset + 4]!, this.pending[offset + 5]!, 0);
      this.pending[offset] = -1;
      this.counts.impacts++;
    }
    while (this.pendingTail < this.pendingHead && this.pending[(this.pendingTail % 2048) * 6] === -1) this.pendingTail++;
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
      b.push(T_COMMANDER, 0, tick, 128, 0, Math.round(281 * FX_ONE), 0, Math.round(246 * FX_ONE), 0, 1);
      this.counts.commanderDeaths++;
    }
    const alerts = this.cfg.alerts;
    while (this.alertNext < alerts.length && tS >= alerts[this.alertNext]!.atS) {
      const a = alerts[this.alertNext]!;
      b.push(T_ALERT, 0, tick, 0, 0, Math.round((a.x + 256) * FX_ONE), 0, Math.round((a.z + 256) * FX_ONE), this.alertIndex[this.alertNext]!, 0);
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
    this.batch.push(type, visual, tick, subTick, flags, Math.round((wx + 256) * FX_ONE), 0, Math.round((wz + 256) * FX_ONE), aux, 0);
  }
}
