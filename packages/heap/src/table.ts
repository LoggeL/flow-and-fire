/**
 * Slot tables of the Table-DSL (PLAN §3.5): SoA columns plus a header with highWater,
 * liveCount and a FIFO freelist ring, a generation column (u16, 12 bits used) and an alive
 * flag per slot. All of it lives in the arena, so snapshot/restore captures the complete state.
 *
 * "Codegen" is done at bind time: the column object `t.col` gets one typed view per column,
 * typed through mapped types (`t.col.x` is an Int32Array for an 'i32' column).
 */

import type { Handle, XxHash32 } from '@faf/fixed';
import { HANDLE_NONE, nextGen, packHandle, unpackGen, unpackIndex } from './handle.ts';
import { MAX_TABLE_CAP, type Columns, type RegionOptions, type Schema } from './layout.ts';
import { ArenaRegion, ColumnSet, checkCap, type PartSpec } from './region.ts';

/** Header words (Int32) of tables and slabs. */
export const HDR_HIGH_WATER = 0;
export const HDR_LIVE_COUNT = 1;
export const HDR_FREE_HEAD = 2;
export const HDR_FREE_TAIL = 3;
export const HDR_FREE_COUNT = 4;
/** Header size in bytes (8 words, 3 reserved). */
export const SLOT_HEADER_BYTES = 32;

/** Static description of a table (no memory). Register it with `ArenaBuilder.addTable`. */
export interface TableDef<S extends Schema> {
  readonly kind: 'table';
  readonly name: string;
  readonly cap: number;
  readonly schema: S;
  readonly options: RegionOptions | undefined;
}

/**
 * Declares a slot table. `cap` ≤ 0xFFFFF (20-bit handle index, 0xFFFFF reserved for HANDLE_NONE).
 *
 * ```ts
 * export const Units = defineTable('units', 8192, { x: 'i32', z: 'i32', hp: 'i32', mass: 'f64s' });
 * ```
 */
export function defineTable<const S extends Schema>(
  name: string,
  cap: number,
  schema: S,
  options?: RegionOptions,
): TableDef<S> {
  checkCap('table', cap, MAX_TABLE_CAP);
  return { kind: 'table', name, cap, schema, options };
}

const EMPTY_I32 = new Int32Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_U16 = new Uint16Array(0);
const EMPTY_U8 = new Uint8Array(0);

/** Reserved names that cannot be used as columns (kept distinct from the built-in parts). */
const TABLE_RESERVED = ['$header', '$free', '$gen', '$alive'];

export class Table<S extends Schema> extends ArenaRegion {
  readonly kind = 'table' as const;
  /** Typed column views (bound on build). Cache them in locals after the arena is built. */
  readonly col: Columns<S>;
  /** Generation per slot (u16, low 12 bits used). */
  gen: Uint16Array = EMPTY_U16;
  /** 1 if the slot is alive, else 0. */
  alive: Uint8Array = EMPTY_U8;
  private hdr: Int32Array = EMPTY_I32;
  private ring: Uint32Array = EMPTY_U32;
  private readonly cols: ColumnSet;
  private hdrOff = 0;
  private ringOff = 0;
  private genOff = 0;
  private aliveOff = 0;

  constructor(def: TableDef<S>) {
    super(def.name, def.cap, def.options);
    this.cols = new ColumnSet(def.schema, TABLE_RESERVED);
    this.col = this.cols.col as unknown as Columns<S>;
  }

  /** Column names in layout order. */
  get columnNames(): readonly string[] {
    return this.cols.names;
  }

  /** One past the highest slot ever allocated. Slots ≥ highWater are untouched (and not hashed). */
  get highWater(): number {
    return this.hdr[HDR_HIGH_WATER]!;
  }

  /** Number of live slots. */
  get liveCount(): number {
    return this.hdr[HDR_LIVE_COUNT]!;
  }

  /** Number of freed slots waiting for reuse. */
  get freeCount(): number {
    return this.hdr[HDR_FREE_COUNT]!;
  }

