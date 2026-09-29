/**
 * Unit instance layout: the instance data of the unit pass is 1:1 the `UnitRecord` of the sim frame
 * (PLAN §3.6, 48 bytes, little endian). The offsets are the protocol's own constants
 * (render → protocol is an allowed dependency, PLAN §3.2), re-exported under render names so the
 * pass code reads as instance attributes; there is no second copy that could drift.
 *
 * World coordinates are Q20.12 raw int32 (x, y = height, z); yaw is Ang16 (65536 = 360°,
 * 0 = +x, increasing towards +z).
 */
import {
  UNIT_OFF_ARMY,
  UNIT_OFF_BANK,
  UNIT_OFF_BUILD,
  UNIT_OFF_CUR_POS,
  UNIT_OFF_CUR_YAW,
  UNIT_OFF_FLAGS,
  UNIT_OFF_HANDLE,
  UNIT_OFF_HP,
  UNIT_OFF_PART_BASE,
  UNIT_OFF_PART_COUNT,
  UNIT_OFF_PREV_POS,
  UNIT_OFF_PREV_YAW,
  UNIT_OFF_RESERVED,
  UNIT_OFF_VISUAL,
  UNIT_RECORD_BYTES,
  UnitFlags,
} from '@faf/protocol';

export const UNIT_INSTANCE_STRIDE = UNIT_RECORD_BYTES;
export const UNIT_INSTANCE_OFF_PREV_POS = UNIT_OFF_PREV_POS; // i32 × 3
export const UNIT_INSTANCE_OFF_CUR_POS = UNIT_OFF_CUR_POS; // i32 × 3
export const UNIT_INSTANCE_OFF_PREV_YAW = UNIT_OFF_PREV_YAW; // u16
export const UNIT_INSTANCE_OFF_CUR_YAW = UNIT_OFF_CUR_YAW; // u16
export const UNIT_INSTANCE_OFF_VISUAL = UNIT_OFF_VISUAL; // u16
export const UNIT_INSTANCE_OFF_ARMY = UNIT_OFF_ARMY; // u8
export const UNIT_INSTANCE_OFF_HP = UNIT_OFF_HP; // u8
export const UNIT_INSTANCE_OFF_BUILD = UNIT_OFF_BUILD; // u8
export const UNIT_INSTANCE_OFF_BANK = UNIT_OFF_BANK; // i8
export const UNIT_INSTANCE_OFF_FLAGS = UNIT_OFF_FLAGS; // u16
export const UNIT_INSTANCE_OFF_HANDLE = UNIT_OFF_HANDLE; // u32
export const UNIT_INSTANCE_OFF_PART_BASE = UNIT_OFF_PART_BASE; // u32
export const UNIT_INSTANCE_OFF_PART_COUNT = UNIT_OFF_PART_COUNT; // u8
export const UNIT_INSTANCE_OFF_RESERVED = UNIT_OFF_RESERVED; // u8 × 3

/** `flags` bit: no interpolation this tick (spawn, roll-off, new handle in slot) → draw at cur. */
export const UNIT_FLAG_NO_INTERP = UnitFlags.NoInterp;

/** Number of 32-bit words per record. */
const WORDS = UNIT_INSTANCE_STRIDE >> 2;
/** Word index holding `visual` in its low 16 bits (little endian). */
const VISUAL_WORD = UNIT_INSTANCE_OFF_VISUAL >> 2;

export interface UnitRecordInit {
  prevX: number;
  prevY: number;
  prevZ: number;
  x: number;
  y: number;
  z: number;
  prevYaw: number;
  yaw: number;
  visual: number;
  army: number;
  hp?: number;
  build?: number;
  bank?: number;
  flags?: number;
  handle?: number;
  partBase?: number;
  partCount?: number;
}

/**
 * Typed-array writer for UnitRecord buffers (tests, demo, synthetic scenes). Host endianness is
 * little endian on every supported platform, matching the frame layout.
 */
export class UnitRecordWriter {
  readonly bytes: Uint8Array;
  private readonly i32: Int32Array;
  private readonly u16: Uint16Array;
  private readonly u32: Uint32Array;
  private readonly i8: Int8Array;

  constructor(capacityOrBytes: number | Uint8Array) {
    this.bytes =
      typeof capacityOrBytes === 'number' ? new Uint8Array(capacityOrBytes * UNIT_INSTANCE_STRIDE) : capacityOrBytes;
    const b = this.bytes;
    if (b.byteOffset % 4 !== 0) throw new Error('UnitRecordWriter: buffer must be 4-byte aligned');
    const words = b.byteLength >> 2;
    this.i32 = new Int32Array(b.buffer, b.byteOffset, words);
    this.u32 = new Uint32Array(b.buffer, b.byteOffset, words);
    this.u16 = new Uint16Array(b.buffer, b.byteOffset, words * 2);
    this.i8 = new Int8Array(b.buffer, b.byteOffset, b.byteLength);
  }

  get capacity(): number {
    return (this.bytes.byteLength / UNIT_INSTANCE_STRIDE) | 0;
  }

