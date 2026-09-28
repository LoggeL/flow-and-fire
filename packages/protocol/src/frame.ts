/**
 * Frame layout (PLAN §3.6): what the sim sends to the renderer each tick, filtered for the
 * viewer. Versioned; the layout is only ever extended (new header fields go after the current
 * header, `headerBytes` tells readers where sections may start).
 *
 * All values little-endian. Sections are 4-byte aligned and packed in this order:
 *   header (96 B) | units | parts | projectiles | beams | events | debug
 *
 * FrameHeader:
 *    0 magic u32 'IFRM'        4 ver u16                 6 headerBytes u16
 *    8 seq u32                12 tick u32               16 tickTimeUs u32
 *   20 speedPermille u16      22 viewer i8              23 flags u8 (bit0 paused)
 *   24 ackSeq u32             28 hashTick u32           32 hash u32
 *   36 counts u32×5 (units, parts, projectiles, beams, events)
 *   56 offsets u32×5 (same order)
 *   76 fogRect u16×4 (x0, y0, x1, y1)
 *   84 footprintDeltaCount u32 88 debugOffset u32        92 debugBytes u32
 *
 * UnitRecord (48 B):
 *    0 prevPos i32×3 | 12 curPos i32×3 | 24 prevYaw u16 | 26 curYaw u16 | 28 visual u16 |
 *   30 army u8 | 31 hp u8 | 32 build u8 | 33 bank i8 | 34 flags u16 | 36 handle u32 |
 *   40 partBase u32 | 44 partCount u8 | 45 reserved[3]
 * PartRecord (8 B):       0 prevYaw u16 | 2 curYaw u16 | 4 prevPitch i16 | 6 curPitch i16
 * ProjectileRecord (28 B): 0 prevPos i32×3 | 12 curPos i32×3 | 24 visual u16 | 26 army u8 | 27 flags u8
 * BeamRecord (12 B):      0 srcHandle u32 | 4 dstHandle u32 | 8 visual u16 | 10 srcPart u8 | 11 flags u8
 * EventRecord (32 B):     0 type u16 | 2 visual u16 | 4 tick u32 | 8 subTick u8 | 9 flags u8 |
 *                         10 reserved u16 | 12 pos i32×3 | 24 aux u32 | 28 handle u32
 */

import { DataViewCache } from './bytes.ts';

/** 'IFRM' read as u32 little-endian. */
export const FRAME_MAGIC = 0x4d524649;
export const FRAME_VERSION = 1;
export const FRAME_HEADER_BYTES = 96;

// ---- header offsets ----
export const FH_MAGIC = 0;
export const FH_VERSION = 4;
export const FH_HEADER_BYTES = 6;
export const FH_SEQ = 8;
export const FH_TICK = 12;
export const FH_TICK_TIME_US = 16;
export const FH_SPEED_PERMILLE = 20;
export const FH_VIEWER = 22;
export const FH_FLAGS = 23;
export const FH_ACK_SEQ = 24;
export const FH_HASH_TICK = 28;
export const FH_HASH = 32;
export const FH_COUNTS = 36;
export const FH_OFFSETS = 56;
export const FH_FOG_RECT = 76;
export const FH_FOOTPRINT_DELTA_COUNT = 84;
export const FH_DEBUG_OFFSET = 88;
export const FH_DEBUG_BYTES = 92;

/** Header flag bits. */
export const FrameFlags = {
  Paused: 1 << 0,
} as const;

/** Record sections of a frame (index into counts/offsets). */
export const FrameSection = {
  Units: 0,
  Parts: 1,
  Projectiles: 2,
  Beams: 3,
  Events: 4,
} as const;
export type FrameSection = (typeof FrameSection)[keyof typeof FrameSection];
export const FRAME_SECTION_COUNT = 5;

