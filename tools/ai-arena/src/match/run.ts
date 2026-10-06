/**
 * Match loop of the arena (PLAN §3.1 CommandSource semantics):
 *
 *   for t = world.tick … maxTicks − 1 (until a commander dies):
 *     onTick(world, t)                       scenario hooks / cheats (logged by the world)
 *     cmds = ⋃ side.source.commandsFor(t)    'pending' ⇒ error (sync) resp. wait (async)
 *     world.step(cmds)                       applied in (army, seq) order, logged with t
 *
 * `replayMatch(setup, log)` rebuilds the world from the setup, re-applies the logged cheats before
 * the step of their tick and the logged commands in their tick ⇒ the same world hash.
 */
import type { AiStatic, PerceptionView } from '@faf/ai';
import { MessageChannel } from 'node:worker_threads';
import { asTick } from '@faf/fixed';
import type { CommandEnvelope, CommandSource } from '@faf/protocol';
import { ArenaPerceiver } from '../perception/perceive.ts';
import { ArenaWorld, type ArenaArmySetup, type ArenaWorldOptions, type CheatRecord, type LoggedCommand } from '../world/world.ts';
import { MetricsCollector, type MatchMetrics } from './metrics.ts';

/** What a source factory gets to build its CommandSource (e.g. an AiCommandSource). */
export interface MatchSourceContext {
  readonly world: ArenaWorld;
  readonly army: number;
  readonly static: AiStatic;
  /** Perception of the side's army at `tick` (= world.tick). */
  perceive(tick: number): PerceptionView;
}

export interface MatchSide {
  readonly army: number;
  /** A ready CommandSource, or a factory called once the world exists. */
  readonly source: CommandSource | ((ctx: MatchSourceContext) => CommandSource);
}

export interface RunMatchOptions {
  /** Existing world (e.g. prepared with cheats); otherwise one is created from `setup` / map + seed. */
  readonly world?: ArenaWorld;
  readonly setup?: ArenaWorldOptions;
  readonly map?: ArenaWorldOptions['map'];
  readonly seed?: number;
  readonly bps?: ArenaWorldOptions['bps'];
  /** Default: one entry per side, start index = the map marker of the side's army. */
  readonly armies?: readonly ArenaArmySetup[];
  readonly sides: readonly MatchSide[];
  /** Absolute tick limit (the match ends as a draw when reached). */
  readonly maxTicks: number;
  /** Called before the commands of tick t are collected (cheats are logged for the replay). */
  readonly onTick?: (world: ArenaWorld, tick: number) => void;
  /** Overrides the perception given to source factories. */
  readonly perceptionFor?: (world: ArenaWorld, army: number) => (tick: number) => PerceptionView;
  /** Role expressions for `producedByRole` (default: ai-openings.json roles). */
  readonly roles?: Readonly<Record<string, string>>;
  /**
   * Early stop (scenarios, tai-p5): checked after every step with the stepped world; true ends the
   * loop like the tick limit (the match counts as a draw unless a commander died).
   */
  readonly stopWhen?: (world: ArenaWorld, tick: number) => boolean;
}

/** Everything needed to replay a match bit-exactly. */
export interface MatchLog {
  readonly setup: ArenaWorldOptions;
  readonly cheats: readonly CheatRecord[];
  readonly commands: readonly LoggedCommand[];
  readonly endTick: number;
  readonly endReason: ArenaWorld['endReason'];
}

export interface MatchResult {
  readonly world: ArenaWorld;
  readonly metrics: MatchMetrics;
  readonly log: MatchLog;
  /** World hash at the end. */
  readonly hash: number;
}

export interface AsyncMatchResult extends MatchResult {
  /** Number of 'pending' answers the loop waited on. */
  readonly pendingWaits: number;
  /** Ticks on which the loop had to wait at least once. */
  readonly ticksWaited: number;
  /** Largest number of waits on a single tick. */
  readonly maxWaitsPerTick: number;
}

interface Prepared {
  world: ArenaWorld;
  sources: { army: number; source: CommandSource }[];
  collector: MetricsCollector;
}

