/**
 * Scenario DSL of the arena (PLAN §3.12 ScenarioBuilder analogue, ai.md §9): a declarative match
 * set-up that runs synchronously through `runMatch` with `AiHost` + `SyncAiSource` + `createDefaultBrain`
 * — the same host path as tournaments and the browser (emergency stop, telemetry forwarding).
 *
 *   runScenario({
 *     map: 'setons', seed: 7,
 *     sides: [{ army: 0, ai: { openingId: 'eco_standard' } }, { army: 1 }],      // army 1 scripted
 *     spawns:   [{ name: 'raid', army: 1, unit: 'core:lnd_t1_bot', count: 6, at: (rt) => … , tick }],
 *     cheats:   [{ tick: sec(60), run: (rt) => rt.world.addDemand(0, 0, 100) }],
 *     commands: [{ tick: sec(90), army: 1, issue: (rt) => rt.cmd.attackMove(1, rt.spawned('raid'), x, z) }],
 *     observe:  [{ every: 1, run: (rt) => … }],                                   // after each step
 *     until:    { seconds: 300, when: (rt) => … },
 *     asserts:  [(r) => …],
 *   });
 *
 * Tick order of a scenario tick t (before the world steps t): spawns of t → cheats of t → scripted
 * commands of t → sources (AI thinks at t ≡ 0 mod thinkEvery, delivers at t + lead) → world.step →
 * observers → `until.when`. Cheats and spawns go through the logged world cheat API, so
 * `replayMatch(result.match.log.setup, result.match.log)` reproduces the run bit-exactly.
 *
 * Timing helpers: 1 tick = 0.1 s; `sec(s)` converts seconds to ticks.
 */
import {
  createDefaultBrain,
  hashString,
  parseOpenings,
  profileFor,
  type AiBrain,
  type AiProfile,
  type Difficulty,
  type EncodedCommand,
  type ManagerName,
  type OpeningsDoc,
  type PerceptionView,
  type TelemetryEvent,
  type ThinkResult,
  type Vec2,
} from '@faf/ai';
import { AiHost, SyncAiSource } from '@faf/ai/host';
import type { CommandEnvelope, CommandSource } from '@faf/protocol';
import { hostClock, type HostClockKind } from '../bench/clock.ts';
import { loadOpeningsJson } from '../data/design.ts';
import type { ArenaMap } from '../data/maps.ts';
import { runMatch, type MatchResult } from '../match/run.ts';
import type { ArmyMatchMetrics, MatchMetrics } from '../match/metrics.ts';
import { ArenaPerceiver } from '../perception/perceive.ts';
import type { ArenaUnit } from '../world/unit.ts';
import type { ArenaWorld } from '../world/world.ts';
import { ScenarioCommands } from './commands.ts';

/** Ticks of `s` seconds (10 Hz). */
export function sec(s: number): number {
  return Math.round(s * 10);
}

/** Seconds of a tick count (null stays null). */
export function secondsOf(t: number | null | undefined): number | null {
  return t === null || t === undefined ? null : t / 10;
}

let openingsCache: OpeningsDoc | null = null;

/** Parsed ai-openings.json (cached per process). */
export function scenarioOpenings(): OpeningsDoc {
  if (openingsCache === null) openingsCache = parseOpenings(loadOpeningsJson());
  return openingsCache;
}

// ---- spec ------------------------------------------------------------------------------------