// ---- UnitRecord ----
export const UNIT_RECORD_BYTES = 48;
export const UNIT_OFF_PREV_POS = 0;
export const UNIT_OFF_CUR_POS = 12;
export const UNIT_OFF_PREV_YAW = 24;
export const UNIT_OFF_CUR_YAW = 26;
export const UNIT_OFF_VISUAL = 28;
export const UNIT_OFF_ARMY = 30;
export const UNIT_OFF_HP = 31;
export const UNIT_OFF_BUILD = 32;
export const UNIT_OFF_BANK = 33;
export const UNIT_OFF_FLAGS = 34;
export const UNIT_OFF_HANDLE = 36;
export const UNIT_OFF_PART_BASE = 40;
export const UNIT_OFF_PART_COUNT = 44;
export const UNIT_OFF_RESERVED = 45;

/** UnitRecord.flags bits. `vet` is a 2-bit field (value = (flags & VetMask) >> VetShift). */
export const UnitFlags = {
  Building: 1 << 0,
  Wreck: 1 << 1,
  Ghost: 1 << 2,
  Blip: 1 << 3,
  VetShift: 4,
  VetMask: 3 << 4,
  ShieldUp: 1 << 6,
  Stalled: 1 << 7,
  Damaged: 1 << 8,
  Idle: 1 << 9,
  NoInterp: 1 << 10,
} as const;

/** Maximum parts per unit (PartStream). */
export const MAX_PARTS_PER_UNIT = 8;

// ---- PartRecord ----
export const PART_RECORD_BYTES = 8;
export const PART_OFF_PREV_YAW = 0;
export const PART_OFF_CUR_YAW = 2;
export const PART_OFF_PREV_PITCH = 4;
export const PART_OFF_CUR_PITCH = 6;

// ---- ProjectileRecord ----
export const PROJECTILE_RECORD_BYTES = 28;
export const PROJ_OFF_PREV_POS = 0;
export const PROJ_OFF_CUR_POS = 12;
export const PROJ_OFF_VISUAL = 24;
export const PROJ_OFF_ARMY = 26;
export const PROJ_OFF_FLAGS = 27;

// ---- BeamRecord ----
export const BEAM_RECORD_BYTES = 12;
export const BEAM_OFF_SRC_HANDLE = 0;
export const BEAM_OFF_DST_HANDLE = 4;
export const BEAM_OFF_VISUAL = 8;
export const BEAM_OFF_SRC_PART = 10;
export const BEAM_OFF_FLAGS = 11;

// ---- EventRecord ----
export const EVENT_RECORD_BYTES = 32;
export const EVENT_OFF_TYPE = 0;
export const EVENT_OFF_VISUAL = 2;
export const EVENT_OFF_TICK = 4;
export const EVENT_OFF_SUB_TICK = 8;
export const EVENT_OFF_FLAGS = 9;
export const EVENT_OFF_RESERVED = 10;
export const EVENT_OFF_POS = 12;
export const EVENT_OFF_AUX = 24;
export const EVENT_OFF_HANDLE = 28;

/** Record size per section, indexed by FrameSection. */
export const SECTION_RECORD_BYTES: readonly number[] = [
  UNIT_RECORD_BYTES,
  PART_RECORD_BYTES,
  PROJECTILE_RECORD_BYTES,
  BEAM_RECORD_BYTES,
  EVENT_RECORD_BYTES,
];

/** Per-frame capacities (upper bounds; the real frame is packed to its content). */
export interface FrameCaps {
  readonly units: number;
  readonly parts: number;
  readonly projectiles: number;
  readonly beams: number;
  readonly events: number;
  readonly debugBytes: number;
}

/** Capacities from PLAN §3.4: 8,192 units (≤ 8 parts each), 16,384 projectiles. */
export const DEFAULT_FRAME_CAPS: FrameCaps = {
  units: 8192,
  parts: 8192 * MAX_PARTS_PER_UNIT,
  projectiles: 16384,
  beams: 2048,
  events: 4096,
  debugBytes: 65536,
};

function align4(n: number): number {
  return (n + 3) & ~3;
}