function defaultArmies(o: RunMatchOptions, map: ArenaWorldOptions['map']): ArenaArmySetup[] {
  const m = typeof map === 'string' ? null : map;
  return o.sides.map((s) => {
    if (m === null) return { army: s.army, startIndex: s.army };
    const i = m.starts.findIndex((st) => st.army === s.army);
    return { army: s.army, startIndex: i >= 0 ? i : s.army };
  });
}

function prepare(o: RunMatchOptions): Prepared {
  let world = o.world;
  if (world === undefined) {
    let setup = o.setup;
    if (setup === undefined) {
      if (o.map === undefined || o.seed === undefined) throw new Error('runMatch: world, setup or map + seed required');
      setup = {
        map: o.map,
        seed: o.seed,
        armies: o.armies ?? defaultArmies(o, o.map),
        ...(o.bps !== undefined ? { bps: o.bps } : {}),
      };
    }
    world = ArenaWorld.create(setup);
  }
  if (!(o.maxTicks >= world.tick)) throw new RangeError('runMatch: maxTicks before the world tick');
  const collector = new MetricsCollector(world, o.roles);
  world.observers.push(collector);
  const w = world;
  const sources = o.sides.map((side) => {
    if (!w.isActive(side.army)) throw new RangeError(`runMatch: army ${side.army} is not in the world`);
    if (typeof side.source !== 'function') return { army: side.army, source: side.source };
    const custom = o.perceptionFor?.(w, side.army);
    const perceiver = new ArenaPerceiver(w, side.army);
    const ctx: MatchSourceContext = {
      world: w,
      army: side.army,
      static: perceiver.static,
      perceive: custom ?? ((tick: number) => perceiver.perceive(tick)),
    };
    return { army: side.army, source: side.source(ctx) };
  });
  return { world: w, sources, collector };
}

function collect(sources: Prepared['sources'], t: number, out: CommandEnvelope[]): boolean {
  for (const s of sources) {
    const r = s.source.commandsFor(asTick(t));
    if (r === 'pending') return false;
    for (const env of r) {
      if ((env.army as number) !== s.army) throw new Error(`runMatch: source of army ${s.army} emitted a command for army ${env.army}`);
      out.push(env);
    }
  }
  return true;
}

function finish(p: Prepared, maxTicks: number): MatchResult {
  const world = p.world;
  if (!world.over && world.tick >= maxTicks) world.endByTickLimit();
  const idx = world.observers.indexOf(p.collector);
  if (idx >= 0) world.observers.splice(idx, 1);
  return {
    world,
    metrics: p.collector.result(world),
    log: matchLogOf(world),
    hash: world.hash(),
  };
}

/** The replay log of a world (setup, cheats, all applied commands). */
export function matchLogOf(world: ArenaWorld): MatchLog {
  return {
    setup: world.setup,
    cheats: world.cheatLog.slice(),
    commands: world.commandLog.slice(),
    endTick: world.tick,
    endReason: world.endReason,
  };
}

/** Runs a match synchronously; a 'pending' answer is an error here (use runMatchAsync). */
export function runMatch(o: RunMatchOptions): MatchResult {
  const p = prepare(o);
  const world = p.world;
  const cmds: CommandEnvelope[] = [];
  while (!world.over && world.tick < o.maxTicks) {
    const t = world.tick;
    o.onTick?.(world, t);
    if (world.over) break;
    cmds.length = 0;
    if (!collect(p.sources, t, cmds)) throw new Error(`runMatch: a source answered 'pending' at tick ${t} (use runMatchAsync)`);
    world.step(cmds);
    if (o.stopWhen?.(world, world.tick) === true) break;
  }
  return finish(p, o.stopWhen === undefined ? o.maxTicks : Math.min(o.maxTicks, world.tick));
}

export interface RunMatchAsyncOptions extends RunMatchOptions {
  /** Yields to the event loop while a source is pending (default: a MessageChannel round trip). */
  readonly yieldFn?: () => Promise<void>;
  /** Safety limit of waits on one tick (default 1,000,000). */
  readonly maxWaitsPerTick?: number;
}