/** An AI-controlled side: default brain (or a custom one) in an `AiHost` behind a `SyncAiSource`. */
export interface AiSideSpec {
  /** Default 'normal'. */
  readonly difficulty?: Difficulty;
  /** Forces an opening (AI-OPEN-01/02); otherwise the weighted selection of the brain. */
  readonly openingId?: string;
  /** Subset of the default managers (executed in MANAGER_ORDER); default all. */
  readonly managers?: readonly ManagerName[];
  /** Custom brain factory (overrides `managers`). */
  readonly brain?: () => AiBrain;
  /** Adjusts the profile (e.g. a scenario-specific wave size); default profileFor(difficulty). */
  readonly profile?: (p: AiProfile) => AiProfile;
  /** Game seed of the brain (RNG streams, opening selection); default the scenario seed. */
  readonly gameSeed?: number;
  /** Scales every op allotment (AI-DET-02: 0.5). */
  readonly budgetScale?: number;
  /** Highest milestone of selectable openings (default 11). */
  readonly maxMs?: number;
  /** Keeps a copy of every perception snapshot the AI got (AI-PERC-01). */
  readonly recordPerception?: boolean;
  /** Called with the full result of every think (dropped commands, per-manager ops). */
  readonly onThink?: (tick: number, result: ThinkResult) => void;
  /**
   * Clock of the host's emergency stop (headless limit 200 ms); default 'thread' as in tournaments
   * (TRACK-AI Abweichung 7), 'wall' = ai.md §2.3.
   */
  readonly clock?: HostClockKind;
}

export interface ScenarioSide {
  readonly army: number;
  /** Index into the map's starts; default: the start whose marker army equals `army`. */
  readonly startIndex?: number;
  /** AI side; absent ⇒ scripted side (only `commands`/`script` act for it). */
  readonly ai?: AiSideSpec;
  /** Additional scripted CommandSource of a non-AI side. */
  readonly script?: CommandSource;
}

export interface SpawnSpec {
  /** Group name for `rt.spawned(name)`. */
  readonly name?: string;
  readonly army: number;
  /** Blueprint id (e.g. 'core:lnd_t1_bot'). */
  readonly unit: string;
  readonly at: Vec2 | ((rt: ScenarioRuntime) => Vec2);
  /** Default 1; several units are laid out in a square grid centred on `at`. */
  readonly count?: number;
  /** Grid spacing in WU (default 2). */
  readonly spacing?: number;
  /** Default true (a finished unit); false = a construction site. */
  readonly complete?: boolean;
  /** Tick of the spawn (default 0 = before the first step). */
  readonly tick?: number;
}

/** A hook at `tick`, or every `every` ticks from `tick` (default 0) up to `until` (exclusive). */
export interface TimedHook {
  readonly tick?: number;
  readonly every?: number;
  readonly until?: number;
  run(rt: ScenarioRuntime, tick: number): void;
}

/** Scripted commands of a non-AI army (same timing fields as TimedHook). */
export interface CommandHook {
  readonly army: number;
  readonly tick?: number;
  readonly every?: number;
  readonly until?: number;
  issue(rt: ScenarioRuntime, tick: number): CommandEnvelope | readonly CommandEnvelope[] | null | undefined;
}

export interface ScenarioUntil {
  /** Absolute tick limit. */
  readonly tick?: number;
  /** Tick limit in seconds (used when `tick` is absent). */
  readonly seconds?: number;
  /** Early stop, checked after every step. */
  readonly when?: (rt: ScenarioRuntime) => boolean;
}

export interface ScenarioSpec {
  readonly name?: string;
  readonly map: string | ArenaMap;
  readonly seed: number;
  readonly sides: readonly ScenarioSide[];
  readonly spawns?: readonly SpawnSpec[];
  /** World cheats (logged, replayable) and other set-up before the step of their tick. */
  readonly cheats?: readonly TimedHook[];
  readonly commands?: readonly CommandHook[];
  /** Observers after the step of their tick (measurements). */
  readonly observe?: readonly TimedHook[];
  readonly until: ScenarioUntil;
  /** Run after the match with the result (throw to fail). */
  readonly asserts?: readonly ((r: ScenarioResult) => void)[];
}

// ---- runtime -----------------------------------------------------------------------------------

/** One think of an AI side. */
export interface ThinkRecord {
  readonly tick: number;
  readonly commands: readonly EncodedCommand[];
  readonly opsTotal: number;
  readonly opsByManager: Readonly<Record<string, number>>;
  readonly dropped: number;
  readonly aborted: boolean;
}