function capsArray(c: FrameCaps): number[] {
  return [c.units, c.parts, c.projectiles, c.beams, c.events];
}

function checkCaps(c: FrameCaps): void {
  for (const v of [...capsArray(c), c.debugBytes]) {
    if (!Number.isInteger(v) || v < 0 || v > 0x1000000) throw new RangeError(`invalid frame cap ${v}`);
  }
}

/** Byte size of a frame buffer that can hold any frame within `caps`. */
export function frameCapacityBytes(caps: FrameCaps = DEFAULT_FRAME_CAPS): number {
  checkCaps(caps);
  const c = capsArray(caps);
  let n = FRAME_HEADER_BYTES;
  for (let s = 0; s < FRAME_SECTION_COUNT; s++) n += c[s]! * SECTION_RECORD_BYTES[s]!;
  return n + align4(caps.debugBytes);
}

/**
 * Writes frames into a caller-provided buffer without allocating (after the first use of a
 * given target buffer, whose DataView is cached).
 *
 * Records of every section can be written in any interleaving (e.g. a unit, then its parts):
 * while a frame is open each section is staged at its capacity offset; `endFrame()` packs the
 * sections behind each other (memmove) and fills counts/offsets. The target must hold at least
 * `capacityBytes`.
 */
export class FrameWriter {
  readonly caps: FrameCaps;
  readonly capacityBytes: number;
  private readonly capArr: Int32Array;
  private readonly stage: Int32Array;
  private readonly counts = new Int32Array(FRAME_SECTION_COUNT);
  private readonly dvCache = new DataViewCache(4);
  private readonly debugStage: number;
  private target: Uint8Array = new Uint8Array(0);
  private dv: DataView = new DataView(new ArrayBuffer(0));
  private debugLen = 0;
  private open = false;
  /** Records rejected because a section was full (reset by beginFrame). */
  dropped = 0;

  constructor(caps: FrameCaps = DEFAULT_FRAME_CAPS) {
    this.caps = caps;
    this.capacityBytes = frameCapacityBytes(caps);
    this.capArr = Int32Array.from(capsArray(caps));
    this.stage = new Int32Array(FRAME_SECTION_COUNT);
    let off = FRAME_HEADER_BYTES;
    for (let s = 0; s < FRAME_SECTION_COUNT; s++) {
      this.stage[s] = off;
      off += this.capArr[s]! * SECTION_RECORD_BYTES[s]!;
    }
    this.debugStage = off;
  }

  /** Starts a frame in `target` and writes the fixed header fields. */
  beginFrame(
    target: Uint8Array,
    seq: number,
    tick: number,
    tickTimeUs: number,
    speedPermille: number,
    viewer: number,
    flags: number,
    ackSeq: number,
    hashTick: number,
    hash: number,
  ): void {
    if (target.length < this.capacityBytes) {
      throw new RangeError(`frame target too small: ${target.length} < ${this.capacityBytes}`);
    }
    const dv = this.dvCache.get(target);
    this.target = target;
    this.dv = dv;
    this.open = true;
    this.dropped = 0;
    this.debugLen = 0;
    this.counts.fill(0);
    dv.setUint32(FH_MAGIC, FRAME_MAGIC, true);
    dv.setUint16(FH_VERSION, FRAME_VERSION, true);
    dv.setUint16(FH_HEADER_BYTES, FRAME_HEADER_BYTES, true);
    dv.setUint32(FH_SEQ, seq >>> 0, true);
    dv.setUint32(FH_TICK, tick >>> 0, true);
    dv.setUint32(FH_TICK_TIME_US, tickTimeUs >>> 0, true);
    dv.setUint16(FH_SPEED_PERMILLE, speedPermille, true);
    dv.setInt8(FH_VIEWER, viewer);
    dv.setUint8(FH_FLAGS, flags);
    dv.setUint32(FH_ACK_SEQ, ackSeq >>> 0, true);
    dv.setUint32(FH_HASH_TICK, hashTick >>> 0, true);
    dv.setUint32(FH_HASH, hash >>> 0, true);
    dv.setUint16(FH_FOG_RECT, 0, true);
    dv.setUint16(FH_FOG_RECT + 2, 0, true);
    dv.setUint16(FH_FOG_RECT + 4, 0, true);
    dv.setUint16(FH_FOG_RECT + 6, 0, true);
    dv.setUint32(FH_FOOTPRINT_DELTA_COUNT, 0, true);
  }