  /**
   * Allocates a slot and returns its index, or −1 if the table is full. Freed slots are reused
   * in the order they were freed (FIFO); otherwise highWater grows. All columns of the slot are
   * zeroed; its generation is kept (it was bumped by `free`).
   */
  alloc(): number {
    const h = this.hdr;
    let idx: number;
    const freeCount = h[HDR_FREE_COUNT]!;
    if (freeCount > 0) {
      const head = h[HDR_FREE_HEAD]!;
      idx = this.ring[head]!;
      h[HDR_FREE_HEAD] = head + 1 === this.cap ? 0 : head + 1;
      h[HDR_FREE_COUNT] = freeCount - 1;
    } else {
      const hw = h[HDR_HIGH_WATER]!;
      if (hw >= this.cap) return -1;
      idx = hw;
      h[HDR_HIGH_WATER] = hw + 1;
    }
    this.alive[idx] = 1;
    h[HDR_LIVE_COUNT] = h[HDR_LIVE_COUNT]! + 1;
    this.cols.zeroRow(idx);
    return idx;
  }

  /** Frees a live slot: generation = (gen + 1) & 0xFFF, slot is appended to the FIFO freelist. */
  free(idx: number): void {
    if (!this.isLive(idx)) throw new RangeError(`Table '${this.name}': free of non-live slot ${idx}`);
    const h = this.hdr;
    this.alive[idx] = 0;
    this.gen[idx] = nextGen(this.gen[idx]!);
    const tail = h[HDR_FREE_TAIL]!;
    this.ring[tail] = idx;
    h[HDR_FREE_TAIL] = tail + 1 === this.cap ? 0 : tail + 1;
    h[HDR_FREE_COUNT] = h[HDR_FREE_COUNT]! + 1;
    h[HDR_LIVE_COUNT] = h[HDR_LIVE_COUNT]! - 1;
  }

  /** True if `idx` is an allocated, live slot. */
  isLive(idx: number): boolean {
    return idx >= 0 && idx < this.hdr[HDR_HIGH_WATER]! && this.alive[idx] === 1;
  }

  /** Handle of slot `idx` with its current generation. */
  handle(idx: number): Handle {
    return packHandle(idx, this.gen[idx]!);
  }

  /** Slot index of a handle, or −1 if the handle is HANDLE_NONE, stale (generation) or dead. */
  resolve(handle: Handle | number): number {
    if (handle === HANDLE_NONE) return -1;
    const idx = unpackIndex(handle);
    if (idx >= this.hdr[HDR_HIGH_WATER]! || this.alive[idx] !== 1) return -1;
    return this.gen[idx] === unpackGen(handle) ? idx : -1;
  }

  /** @internal */
  partSpecs(): PartSpec[] {
    const cap = this.cap;
    return [
      { name: '$header', type: 'raw', bytes: SLOT_HEADER_BYTES },
      { name: '$free', type: 'raw', bytes: cap * 4 },
      { name: '$gen', type: 'u16', bytes: cap * 2 },
      { name: '$alive', type: 'u8', bytes: cap },
      ...this.cols.specs(cap),
    ];
  }

  protected bindParts(buffer: ArrayBuffer, offsets: readonly number[]): void {
    const cap = this.cap;
    this.hdrOff = offsets[0]!;
    this.ringOff = offsets[1]!;
    this.genOff = offsets[2]!;
    this.aliveOff = offsets[3]!;
    this.hdr = new Int32Array(buffer, this.hdrOff, SLOT_HEADER_BYTES >> 2);
    this.ring = new Uint32Array(buffer, this.ringOff, cap);
    this.gen = new Uint16Array(buffer, this.genOff, cap);
    this.alive = new Uint8Array(buffer, this.aliveOff, cap);
    this.cols.bind(buffer, offsets.slice(4), cap);
  }

  /** @internal Header, live freelist entries, gen/alive/columns of slots [0, highWater). */
  hashLive(h: XxHash32, bytes: Uint8Array): void {
    const hw = this.hdr[HDR_HIGH_WATER]!;
    h.update(bytes, this.hdrOff, SLOT_HEADER_BYTES);
    hashRing(h, bytes, this.ringOff, this.cap, this.hdr[HDR_FREE_HEAD]!, this.hdr[HDR_FREE_COUNT]!);
    h.update(bytes, this.genOff, hw * 2);
    h.update(bytes, this.aliveOff, hw);
    this.cols.hashRows(h, bytes, hw);
  }
}

/** Hashes the `count` live entries of a u32 ring starting at `head` (wrap-around aware). */
export function hashRing(h: XxHash32, bytes: Uint8Array, ringOff: number, cap: number, head: number, count: number): void {
  if (count <= 0) return;
  const first = Math.min(count, cap - head);
  h.update(bytes, ringOff + head * 4, first * 4);
  if (count > first) h.update(bytes, ringOff, (count - first) * 4);
}