  write(i: number, r: UnitRecordInit): void {
    const w = i * WORDS;
    const h = w * 2;
    const b = i * UNIT_INSTANCE_STRIDE;
    this.i32[w] = r.prevX;
    this.i32[w + 1] = r.prevY;
    this.i32[w + 2] = r.prevZ;
    this.i32[w + 3] = r.x;
    this.i32[w + 4] = r.y;
    this.i32[w + 5] = r.z;
    this.u16[h + 12] = r.prevYaw & 0xffff;
    this.u16[h + 13] = r.yaw & 0xffff;
    this.u16[h + 14] = r.visual & 0xffff;
    this.bytes[b + UNIT_INSTANCE_OFF_ARMY] = r.army;
    this.bytes[b + UNIT_INSTANCE_OFF_HP] = r.hp ?? 255;
    this.bytes[b + UNIT_INSTANCE_OFF_BUILD] = r.build ?? 255;
    this.i8[b + UNIT_INSTANCE_OFF_BANK] = r.bank ?? 0;
    this.u16[h + 17] = (r.flags ?? 0) & 0xffff;
    this.u32[w + 9] = (r.handle ?? 0) >>> 0;
    this.u32[w + 10] = (r.partBase ?? 0) >>> 0;
    this.bytes[b + UNIT_INSTANCE_OFF_PART_COUNT] = r.partCount ?? 0;
    this.bytes[b + 45] = 0;
    this.bytes[b + 46] = 0;
    this.bytes[b + 47] = 0;
  }

  /** Moves cur → prev for record i and sets the new current position/yaw (one sim tick). */
  advance(i: number, x: number, y: number, z: number, yaw: number): void {
    const w = i * WORDS;
    const h = w * 2;
    this.i32[w] = this.i32[w + 3]!;
    this.i32[w + 1] = this.i32[w + 4]!;
    this.i32[w + 2] = this.i32[w + 5]!;
    this.u16[h + 12] = this.u16[h + 13]!;
    this.i32[w + 3] = x;
    this.i32[w + 4] = y;
    this.i32[w + 5] = z;
    this.u16[h + 13] = yaw & 0xffff;
  }

  setFlags(i: number, flags: number): void {
    this.u16[i * WORDS * 2 + 17] = flags & 0xffff;
  }

  flags(i: number): number {
    return this.u16[i * WORDS * 2 + 17]!;
  }

  curX(i: number): number {
    return this.i32[i * WORDS + 3]!;
  }
  curY(i: number): number {
    return this.i32[i * WORDS + 4]!;
  }
  curZ(i: number): number {
    return this.i32[i * WORDS + 5]!;
  }
  curYaw(i: number): number {
    return this.u16[i * WORDS * 2 + 13]!;
  }
  visual(i: number): number {
    return this.u16[i * WORDS * 2 + 14]!;
  }
  handle(i: number): number {
    return this.u32[i * WORDS + 9]!;
  }
}

/**
 * Counting sort of UnitRecords by `visual` into a staging buffer (stable, O(n + visuals)).
 * All storage is preallocated and grows only on demand; `sort()` allocates nothing in steady state.
 */
export class VisualBuckets {
  /** First sorted record of each visual. */
  start = new Uint32Array(0);
  /** Record count of each visual. */
  count = new Uint32Array(0);
  /** Sorted records (`total * 48` bytes valid). */
  sorted = new Uint8Array(0);
  /** Highlight byte per sorted record (valid if a highlight array was given). */
  highlight = new Uint8Array(0);
  /** Records written to `sorted`. */
  total = 0;
  /** Records skipped because their visual is ≥ `visualCount`. */
  dropped = 0;
  visualCount = 0;

  private sorted32 = new Uint32Array(0);
  private cursor = new Uint32Array(0);
  private srcBuffer: ArrayBufferLike | null = null;
  private srcOffset = -1;
  private src32: Uint32Array<ArrayBufferLike> = new Uint32Array(0);

  /** Ensures room for `capacity` records and `visualCount` buckets. */
  ensure(capacity: number, visualCount: number): void {
    if (this.sorted.byteLength < capacity * UNIT_INSTANCE_STRIDE) {
      let cap = Math.max(64, this.sorted.byteLength / UNIT_INSTANCE_STRIDE);
      while (cap < capacity) cap *= 2;
      const buf = new ArrayBuffer(cap * UNIT_INSTANCE_STRIDE);
      this.sorted = new Uint8Array(buf);
      this.sorted32 = new Uint32Array(buf);
      this.highlight = new Uint8Array(cap);
    }
    if (this.start.length < visualCount) {
      this.start = new Uint32Array(visualCount);
      this.count = new Uint32Array(visualCount);
      this.cursor = new Uint32Array(visualCount);
    }
    this.visualCount = visualCount;
  }

  /** Capacity in records. */
  get capacity(): number {
    return this.sorted.byteLength / UNIT_INSTANCE_STRIDE;
  }