  /** Fog dirty rectangle (cells). */
  setFogRect(x0: number, y0: number, x1: number, y1: number): void {
    const dv = this.dv;
    dv.setUint16(FH_FOG_RECT, x0, true);
    dv.setUint16(FH_FOG_RECT + 2, y0, true);
    dv.setUint16(FH_FOG_RECT + 4, x1, true);
    dv.setUint16(FH_FOG_RECT + 6, y1, true);
  }

  setFootprintDeltaCount(n: number): void {
    this.dv.setUint32(FH_FOOTPRINT_DELTA_COUNT, n >>> 0, true);
  }

  /** Records written so far per section. */
  count(section: FrameSection): number {
    return this.counts[section]!;
  }

  get unitCount(): number {
    return this.counts[FrameSection.Units]!;
  }

  get partCount(): number {
    return this.counts[FrameSection.Parts]!;
  }

  /** Reserves the next record of `section`; returns its staged byte offset or −1 if full. */
  private slot(section: number): number {
    if (!this.open) throw new Error('FrameWriter: no open frame (call beginFrame)');
    const i = this.counts[section]!;
    if (i >= this.capArr[section]!) {
      this.dropped++;
      return -1;
    }
    this.counts[section] = i + 1;
    return this.stage[section]! + i * SECTION_RECORD_BYTES[section]!;
  }

  /** Appends a UnitRecord; returns its index or −1 if the unit section is full. */
  writeUnit(
    prevX: number,
    prevY: number,
    prevZ: number,
    curX: number,
    curY: number,
    curZ: number,
    prevYaw: number,
    curYaw: number,
    visual: number,
    army: number,
    hp: number,
    build: number,
    bank: number,
    flags: number,
    handle: number,
    partBase: number,
    partCount: number,
  ): number {
    const o = this.slot(FrameSection.Units);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setInt32(o + UNIT_OFF_PREV_POS, prevX, true);
    dv.setInt32(o + UNIT_OFF_PREV_POS + 4, prevY, true);
    dv.setInt32(o + UNIT_OFF_PREV_POS + 8, prevZ, true);
    dv.setInt32(o + UNIT_OFF_CUR_POS, curX, true);
    dv.setInt32(o + UNIT_OFF_CUR_POS + 4, curY, true);
    dv.setInt32(o + UNIT_OFF_CUR_POS + 8, curZ, true);
    dv.setUint16(o + UNIT_OFF_PREV_YAW, prevYaw, true);
    dv.setUint16(o + UNIT_OFF_CUR_YAW, curYaw, true);
    dv.setUint16(o + UNIT_OFF_VISUAL, visual, true);
    dv.setUint8(o + UNIT_OFF_ARMY, army);
    dv.setUint8(o + UNIT_OFF_HP, hp);
    dv.setUint8(o + UNIT_OFF_BUILD, build);
    dv.setInt8(o + UNIT_OFF_BANK, bank);
    dv.setUint16(o + UNIT_OFF_FLAGS, flags, true);
    dv.setUint32(o + UNIT_OFF_HANDLE, handle >>> 0, true);
    dv.setUint32(o + UNIT_OFF_PART_BASE, partBase >>> 0, true);
    dv.setUint8(o + UNIT_OFF_PART_COUNT, partCount);
    dv.setUint8(o + UNIT_OFF_RESERVED, 0);
    dv.setUint16(o + UNIT_OFF_RESERVED + 1, 0, true);
    return this.counts[FrameSection.Units]! - 1;
  }

