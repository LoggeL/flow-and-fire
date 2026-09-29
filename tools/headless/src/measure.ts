/**
 * Per-tick timing with optional repetition (tools only). With `reps > 1` every tick is executed
 * `reps` times from an arena snapshot (restore between repetitions) and the time is divided by
 * `reps`; the restore cost is measured separately and subtracted. This compensates coarse clocks
 * (WebKit workers: 1 ms) without changing the simulated result: after the last repetition the
 * world is in exactly the state of a single step.
 */
import { summarize, type Clock, type Summary } from './stats.ts';

export interface PhaseProbeLike {
  begin(phase: number): void;
  end(phase: number): void;
}

export interface TickTarget {
  /** Executes one tick; phases are reported through `probe`. */
  step(probe: PhaseProbeLike): void;
  /** Saves the state before a tick (reps > 1 only). */
  save(): void;
  /** Restores the saved state (reps > 1 only). */
  restore(): void;
}

export interface MeasureOptions {
  readonly ticks: number;
  readonly reps: number;
  readonly clock: Clock;
  /** Phase ids are 0 … phaseCount − 1. */
  readonly phaseCount: number;
  /** Called before each measured tick (untimed), e.g. to prepare commands. */
  readonly beforeTick?: (i: number) => void;
}

export interface MeasureResult {
  readonly total: Summary;
  /** Per phase id: summary over the ticks in which the phase ran (empty summary if never). */
  readonly phases: readonly Summary[];
  /** Mean restore cost that was subtracted per repetition (ms). */
  readonly restoreMs: number;
  /** Wall time of the whole measurement loop (ms). */
  readonly wallMs: number;
}

/** Measures the mean cost of `restore` with enough iterations to beat the clock resolution. */
export function measureRestore(target: TickTarget, clock: Clock, minMs: number): number {
  target.save();
  let n = 0;
  const t0 = clock();
  let t = t0;
  while (n < 20 || t - t0 < minMs) {
    target.restore();
    n++;
    t = clock();
  }
  return (t - t0) / n;
}

export function measureTicks(target: TickTarget, o: MeasureOptions): MeasureResult {
  const { ticks, reps, clock, phaseCount } = o;
  const total = new Float64Array(ticks);
  const phaseSamples: Float64Array[] = [];
  const phaseN = new Int32Array(phaseCount);
  for (let p = 0; p < phaseCount; p++) phaseSamples.push(new Float64Array(ticks));
  const acc = new Float64Array(phaseCount);
  const ran = new Uint8Array(phaseCount);
  const t0 = new Float64Array(phaseCount);
  const probe: PhaseProbeLike = {
    begin(p) {
      t0[p] = clock();
    },
    end(p) {
      acc[p] = acc[p]! + (clock() - t0[p]!);
      ran[p] = 1;
    },
  };
  const restoreMs = reps > 1 ? measureRestore(target, clock, 20) : 0;
  const wall0 = clock();
  for (let i = 0; i < ticks; i++) {
    o.beforeTick?.(i);
    acc.fill(0);
    ran.fill(0);
    let dt: number;
    if (reps <= 1) {
      const s = clock();
      target.step(probe);
      dt = clock() - s;
    } else {
      target.save();
      const s = clock();
      for (let r = 0; r < reps; r++) {
        if (r > 0) target.restore();
        target.step(probe);
      }
      dt = Math.max(0, (clock() - s - (reps - 1) * restoreMs) / reps);
    }
    total[i] = dt;
    for (let p = 0; p < phaseCount; p++) {
      if (ran[p] === 1) phaseSamples[p]![phaseN[p]!++] = acc[p]! / Math.max(1, reps);
    }
  }
  const wallMs = clock() - wall0;
  return {
    total: summarize(total),
    phases: phaseSamples.map((s, p) => summarize(s, phaseN[p]!)),
    restoreMs,
    wallMs,
  };
}
