/**
 * Tick-exact divergence search (PLAN §3.12 desync-diff: "erster abweichender Tick").
 *
 * - `firstDivergentRecordedTick` compares two recorded rule-hash trails (log/replay HASH data,
 *   every 10 ticks): it narrows a desync down to one hash interval without simulating.
 * - `findFirstDivergence` then steps two runs in lockstep from a common tick (e.g. the last
 *   keyframe before that interval) and compares the rule hash after EVERY tick — the first tick
 *   whose rule hash differs, not just the next point of the 10-tick grid. At that tick the caller
 *   takes full dumps of both sides (dump.ts / state-diff.ts).
 *
 * Environment-neutral (Node and browser worker): no node: imports.
 */

import type { HeadlessSim } from '@faf/sim-host';

/** A simulation that can be advanced tick by tick. */
export interface SteppedRun {
  /** Current tick (number of completed steps). */
  tick(): number;
  /** Advances exactly one tick. */
  step(): void;
  /** Rule hash of the current state (u32). */
  ruleHash(): number;
}

export interface DivergenceResult {
  /** First tick at which the rule hashes differ; null = equal through `toTick`. */
  readonly tick: number | null;
  /** Rule hashes of A and B at `tick` (or at `toTick` if equal). */
  readonly ruleA: number;
  readonly ruleB: number;
  /** Tick the search started at (both runs' tick on entry). */
  readonly fromTick: number;
}

/**
 * Steps `a` and `b` in lockstep up to `toTick` and returns the first tick whose rule hash
 * differs. The current state is checked first (a difference that already exists on entry is
 * reported at the entry tick). Both runs must be at the same tick; they stop at the divergent
 * tick (so the caller can dump them), or at `toTick`.
 */
export function findFirstDivergence(a: SteppedRun, b: SteppedRun, opts: { toTick: number }): DivergenceResult {
  const from = a.tick();
  if (b.tick() !== from) throw new RangeError(`findFirstDivergence: runs are at different ticks (${from} vs ${b.tick()})`);
  if (!Number.isInteger(opts.toTick) || opts.toTick < from) throw new RangeError(`findFirstDivergence: toTick ${opts.toTick} before start tick ${from}`);
  let ra = a.ruleHash() >>> 0;
  let rb = b.ruleHash() >>> 0;
  if (ra !== rb) return { tick: from, ruleA: ra, ruleB: rb, fromTick: from };
  while (a.tick() < opts.toTick) {
    a.step();
    b.step();
    const t = a.tick();
    if (b.tick() !== t) throw new Error(`findFirstDivergence: runs left lockstep (${t} vs ${b.tick()})`);
    ra = a.ruleHash() >>> 0;
    rb = b.ruleHash() >>> 0;
    if (ra !== rb) return { tick: t, ruleA: ra, ruleB: rb, fromTick: from };
  }
  return { tick: null, ruleA: ra, ruleB: rb, fromTick: from };
}

/** A recorded hash trail on a regular grid: values[k] is the hash of tick firstTick + k·interval. */
export interface RecordedTrail {
  readonly firstTick: number;
  readonly interval: number;
  readonly values: ArrayLike<number>;
}

/**
 * First tick present in both trails whose recorded hashes differ, or null. Only ticks both trails
 * cover are compared (a shorter trail — truncated log — is no divergence by itself); the grids may
 * differ (e.g. interval 10 vs 50): the common ticks are compared.
 */
export function firstDivergentRecordedTick(a: RecordedTrail, b: RecordedTrail): number | null {
  for (const t of [a, b]) {
    if (!Number.isInteger(t.interval) || t.interval < 1 || !Number.isInteger(t.firstTick) || t.firstTick < 0) {
      throw new RangeError(`firstDivergentRecordedTick: bad grid (firstTick ${t.firstTick}, interval ${t.interval})`);
    }
  }
  if (a.values.length === 0 || b.values.length === 0) return null;
  const endA = a.firstTick + (a.values.length - 1) * a.interval;
  const endB = b.firstTick + (b.values.length - 1) * b.interval;
  const end = Math.min(endA, endB);
  let ka = 0;
  let kb = 0;
  while (ka < a.values.length && kb < b.values.length) {
    const ta = a.firstTick + ka * a.interval;
    const tb = b.firstTick + kb * b.interval;
    if (ta > end || tb > end) break;
    if (ta < tb) ka++;
    else if (tb < ta) kb++;
    else {
      if (a.values[ka]! >>> 0 !== b.values[kb]! >>> 0) return ta;
      ka++;
      kb++;
    }
  }
  return null;
}

/**
 * Trail of `{tick, hash}` entries (sim-host hashTrail / ParsedCommandLog.hashes) as a
 * RecordedTrail. Throws if the ticks are not on one regular grid.
 */
export function trailFromEntries(entries: readonly { readonly tick: number; readonly hash: number }[]): RecordedTrail & { readonly values: Uint32Array } {
  const n = entries.length;
  if (n === 0) return { firstTick: 0, interval: 1, values: new Uint32Array(0) };
  const firstTick = entries[0]!.tick;
  const interval = n > 1 ? entries[1]!.tick - firstTick : 1;
  const values = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const e = entries[i]!;
    if (e.tick !== firstTick + i * interval) throw new RangeError(`trailFromEntries: tick ${e.tick} at entry ${i} is off the grid ${firstTick}+k·${interval}`);
    values[i] = e.hash >>> 0;
  }
  return { firstTick, interval: interval < 1 ? 1 : interval, values };
}

/** SteppedRun over a HeadlessSim (throws if a source is pending, which a replay never is). */
export function headlessRun(sim: HeadlessSim): SteppedRun {
  return {
    tick: () => sim.tick,
    step: () => {
      if (sim.step(1) !== 1) throw new Error(`headlessRun: tick ${sim.tick + 1} is pending`);
    },
    ruleHash: () => sim.ruleHash(),
  };
}