  /** Appends a PartRecord; returns its index or −1. */
  writePart(prevYaw: number, curYaw: number, prevPitch: number, curPitch: number): number {
    const o = this.slot(FrameSection.Parts);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setUint16(o + PART_OFF_PREV_YAW, prevYaw, true);
    dv.setUint16(o + PART_OFF_CUR_YAW, curYaw, true);
    dv.setInt16(o + PART_OFF_PREV_PITCH, prevPitch, true);
    dv.setInt16(o + PART_OFF_CUR_PITCH, curPitch, true);
    return this.counts[FrameSection.Parts]! - 1;
  }

  /** Appends a ProjectileRecord; returns its index or −1. */
  writeProjectile(
    prevX: number,
    prevY: number,
    prevZ: number,
    curX: number,
    curY: number,
    curZ: number,
    visual: number,
    army: number,
    flags: number,
  ): number {
    const o = this.slot(FrameSection.Projectiles);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setInt32(o + PROJ_OFF_PREV_POS, prevX, true);
    dv.setInt32(o + PROJ_OFF_PREV_POS + 4, prevY, true);
    dv.setInt32(o + PROJ_OFF_PREV_POS + 8, prevZ, true);
    dv.setInt32(o + PROJ_OFF_CUR_POS, curX, true);
    dv.setInt32(o + PROJ_OFF_CUR_POS + 4, curY, true);
    dv.setInt32(o + PROJ_OFF_CUR_POS + 8, curZ, true);
    dv.setUint16(o + PROJ_OFF_VISUAL, visual, true);
    dv.setUint8(o + PROJ_OFF_ARMY, army);
    dv.setUint8(o + PROJ_OFF_FLAGS, flags);
    return this.counts[FrameSection.Projectiles]! - 1;
  }

  /** Appends a BeamRecord; returns its index or −1. */
  writeBeam(srcHandle: number, dstHandle: number, visual: number, srcPart: number, flags: number): number {
    const o = this.slot(FrameSection.Beams);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setUint32(o + BEAM_OFF_SRC_HANDLE, srcHandle >>> 0, true);
    dv.setUint32(o + BEAM_OFF_DST_HANDLE, dstHandle >>> 0, true);
    dv.setUint16(o + BEAM_OFF_VISUAL, visual, true);
    dv.setUint8(o + BEAM_OFF_SRC_PART, srcPart);
    dv.setUint8(o + BEAM_OFF_FLAGS, flags);
    return this.counts[FrameSection.Beams]! - 1;
  }

  /** Appends an EventRecord; returns its index or −1. */
  writeEvent(
    type: number,
    visual: number,
    tick: number,
    subTick: number,
    flags: number,
    x: number,
    y: number,
    z: number,
    aux: number,
    handle: number,
  ): number {
    const o = this.slot(FrameSection.Events);
    if (o < 0) return -1;
    const dv = this.dv;
    dv.setUint16(o + EVENT_OFF_TYPE, type, true);
    dv.setUint16(o + EVENT_OFF_VISUAL, visual, true);
    dv.setUint32(o + EVENT_OFF_TICK, tick >>> 0, true);
    dv.setUint8(o + EVENT_OFF_SUB_TICK, subTick);
    dv.setUint8(o + EVENT_OFF_FLAGS, flags);
    dv.setUint16(o + EVENT_OFF_RESERVED, 0, true);
    dv.setInt32(o + EVENT_OFF_POS, x, true);
    dv.setInt32(o + EVENT_OFF_POS + 4, y, true);
    dv.setInt32(o + EVENT_OFF_POS + 8, z, true);
    dv.setUint32(o + EVENT_OFF_AUX, aux >>> 0, true);
    dv.setUint32(o + EVENT_OFF_HANDLE, handle >>> 0, true);
    return this.counts[FrameSection.Events]! - 1;
  }

