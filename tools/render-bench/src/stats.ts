/**
 * Statistics of the benchmark (page and Node script share them): percentiles by nearest rank on the
 * sorted finite samples, summaries and range formatting for the docs.
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

/** Summary of the finite values among `values[0..count)` (NaN/±Infinity = missing sample). */
export function summarize(values: ArrayLike<number>, count = values.length): Summary {
  const xs: number[] = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) {
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

/** Number with `digits` decimals and a German decimal comma; NaN → '–'. */
export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(digits).replace('.', ',');
}

/** "a–b" range of several measurements (single value if equal); empty/NaN → '–'. */
export function fmtRange(values: readonly number[], digits = 2): string {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return '–';
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return fmt(lo, digits) === fmt(hi, digits) ? fmt(lo, digits) : `${fmt(lo, digits)}–${fmt(hi, digits)}`;
}

/** Growable Float64 sample buffer without per-sample allocation. */
export class Samples {
  data: Float64Array;
  length = 0;
  constructor(capacity = 2048) {
    this.data = new Float64Array(capacity);
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  /** Sets sample i (grows with NaN holes if needed). */
  set(i: number, v: number): void {
    while (i >= this.data.length) {
      const next = new Float64Array(this.data.length * 2).fill(Number.NaN);
      next.set(this.data);
      this.data = next;
    }
    this.data[i] = v;
    if (i >= this.length) this.length = i + 1;
  }
  summary(): Summary {
    return summarize(this.data, this.length);
  }
  clear(): void {
    this.length = 0;
  }
}
