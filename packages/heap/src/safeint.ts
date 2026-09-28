/**
 * SafeInt storage — the only place of the simulation packages that touches Float64Array
 * (lint `sim/determinism`, option float64Allow). A `f64s` column stores integers in
 * [-(2^53-1), 2^53-1] as float64; every write normalizes −0 to +0 so the byte image (and
 * therefore the rule hash) is canonical.
 */

import { isFixedDebug, type SafeInt } from '@faf/fixed';

const EMPTY = new Float64Array(0);

/** Creates a Float64Array view (used for binding `f64s` columns). */
export function createF64View(buffer: ArrayBufferLike, byteOffset: number, length: number): Float64Array {
  return new Float64Array(buffer, byteOffset, length);
}

/**
 * Column of SafeInt values inside the arena. Reads return the stored integer; writes go through
 * `set`/`add`, which canonicalize −0 and (in debug mode) verify integrality.
 */
export class SafeIntColumn {
  private data: Float64Array = EMPTY;

  /** Number of rows (the capacity of the owning table / dense component). */
  get length(): number {
    return this.data.length;
  }

  /** Value of row `i`. */
  get(i: number): SafeInt {
    return this.data[i]! as SafeInt;
  }

  /** Stores `v` into row `i` (−0 → +0; debug: must be a safe integer). */
  set(i: number, v: SafeInt | number): void {
    const r = v + 0;
    if (isFixedDebug() && !Number.isSafeInteger(r)) {
      throw new RangeError(`SafeIntColumn.set: ${v} is not a safe integer`);
    }
    this.data[i] = r;
  }

  /** Adds `d` to row `i` and returns the new value. */
  add(i: number, d: SafeInt | number): SafeInt {
    const r = this.data[i]! + d + 0;
    if (isFixedDebug() && !Number.isSafeInteger(r)) {
      throw new RangeError(`SafeIntColumn.add: result ${r} is not a safe integer`);
    }
    this.data[i] = r;
    return r as SafeInt;
  }

  /** Copies row `from` to row `to` (bit-exact). */
  copyRow(from: number, to: number): void {
    this.data[to] = this.data[from]!;
  }

  /** Sets row `i` to +0. */
  zero(i: number): void {
    this.data[i] = 0;
  }

  /** @internal Binds the column to arena memory (called by the arena builder). */
  bindTo(buffer: ArrayBufferLike, byteOffset: number, length: number): void {
    this.data = createF64View(buffer, byteOffset, length);
  }
}
