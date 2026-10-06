/**
 * `step(world, commands, probe?)`: advances the world by exactly one tick (PLAN §3.1: the state
 * only changes through step). Phases run in the binding order of PLAN §3.4; MS3 runs
 * 1 CommandApply, 2 Orders, 3 PathService, 7 Movement, 8 SpatialRebuild, 15 Cleanup, 16 Output.
 *
 * Commands are applied in this step regardless of the envelope's tick field (inputDelay = 0;
 * the host stamps the application tick for recording).
 */
import { fullHash as arenaFullHash, ruleHash as arenaRuleHash } from '@faf/heap';
import { CommandBatchView, type CommandEnvelope } from '@faf/protocol';
import { commandApplyPhase } from './commands.ts';
import { HASH_INTERVAL_TICKS } from './constants.ts';
import { movementPhase } from './movement.ts';
import { ordersPhase } from './orders.ts';
import { pathServicePhase } from './pathservice.ts';
import { PhaseId, type PhaseProbe } from './phases.ts';
import { HL_LAST_HASH, HL_LAST_HASH_TICK, WH_TICK } from './schema.ts';
import { spatialRebuildPhase } from './spatial.ts';
import { cleanupPhase } from './units.ts';
import type { World } from './world.ts';

/** Commands of one step: a binary batch, a positioned batch cursor, or envelope objects. */
export type StepCommands = Uint8Array | CommandBatchView | readonly CommandEnvelope[] | null | undefined;

/** Probe that does nothing (default). */
const NO_PROBE: PhaseProbe = {
  begin(): void {},
  end(): void {},
};

function stageCommands(w: World, cmds: StepCommands): void {
  const s = w.stage;
  s.clear();
  if (cmds === null || cmds === undefined) return;
  if (cmds instanceof Uint8Array) {
    if (cmds.length === 0) return;
    w.batchView.reset(cmds);
    s.addFromView(w.batchView);
  } else if (cmds instanceof CommandBatchView) {
    s.addFromView(cmds);
  } else {
    s.addEnvelopes(cmds);
  }
}

/**
 * Advances the world by one tick. `cmds` are the commands of this tick (a CommandBatchView must
 * already be `reset()` to the batch; it is consumed). `probe.begin/end(phase)` bracket every
 * running phase; `HashTick` brackets the rule-hash computation inside Output on hash ticks.
 */
export function step(w: World, cmds?: StepCommands, probe: PhaseProbe = NO_PROBE): void {
  const h = w.header.i32;
  const tick = h[WH_TICK]! + 1;
  h[WH_TICK] = tick;

  probe.begin(PhaseId.CommandApply);
  stageCommands(w, cmds);
  commandApplyPhase(w);
  w.stage.clear();
  probe.end(PhaseId.CommandApply);

  probe.begin(PhaseId.Orders);
  ordersPhase(w);
  probe.end(PhaseId.Orders);

  probe.begin(PhaseId.PathService);
  pathServicePhase(w);
  probe.end(PhaseId.PathService);

  probe.begin(PhaseId.Movement);
  movementPhase(w);
  probe.end(PhaseId.Movement);

  probe.begin(PhaseId.SpatialRebuild);
  spatialRebuildPhase(w);
  probe.end(PhaseId.SpatialRebuild);

  probe.begin(PhaseId.Cleanup);
  cleanupPhase(w);
  probe.end(PhaseId.Cleanup);

  probe.begin(PhaseId.Output);
  if (tick % HASH_INTERVAL_TICKS === 0) {
    probe.begin(PhaseId.HashTick);
    const hash = arenaRuleHash(w.arena, w.hasher);
    probe.end(PhaseId.HashTick);
    // Written after hashing into the derived region: the next rule hash does not see it.
    w.hashLog.i32[HL_LAST_HASH_TICK] = tick;
    w.hashLog.u32[HL_LAST_HASH] = hash;
  }
  probe.end(PhaseId.Output);
}

/** Tick of the last rule hash (derived region `hashlog`; 0 = none yet). */
export function lastHashTick(w: World): number {
  return w.hashLog.i32[HL_LAST_HASH_TICK]!;
}

/** Last rule hash (derived region `hashlog`; valid if lastHashTick > 0). */
export function lastHash(w: World): number {
  return w.hashLog.u32[HL_LAST_HASH]!;
}

/** Rule hash of the current state (replay/desync check; PLAN §3.5). */
export function ruleHash(w: World): number {
  return arenaRuleHash(w.arena, w.hasher);
}

/** Full hash including derived state (spatial grids, nav caches; desync-diff and restore tests). */
export function fullHash(w: World): number {
  return arenaFullHash(w.arena, w.hasher);
}

/** Copies the dynamic arena (all state incl. derived) into `target` or a new buffer. */
export function snapshot(w: World, target?: Uint8Array): Uint8Array {
  return w.arena.snapshot(target);
}

/** Restores a snapshot taken from a world with the same layout (same blueprint table/map size). */
export function restore(w: World, bytes: Uint8Array): void {
  w.arena.restore(bytes);
}
