/**
 * Tournament statistics (ai.md §7.1, PLAN §3.12 "KI-Qualität").
 *
 * - Win rate p̂ = (wins + 0.5 · draws) / n; gate = lower bound of the 95 % Wilson interval (z = 1.96).
 * - Elo difference 400 · log10(p̂ / (1 − p̂)) is a report figure only, never a gate. `Math.log10` is
 *   allowed exactly here (determinism-guard allowlist for tools/ai-arena/src/stats/**): no decision
 *   ever depends on it.
 */

/** z for a two-sided 95 % interval. */
export const Z95 = 1.96;

export interface WilsonInterval {
  /** Point estimate successes / n. */
  readonly p: number;
  readonly lo: number;
  readonly hi: number;
}

/** Tally of one contestant's games; draws (45-min time limit) count 0.5 (ai.md §7.1). */
export interface GameTally {
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
}

/** Successes of a tally: wins + 0.5 · draws. */
export function successesOf(t: GameTally): number {
  return t.wins + t.draws * 0.5;
}

/**
 * Wilson score interval for `successes` out of `n` (successes may be a multiple of 0.5 because of
 * draws). n = 0 yields the uninformative interval [0, 1].
 */
export function wilson(successes: number, n: number, z: number = Z95): WilsonInterval {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`wilson: n must be a non-negative integer (${n})`);
  if (!(successes >= 0) || successes > n) throw new RangeError(`wilson: successes must be in [0, n] (${successes}, n = ${n})`);
  if (n === 0) return { p: 0, lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lo = center - half;
  const hi = center + half;
  return { p, lo: lo < 0 ? 0 : lo, hi: hi > 1 ? 1 : hi };
}

/** Wilson interval of a win/draw/loss tally. */
export function wilsonOf(t: GameTally, z: number = Z95): WilsonInterval {
  return wilson(successesOf(t), t.wins + t.draws + t.losses, z);
}

/** Clamp range of p for the Elo report figure. */
export const ELO_P_MIN = 0.001;
export const ELO_P_MAX = 0.999;

/** Elo difference 400 · log10(p / (1 − p)), p clamped to [0.001, 0.999] (report figure only). */
export function eloDiff(p: number): number {
  if (Number.isNaN(p)) throw new RangeError('eloDiff: p is NaN');
  const c = p < ELO_P_MIN ? ELO_P_MIN : p > ELO_P_MAX ? ELO_P_MAX : p;
  return 400 * Math.log10(c / (1 - c));
}

/**
 * Smallest integer number of successes out of n whose Wilson lower bound reaches `gate`
 * (ai.md §7.1 thresholds, n = 200: 55 % → 124, 60 → 134, 65 → 144, 70 → 153, 75 → 163, 80 → 172,
 * 90 → 189). Returns null when even n successes do not reach the gate.
 */
export function successesNeeded(n: number, gate: number, z: number = Z95): number | null {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`successesNeeded: n must be a positive integer (${n})`);
  // lo(s) is strictly increasing in s: binary search for the first s with lo(s) >= gate.
  if (wilson(n, n, z).lo < gate) return null;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wilson(mid, n, z).lo >= gate) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Whether a tally passes a gate: lower Wilson bound ≥ gate. */
export function passesGate(t: GameTally, gate: number, z: number = Z95): boolean {
  return wilsonOf(t, z).lo >= gate;
}
