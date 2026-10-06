/**
 * Statistics of the FX benchmark: nearest-rank percentiles over finite samples, summaries and number
 * formatting for the German status docs (decimal comma). Pure functions (unit-tested in
 * apps/fx-lab/test/e2e/bench.test.ts).
 */

export interface Summary {
  /** Finite samples used. */
  n: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/**
 * Nearest-rank percentile (`p` in [0, 100]) of an ascending array: the smallest value such that at
 * least p % of the samples are ≤ it. Empty → NaN.
 */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[n - 1]!;
  const rank = Math.ceil((p / 100) * n);
  return sorted[Math.min(n, Math.max(1, rank)) - 1]!;
}

/** Summary of the finite values (null, NaN and ±Infinity count as missing samples). */
export function summarize(values: Iterable<number | null>): Summary {
  const xs: number[] = [];
  let sum = 0;
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) {
      xs.push(v);
      sum += v;
    }
  }
  xs.sort((a, b) => a - b);
  const n = xs.length;
  return {
    n,
    min: n > 0 ? xs[0]! : Number.NaN,
    mean: n > 0 ? sum / n : Number.NaN,
    p50: percentileSorted(xs, 50),
    p95: percentileSorted(xs, 95),
    p99: percentileSorted(xs, 99),
    max: n > 0 ? xs[n - 1]! : Number.NaN,
  };
}

/** Summary with no samples (e.g. GPU times without timer query). */
export function emptySummary(): Summary {
  return { n: 0, min: Number.NaN, mean: Number.NaN, p50: Number.NaN, p95: Number.NaN, p99: Number.NaN, max: Number.NaN };
}

/**
 * Smallest positive step between distinct sample values (clock granularity of performance.now as seen
 * in the samples). WebKit quantizes to 1 ms, cross-origin-isolated Chromium to ~5 µs. No two distinct
 * values → NaN.
 */
export function clockResolution(values: Iterable<number>): number {
  const xs = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    if (d > 1e-9 && d < best) best = d;
  }
  return Number.isFinite(best) ? best : Number.NaN;
}

/** Number with `digits` decimals and a German decimal comma; NaN → '–'. */
export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(digits).replace('.', ',');
}

/** Integer with German thousands separator (65536 → '65.536'); NaN → '–'. */
export function fmtInt(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const s = String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return v < 0 ? `−${s}` : s;
}

/** "a–b" range of several measurements (single value if equal); empty/NaN → '–'. */
export function fmtRange(values: readonly number[], digits = 2): string {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return '–';
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return fmt(lo, digits) === fmt(hi, digits) ? fmt(lo, digits) : `${fmt(lo, digits)}–${fmt(hi, digits)}`;
}
