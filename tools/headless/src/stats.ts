/**
 * Measurement helpers of the headless tools (not simulation code: floats and clocks are fine here).
 */

/** Monotonic clock in milliseconds (performance.now in every engine). */
export type Clock = () => number;

/** Percentile summary of a sample set (milliseconds unless stated otherwise). */
export interface Summary {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export const EMPTY_SUMMARY: Summary = { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };

/** Nearest-rank percentile of an ascending sorted array (q in [0, 1]). */
export function percentileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const rank = Math.ceil(q * n);
  return sorted[Math.min(n - 1, Math.max(0, rank - 1))]!;
}

/** Summarizes the first `n` samples (default: all). Does not modify the input. */
export function summarize(samples: Float64Array, n = samples.length): Summary {
  if (n <= 0) return EMPTY_SUMMARY;
  const s = samples.slice(0, n).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i]!;
  return {
    n,
    mean: round4(sum / n),
    p50: round4(percentileSorted(s, 0.5)),
    p95: round4(percentileSorted(s, 0.95)),
    p99: round4(percentileSorted(s, 0.99)),
    max: round4(s[n - 1]!),
  };
}

/** Rounds to 4 decimals (0.1 µs for millisecond values) to keep JSON reports readable. */
export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Smallest observable step of the clock (ms). Chromium ≈ 0.005 (cross-origin isolated),
 * Firefox ≈ 0.02, WebKit 1.0, Node ≈ 0.0001.
 */
export function clockResolution(now: Clock, spins = 200_000): number {
  let last = now();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < spins; i++) {
    const t = now();
    if (t > last) {
      const d = t - last;
      if (d < min) min = d;
      last = t;
    }
  }
  return Number.isFinite(min) ? round4(Math.max(min, 0.0001)) : 1;
}

/**
 * Repetitions per measured tick so that `resolution / reps ≤ target` (1 when the clock is fine
 * enough). Coarse clocks (WebKit: 1 ms) are compensated by re-running the same tick from an arena
 * snapshot (see measureTick in tickbench/spk1).
 */
export function repsFor(resolutionMs: number, targetMs: number, maxReps = 50): number {
  if (resolutionMs <= targetMs) return 1;
  return Math.min(maxReps, Math.ceil(resolutionMs / targetMs));
}

/** Engine description attached to every result. */
export interface EngineInfo {
  /** 'node' or the Playwright project name. */
  readonly engine: string;
  readonly userAgent: string;
  readonly crossOriginIsolated: boolean;
  /** Observed clock resolution in ms. */
  readonly clockResolutionMs: number;
}