class AiSideState {
  brain: AiBrain | null = null;
  readonly thinks: ThinkRecord[] = [];
  readonly perception: Uint8Array[] = [];
}

/** What hooks see while the scenario runs. */
export class ScenarioRuntime {
  readonly cmd = new ScenarioCommands();
  /** Current scenario tick (the tick about to be stepped, resp. just stepped for observers). */
  tick = 0;
  private worldValue: ArenaWorld | null = null;
  private readonly groups = new Map<string, number[]>();
  /** @internal */
  readonly ai = new Map<number, AiSideState>();
  /** @internal pending scripted commands per army for the current tick */
  readonly pending = new Map<number, CommandEnvelope[]>();

  get world(): ArenaWorld {
    if (this.worldValue === null) throw new Error('scenario: world not created yet');
    return this.worldValue;
  }

  /** @internal */
  attach(w: ArenaWorld): void {
    this.worldValue = w;
  }

  /** Handles of a spawn group (in spawn order; dead units included). */
  spawned(name: string): number[] {
    return [...(this.groups.get(name) ?? [])];
  }

  /** Live handles of a spawn group. */
  alive(name: string): number[] {
    const w = this.world;
    return this.spawned(name).filter((h) => {
      const u = w.unit(h);
      return u !== null && u.alive;
    });
  }

  /** @internal */
  addToGroup(name: string, h: number): void {
    const g = this.groups.get(name);
    if (g === undefined) this.groups.set(name, [h]);
    else g.push(h);
  }

  /** Brain of an AI army (after the first tick). */
  brain(army: number): AiBrain {
    const s = this.ai.get(army);
    if (s === undefined || s.brain === null) throw new Error(`scenario: army ${army} has no brain (yet)`);
    return s.brain;
  }

  /** Live units of an army, optionally of one blueprint id (slot order). */
  units(army: number, bpId?: string): ArenaUnit[] {
    const w = this.world;
    const bp = bpId === undefined ? -1 : w.bpIndex(bpId);
    return w.unitsOf(army).filter((u) => u.alive && (bp < 0 || u.bp.index === bp));
  }

  /** Queues scripted commands of a non-AI army for the current tick. */
  issue(army: number, envs: CommandEnvelope | readonly CommandEnvelope[]): void {
    if (this.ai.has(army)) throw new Error(`scenario: army ${army} is AI-controlled; scripted commands would collide with its sequence numbers`);
    const list = this.pending.get(army) ?? [];
    if (Array.isArray(envs)) list.push(...(envs as readonly CommandEnvelope[]));
    else list.push(envs as CommandEnvelope);
    this.pending.set(army, list);
  }
}

// ---- result ------------------------------------------------------------------------------------

export class ScenarioResult {
  constructor(
    readonly spec: ScenarioSpec,
    readonly match: MatchResult,
    readonly rt: ScenarioRuntime,
  ) {}

  get world(): ArenaWorld {
    return this.match.world;
  }

  get metrics(): MatchMetrics {
    return this.match.metrics;
  }

  /** Truth metrics of an army. */
  army(a: number): ArmyMatchMetrics {
    const m = this.match.metrics.armies.find((x) => x.army === a);
    if (m === undefined) throw new Error(`scenario: no metrics for army ${a}`);
    return m;
  }

  brain(a: number): AiBrain {
    return this.rt.brain(a);
  }

  telemetry(a: number): readonly TelemetryEvent[] {
    return this.brain(a).blackboard.telemetry.events;
  }

  /** First telemetry event of a kind (optionally matching `pred`). */
  first<K extends TelemetryEvent['kind']>(a: number, kind: K, pred?: (e: Extract<TelemetryEvent, { kind: K }>) => boolean): Extract<TelemetryEvent, { kind: K }> | undefined {
    for (const e of this.telemetry(a)) {
      if (e.kind !== kind) continue;
      const x = e as Extract<TelemetryEvent, { kind: K }>;
      if (pred === undefined || pred(x)) return x;
    }
    return undefined;
  }

