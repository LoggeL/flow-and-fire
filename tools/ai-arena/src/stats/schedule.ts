/**
 * Tournament pairing schedule and side sampling (ai.md §7.1 "Stichprobe", §7.3 "Paarung").
 *
 * - Seed s plays map maps[s mod k] (k = number of maps), so maps get equal shares when the seed
 *   count is a multiple of k (e.g. seeds 1…105 on 3 maps: 35 seeds per map).
 * - With `swap`, every seed is played twice with exchanged armies (start advantage cancels out):
 *   first contestant A on army 0, then A on army 1.
 * - In mirror tournaments exactly one side per game is sampled: the army with the parity of the
 *   seed (`sampleSide`), otherwise the two values of one game would be correlated.
 * - The two mirror games of a seed sample the same army; the second game (exchanged start markers)
 *   therefore gets its own AI seed (`mirrorAiSeed`), so the sampled AI's opening choice and RNG
 *   streams are independent of the first game (review TRACK-AI: identical openings in all 105 pairs).
 */

export interface Pairing {
  /** Position in the schedule (0-based); also the job index for the worker pool. */
  readonly game: number;
  readonly seed: number;
  readonly map: string;
  readonly mapIndex: number;
  /** false: contestant A plays army 0, B army 1; true: exchanged. */
  readonly swapped: boolean;
  /** Army of contestant A. */
  readonly armyA: 0 | 1;
  /** Army of contestant B. */
  readonly armyB: 0 | 1;
}

export interface ScheduleOptions {
  readonly seeds: readonly number[];
  readonly maps: readonly string[];
  /** Play every seed a second time with exchanged armies (default true). */
  readonly swap?: boolean;
}

/** Inclusive integer seed range [from, to]. */
export function seedRange(from: number, to: number): number[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) throw new RangeError(`seedRange: invalid range ${from}..${to}`);
  const out: number[] = [];
  for (let s = from; s <= to; s++) out.push(s);
  return out;
}

function mod(a: number, k: number): number {
  const r = a % k;
  return r < 0 ? r + k : r;
}

/** Map index of a seed: seed mod k (non-negative). */
export function mapIndexOfSeed(seed: number, mapCount: number): number {
  if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer (${seed})`);
  if (!Number.isInteger(mapCount) || mapCount < 1) throw new RangeError(`mapCount must be >= 1 (${mapCount})`);
  return mod(seed, mapCount);
}

/**
 * Game list in seed order (as given); with swap each seed yields the unswapped game followed by the
 * swapped one. Seeds must be distinct integers.
 */
export function pairingSchedule(opts: ScheduleOptions): Pairing[] {
  const { seeds, maps } = opts;
  const swap = opts.swap ?? true;
  if (maps.length === 0) throw new RangeError('pairingSchedule: no maps');
  const seen = new Set<number>();
  const out: Pairing[] = [];
  for (const seed of seeds) {
    if (seen.has(seed)) throw new RangeError(`pairingSchedule: duplicate seed ${seed}`);
    seen.add(seed);
    const mapIndex = mapIndexOfSeed(seed, maps.length);
    const map = maps[mapIndex] as string;
    out.push({ game: out.length, seed, map, mapIndex, swapped: false, armyA: 0, armyB: 1 });
    if (swap) out.push({ game: out.length, seed, map, mapIndex, swapped: true, armyA: 1, armyB: 0 });
  }
  return out;
}

/**
 * AI game seed of a mirror game: the tournament seed for the first game, an integer mix of it for the
 * second (swapped) game. Deterministic, 32-bit, never equal to any small tournament seed in practice.
 */
export function mirrorAiSeed(seed: number, swapped: boolean): number {
  if (!Number.isInteger(seed)) throw new RangeError(`mirrorAiSeed: seed must be an integer (${seed})`);
  if (!swapped) return seed >>> 0;
  let h = Math.imul(seed >>> 0, 0x9e3779b1) ^ 0x5bd1e995;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Sampled army in a mirror tournament: the army with the parity of the seed (0 or 1). */
export function sampleSide(seed: number): 0 | 1 {
  if (!Number.isInteger(seed)) throw new RangeError(`sampleSide: seed must be an integer (${seed})`);
  return mod(seed, 2) === 0 ? 0 : 1;
}

/**
 * Which contestant's value a mirror game contributes: 'A' when the sampled army is A's army.
 * Over a swapped schedule this picks each contestant for exactly one of the two games of a seed.
 */
export function sampledContestant(p: Pairing): 'A' | 'B' {
  return sampleSide(p.seed) === p.armyA ? 'A' : 'B';
}
