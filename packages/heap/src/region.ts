/**
 * Common base of all arena regions (tables, dense components, slabs, raw regions).
 * A region describes its parts (sizes only) before `build()`; the builder places the parts
 * (8-byte aligned, registration order) and binds typed views afterwards.
 */

import type { XxHash32 } from '@faf/fixed';
import {
  checkInt,
  checkName,
  colTypeBytes,
  isColType,
  resolveRegionOptions,
  type Area,
  type ColType,
  type ColViewMap,
  type LayoutPart,
  type RegionLayout,
  type RegionOptions,
  type Schema,
} from './layout.ts';
import { SafeIntColumn } from './safeint.ts';

/** Size request of one part of a region. */
export interface PartSpec {
  readonly name: string;
  readonly type: ColType | 'raw';
  readonly bytes: number;
}

/** Integer typed arrays used for columns. */
export type IntView = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array;

export abstract class ArenaRegion {
  abstract readonly kind: RegionLayout['kind'];
  readonly name: string;
  readonly area: Area;
  readonly derived: boolean;
  readonly cap: number;
  private placed: RegionLayout | null = null;

  protected constructor(name: string, cap: number, opts: RegionOptions | undefined) {
    checkName('region', name);
    const o = resolveRegionOptions(opts);
    this.name = name;
    this.area = o.area;
    this.derived = o.derived;
    this.cap = cap;
  }

  /** True once the arena has been built and views are bound. */
  get isBound(): boolean {
    return this.placed !== null;
  }

  /** Placement of this region (after build). */
  get layout(): RegionLayout {
    if (this.placed === null) throw new Error(`region '${this.name}' is not bound (build the arena first)`);
    return this.placed;
  }

  /** @internal Part sizes in layout order. */
  abstract partSpecs(): PartSpec[];

  /** @internal Binds typed views; `offsets[i]` is the absolute byte offset of part i. */
  protected abstract bindParts(buffer: ArrayBuffer, offsets: readonly number[]): void;

  /** @internal Streams the live bytes of this region into `h` (allocation-free). */
  abstract hashLive(h: XxHash32, bytes: Uint8Array): void;

  /** @internal Called by the arena builder. */
  bind(buffer: ArrayBuffer, layout: RegionLayout): void {
    if (this.placed !== null) throw new Error(`region '${this.name}' is already bound to an arena`);
    const offsets: number[] = [];
    for (const p of layout.parts) offsets.push(p.byteOffset);
    this.bindParts(buffer, offsets);
    this.placed = layout;
  }
}

/** Validates a schema and returns its column names in layout order. */
export function schemaColumns(schema: Schema, reserved: readonly string[]): string[] {
  const names = Object.keys(schema);
  for (const n of names) {
    checkName('column', n);
    if (reserved.indexOf(n) >= 0) throw new RangeError(`column name '${n}' is reserved`);
    const t: unknown = schema[n];
    if (!isColType(t)) throw new RangeError(`column '${n}' has invalid type '${String(t)}'`);
  }
  return names;
}

/** Empty (unbound) view of a column type. */
export function emptyView(t: ColType): ColViewMap[ColType] {
  switch (t) {
    case 'u8':
      return new Uint8Array(0);
    case 'i8':
      return new Int8Array(0);
    case 'u16':
      return new Uint16Array(0);
    case 'i16':
      return new Int16Array(0);
    case 'u32':
      return new Uint32Array(0);
    case 'i32':
      return new Int32Array(0);
    case 'f64s':
      return new SafeIntColumn();
  }
}

/** Integer column view over arena memory. */
export function intView(t: Exclude<ColType, 'f64s'>, buffer: ArrayBuffer, off: number, len: number): IntView {
  switch (t) {
    case 'u8':
      return new Uint8Array(buffer, off, len);
    case 'i8':
      return new Int8Array(buffer, off, len);
    case 'u16':
      return new Uint16Array(buffer, off, len);
    case 'i16':
      return new Int16Array(buffer, off, len);
    case 'u32':
      return new Uint32Array(buffer, off, len);
    case 'i32':
      return new Int32Array(buffer, off, len);
  }
}

/**
 * Column set of a table or dense component: owns the `col` object (stable identity), the
 * per-column byte offsets/sizes for hashing and the row helpers (zero, copy).
 */
export class ColumnSet {
  readonly names: readonly string[];
  readonly types: readonly ColType[];
  /** Public column object; property values are replaced on bind (SafeIntColumn instances are kept). */
  readonly col: Record<string, ColViewMap[ColType]>;
  private readonly ints: IntView[] = [];
  private readonly safes: SafeIntColumn[] = [];
  private readonly offs: number[] = [];
  private readonly sizes: number[] = [];

  constructor(schema: Schema, reserved: readonly string[]) {
    this.names = schemaColumns(schema, reserved);
    const types: ColType[] = [];
    const col: Record<string, ColViewMap[ColType]> = {};
    for (const n of this.names) {
      const t = schema[n]!;
      types.push(t);
      col[n] = emptyView(t);
    }
    this.types = types;
    this.col = col;
  }

  /** Part specs for `cap` rows. */
  specs(cap: number): PartSpec[] {
    const out: PartSpec[] = [];
    for (let i = 0; i < this.names.length; i++) {
      const t = this.types[i]!;
      out.push({ name: this.names[i]!, type: t, bytes: cap * colTypeBytes(t) });
    }
    return out;
  }

  /** Binds all columns; `offsets` are the absolute offsets of the column parts. */
  bind(buffer: ArrayBuffer, offsets: readonly number[], cap: number): void {
    for (let i = 0; i < this.names.length; i++) {
      const t = this.types[i]!;
      const n = this.names[i]!;
      const off = offsets[i]!;
      if (t === 'f64s') {
        const c = this.col[n] as SafeIntColumn;
        c.bindTo(buffer, off, cap);
        this.safes.push(c);
      } else {
        const v = intView(t, buffer, off, cap);
        this.col[n] = v;
        this.ints.push(v);
      }
      this.offs.push(off);
      this.sizes.push(colTypeBytes(t));
    }
  }

  /** Zeroes row `r` in every column. */
  zeroRow(r: number): void {
    const ints = this.ints;
    for (let k = 0; k < ints.length; k++) ints[k]![r] = 0;
    const safes = this.safes;
    for (let k = 0; k < safes.length; k++) safes[k]!.zero(r);
  }

  /** Copies row `from` into row `to` in every column. */
  copyRow(from: number, to: number): void {
    const ints = this.ints;
    for (let k = 0; k < ints.length; k++) {
      const v = ints[k]!;
      v[to] = v[from]!;
    }
    const safes = this.safes;
    for (let k = 0; k < safes.length; k++) safes[k]!.copyRow(from, to);
  }

  /** Hashes rows [0, rows) of every column in layout order. */
  hashRows(h: XxHash32, bytes: Uint8Array, rows: number): void {
    const offs = this.offs;
    const sizes = this.sizes;
    for (let k = 0; k < offs.length; k++) h.update(bytes, offs[k]!, rows * sizes[k]!);
  }
}

/** Validates a capacity. */
export function checkCap(what: string, cap: number, max: number): void {
  checkInt(`${what} capacity`, cap, 1, max);
}

/** Builds LayoutPart entries from specs and absolute offsets. */
export function toLayoutParts(specs: readonly PartSpec[], offsets: readonly number[]): LayoutPart[] {
  const parts: LayoutPart[] = [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    parts.push({ name: s.name, type: s.type, byteOffset: offsets[i]!, byteLength: s.bytes });
  }
  return parts;
}