  /** ai.md §7.1 "erste Welle": first waveAttack with a target in the enemy half (tick or null). */
  firstWaveTick(a: number): number | null {
    return this.first(a, 'waveAttack', (e) => e.enemyHalf)?.tick ?? null;
  }

  thinks(a: number): readonly ThinkRecord[] {
    return this.side(a).thinks;
  }

  /** Every command the AI emitted, in think order. */
  commands(a: number): EncodedCommand[] {
    const out: EncodedCommand[] = [];
    for (const t of this.side(a).thinks) out.push(...t.commands);
    return out;
  }

  /** Canonical text of the AI's command stream (determinism comparisons). */
  streamKey(a: number): string {
    return streamKeyOf(this.commands(a));
  }

  streamHash(a: number): number {
    return hashString(this.streamKey(a));
  }

  /** Recorded perception snapshots (AiSideSpec.recordPerception). */
  perception(a: number): readonly Uint8Array[] {
    return this.side(a).perception;
  }

  /** Nearest-rank percentile of the ops per think (pct in %). */
  opsPercentile(a: number, pct: number): number {
    const v = this.side(a).thinks.map((t) => t.opsTotal);
    return nearestRank(v, pct);
  }

  /** Largest ops of a manager in any think. */
  maxOps(a: number, manager: string): number {
    let m = 0;
    for (const t of this.side(a).thinks) {
      const v = t.opsByManager[manager] ?? 0;
      if (v > m) m = v;
    }
    return m;
  }

  private side(a: number): AiSideState {
    const s = this.rt.ai.get(a);
    if (s === undefined) throw new Error(`scenario: army ${a} is not an AI side`);
    return s;
  }
}

/** Canonical text of a command list: tick:seq:op:flags:units:payload per command. */
export function streamKeyOf(cmds: readonly EncodedCommand[]): string {
  const parts: string[] = [];
  for (const c of cmds) parts.push(`${c.tick}:${c.seq}:${c.op}:${c.flags}:${c.units.join(',')}:${Array.from(c.payload).join('.')}`);
  return parts.join('|');
}

/** Nearest-rank percentile (pct in %, 0 for an empty list). */
export function nearestRank(values: readonly number[], pct: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.min(s.length, Math.max(1, Math.ceil((pct * s.length) / 100)));
  return s[rank - 1]!;
}

// ---- runner ------------------------------------------------------------------------------------

function due(h: { tick?: number; every?: number; until?: number }, t: number): boolean {
  const from = h.tick ?? 0;
  if (t < from) return false;
  if (h.until !== undefined && t >= h.until) return false;
  if (h.every === undefined) return t === from;
  return (t - from) % h.every === 0;
}

function layout(count: number, spacing: number, at: Vec2): Vec2[] {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({ x: at.x + (c - (cols - 1) / 2) * spacing, z: at.z + (r - (rows - 1) / 2) * spacing });
  }
  return out;
}

function defaultStartIndex(map: string | ArenaMap, army: number): number {
  if (typeof map === 'string') return army;
  const i = map.starts.findIndex((s) => s.army === army);
  return i >= 0 ? i : army;
}

