/**
 * Deterministic percentile (nearest-rank method).
 *
 * Definition: sort the values ascending (total numeric comparator; −0 and +0 compare equal and keep
 * their input order because the sort is stable), N = count, rank = ⌈pct · N / 100⌉ clamped to
 * [1, N]; the result is the value at position rank (1-based). pct is a percentage in [0, 100]
 * (e.g. 95 for p95), so for integer pct the rank is computed exactly. pct = 0 yields the minimum,
 * pct = 100 the maximum. The result is always one of the input values (no interpolation).
 */
export function percentile(values: ArrayLike<number>, pct: number): number {
  return pickRank(sortedCopy(values), pct);
}

/** Several percentiles of the same values with a single sort (same definition as `percentile`). */
export function percentiles(values: ArrayLike<number>, pcts: readonly number[]): number[] {
  const sorted = sortedCopy(values);
  return pcts.map((p) => pickRank(sorted, p));
}

function sortedCopy(values: ArrayLike<number>): number[] {
  const n = values.length;
  if (n === 0) throw new RangeError('percentile: no values');
  const sorted: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    if (Number.isNaN(v)) throw new RangeError(`percentile: NaN at index ${i}`);
    sorted.push(v);
  }
  sorted.sort(compareNumbers);
  return sorted;
}

function pickRank(sorted: readonly number[], pct: number): number {
  if (!(pct >= 0 && pct <= 100)) throw new RangeError(`percentile: pct must be in [0, 100] (${pct})`);
  const n = sorted.length;
  let rank = Math.ceil((pct * n) / 100);
  if (rank < 1) rank = 1;
  if (rank > n) rank = n;
  return sorted[rank - 1] as number;
}

/** Total ascending comparator for non-NaN numbers. */
export function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Arithmetic mean with a fixed left-to-right summation order (0 for an empty list). */
export function mean(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += values[i] as number;
  return s / n;
}
