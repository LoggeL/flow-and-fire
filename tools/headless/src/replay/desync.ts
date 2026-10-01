/** Compare recording hashes and reconstruct the first differing simulation tick. */
import { readAllCommands } from '@faf/formats';
import { ReplayCompatError, type ReplayPlayer } from '@faf/sim-host';
import { captureStateDump } from './dump.ts';
import { firstDivergentRecordedTick, findFirstDivergence, type SteppedRun } from './divergence.ts';
import { diffStateDumps, type StateDiff } from './state-diff.ts';
import { openReplayFile, type ReplayAssets } from './verify.ts';
export interface ReplayPerturbation { readonly tick: number; readonly region: string; readonly column: string; readonly index: number; readonly value: number; }
export interface DesyncResult {
  readonly status: 'equal' | 'explained' | 'recorded-only'; readonly tick: number | null;
  readonly firstRecordedTick: number | null; readonly firstCommandTick: number | null;
  readonly ruleA: number; readonly ruleB: number; readonly diff: StateDiff | null;
}
function perturb(player: ReplayPlayer, p: ReplayPerturbation): void {
  const world = player.world;
  const tables = { units: world.units.col, movers: world.movers.col, formations: world.formations.col, armies: world.armies.col };
  if (!Object.hasOwn(tables, p.region)) throw new RangeError(`unsupported perturbation table ${p.region}`);
  const columns = tables[p.region as keyof typeof tables] as unknown as Record<string, { readonly length: number; [key: number]: number }>;
  const column = Object.hasOwn(columns, p.column) ? columns[p.column] : undefined;
  if (column === undefined || !Number.isInteger(p.index) || p.index < 0 || p.index >= column.length || !Number.isSafeInteger(p.value)) throw new RangeError('invalid perturbation column/index/value');
  column[p.index] = p.value;
}
function firstCommandDifference(a: ReplayPlayer, b: ReplayPlayer): number | null {
  const ac = readAllCommands(a.replay), bc = readAllCommands(b.replay), n = Math.max(ac.length, bc.length);
  for (let i = 0; i < n; i++) {
    const x = ac[i], y = bc[i];
    if (x === undefined) return y!.tick; if (y === undefined) return x.tick;
    if (x.tick !== y.tick) return Math.min(x.tick, y.tick);
    if (x.batch.length !== y.batch.length || x.batch.some((v, j) => v !== y.batch[j])) return x.tick;
  }
  return null;
}
export function desyncDiff(aBytes: Uint8Array, bBytes: Uint8Array, assets: ReplayAssets, options: { readonly perturbB?: ReplayPerturbation } = {}): DesyncResult {
  const a = openReplayFile(aBytes, assets), b = openReplayFile(bBytes, assets);
  if (a.sim.simId !== b.sim.simId || a.world.layoutHash !== b.world.layoutHash || a.replay.game.seed !== b.replay.game.seed || a.world.armyCount !== b.world.armyCount)
    throw new ReplayCompatError('Replay session identities differ', b.replay.head.buildHash);
  const trail = (p: ReplayPlayer) => ({ firstTick: p.replay.hashes.firstTick, interval: p.replay.hashes.interval, values: p.replay.hashes.hashes });
  const firstRecordedTick = firstDivergentRecordedTick(trail(a), trail(b)), firstCommandTick = firstCommandDifference(a, b);
  const p = options.perturbB;
  if (p !== undefined && (!Number.isInteger(p.tick) || p.tick < 0 || p.tick > Math.min(a.endTick, b.endTick))) throw new RangeError('perturbation tick outside shared timeline');
  if (p?.tick === 0) perturb(b, p);
  const run = (player: ReplayPlayer, isB: boolean): SteppedRun => ({ tick: () => player.tick, ruleHash: () => player.ruleHash(), step: () => {
    player.step(); if (isB && p?.tick === player.tick) perturb(player, p);
  } });
  // Fresh players share their tick-zero keyframe. Compare every subsequent tick so a divergence
  // that disappears between stored hash ticks cannot be hidden by a matching recorded prefix.
  const found = findFirstDivergence(run(a, false), run(b, true), { toTick: Math.min(a.endTick, b.endTick) });
  const diff = found.tick === null ? null : diffStateDumps(captureStateDump(a.world, { label: 'A', simId: a.sim.simId }), captureStateDump(b.world, { label: 'B', simId: b.sim.simId }), { includeDerived: false });
  return { status: found.tick !== null ? 'explained' : firstRecordedTick !== null ? 'recorded-only' : 'equal', tick: found.tick,
    firstRecordedTick, firstCommandTick, ruleA: found.ruleA, ruleB: found.ruleB, diff };
}
