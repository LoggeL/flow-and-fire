/**
 * Tick benchmark (L6): 1,000 cubes that keep driving (a rotating group of 50 gets a new target
 * every tick), p50/p95/p99 of the whole sim tick, each active phase and the hash tick.
 * MS1: flat test plane (spawn disc r 120 around the centre, targets in [32, 480)²).
 * MS2: with `map` (hollow-ridge): targets in [40, 200)², all on the NW side of the river — the
 * cubes drive over the plateau ramps, the lowland and the mesa, so every position update samples
 * the heightmap and runs the passability rule. MS3: spawn disc r 20 around (100, 100) on the
 * plateau (no rejected points), every group order is pathed (HPA*, offsets).
 */
import { asArmyId, asTick, fx, rng32, type Handle } from '@faf/fixed';
import { createTestPlaneMap, mapSimData, readRtsMap, type RtsMap, TEST_PLANE_MAP_NAME } from '@faf/formats';
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
  /** Map (.rtsmap bytes or parsed); missing = MS1 test plane. */
  readonly map?: Uint8Array | RtsMap;
  readonly ticks: number;
  readonly reps: number;
  readonly clock: Clock;
  readonly seed?: number;
}

export interface TickBenchResult {
  /** META name of the bench map ('testplane' for the generated test plane). */
  readonly map: string;
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

/** Spawn disc and target square (WU) of a bench world. */
interface BenchArea {
  readonly cx: number;
  readonly cz: number;
  readonly spread: number;
  readonly min: number;
  readonly span: number;
}
const PLANE_AREA: BenchArea = { cx: 256, cz: 256, spread: 120, min: 32, span: 448 };
// MS3: the spawn disc stays on the NW plateau (no cliff cells: all 1,000 spawned); the targets
// cover the NW side of the river (plateau, ramps, lowland, mesa) — every move is pathed.
const RIDGE_AREA: BenchArea = { cx: 100, cz: 100, spread: 20, min: 40, span: 160 };

export function runTickBench(o: TickBenchOptions): TickBenchResult {
  const seed = o.seed ?? 0x7b0000c1;
  const map = o.map === undefined ? createTestPlaneMap() : o.map instanceof Uint8Array ? readRtsMap(o.map) : o.map;
  // Spawn/target area per bench map (the open plane vs. the NW side of hollow-ridge's river).
  const area = map.meta.name === TEST_PLANE_MAP_NAME ? PLANE_AREA : RIDGE_AREA;
  const w = createWorld({ simBin: o.simBin, seed, armyCount: 2, map: mapSimData(map) });
  const enc = new CommandBatchEncoder(1 << 12);
  enc.add({
    tick: asTick(1),
    army: asArmyId(0),
    seq: 0,
    op: Op.Cheat,
    flags: 0,
    units: [],
    payload: encodeCheatSpawn({ bp: w.bp.indexOf('core:cube'), army: 0, count: TICKBENCH_UNITS, x: fx(area.cx), z: fx(area.cz), spread: fx(area.spread) }),
  });
  step(w, enc.view());
  const handles = unitHandles(w, 0);
  const groups = Math.ceil(handles.length / TICKBENCH_GROUP);
  const groupUnits = Array.from({ length: groups }, (_, g) => handles.slice(g * TICKBENCH_GROUP, (g + 1) * TICKBENCH_GROUP));
  // Every group gets an initial target so all cubes drive from the first measured tick on.
  enc.reset();
  let seq = 1;
  for (let g = 0; g < groups; g++) enc.add(moveEnv(2, seq++, groupUnits[g]!, seed, g, area));
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
        enc.add(moveEnv(tick, seq, groupUnits[g]!, seed, tick, area));
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
    map: map.meta.name,
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

function moveEnv(tick: number, seq: number, units: readonly Handle[], seed: number, salt: number, area: BenchArea): CommandEnvelope {
  const r = rng32(seed, tick, salt, SALT_TARGET);
  const x = area.min + ((r & 0xffff) % area.span);
  const z = area.min + ((r >>> 16) % area.span);
  return { tick: asTick(tick), army: asArmyId(0), seq, op: Op.Move, flags: 0, units, payload: encodeMove({ x: fx(x), y: fx(0), z: fx(z) }) };
}
