/**
 * MS3 scenario 5 (harness job `ms3Load`, all engines): 1,000 blueprint tanks (classes 1–3, two
 * armies) keep driving across hollow-ridge with HPA* pathing — 10 groups of 100, one group gets a
 * new cross-map target every 20 ticks (every third order queued with Shift). Measured: the whole
 * sim tick incl. the hash tick (MS3 budget p95 ≤ 8 ms in the slowest engine), each phase
 * (PathService, Movement, SpatialRebuild separately) and the hash tick; plus the load that was
 * actually simulated (moving units, path requests) and the final rule hash (must be identical in
 * every engine and JIT mode: same commands, same state).
 *
 * Runs in Node and in the harness module worker (no Node APIs here).
 */
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { mapSimData, readRtsMap, type RtsMap } from '@faf/formats';
import { CmdFlags, CommandBatchEncoder, encodeCheatSpawn, encodeMove, Op } from '@faf/protocol';
import {
  ACTIVE_PHASES,
  createWorld,
  lastHash,
  MoverState,
  PHASE_ID_COUNT,
  PHASE_NAMES,
  PhaseId,
  restore,
  snapshot,
  step,
  unitHandles,
  WH_STUCK_GIVEUPS,
} from '@faf/sim';
import { hex32 } from '../goldens.ts';
import { measureTicks } from '../measure.ts';
import type { Clock, Summary } from '../stats.ts';

export interface Ms3LoadOptions {
  readonly simBin: Uint8Array;
  readonly map: Uint8Array | RtsMap;
  /** Measured ticks. */
  readonly ticks: number;
  /** Unmeasured ticks after the initial orders (paths served, everyone under way). */
  readonly rampTicks: number;
  readonly reps: number;
  readonly clock: Clock;
  readonly seed?: number;
}

export interface Ms3LoadResult {
  readonly map: string;
  readonly units: number;
  readonly ticks: number;
  readonly rampTicks: number;
  readonly reps: number;
  /** Whole `step` incl. CommandApply and the hash tick. */
  readonly total: Summary;
  readonly phases: Readonly<Record<string, Summary>>;
  readonly hashTick: Summary;
  /** Mean number of moving units (sampled every 50 measured ticks) and the minimum sample. */
  readonly movingMean: number;
  readonly movingMin: number;
  readonly requestsIssued: number;
  readonly expansionsTotal: number;
  readonly stuckGiveUps: number;
  readonly finalHash: string;
  readonly restoreMs: number;
  readonly wallMs: number;
}

/** Cross-map targets (hollow-ridge: plateaus, lowland, mesas, both fords). */
const TARGETS: readonly (readonly [number, number])[] = [
  [402, 402],
  [110, 110],
  [150, 380],
  [380, 150],
  [256, 120],
  [120, 256],
  [300, 330],
  [200, 180],
  [356, 156],
  [156, 356],
];

export const MS3_LOAD_UNITS = 1000;