  /** Copies `len` bytes from `src[off…]` into the debug section (replaces earlier content). */
  setDebugSection(src: Uint8Array, off = 0, len = src.length - off): void {
    if (!this.open) throw new Error('FrameWriter: no open frame (call beginFrame)');
    if (len < 0 || off < 0 || off + len > src.length) throw new RangeError('debug range out of bounds');
    if (len > this.caps.debugBytes) throw new RangeError(`debug section too large: ${len} > ${this.caps.debugBytes}`);
    const t = this.target;
    for (let i = 0; i < len; i++) t[this.debugStage + i] = src[off + i]!;
    this.debugLen = len;
  }

  /** Packs the sections, writes counts/offsets and returns the frame's byte length. */
  endFrame(): number {
    if (!this.open) throw new Error('FrameWriter: no open frame (call beginFrame)');
    this.open = false;
    const t = this.target;
    const dv = this.dv;
    let off = FRAME_HEADER_BYTES;
    for (let s = 0; s < FRAME_SECTION_COUNT; s++) {
      const n = this.counts[s]!;
      const bytes = n * SECTION_RECORD_BYTES[s]!;
      const from = this.stage[s]!;
      if (bytes > 0 && from !== off) t.copyWithin(off, from, from + bytes);
      dv.setUint32(FH_COUNTS + s * 4, n, true);
      dv.setUint32(FH_OFFSETS + s * 4, off, true);
      off += bytes;
    }
    const dbg = this.debugLen;
    if (dbg > 0 && this.debugStage !== off) t.copyWithin(off, this.debugStage, this.debugStage + dbg);
    dv.setUint32(FH_DEBUG_OFFSET, off, true);
    dv.setUint32(FH_DEBUG_BYTES, dbg, true);
    // Zero the alignment padding so equal content always yields equal bytes.
    const end = off + dbg;
    const padded = align4(end);
    for (let i = end; i < padded; i++) t[i] = 0;
    return padded;
  }
}

/**
 * Zero-copy reader over a frame. `reset(bytes)` validates header and section bounds; accessors
 * read through a cached DataView (no allocation for recurring buffers).
 */
export class FrameReader {
  private readonly dvCache = new DataViewCache(4);
  private dv: DataView = new DataView(new ArrayBuffer(0));
  private u8: Uint8Array = new Uint8Array(0);
  private uo = 0;
  private po = 0;
  private jo = 0;
  private bo = 0;
  private eo = 0;

  /** Binds to a frame; returns false if magic/version/bounds are invalid. */
  reset(bytes: Uint8Array): boolean {
    if (bytes.length < FRAME_HEADER_BYTES) return false;
    const dv = this.dvCache.get(bytes);
    if (dv.getUint32(FH_MAGIC, true) !== FRAME_MAGIC) return false;
    if (dv.getUint16(FH_VERSION, true) < 1) return false;
    const hb = dv.getUint16(FH_HEADER_BYTES, true);
    if (hb < FRAME_HEADER_BYTES || hb > bytes.length) return false;
    for (let s = 0; s < FRAME_SECTION_COUNT; s++) {
      const n = dv.getUint32(FH_COUNTS + s * 4, true);
      const o = dv.getUint32(FH_OFFSETS + s * 4, true);
      if ((o & 3) !== 0 || o < hb || o + n * SECTION_RECORD_BYTES[s]! > bytes.length) return false;
    }
    const dOff = dv.getUint32(FH_DEBUG_OFFSET, true);
    const dLen = dv.getUint32(FH_DEBUG_BYTES, true);
    if (dOff + dLen > bytes.length) return false;
    this.dv = dv;
    this.u8 = bytes;
    this.uo = dv.getUint32(FH_OFFSETS + FrameSection.Units * 4, true);
    this.po = dv.getUint32(FH_OFFSETS + FrameSection.Parts * 4, true);
    this.jo = dv.getUint32(FH_OFFSETS + FrameSection.Projectiles * 4, true);
    this.bo = dv.getUint32(FH_OFFSETS + FrameSection.Beams * 4, true);
    this.eo = dv.getUint32(FH_OFFSETS + FrameSection.Events * 4, true);
    return true;
  }

