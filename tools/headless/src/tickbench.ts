/**
 * MS1 tick benchmark (L6): 1,000 cubes that keep driving (a rotating group of 50 gets a new
 * target every tick), p50/p95/p99 of the whole sim tick, each active phase and the hash tick.
 */
import { asArmyId, asTick, fx, rng32, type Handle } from '@faf/fixed';
import { CommandBatchEncoder, encodeCheatSpawn, encodeMove, Op, type CommandEnvelope } from '@faf/protocol';
import {
  ACTIVE_PHASES,
  createWorld,
  lastHash,
  PHASE_ID_COUNT,
  PHASE_NAMES,
  PhaseId,
  restore,
  snapshot,
  step,
  unitHandles,
  unitInfo,
} from '@faf/sim';
import { hex32 } from './goldens.ts';
import { measureTicks } from './measure.ts';
import type { Clock, Summary } from './stats.ts';

export const TICKBENCH_UNITS = 1000;
export const TICKBENCH_GROUP = 50;
const SALT_TARGET = 0x54424e54; // 'TBNT'

export interface TickBenchOptions {
  readonly simBin: Uint8Array;
  readonly ticks: number;
  readonly reps: number;
  readonly clock: Clock;
  readonly seed?: number;
}

export interface TickBenchResult {
  readonly units: number;
  readonly ticks: number;
  readonly reps: number;
  /** Whole `step` including CommandApply and the hash tick. */
  readonly total: Summary;
  readonly phases: Readonly<Record<string, Summary>>;
  /** Rule-hash computation on hash ticks only (nested in Output). */
  readonly hashTick: Summary;
  readonly movingAtEnd: number;
  readonly finalHash: string;
  readonly restoreMs: number;
  readonly wallMs: number;
}

export function runTickBench(o: TickBenchOptions): TickBenchResult {
  const seed = o.seed ?? 0x7b0000c1;
  const w = createWorld({ simBin: o.simBin, seed, armyCount: 2 });
  const enc = new CommandBatchEncoder(1 << 12);
  enc.add({
    tick: asTick(1),
    army: asArmyId(0),
    seq: 0,
    op: Op.Cheat,
    flags: 0,
    units: [],
    payload: encodeCheatSpawn({ bp: w.bp.indexOf('core:cube'), army: 0, count: TICKBENCH_UNITS, x: fx(256), z: fx(256), spread: fx(120) }),
  });
  step(w, enc.view());
  const handles = unitHandles(w, 0);
  const groups = Math.ceil(handles.length / TICKBENCH_GROUP);
  const groupUnits = Array.from({ length: groups }, (_, g) => handles.slice(g * TICKBENCH_GROUP, (g + 1) * TICKBENCH_GROUP));
  // Every group gets an initial target so all cubes drive from the first measured tick on.
  enc.reset();
  let seq = 1;
  for (let g = 0; g < groups; g++) enc.add(moveEnv(2, seq++, groupUnits[g]!, seed, g));
  step(w, enc.view());

  const snap = new Uint8Array(w.snapshotByteLength);
  let batch: Uint8Array | null = null;
  const m = measureTicks(
    {
      step: (probe) => step(w, batch, probe),
      save: () => void snapshot(w, snap),
      restore: () => restore(w, snap),
    },
    {
      ticks: o.ticks,
      reps: o.reps,
      clock: o.clock,
      phaseCount: PHASE_ID_COUNT,
      beforeTick: () => {
        const tick = w.tick + 1;
        const g = tick % groups;
        enc.reset();
        enc.add(moveEnv(tick, seq, groupUnits[g]!, seed, tick));
        seq = (seq + 1) & 0xffff;
        batch = enc.view();
      },
    },
  );
  const phases: Record<string, Summary> = {};
  for (const p of ACTIVE_PHASES) phases[PHASE_NAMES[p]!] = m.phases[p]!;
  let moving = 0;
  for (const h of handles) if (unitInfo(w, h)?.moving === true) moving++;
  return {
    units: handles.length,
    ticks: o.ticks,
    reps: o.reps,
    total: m.total,
    phases,
    hashTick: m.phases[PhaseId.HashTick]!,
    movingAtEnd: moving,
    finalHash: hex32(lastHash(w)),
    restoreMs: m.restoreMs,
    wallMs: m.wallMs,
  };
}

function moveEnv(tick: number, seq: number, units: readonly Handle[], seed: number, salt: number): CommandEnvelope {
  const r = rng32(seed, tick, salt, SALT_TARGET);
  const x = 32 + ((r & 0xffff) % 448);
  const z = 32 + ((r >>> 16) % 448);
  return { tick: asTick(tick), army: asArmyId(0), seq, op: Op.Move, flags: 0, units, payload: encodeMove({ x: fx(x), y: fx(0), z: fx(z) }) };
}
