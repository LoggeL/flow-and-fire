/**
 * Raw regions: untyped byte blocks in the arena, e.g. grids (heightmap/nav in the static area,
 * spatial grids as derived dynamic state). Hashed as a whole (if dynamic).
 */

import type { XxHash32 } from '@faf/fixed';
import { align8, checkInt, type RegionOptions } from './layout.ts';
import { ArenaRegion, type PartSpec } from './region.ts';

/** Static description of a raw region. Register it with `ArenaBuilder.addRegion`. */
export interface RawRegionDef {
  readonly kind: 'raw';
  readonly name: string;
  readonly bytes: number;
  readonly options: RegionOptions | undefined;
}

/** Maximum size of a single raw region (1 GiB). */
export const MAX_RAW_BYTES = 0x40000000;

/** Declares a raw region of `bytes` bytes (views cover the size rounded up to 8). */
export function defineRegion(name: string, bytes: number, options?: RegionOptions): RawRegionDef {
  checkInt('region bytes', bytes, 1, MAX_RAW_BYTES);
  return { kind: 'raw', name, bytes, options };
}

const EMPTY_U8 = new Uint8Array(0);
const EMPTY_I8 = new Int8Array(0);
const EMPTY_U16 = new Uint16Array(0);
const EMPTY_I16 = new Int16Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_I32 = new Int32Array(0);

export class RawRegion extends ArenaRegion {
  readonly kind = 'raw' as const;
  /** Requested size in bytes (hashed range). */
  readonly byteLength: number;
  u8: Uint8Array = EMPTY_U8;
  i8: Int8Array = EMPTY_I8;
  u16: Uint16Array = EMPTY_U16;
  i16: Int16Array = EMPTY_I16;
  u32: Uint32Array = EMPTY_U32;
  i32: Int32Array = EMPTY_I32;
  private off = 0;

  constructor(def: RawRegionDef) {
    super(def.name, 1, def.options);
    this.byteLength = def.bytes;
  }

  /** Absolute byte offset of the region in the arena. */
  get byteOffset(): number {
    return this.off;
  }

  /** @internal */
  partSpecs(): PartSpec[] {
    return [{ name: '$data', type: 'raw', bytes: align8(this.byteLength) }];
  }

  protected bindParts(buffer: ArrayBuffer, offsets: readonly number[]): void {
    const off = offsets[0]!;
    const n = align8(this.byteLength);
    this.off = off;
    this.u8 = new Uint8Array(buffer, off, n);
    this.i8 = new Int8Array(buffer, off, n);
    this.u16 = new Uint16Array(buffer, off, n >> 1);
    this.i16 = new Int16Array(buffer, off, n >> 1);
    this.u32 = new Uint32Array(buffer, off, n >> 2);
    this.i32 = new Int32Array(buffer, off, n >> 2);
  }

  /** @internal */
  hashLive(h: XxHash32, bytes: Uint8Array): void {
    h.update(bytes, this.off, this.byteLength);
  }
}