  /** The bound frame bytes. */
  get bytes(): Uint8Array {
    return this.u8;
  }
  get dataView(): DataView {
    return this.dv;
  }

  // ---- header ----
  get version(): number {
    return this.dv.getUint16(FH_VERSION, true);
  }
  get headerBytes(): number {
    return this.dv.getUint16(FH_HEADER_BYTES, true);
  }
  get seq(): number {
    return this.dv.getUint32(FH_SEQ, true);
  }
  get tick(): number {
    return this.dv.getUint32(FH_TICK, true);
  }
  get tickTimeUs(): number {
    return this.dv.getUint32(FH_TICK_TIME_US, true);
  }
  get speedPermille(): number {
    return this.dv.getUint16(FH_SPEED_PERMILLE, true);
  }
  get viewer(): number {
    return this.dv.getInt8(FH_VIEWER);
  }
  get flags(): number {
    return this.dv.getUint8(FH_FLAGS);
  }
  get paused(): boolean {
    return (this.flags & FrameFlags.Paused) !== 0;
  }
  get ackSeq(): number {
    return this.dv.getUint32(FH_ACK_SEQ, true);
  }
  get hashTick(): number {
    return this.dv.getUint32(FH_HASH_TICK, true);
  }
  get hash(): number {
    return this.dv.getUint32(FH_HASH, true);
  }
  count(section: FrameSection): number {
    return this.dv.getUint32(FH_COUNTS + section * 4, true);
  }
  offset(section: FrameSection): number {
    return this.dv.getUint32(FH_OFFSETS + section * 4, true);
  }
  get unitCount(): number {
    return this.count(FrameSection.Units);
  }
  get partCount(): number {
    return this.count(FrameSection.Parts);
  }
  get projectileCount(): number {
    return this.count(FrameSection.Projectiles);
  }
  get beamCount(): number {
    return this.count(FrameSection.Beams);
  }
  get eventCount(): number {
    return this.count(FrameSection.Events);
  }
  get unitsOffset(): number {
    return this.uo;
  }
  /** Fog rect component 0..3 = x0, y0, x1, y1. */
  fogRect(i: number): number {
    return this.dv.getUint16(FH_FOG_RECT + i * 2, true);
  }
  get footprintDeltaCount(): number {
    return this.dv.getUint32(FH_FOOTPRINT_DELTA_COUNT, true);
  }
  get debugOffset(): number {
    return this.dv.getUint32(FH_DEBUG_OFFSET, true);
  }
  get debugBytes(): number {
    return this.dv.getUint32(FH_DEBUG_BYTES, true);
  }

  /** View of a whole record section (e.g. for a GPU upload). Allocates a view object. */
  section(section: FrameSection): Uint8Array {
    const o = this.offset(section);
    return this.u8.subarray(o, o + this.count(section) * SECTION_RECORD_BYTES[section]!);
  }

  /** View of the debug section. Allocates a view object. */
  debugSection(): Uint8Array {
    const o = this.debugOffset;
    return this.u8.subarray(o, o + this.debugBytes);
  }