function messageChannelYield(): { next: () => Promise<void>; close: () => void } {
  const ch = new MessageChannel();
  let wake: (() => void) | null = null;
  ch.port1.on('message', () => {
    const w = wake;
    wake = null;
    w?.();
  });
  return {
    next: () =>
      new Promise<void>((resolve) => {
        wake = resolve;
        ch.port2.postMessage(0);
      }),
    close: () => {
      ch.port1.close();
      ch.port2.close();
    },
  };
}

/**
 * Runs a match and awaits 'pending' sources (worker hosts): the tick is retried after yielding to
 * the event loop; nothing is dropped (SP sim lag). Counts the waits.
 */
export async function runMatchAsync(o: RunMatchAsyncOptions): Promise<AsyncMatchResult> {
  const p = prepare(o);
  const world = p.world;
  const limit = o.maxWaitsPerTick ?? 1_000_000;
  const own = o.yieldFn === undefined ? messageChannelYield() : null;
  const yieldFn = o.yieldFn ?? own!.next;
  let pendingWaits = 0;
  let ticksWaited = 0;
  let maxWaits = 0;
  const cmds: CommandEnvelope[] = [];
  try {
    while (!world.over && world.tick < o.maxTicks) {
      const t = world.tick;
      o.onTick?.(world, t);
      if (world.over) break;
      let waits = 0;
      for (;;) {
        cmds.length = 0;
        if (collect(p.sources, t, cmds)) break;
        waits++;
        pendingWaits++;
        if (waits > limit) throw new Error(`runMatchAsync: tick ${t} still pending after ${limit} waits`);
        await yieldFn();
      }
      if (waits > 0) ticksWaited++;
      if (waits > maxWaits) maxWaits = waits;
      world.step(cmds);
      if (o.stopWhen?.(world, world.tick) === true) break;
    }
  } finally {
    own?.close();
  }
  return { ...finish(p, o.stopWhen === undefined ? o.maxTicks : Math.min(o.maxTicks, world.tick)), pendingWaits, ticksWaited, maxWaitsPerTick: maxWaits };
}

export interface ReplayResult {
  readonly world: ArenaWorld;
  readonly metrics: MatchMetrics;
  readonly hash: number;
}

/**
 * Replays a match from its setup and log: cheats of tick t before the step of t, then the logged
 * commands of t. Returns the world hash (equal to the original run for a deterministic arena).
 */
export function replayMatch(setup: ArenaWorldOptions, log: Pick<MatchLog, 'cheats' | 'commands' | 'endTick'> & Partial<Pick<MatchLog, 'endReason'>>, roles?: Readonly<Record<string, string>>): ReplayResult {
  const world = ArenaWorld.create(setup);
  const collector = new MetricsCollector(world, roles);
  world.observers.push(collector);
  let ci = 0;
  let mi = 0;
  const cheats = log.cheats;
  const commands = log.commands;
  const cmds: CommandEnvelope[] = [];
  for (let t = 0; t < log.endTick; t++) {
    while (ci < cheats.length && cheats[ci]!.tick === t) world.applyCheat(cheats[ci++]!);
    if (ci < cheats.length && cheats[ci]!.tick < t) throw new Error(`replayMatch: cheat log out of order at tick ${t}`);
    cmds.length = 0;
    while (mi < commands.length && commands[mi]!.tick === t) cmds.push(commands[mi++]!.env);
    if (mi < commands.length && commands[mi]!.tick < t) throw new Error(`replayMatch: command log out of order at tick ${t}`);
    world.step(cmds);
  }
  while (ci < cheats.length && cheats[ci]!.tick === log.endTick) world.applyCheat(cheats[ci++]!);
  if (log.endReason === 'maxTicks') world.endByTickLimit();
  const idx = world.observers.indexOf(collector);
  if (idx >= 0) world.observers.splice(idx, 1);
  return { world, metrics: collector.result(world), hash: world.hash() };
}