  /**
   * Counting sort by a precomputed bucket key per record (P2: key = visual × 3 + LOD). Keys
   * ≥ `bucketCount` are skipped (culled/dropped) and not counted in {@link dropped}; `dropped` is left
   * to the caller. Afterwards bucket b holds `count[b]` records starting at `start[b]`.
   */
  sortByKeys(src: Uint8Array, n: number, keys: Uint16Array, bucketCount: number, highlight?: Uint8Array): void {
    if (n * UNIT_INSTANCE_STRIDE > src.byteLength) throw new Error('VisualBuckets.sortByKeys: count exceeds source');
    this.ensure(n, bucketCount);
    const count = this.count;
    const start = this.start;
    const cursor = this.cursor;
    count.fill(0, 0, bucketCount);
    for (let i = 0; i < n; i++) {
      const k = keys[i]!;
      if (k < bucketCount) count[k]!++;
    }
    let acc = 0;
    for (let b = 0; b < bucketCount; b++) {
      start[b] = acc;
      cursor[b] = acc;
      acc += count[b]!;
    }
    const aligned = src.byteOffset % 4 === 0;
    let s32 = this.src32;
    if (aligned && (this.srcBuffer !== src.buffer || this.srcOffset !== src.byteOffset || s32.length < n * WORDS)) {
      s32 = this.src32 = new Uint32Array(src.buffer, src.byteOffset, src.byteLength >> 2);
      this.srcBuffer = src.buffer;
      this.srcOffset = src.byteOffset;
    }
    const d32 = this.sorted32;
    const d8 = this.sorted;
    const hl = this.highlight;
    const hasHl = highlight !== undefined;
    for (let i = 0; i < n; i++) {
      const k = keys[i]!;
      if (k >= bucketCount) continue;
      const j = cursor[k]!++;
      if (aligned) {
        const si = i * WORDS;
        const di = j * WORDS;
        for (let w = 0; w < WORDS; w++) d32[di + w] = s32[si + w]!;
      } else {
        const sb = i * UNIT_INSTANCE_STRIDE;
        const db = j * UNIT_INSTANCE_STRIDE;
        for (let w = 0; w < UNIT_INSTANCE_STRIDE; w++) d8[db + w] = src[sb + w]!;
      }
      hl[j] = hasHl ? (highlight[i] ?? 0) : 0;
    }
    this.total = acc;
  }

  sort(src: Uint8Array, n: number, highlight?: Uint8Array): void {
    const vc = this.visualCount;
    if (n * UNIT_INSTANCE_STRIDE > src.byteLength) throw new Error('VisualBuckets.sort: count exceeds source');
    this.ensure(n, vc);
    const count = this.count;
    const start = this.start;
    const cursor = this.cursor;
    count.fill(0, 0, vc);
    const aligned = src.byteOffset % 4 === 0;
    let s32 = this.src32;
    if (aligned && (this.srcBuffer !== src.buffer || this.srcOffset !== src.byteOffset || s32.length < n * WORDS)) {
      s32 = this.src32 = new Uint32Array(src.buffer, src.byteOffset, src.byteLength >> 2);
      this.srcBuffer = src.buffer;
      this.srcOffset = src.byteOffset;
    }
    let dropped = 0;
    for (let i = 0; i < n; i++) {
      const v = aligned
        ? s32[i * WORDS + VISUAL_WORD]! & 0xffff
        : src[i * UNIT_INSTANCE_STRIDE + UNIT_INSTANCE_OFF_VISUAL]! |
          (src[i * UNIT_INSTANCE_STRIDE + UNIT_INSTANCE_OFF_VISUAL + 1]! << 8);
      if (v < vc) count[v]!++;
      else dropped++;
    }
    let acc = 0;
    for (let v = 0; v < vc; v++) {
      start[v] = acc;
      cursor[v] = acc;
      acc += count[v]!;
    }
    const d32 = this.sorted32;
    const d8 = this.sorted;
    const hl = this.highlight;
    const hasHl = highlight !== undefined;
    for (let i = 0; i < n; i++) {
      const v = aligned
        ? s32[i * WORDS + VISUAL_WORD]! & 0xffff
        : src[i * UNIT_INSTANCE_STRIDE + UNIT_INSTANCE_OFF_VISUAL]! |
          (src[i * UNIT_INSTANCE_STRIDE + UNIT_INSTANCE_OFF_VISUAL + 1]! << 8);
      if (v >= vc) continue;
      const j = cursor[v]!++;
      if (aligned) {
        const si = i * WORDS;
        const di = j * WORDS;
        for (let k = 0; k < WORDS; k++) d32[di + k] = s32[si + k]!;
      } else {
        const sb = i * UNIT_INSTANCE_STRIDE;
        const db = j * UNIT_INSTANCE_STRIDE;
        for (let k = 0; k < UNIT_INSTANCE_STRIDE; k++) d8[db + k] = src[sb + k]!;
      }
      hl[j] = hasHl ? (highlight[i] ?? 0) : 0;
    }
    this.total = acc;
    this.dropped = dropped;
  }
}
