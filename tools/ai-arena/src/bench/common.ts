/**
 * Shared helpers of the benchmarks: AI sides for a world, a placement frame between the two
 * starts, step loops with per-tick wall time, and a timed replay (the same world trajectory without
 * any AI work — "Sim ohne KI").
 */
import { asTick } from '@faf/fixed';
import type { Difficulty } from '@faf/ai';
import type { CommandEnvelope } from '@faf/protocol';
import type { MatchLog } from '../match/run.ts';
import { ArenaWorld } from '../world/world.ts';
import { DEFAULT_BRAIN_SPEC, loadBrainFactory } from '../host-node/brain-spec.ts';
import { createAiSide, type AiSide, type HostKind } from '../host-node/sides.ts';
import { wallNow } from './clock.ts';

/** Placement frame: f along start(army) → start(enemy), s lateral (WU). */
export function startFrame(world: ArenaWorld, army: number, enemy: number): (f: number, s: number) => { x: number; z: number } {
  const a = world.startOf(army);
  const b = world.startOf(enemy);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  const fx = dx / l;
  const fz = dz / l;
  return (f, s) => ({ x: a.x + fx * f - fz * s, z: a.z + fz * f + fx * s });
}

/** Straight distance between the starts of two armies (WU). */
export function startDistance(world: ArenaWorld, a: number, b: number): number {
  const p = world.startOf(a);
  const q = world.startOf(b);
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function setonsDuel(seed: number, map = 'setons'): ArenaWorld {
  return ArenaWorld.create({ map, seed, armies: [{ army: 0, startIndex: 0 }, { army: 1, startIndex: 1 }] });
}

/** Two AI sides (armies 0 and 1) of the same profile. */
export async function aiSides(world: ArenaWorld, profile: Difficulty, host: HostKind, brainSpec: string = DEFAULT_BRAIN_SPEC): Promise<AiSide[]> {
  const factory = host === 'sync' ? await loadBrainFactory(brainSpec) : undefined;
  return [0, 1].map((army) =>
    createAiSide(world, { army, profile, host, brainSpec, ...(factory !== undefined ? { brainFactory: factory } : {}) }),
  );
}

export interface SyncRun {
  /** Wall ms of world.step per tick (without AI thinks). */
  readonly stepMs: number[];
  /** Wall ms of the whole loop (thinks + perception + steps). */
  readonly totalMs: number;
  readonly ticks: number;
}

/** Steps `world` for `ticks` ticks with synchronous sources (never 'pending'). */
export function runSyncLoop(world: ArenaWorld, sides: readonly AiSide[], ticks: number, onTick?: (w: ArenaWorld, t: number) => void): SyncRun {
  const stepMs: number[] = [];
  const cmds: CommandEnvelope[] = [];
  const end = world.tick + ticks;
  const t0 = wallNow();
  while (!world.over && world.tick < end) {
    const t = world.tick;
    onTick?.(world, t);
    cmds.length = 0;
    for (const s of sides) {
      const r = s.source.commandsFor(asTick(t));
      if (r === 'pending') throw new Error(`bench: sync source of army ${s.army} answered 'pending' at tick ${t}`);
      for (const e of r) cmds.push(e);
    }
    const a = wallNow();
    world.step(cmds);
    stepMs.push(wallNow() - a);
  }
  return { stepMs, totalMs: wallNow() - t0, ticks: stepMs.length };
}

export interface ReplayRun {
  readonly stepMs: number[];
  readonly totalMs: number;
  readonly hash: number;
}

/** Replays a log (cheats + commands) and times every step: the same trajectory without AI. */
export function timedReplay(log: Pick<MatchLog, 'setup' | 'cheats' | 'commands' | 'endTick'>): ReplayRun {
  const world = ArenaWorld.create(log.setup);
  const stepMs: number[] = [];
  const cmds: CommandEnvelope[] = [];
  let ci = 0;
  let mi = 0;
  const t0 = wallNow();
  for (let t = 0; t < log.endTick; t++) {
    while (ci < log.cheats.length && log.cheats[ci]!.tick === t) world.applyCheat(log.cheats[ci++]!);
    cmds.length = 0;
    while (mi < log.commands.length && log.commands[mi]!.tick === t) cmds.push(log.commands[mi++]!.env);
    const a = wallNow();
    world.step(cmds);
    stepMs.push(wallNow() - a);
  }
  return { stepMs, totalMs: wallNow() - t0, hash: world.hash() };
}

/** Replay log of a world run by a bench loop. */
export function logOf(world: ArenaWorld): Pick<MatchLog, 'setup' | 'cheats' | 'commands' | 'endTick'> {
  return { setup: world.setup, cheats: world.cheatLog.slice(), commands: world.commandLog.slice(), endTick: world.tick };
}
