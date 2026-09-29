import { CommandBatchView, type CommandEnvelope } from '@faf/protocol';
import type { SimBpTable } from '@faf/blueprints';
import { createWorld, fullHash, lastHash, lastHashTick, ruleHash, step, unitHandles, type World } from '../../src/index.ts';
import { batch, killCmd, moveCmd, spawnCmd, stopCmd } from './fixtures.ts';

export type InputForm = 'batch' | 'view' | 'envelopes';

/**
 * Commands of the reference scenario "cubes-1000": 1,000 cubes (900 army 0, 100 army 1), group
 * moves at ticks 5/300/700/1100/1500, kills + respawn at 700, stop at 1500. Commands depend only
 * on the world state (handles in slot order), so every run issues identical commands.
 */
export function scenarioCommands(w: World, tick: number): CommandEnvelope[] {
  const seq = tick * 8;
  switch (tick) {
    case 1:
      return [spawnCmd(0, 900, 128, 128, 40, 0, 0, seq), spawnCmd(1, 100, 384, 384, 20, 0, 1, seq)];
    case 5:
      return [moveCmd(0, unitHandles(w, 0), 300, 200, seq)];
    case 300: {
      const a0 = unitHandles(w, 0);
      return [moveCmd(1, unitHandles(w, 1), 200, 200, seq), moveCmd(0, a0.slice(0, a0.length >> 1), 100, 400, seq + 1)];
    }
    case 700: {
      const a0 = unitHandles(w, 0);
      return [killCmd(0, a0.filter((_, i) => i % 18 === 0), seq), spawnCmd(0, 50, 256, 256, 10, 0, 0, seq + 1)];
    }
    case 1100:
      return [moveCmd(0, unitHandles(w, 0), 400, 100, seq)];
    case 1500: {
      const a0 = unitHandles(w, 0);
      return [stopCmd(0, a0.filter((_, i) => i % 3 === 0), seq), moveCmd(1, unitHandles(w, 1), 50, 50, seq)];
    }
    default:
      return [];
  }
}

const VIEW = new CommandBatchView();

/** Steps once with the commands of `tick` delivered in the given input form. */
export function stepWith(w: World, envs: readonly CommandEnvelope[], form: InputForm): void {
  if (envs.length === 0) {
    step(w, null);
    return;
  }
  if (form === 'envelopes') step(w, envs);
  else if (form === 'batch') step(w, batch(envs));
  else {
    VIEW.reset(batch(envs));
    step(w, VIEW);
  }
}

export interface RunResult {
  /** Rule hashes at ticks 10, 20, … */
  readonly chain: number[];
  readonly world: World;
}

/** Runs the reference scenario for `ticks` ticks from a fresh world. */
export function runScenario(table: SimBpTable, seed: number, ticks: number, form: InputForm = 'batch'): RunResult {
  const w = createWorld({ bpTable: table, seed, armyCount: 2 });
  return continueScenario(w, ticks, form);
}

/** Continues the scenario on `w` up to tick `untilTick`. */
export function continueScenario(w: World, untilTick: number, form: InputForm = 'batch'): RunResult {
  const chain: number[] = [];
  while (w.tick < untilTick) {
    const t = w.tick + 1;
    stepWith(w, scenarioCommands(w, t), form);
    if (lastHashTick(w) === t) chain.push(lastHash(w));
  }
  return { chain, world: w };
}

export function hashes(w: World): { rule: number; full: number } {
  return { rule: ruleHash(w), full: fullHash(w) };
}
