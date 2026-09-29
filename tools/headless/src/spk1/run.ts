/**
 * SPK1 runners: deterministic hash chain (tests, cross-engine) and the per-subsystem benchmark.
 */
import { hex32 } from '../goldens.ts';
import { measureTicks } from '../measure.ts';
import type { Clock, Summary } from '../stats.ts';
import { populate, spk1Counts, spk1LastHash, spk1LastHashTick, spk1Step, SPK1_PHASE_COUNT, SPK1_PHASE_NAMES, Spk1Phase, type Spk1Counts } from './systems.ts';
import { Spk1World } from './world.ts';

export const SPK1_DEFAULT_SEED = 0x5b1c0001;

/** Creates and populates the SPK1 world (tick 0). */
export function createSpk1(seed = SPK1_DEFAULT_SEED): Spk1World {
  const w = new Spk1World(seed);
  populate(w);
  return w;
}

export interface Spk1ChainResult {
  readonly ticks: number;
  /** Rule hashes every 10 ticks (hex). */
  readonly trail: readonly string[];
  readonly counts: Spk1Counts;
}

/** Runs `ticks` ticks and collects the hash trail. */
export function runSpk1Chain(ticks: number, seed = SPK1_DEFAULT_SEED): Spk1ChainResult {
  const w = createSpk1(seed);
  const trail: string[] = [];
  for (let t = 1; t <= ticks; t++) {
    spk1Step(w);
    if (spk1LastHashTick(w) === t) trail.push(hex32(spk1LastHash(w)));
  }
  return { ticks, trail, counts: spk1Counts(w) };
}

export interface Spk1BenchOptions {
  readonly ticks: number;
  /** Untimed ramp-up ticks before the measurement (projectile pool fills up). */
  readonly rampTicks: number;
  readonly reps: number;
  readonly clock: Clock;
  readonly seed?: number;
}

export interface Spk1BenchResult {
  readonly ticks: number;
  readonly rampTicks: number;
  readonly reps: number;
  readonly total: Summary;
  readonly phases: Readonly<Record<string, Summary>>;
  /** Mean live projectiles over the measured ticks. */
  readonly meanProjectiles: number;
  readonly minProjectiles: number;
  readonly counts: Spk1Counts;
  readonly finalHash: string;
  readonly restoreMs: number;
  readonly wallMs: number;
}

export function runSpk1Bench(o: Spk1BenchOptions): Spk1BenchResult {
  const w = createSpk1(o.seed ?? SPK1_DEFAULT_SEED);
  for (let t = 0; t < o.rampTicks; t++) spk1Step(w);
  const snap = new Uint8Array(w.arena.snapshotByteLength);
  let projSum = 0;
  let projMin = Number.MAX_SAFE_INTEGER;
  const m = measureTicks(
    {
      step: (probe) => spk1Step(w, probe),
      save: () => void w.arena.snapshot(snap),
      restore: () => w.arena.restore(snap),
    },
    {
      ticks: o.ticks,
      reps: o.reps,
      clock: o.clock,
      phaseCount: SPK1_PHASE_COUNT,
      beforeTick: () => {
        const n = w.proj.count;
        projSum += n;
        if (n < projMin) projMin = n;
      },
    },
  );
  const phases: Record<string, Summary> = {};
  for (let p = 0; p < SPK1_PHASE_COUNT; p++) phases[SPK1_PHASE_NAMES[p]!] = m.phases[p]!;
  return {
    ticks: o.ticks,
    rampTicks: o.rampTicks,
    reps: o.reps,
    total: m.total,
    phases,
    meanProjectiles: Math.round(projSum / Math.max(1, o.ticks)),
    minProjectiles: projMin === Number.MAX_SAFE_INTEGER ? 0 : projMin,
    counts: spk1Counts(w),
    finalHash: hex32(spk1LastHash(w)),
    restoreMs: m.restoreMs,
    wallMs: m.wallMs,
  };
}

export { Spk1Phase };
