/**
 * Determinism helpers of the AI (ai.md §2.5): IEEE-exact math only, total comparators, LUTs built
 * by repeated multiplication instead of Math.pow.
 */
import { FX_ONE, FX_RAW_MAX, FX_RAW_MIN } from '@faf/fixed';

/** Seconds covered by DECAY_LUT. */
export const DECAY_LUT_MAX_S = 600;

function buildDecayLut(): Float64Array {
  const lut = new Float64Array(DECAY_LUT_MAX_S + 1);
  let v = 1;
  for (let s = 0; s <= DECAY_LUT_MAX_S; s++) {
    lut[s] = v;
    v *= 0.95;
  }
  return lut;
}

/** 0.95^s for s = 0…600, produced once by multiplication (ai.md §5.6 threat memory). */
export const DECAY_LUT: Float64Array = buildDecayLut();

/** 0.95^s for whole seconds (clamped to [0, 600]; beyond 600 s the factor is 0). */
export function decayFactor(seconds: number): number {
  if (!(seconds > 0)) return 1;
  const s = Math.floor(seconds);
  if (s > DECAY_LUT_MAX_S) return 0;
  return DECAY_LUT[s]!;
}

/** Total order on numbers (NaN sorts last, −0 equals +0). */
export function compareNumbers(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  if (a === b) return 0;
  // at least one NaN
  const an = a !== a;
  const bn = b !== b;
  if (an && bn) return 0;
  return an ? 1 : -1;
}

/** Total order on strings by UTF-16 code units (locale-independent). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Comparator factory: primary numeric key ascending, tie-break on an integer id ascending. */
export function byKeyThenId<T>(key: (v: T) => number, id: (v: T) => number): (a: T, b: T) => number {
  return (a, b) => {
    const c = compareNumbers(key(a), key(b));
    return c !== 0 ? c : id(a) - id(b);
  };
}

/** Squared euclidean distance. */
export function distSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Euclidean distance (Math.sqrt is IEEE-exact; Math.hypot is not allowed). */
export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(distSq(ax, az, bx, bz));
}

/** WU → Fx raw (round half up); throws outside the Q20.12 range or for non-finite input. */
export function toFxRaw(wu: number): number {
  if (!Number.isFinite(wu)) throw new RangeError(`toFxRaw: ${wu} is not finite`);
  const raw = Math.round(wu * FX_ONE);
  if (raw < FX_RAW_MIN || raw > FX_RAW_MAX) throw new RangeError(`toFxRaw: ${wu} WU is out of the Fx range`);
  return raw | 0;
}

/** Fx raw → WU. */
export function fromFxRaw(raw: number): number {
  return raw / FX_ONE;
}

/** Clamps v into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Stable deterministic 32-bit FNV-1a hash of a string (salts, dedup keys). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