export function runMs3Load(o: Ms3LoadOptions): Ms3LoadResult {
  const map = o.map instanceof Uint8Array ? readRtsMap(o.map) : o.map;
  const w = createWorld({ simBin: o.simBin, seed: o.seed ?? 0x3a115005, armyCount: 2, map: mapSimData(map) });
  const bp = (id: string): number => {
    const i = w.bp.indexOf(id);
    if (i < 0) throw new RangeError(`unknown blueprint '${id}'`);
    return i;
  };
  const t1 = bp('core:lnd_t1_tank');
  const t2 = bp('core:lnd_t2_tank');
  const t3 = bp('core:lnd_t3_heavy');
  const enc = new CommandBatchEncoder(1 << 14);
  const seqs = [0, 0];
  const cmd = (army: number): { tick: ReturnType<typeof asTick>; army: ReturnType<typeof asArmyId>; seq: number } => {
    seqs[army] = (seqs[army]! + 1) & 0xffff;
    return { tick: asTick(w.tick + 1), army: asArmyId(army), seq: seqs[army]! };
  };
  // Spawn discs on both start plateaus (no cliff cells: every point accepted).
  const spawnAt = [
    [100, 100],
    [412, 412],
  ] as const;
  for (let a = 0; a < 2; a++) {
    for (const [b, n] of [
      [t1, 300],
      [t2, 150],
      [t3, 50],
    ] as const) {
      enc.add({ ...cmd(a), op: Op.Cheat, flags: 0, units: [], payload: encodeCheatSpawn({ bp: b, army: a, count: n, x: fx(spawnAt[a]![0]), z: fx(spawnAt[a]![1]), spread: fx(20) }) });
    }
  }
  step(w, enc.view());
  // Groups of 100 with mixed classes (every 5th handle of an army).
  const groups: { army: number; units: Handle[] }[] = [];
  for (let a = 0; a < 2; a++) {
    const hs = unitHandles(w, a);
    for (let g = 0; g < 5; g++) groups.push({ army: a, units: hs.filter((_, i) => i % 5 === g) });
  }
  const units = unitHandles(w).length;
  const move = (g: { army: number; units: Handle[] }, x: number, z: number, queue: boolean): void => {
    enc.add({ ...cmd(g.army), op: Op.Move, flags: queue ? CmdFlags.Queue : 0, units: g.units, payload: encodeMove({ x: fx(x), y: fx(0), z: fx(z) }) });
  };
  enc.reset();
  groups.forEach((g, i) => {
    const [x, z] = TARGETS[(i * 3 + 1) % TARGETS.length]!;
    move(g, x, z, false);
  });
  step(w, enc.view());
  let k = 0;
  /** Commands of the next tick (every 20 ticks one group gets a new target). */
  const prepare = (): Uint8Array | null => {
    if ((w.tick + 1) % 20 !== 0) return null;
    const g = groups[k % groups.length]!;
    const [x, z] = TARGETS[(k * 7 + Math.floor(k / groups.length) * 3 + 3) % TARGETS.length]!;
    enc.reset();
    move(g, x, z, k % 3 === 2);
    k++;
    return enc.view();
  };
  for (let t = 0; t < o.rampTicks; t++) step(w, prepare());
  const req0 = w.nav.requestsIssued;
  const exp0 = w.nav.expansionsTotal;
  const give0 = w.header.i32[WH_STUCK_GIVEUPS]!;
  const snap = new Uint8Array(w.snapshotByteLength);
  let batch: Uint8Array | null = null;
  let movingSum = 0;
  let movingN = 0;
  let movingMin = Infinity;
  const countMoving = (): number => {
    const M = w.movers.col;
    let n = 0;
    for (let r = 0; r < w.movers.count; r++) if (M.state[r] !== MoverState.Idle && M.speed[r]! > 0) n++;
    return n;
  };
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
      beforeTick: (i) => {
        if (i % 50 === 0) {
          const n = countMoving();
          movingSum += n;
          movingN++;
          if (n < movingMin) movingMin = n;
        }
        batch = prepare();
      },
    },
  );
  const phases: Record<string, Summary> = {};
  for (const p of ACTIVE_PHASES) phases[PHASE_NAMES[p]!] = m.phases[p]!;
  return {
    map: map.meta.name,
    units,
    ticks: o.ticks,
    rampTicks: o.rampTicks,
    reps: o.reps,
    total: m.total,
    phases,
    hashTick: m.phases[PhaseId.HashTick]!,
    movingMean: movingN > 0 ? Math.round(movingSum / movingN) : 0,
    movingMin: Number.isFinite(movingMin) ? movingMin : 0,
    requestsIssued: w.nav.requestsIssued - req0,
    expansionsTotal: w.nav.expansionsTotal - exp0,
    stuckGiveUps: w.header.i32[WH_STUCK_GIVEUPS]! - give0,
    finalHash: hex32(lastHash(w)),
    restoreMs: m.restoreMs,
    wallMs: m.wallMs,
  };
}
