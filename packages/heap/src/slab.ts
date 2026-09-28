/**
 * Slabs (PLAN §3.5): fixed-size records (e.g. 32-byte order records, path blocks) with a FIFO
 * freelist in the arena. Records are addressed by index; `i32`/`u32`/`u16`/`u8` views cover the
 * record area, `wordOffset(rec)` / `byteOffset(rec)` locate a record inside those views.
 */

import type { XxHash32 } from '@faf/fixed';
import { checkInt, MAX_TABLE_CAP, type RegionOptions } from './layout.ts';
import { ArenaRegion, checkCap, type PartSpec } from './region.ts';
import {
  HDR_FREE_COUNT,
  HDR_FREE_HEAD,
  HDR_FREE_TAIL,
  HDR_HIGH_WATER,
  HDR_LIVE_COUNT,
  SLOT_HEADER_BYTES,
  hashRing,
} from './table.ts';

/** Static description of a slab. Register it with `ArenaBuilder.addSlab`. */
export interface SlabDef {
  readonly kind: 'slab';
  readonly name: string;
  readonly recordBytes: number;
  readonly cap: number;
  readonly options: RegionOptions | undefined;
}

/** Declares a slab of `cap` records of `recordBytes` bytes (multiple of 4, ≤ 65536). */
export function defineSlab(name: string, recordBytes: number, cap: number, options?: RegionOptions): SlabDef {
  checkInt('slab recordBytes', recordBytes, 4, 65536);
  if ((recordBytes & 3) !== 0) throw new RangeError(`slab recordBytes must be a multiple of 4, got ${recordBytes}`);
  checkCap('slab', cap, MAX_TABLE_CAP);
  return { kind: 'slab', name, recordBytes, cap, options };
}

const EMPTY_I32 = new Int32Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_U16 = new Uint16Array(0);
const EMPTY_U8 = new Uint8Array(0);

export class Slab extends ArenaRegion {
  readonly kind = 'slab' as const;
  readonly recordBytes: number;
  /** Words (4 B) per record. */
  readonly recordWords: number;
  /** Record area views (record r starts at byteOffset(r) / wordOffset(r)). */
  u8: Uint8Array = EMPTY_U8;
  u16: Uint16Array = EMPTY_U16;
  i32: Int32Array = EMPTY_I32;
  u32: Uint32Array = EMPTY_U32;
  /** 1 if the record is allocated. */
  alive: Uint8Array = EMPTY_U8;
  private hdr: Int32Array = EMPTY_I32;
  private ring: Uint32Array = EMPTY_U32;
  private hdrOff = 0;
  private ringOff = 0;
  private aliveOff = 0;
  private dataOff = 0;

  constructor(def: SlabDef) {
    super(def.name, def.cap, def.options);
    this.recordBytes = def.recordBytes;
    this.recordWords = def.recordBytes >> 2;
  }

  get highWater(): number {
    return this.hdr[HDR_HIGH_WATER]!;
  }

  get liveCount(): number {
    return this.hdr[HDR_LIVE_COUNT]!;
  }

  get freeCount(): number {
    return this.hdr[HDR_FREE_COUNT]!;
  }

  /** Byte offset of record `rec` inside `u8`. */
  byteOffset(rec: number): number {
    return rec * this.recordBytes;
  }

  /** Word offset of record `rec` inside `i32`/`u32`. */
  wordOffset(rec: number): number {
    return rec * this.recordWords;
  }

  /** Allocates a zeroed record (FIFO reuse of freed records, else highWater++); −1 if full. */
  alloc(): number {
    const h = this.hdr;
    let rec: number;
    const freeCount = h[HDR_FREE_COUNT]!;
    if (freeCount > 0) {
      const head = h[HDR_FREE_HEAD]!;
      rec = this.ring[head]!;
      h[HDR_FREE_HEAD] = head + 1 === this.cap ? 0 : head + 1;
      h[HDR_FREE_COUNT] = freeCount - 1;
    } else {
      const hw = h[HDR_HIGH_WATER]!;
      if (hw >= this.cap) return -1;
      rec = hw;
      h[HDR_HIGH_WATER] = hw + 1;
    }
    this.alive[rec] = 1;
    h[HDR_LIVE_COUNT] = h[HDR_LIVE_COUNT]! + 1;
    const w = rec * this.recordWords;
    this.i32.fill(0, w, w + this.recordWords);
    return rec;
  }

  /** Frees an allocated record (appended to the FIFO freelist). */
  free(rec: number): void {
    if (!this.isLive(rec)) throw new RangeError(`Slab '${this.name}': free of non-live record ${rec}`);
    const h = this.hdr;
    this.alive[rec] = 0;
    const tail = h[HDR_FREE_TAIL]!;
    this.ring[tail] = rec;
    h[HDR_FREE_TAIL] = tail + 1 === this.cap ? 0 : tail + 1;
    h[HDR_FREE_COUNT] = h[HDR_FREE_COUNT]! + 1;
    h[HDR_LIVE_COUNT] = h[HDR_LIVE_COUNT]! - 1;
  }

  isLive(rec: number): boolean {
    return rec >= 0 && rec < this.hdr[HDR_HIGH_WATER]! && this.alive[rec] === 1;
  }

  /** @internal */
  partSpecs(): PartSpec[] {
    return [
      { name: '$header', type: 'raw', bytes: SLOT_HEADER_BYTES },
      { name: '$free', type: 'raw', bytes: this.cap * 4 },
      { name: '$alive', type: 'u8', bytes: this.cap },
      { name: '$records', type: 'raw', bytes: this.cap * this.recordBytes },
    ];
  }

  protected bindParts(buffer: ArrayBuffer, offsets: readonly number[]): void {
    this.hdrOff = offsets[0]!;
    this.ringOff = offsets[1]!;
    this.aliveOff = offsets[2]!;
    this.dataOff = offsets[3]!;
    const bytes = this.cap * this.recordBytes;
    this.hdr = new Int32Array(buffer, this.hdrOff, SLOT_HEADER_BYTES >> 2);
    this.ring = new Uint32Array(buffer, this.ringOff, this.cap);
    this.alive = new Uint8Array(buffer, this.aliveOff, this.cap);
    this.u8 = new Uint8Array(buffer, this.dataOff, bytes);
    this.u16 = new Uint16Array(buffer, this.dataOff, bytes >> 1);
    this.i32 = new Int32Array(buffer, this.dataOff, bytes >> 2);
    this.u32 = new Uint32Array(buffer, this.dataOff, bytes >> 2);
  }

  /** @internal Header, live freelist entries, alive flags and records [0, highWater). */
  hashLive(h: XxHash32, bytes: Uint8Array): void {
    const hw = this.hdr[HDR_HIGH_WATER]!;
    h.update(bytes, this.hdrOff, SLOT_HEADER_BYTES);
    hashRing(h, bytes, this.ringOff, this.cap, this.hdr[HDR_FREE_HEAD]!, this.hdr[HDR_FREE_COUNT]!);
    h.update(bytes, this.aliveOff, hw);
    h.update(bytes, this.dataOff, hw * this.recordBytes);
  }
}
