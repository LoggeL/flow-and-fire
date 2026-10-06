/**
 * The only wall-clock access of @faf/ai (ai.md §2.3 "Notabbruch", §2.5): the AI host measures the
 * duration of a think to abort it at the emergency limit. Decisions never read the clock; a clock
 * only decides whether a think is cut short (the result then carries `aborted` and an `aiTimeout`
 * mark). The clock is injectable so tests (AI-DET-04) and benchmarks control it.
 */

/** Monotonic milliseconds (origin arbitrary). */
export interface AiClock {
  now(): number;
}

/** Emergency limit of one think in ms (ai.md §2.3, PLAN §3.10): browser 40 ms, headless 200 ms. */
export const AI_TIMEOUT_MS = {
  browser: 40,
  headless: 200,
} as const;

export type AiHostEnv = keyof typeof AI_TIMEOUT_MS;

interface MonotonicNow {
  now(): number;
}

function globalNow(): MonotonicNow | undefined {
  return (globalThis as { performance?: MonotonicNow }).performance;
}

/**
 * Default clock: `globalThis.performance.now()` (browser worker, Node ≥ 16). Without it the clock
 * stands still at 0 and a think is never aborted.
 */
export const systemClock: AiClock = {
  now(): number {
    const p = globalNow();
    return p === undefined ? 0 : p.now();
  },
};

/** Manually advanced clock for tests: time only moves through `advance`/`set`. */
export class ManualClock implements AiClock {
  private t: number;

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (!(ms >= 0)) throw new RangeError(`ManualClock.advance: ms must be >= 0 (${ms})`);
    this.t += ms;
  }

  set(ms: number): void {
    this.t = ms;
  }
}
