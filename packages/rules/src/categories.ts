/**
 * 128-bit category masks (PLAN §3.1 "Blueprint-Identität", §3.9 step 4).
 *
 * A mask is 4 × u32 words (bit b lives in word b >>> 5, bit b & 31). Masks are stored flat in
 * Uint32Arrays (`mask`, `offset`) so tables of masks need no per-entry objects.
 *
 * The registry maps category names to bits deterministically: the distinct names are sorted by
 * UTF-16 code units (never locale-dependent) and numbered in that order.
 */

/** Words per category mask. */
export const CATEGORY_WORDS = 4;
/** Maximum number of distinct categories (bits per mask). */
export const MAX_CATEGORIES = 128;

/** Valid category name: upper-case ASCII identifier, e.g. `LAND`, `TECH1`, `DIRECT_FIRE`. */
const CATEGORY_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** True if `name` is a syntactically valid category name. */
export function isCategoryName(name: string): boolean {
  return CATEGORY_NAME_RE.test(name);
}

/** Total order on strings by UTF-16 code units (locale-independent). */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Allocates a zeroed mask (or `n` consecutive masks). */
export function createMask(n = 1): Uint32Array {
  return new Uint32Array(CATEGORY_WORDS * n);
}

/** Sets bit `bit` of the mask at `off`. */
export function maskSetBit(mask: Uint32Array, off: number, bit: number): void {
  const w = off + (bit >>> 5);
  mask[w] = (mask[w]! | (1 << (bit & 31))) >>> 0;
}

/** True if bit `bit` of the mask at `off` is set. */
export function maskHasBit(mask: Uint32Array, off: number, bit: number): boolean {
  return (mask[off + (bit >>> 5)]! & (1 << (bit & 31))) !== 0;
}

/** True if every bit of `b` (at `bOff`) is also set in `a` (at `aOff`). */
export function maskContainsAll(a: Uint32Array, aOff: number, b: Uint32Array, bOff: number): boolean {
  for (let i = 0; i < CATEGORY_WORDS; i++) {
    const bw = b[bOff + i]!;
    if ((a[aOff + i]! & bw) >>> 0 !== bw) return false;
  }
  return true;
}

/** True if `a` and `b` share at least one bit. */
export function maskIntersects(a: Uint32Array, aOff: number, b: Uint32Array, bOff: number): boolean {
  for (let i = 0; i < CATEGORY_WORDS; i++) if ((a[aOff + i]! & b[bOff + i]!) !== 0) return true;
  return false;
}

/** True if the two masks are identical. */
export function maskEquals(a: Uint32Array, aOff: number, b: Uint32Array, bOff: number): boolean {
  for (let i = 0; i < CATEGORY_WORDS; i++) if (a[aOff + i] !== b[bOff + i]) return false;
  return true;
}

/**
 * Deterministic category registry: sorted distinct names → bit index.
 * Lookup is a binary search over the sorted name list (no Map, see sim/determinism).
 */
export class CategoryRegistry {
  /** Category names sorted by code units; index = bit. */
  readonly names: readonly string[];

  constructor(names: Iterable<string>) {
    const list: string[] = [];
    for (const n of names) {
      if (!isCategoryName(n)) throw new RangeError(`invalid category name '${n}'`);
      list.push(n);
    }
    list.sort(compareCodeUnits);
    const unique: string[] = [];
    for (let i = 0; i < list.length; i++) {
      if (i === 0 || list[i] !== list[i - 1]) unique.push(list[i]!);
    }
    if (unique.length > MAX_CATEGORIES) {
      throw new RangeError(`too many categories: ${unique.length} > ${MAX_CATEGORIES}`);
    }
    this.names = unique;
  }

  /** Number of registered categories. */
  get size(): number {
    return this.names.length;
  }

  /** Bit of `name`, or −1 if it is not registered. */
  bitOf(name: string): number {
    const names = this.names;
    let lo = 0;
    let hi = names.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const c = compareCodeUnits(names[mid]!, name);
      if (c === 0) return mid;
      if (c < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  /** Name of `bit` (throws if out of range). */
  nameOf(bit: number): string {
    const n = this.names[bit];
    if (n === undefined) throw new RangeError(`category bit ${bit} is not registered`);
    return n;
  }

  /**
   * Writes the mask of `names` into `out` at `off` (cleared first) and returns `out`.
   * Unknown names throw.
   */
  maskOf(names: readonly string[], out: Uint32Array = createMask(), off = 0): Uint32Array {
    for (let i = 0; i < CATEGORY_WORDS; i++) out[off + i] = 0;
    for (let i = 0; i < names.length; i++) {
      const b = this.bitOf(names[i]!);
      if (b < 0) throw new RangeError(`unknown category '${names[i]!}'`);
      maskSetBit(out, off, b);
    }
    return out;
  }

  /** Names of all bits set in the mask at `off`, in bit order. */
  namesOf(mask: Uint32Array, off = 0): string[] {
    const out: string[] = [];
    for (let b = 0; b < this.names.length; b++) if (maskHasBit(mask, off, b)) out.push(this.names[b]!);
    return out;
  }
}