  // ---- units ----
  /** Byte offset of unit record `i` in the frame. */
  unitOffset(i: number): number {
    return this.uo + i * UNIT_RECORD_BYTES;
  }
  /** prevPos component c (0 = x, 1 = y, 2 = z), Fx raw. */
  unitPrev(i: number, c: number): number {
    return this.dv.getInt32(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_PREV_POS + c * 4, true);
  }
  /** curPos component c (0 = x, 1 = y, 2 = z), Fx raw. */
  unitCur(i: number, c: number): number {
    return this.dv.getInt32(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_CUR_POS + c * 4, true);
  }
  unitPrevYaw(i: number): number {
    return this.dv.getUint16(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_PREV_YAW, true);
  }
  unitCurYaw(i: number): number {
    return this.dv.getUint16(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_CUR_YAW, true);
  }
  unitVisual(i: number): number {
    return this.dv.getUint16(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_VISUAL, true);
  }
  unitArmy(i: number): number {
    return this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_ARMY);
  }
  unitHp(i: number): number {
    return this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_HP);
  }
  unitBuild(i: number): number {
    return this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_BUILD);
  }
  unitBank(i: number): number {
    return this.dv.getInt8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_BANK);
  }
  unitFlags(i: number): number {
    return this.dv.getUint16(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_FLAGS, true);
  }
  unitHandle(i: number): number {
    return this.dv.getUint32(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_HANDLE, true);
  }
  unitPartBase(i: number): number {
    return this.dv.getUint32(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_PART_BASE, true);
  }
  unitPartCount(i: number): number {
    return this.dv.getUint8(this.uo + i * UNIT_RECORD_BYTES + UNIT_OFF_PART_COUNT);
  }

  // ---- parts ----
  partPrevYaw(i: number): number {
    return this.dv.getUint16(this.po + i * PART_RECORD_BYTES + PART_OFF_PREV_YAW, true);
  }
  partCurYaw(i: number): number {
    return this.dv.getUint16(this.po + i * PART_RECORD_BYTES + PART_OFF_CUR_YAW, true);
  }
  partPrevPitch(i: number): number {
    return this.dv.getInt16(this.po + i * PART_RECORD_BYTES + PART_OFF_PREV_PITCH, true);
  }
  partCurPitch(i: number): number {
    return this.dv.getInt16(this.po + i * PART_RECORD_BYTES + PART_OFF_CUR_PITCH, true);
  }

  // ---- projectiles ----
  projectilePrev(i: number, c: number): number {
    return this.dv.getInt32(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_PREV_POS + c * 4, true);
  }
  projectileCur(i: number, c: number): number {
    return this.dv.getInt32(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_CUR_POS + c * 4, true);
  }
  projectileVisual(i: number): number {
    return this.dv.getUint16(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_VISUAL, true);
  }
  projectileArmy(i: number): number {
    return this.dv.getUint8(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_ARMY);
  }
  projectileFlags(i: number): number {
    return this.dv.getUint8(this.jo + i * PROJECTILE_RECORD_BYTES + PROJ_OFF_FLAGS);
  }

  // ---- beams ----
  beamSrcHandle(i: number): number {
    return this.dv.getUint32(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_SRC_HANDLE, true);
  }
  beamDstHandle(i: number): number {
    return this.dv.getUint32(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_DST_HANDLE, true);
  }
  beamVisual(i: number): number {
    return this.dv.getUint16(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_VISUAL, true);
  }
  beamSrcPart(i: number): number {
    return this.dv.getUint8(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_SRC_PART);
  }
  beamFlags(i: number): number {
    return this.dv.getUint8(this.bo + i * BEAM_RECORD_BYTES + BEAM_OFF_FLAGS);
  }

  // ---- events ----
  eventType(i: number): number {
    return this.dv.getUint16(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_TYPE, true);
  }
  eventVisual(i: number): number {
    return this.dv.getUint16(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_VISUAL, true);
  }
  eventTick(i: number): number {
    return this.dv.getUint32(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_TICK, true);
  }
  eventSubTick(i: number): number {
    return this.dv.getUint8(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_SUB_TICK);
  }
  eventFlags(i: number): number {
    return this.dv.getUint8(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_FLAGS);
  }
  eventPos(i: number, c: number): number {
    return this.dv.getInt32(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_POS + c * 4, true);
  }
  eventAux(i: number): number {
    return this.dv.getUint32(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_AUX, true);
  }
  eventHandle(i: number): number {
    return this.dv.getUint32(this.eo + i * EVENT_RECORD_BYTES + EVENT_OFF_HANDLE, true);
  }
}