/** Runs a scenario synchronously and checks its asserts. */
export function runScenario(spec: ScenarioSpec): ScenarioResult {
  const rt = new ScenarioRuntime();
  const openings = scenarioOpenings();
  const maxTicks = spec.until.tick ?? (spec.until.seconds !== undefined ? sec(spec.until.seconds) : NaN);
  if (!(maxTicks > 0)) throw new RangeError('runScenario: until.tick or until.seconds required');
  for (const s of spec.sides) if (s.ai !== undefined) rt.ai.set(s.army, new AiSideState());

  const sides = spec.sides.map((side) => {
    if (side.ai === undefined) {
      const script = side.script;
      const army = side.army;
      const source: CommandSource = {
        commandsFor: (tick) => {
          const out: CommandEnvelope[] = [];
          if (script !== undefined) {
            const r = script.commandsFor(tick);
            if (r === 'pending') throw new Error('runScenario: scripted sources must not be pending');
            out.push(...r);
          }
          const p = rt.pending.get(army);
          if (p !== undefined) {
            out.push(...p);
            rt.pending.delete(army);
          }
          return out;
        },
      };
      return { army, source };
    }
    const ai = side.ai;
    const state = rt.ai.get(side.army)!;
    return {
      army: side.army,
      source: (ctx: { world: ArenaWorld; army: number }): CommandSource => {
        const gameSeed = ai.gameSeed ?? spec.seed;
        const perceiver = new ArenaPerceiver(ctx.world, ctx.army, gameSeed);
        const brain = ai.brain?.() ?? createDefaultBrain(ai.managers !== undefined ? { managers: ai.managers } : {});
        let profile = profileFor(ai.difficulty ?? 'normal', openings);
        if (ai.profile !== undefined) profile = ai.profile(profile);
        const host = new AiHost({
          brain,
          static: perceiver.static,
          profile,
          openings,
          gameSeed,
          env: 'headless',
          clock: hostClock(ai.clock ?? 'thread'),
          ...(ai.openingId !== undefined ? { openingId: ai.openingId } : {}),
          ...(ai.maxMs !== undefined ? { maxMs: ai.maxMs } : {}),
          ...(ai.budgetScale !== undefined ? { budgetScale: ai.budgetScale } : {}),
        });
        state.brain = host.brain;
        return new SyncAiSource({
          host,
          perceive: ai.recordPerception === true ? recordingPerceive(perceiver, state) : (tick: number): PerceptionView => perceiver.perceive(tick),
          onThink: (tick, r: ThinkResult) => {
            state.thinks.push({
              tick,
              commands: r.commands,
              opsTotal: r.opsTotal,
              opsByManager: r.opsByManager,
              dropped: r.dropped.length,
              aborted: r.aborted,
            });
            ai.onThink?.(tick, r);
          },
        });
      },
    };
  });

  const armies = spec.sides.map((s) => ({ army: s.army, startIndex: s.startIndex ?? defaultStartIndex(spec.map, s.army) }));
  const spawns = spec.spawns ?? [];
  const cheats = spec.cheats ?? [];
  const commands = spec.commands ?? [];
  const observe = spec.observe ?? [];
  const match = runMatch({
    map: spec.map,
    seed: spec.seed,
    armies,
    sides,
    maxTicks,
    onTick: (world, t) => {
      rt.attach(world);
      rt.tick = t;
      for (const sp of spawns) {
        if ((sp.tick ?? 0) !== t) continue;
        const at = typeof sp.at === 'function' ? sp.at(rt) : sp.at;
        for (const p of layout(sp.count ?? 1, sp.spacing ?? 2, at)) {
          const h = world.spawn(sp.army, sp.unit, p.x, p.z, { complete: sp.complete ?? true });
          if (sp.name !== undefined) rt.addToGroup(sp.name, h);
        }
      }
      for (const c of cheats) if (due(c, t)) c.run(rt, t);
      for (const c of commands) {
        if (!due(c, t)) continue;
        const r = c.issue(rt, t);
        if (r !== null && r !== undefined) rt.issue(c.army, r);
      }
    },
    stopWhen: (world, t) => {
      rt.attach(world);
      rt.tick = t;
      for (const o of observe) if (due(o, t)) o.run(rt, t);
      return spec.until.when !== undefined && spec.until.when(rt);
    },
  });
  const res = new ScenarioResult(spec, match, rt);
  for (const a of spec.asserts ?? []) a(res);
  return res;
}

function recordingPerceive(perceiver: ArenaPerceiver, state: AiSideState): (tick: number) => Uint8Array {
  return (tick) => {
    // One snapshot per think: `bytes` drains the event queue; the host binds its own view to a copy.
    const bytes = perceiver.bytes(tick);
    state.perception.push(bytes);
    return bytes.slice();
  };
}
