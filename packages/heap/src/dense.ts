/**
 * Dense components (PLAN §3.5): packed rows [0, count) with a back-pointer column `owner`
 * (e.g. the Units slot). Systems iterate only the dense rows; removal is a swap-remove.
 */

import type { XxHash32 } from '@faf/fixed';
import { MAX_TABLE_CAP, type Columns, type RegionOptions, type Schema } from './layout.ts';
import { ArenaRegion, ColumnSet, checkCap, type PartSpec } from './region.ts';

/** Static description of a dense component. Register it with `ArenaBuilder.addDense`. */
export interface DenseDef<S extends Schema> {
  readonly kind: 'dense';
  readonly name: string;
  readonly cap: number;
  readonly schema: S;
  readonly options: RegionOptions | undefined;
}

/** Declares a dense component with back-pointer column `owner` (i32) plus the given columns. */
export function defineDense<const S extends Schema>(
  name: string,
  cap: number,
  schema: S,
  options?: RegionOptions,
): DenseDef<S> {
  checkCap('dense', cap, MAX_TABLE_CAP);
  return { kind: 'dense', name, cap, schema, options };
}

/** Header: word 0 = count, word 1 reserved. */
export const DENSE_HEADER_BYTES = 8;

const EMPTY_I32 = new Int32Array(0);

export class Dense<S extends Schema> extends ArenaRegion {
  readonly kind = 'dense' as const;
  /** Typed column views (bound on build). */
  readonly col: Columns<S>;
  /** Back-pointer per row (owner slot index). */
  owner: Int32Array = EMPTY_I32;
  private hdr: Int32Array = EMPTY_I32;
  private readonly cols: ColumnSet;
  private hdrOff = 0;
  private ownerOff = 0;

  constructor(def: DenseDef<S>) {
    super(def.name, def.cap, def.options);
    this.cols = new ColumnSet(def.schema, ['owner']);
    this.col = this.cols.col as unknown as Columns<S>;
  }

  /** Column names in layout order (without `owner`). */
  get columnNames(): readonly string[] {
    return this.cols.names;
  }

  /** Number of live rows. */
  get count(): number {
    return this.hdr[0]!;
  }

  /** Appends a zeroed row for `owner` and returns its index, or −1 if full. */
  add(owner: number): number {
    const row = this.hdr[0]!;
    if (row >= this.cap) return -1;
    this.hdr[0] = row + 1;
    this.owner[row] = owner;
    this.cols.zeroRow(row);
    return row;
  }

  /**
   * Removes `row` by moving the last row into its place. Returns the owner of the moved row
   * (whose back-pointer, e.g. `Units.mover`, the caller must set to `row`), or −1 if `row`
   * was the last row and nothing moved. The vacated last row is zeroed.
   */
  removeAt(row: number): number {
    const n = this.hdr[0]!;
    if (row < 0 || row >= n) throw new RangeError(`Dense '${this.name}': removeAt(${row}) out of range (count ${n})`);
    const last = n - 1;
    let moved = -1;
    if (row !== last) {
      moved = this.owner[last]!;
      this.owner[row] = moved;
      this.cols.copyRow(last, row);
    }
    this.owner[last] = 0;
    this.cols.zeroRow(last);
    this.hdr[0] = last;
    return moved;
  }

  /** @internal */
  partSpecs(): PartSpec[] {
    return [
      { name: '$header', type: 'raw', bytes: DENSE_HEADER_BYTES },
      { name: 'owner', type: 'i32', bytes: this.cap * 4 },
      ...this.cols.specs(this.cap),
    ];
  }

  protected bindParts(buffer: ArrayBuffer, offsets: readonly number[]): void {
    this.hdrOff = offsets[0]!;
    this.ownerOff = offsets[1]!;
    this.hdr = new Int32Array(buffer, this.hdrOff, DENSE_HEADER_BYTES >> 2);
    this.owner = new Int32Array(buffer, this.ownerOff, this.cap);
    this.cols.bind(buffer, offsets.slice(2), this.cap);
  }

  /** @internal Header, owner and columns of rows [0, count). */
  hashLive(h: XxHash32, bytes: Uint8Array): void {
    const n = this.hdr[0]!;
    h.update(bytes, this.hdrOff, DENSE_HEADER_BYTES);
    h.update(bytes, this.ownerOff, n * 4);
    this.cols.hashRows(h, bytes, n);
  }
}
