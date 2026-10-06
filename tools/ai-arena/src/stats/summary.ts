/**
 * Distribution summaries for tournament and benchmark reports (nearest-rank percentiles, see
 * percentile.ts; fixed summation order). Empty inputs yield zeros with n = 0.
 */
import { mean, percentiles } from './percentile.ts';

export interface Summary {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export const EMPTY_SUMMARY: Summary = { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };

/** n, mean, p50/p95/p99 (nearest rank) and max of `values`. */
export function summarize(values: ArrayLike<number>): Summary {
  if (values.length === 0) return EMPTY_SUMMARY;
  const [p50, p95, p99, max] = percentiles(values, [50, 95, 99, 100]) as [number, number, number, number];
  return { n: values.length, mean: mean(values), p50, p95, p99, max };
}

/** Median (nearest rank, p50) or null for no values. */
export function medianOrNull(values: ArrayLike<number>): number | null {
  return values.length === 0 ? null : percentiles(values, [50])[0]!;
}

/** Share of values ≤ limit (0 for no values). */
export function shareAtMost(values: readonly (number | null)[], limit: number): number {
  if (values.length === 0) return 0;
  let k = 0;
  for (const v of values) if (v !== null && v <= limit) k++;
  return k / values.length;
}
