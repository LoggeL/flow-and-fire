/**
 * `sim.bin`: the compiled, sim-relevant blueprint table (PLAN §3.9 step 7) and its decoder.
 * This module is the contract between the blueprint compiler and the sim: it depends only on
 * @faf/fixed (no TypeBox) and is exported separately as `@faf/blueprints/simbin`.
 *
 * Layout (little-endian, all sections 4-byte aligned):
 *
 * Header (32 B)
 *    0 magic u32 'IFBP' (0x50424649)     4 version u16          6 headerBytes u16 (32)
 *    8 unitCount u16                     10 unitRecordBytes u16 (64)
 *   12 categoryCount u16                 14 categoryWords u16 (4)
 *   16 unitsOffset u32                   20 categoryNamesOffset u32
 *   24 unitIdsOffset u32                 28 totalBytes u32
 *
 * UnitRecord (64 B), index = blueprint sim id (u16, order of the sorted string ids)
 *    0 speedPerTick i32 (Fx, WU/tick)    4 accelPerTick i32 (Fx, WU/tick²)
 *    8 turnRatePerTick u16 (Ang16/tick) 10 layer u8 (MotionLayer)   11 sizeClass u8
 *   12 maxHp i32                        16 radius i32 (Fx)           20 vision i32 (Fx)
 *   24 maxSlope i32 (Fx)                28 footprintW u8             29 footprintH u8
 *   30 flags u16 (reserved, 0)          32 categories u32×4          48 reserved (16 B, 0)
 *
 * String tables (category names in bit order, then unit ids in sim-id order):
 *   per entry u8 length + ASCII bytes; each table zero-padded to 4 bytes.
 */
import { asAng16, asFx, xxHash32, type Ang16, type Fx } from '@faf/fixed';

/** 'IFBP' read as u32 little-endian. */
export const SIM_BIN_MAGIC = 0x50424649;
export const SIM_BIN_VERSION = 1;
export const SIM_BIN_HEADER_BYTES = 32;
export const SIM_BIN_UNIT_RECORD_BYTES = 64;
export const SIM_BIN_CATEGORY_WORDS = 4;
/** Maximum number of unit blueprints (u16 sim ids). */
export const SIM_BIN_MAX_UNITS = 0xffff;

// Unit record field offsets.
export const SBU_SPEED = 0;
export const SBU_ACCEL = 4;
export const SBU_TURN_RATE = 8;
export const SBU_LAYER = 10;
export const SBU_SIZE_CLASS = 11;
export const SBU_MAX_HP = 12;
export const SBU_RADIUS = 16;
export const SBU_VISION = 20;
export const SBU_MAX_SLOPE = 24;
export const SBU_FOOTPRINT_W = 28;
export const SBU_FOOTPRINT_H = 29;
export const SBU_FLAGS = 30;
export const SBU_CATEGORIES = 32;

/** One unit entry in sim units (already converted: Fx, Ang16, per tick). */
export interface SimBinUnit {
  readonly id: string;
  readonly speedPerTick: number;
  readonly accelPerTick: number;
  readonly turnRatePerTick: number;
  readonly layer: number;
  readonly sizeClass: number;
  readonly maxHp: number;
  readonly radius: number;
  readonly vision: number;
  readonly maxSlope: number;
  readonly footprintW: number;
  readonly footprintH: number;
  /** 4 × u32 category mask. */
  readonly categories: readonly [number, number, number, number];
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

function checkInt(what: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`sim.bin: ${what} out of range: ${v}`);
}

function checkAscii(what: string, s: string): void {
  if (s.length === 0 || s.length > 255) throw new RangeError(`sim.bin: ${what} '${s}' must have 1..255 characters`);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) throw new RangeError(`sim.bin: ${what} '${s}' must be printable ASCII`);
  }
}

function stringTableBytes(list: readonly string[]): number {
  let n = 0;
  for (const s of list) n += 1 + s.length;
  return align4(n);
}

function writeStrings(u8: Uint8Array, off: number, list: readonly string[]): number {
  let p = off;
  for (const s of list) {
    u8[p++] = s.length;
    for (let i = 0; i < s.length; i++) u8[p++] = s.charCodeAt(i);
  }
  return align4(p);
}

/**
 * Encodes a sim.bin. `units` must be sorted by id (code units) — the index is the sim id;
 * `categoryNames` are in bit order.
 */
export function encodeSimBin(units: readonly SimBinUnit[], categoryNames: readonly string[]): Uint8Array {
  if (units.length > SIM_BIN_MAX_UNITS) throw new RangeError(`sim.bin: too many units (${units.length})`);
  if (categoryNames.length > SIM_BIN_CATEGORY_WORDS * 32) throw new RangeError('sim.bin: too many categories');
  for (let i = 0; i < units.length; i++) {
    checkAscii('unit id', units[i]!.id);
    if (i > 0 && !(units[i - 1]!.id < units[i]!.id)) {
      throw new RangeError(`sim.bin: unit ids must be strictly sorted ('${units[i - 1]!.id}' ≥ '${units[i]!.id}')`);
    }
  }
  for (const c of categoryNames) checkAscii('category', c);
  const unitsOffset = SIM_BIN_HEADER_BYTES;
  const catOffset = unitsOffset + units.length * SIM_BIN_UNIT_RECORD_BYTES;
  const idsOffset = catOffset + stringTableBytes(categoryNames);
  const total = idsOffset + stringTableBytes(units.map((u) => u.id));
  const u8 = new Uint8Array(total);
  const dv = new DataView(u8.buffer);
  dv.setUint32(0, SIM_BIN_MAGIC, true);
  dv.setUint16(4, SIM_BIN_VERSION, true);
  dv.setUint16(6, SIM_BIN_HEADER_BYTES, true);
  dv.setUint16(8, units.length, true);
  dv.setUint16(10, SIM_BIN_UNIT_RECORD_BYTES, true);
  dv.setUint16(12, categoryNames.length, true);
  dv.setUint16(14, SIM_BIN_CATEGORY_WORDS, true);
  dv.setUint32(16, unitsOffset, true);
  dv.setUint32(20, catOffset, true);
  dv.setUint32(24, idsOffset, true);
  dv.setUint32(28, total, true);
  const I32 = 0x7fffffff;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const o = unitsOffset + i * SIM_BIN_UNIT_RECORD_BYTES;
    checkInt(`${u.id}.speedPerTick`, u.speedPerTick, 0, I32);
    checkInt(`${u.id}.accelPerTick`, u.accelPerTick, 0, I32);
    checkInt(`${u.id}.turnRatePerTick`, u.turnRatePerTick, 0, 32768);
    checkInt(`${u.id}.layer`, u.layer, 0, 255);
    checkInt(`${u.id}.sizeClass`, u.sizeClass, 0, 255);
    checkInt(`${u.id}.maxHp`, u.maxHp, 1, I32);
    checkInt(`${u.id}.radius`, u.radius, 1, I32);
    checkInt(`${u.id}.vision`, u.vision, 0, I32);
    checkInt(`${u.id}.maxSlope`, u.maxSlope, 0, I32);
    checkInt(`${u.id}.footprintW`, u.footprintW, 1, 255);
    checkInt(`${u.id}.footprintH`, u.footprintH, 1, 255);
    dv.setInt32(o + SBU_SPEED, u.speedPerTick, true);
    dv.setInt32(o + SBU_ACCEL, u.accelPerTick, true);
    dv.setUint16(o + SBU_TURN_RATE, u.turnRatePerTick, true);
    dv.setUint8(o + SBU_LAYER, u.layer);
    dv.setUint8(o + SBU_SIZE_CLASS, u.sizeClass);
    dv.setInt32(o + SBU_MAX_HP, u.maxHp, true);
    dv.setInt32(o + SBU_RADIUS, u.radius, true);
    dv.setInt32(o + SBU_VISION, u.vision, true);
    dv.setInt32(o + SBU_MAX_SLOPE, u.maxSlope, true);
    dv.setUint8(o + SBU_FOOTPRINT_W, u.footprintW);
    dv.setUint8(o + SBU_FOOTPRINT_H, u.footprintH);
    dv.setUint16(o + SBU_FLAGS, 0, true);
    for (let w = 0; w < SIM_BIN_CATEGORY_WORDS; w++) {
      dv.setUint32(o + SBU_CATEGORIES + w * 4, u.categories[w]! >>> 0, true);
    }
  }
  writeStrings(u8, catOffset, categoryNames);
  writeStrings(u8, idsOffset, units.map((u) => u.id));
  return u8;
}

/**
 * Decoded blueprint table: flat typed columns indexed by sim id. Built once by
 * `decodeSimBin`; all accessors are allocation-free.
 */
export class SimBpTable {
  /** Number of unit blueprints. */
  readonly count: number;
  /** xxHash32 (seed 0) of the sim.bin bytes = bpSimHash (PLAN §3.1 simId). */
  readonly simHash: number;
  /** String ids in sim-id order (sorted). */
  readonly ids: readonly string[];
  /** Category names in bit order. */
  readonly categoryNames: readonly string[];
  readonly speed: Int32Array;
  readonly accel: Int32Array;
  readonly turnRate: Int32Array;
  readonly maxHpCol: Int32Array;
  readonly radiusCol: Int32Array;
  readonly visionCol: Int32Array;
  readonly maxSlopeCol: Int32Array;
  readonly layerCol: Uint8Array;
  readonly sizeClassCol: Uint8Array;
  readonly footprintWCol: Uint8Array;
  readonly footprintHCol: Uint8Array;
  /** Category masks, 4 words per blueprint. */
  readonly categoryMasks: Uint32Array;

  /** @internal Use decodeSimBin. */
  constructor(count: number, simHash: number, ids: readonly string[], categoryNames: readonly string[]) {
    this.count = count;
    this.simHash = simHash;
    this.ids = ids;
    this.categoryNames = categoryNames;
    this.speed = new Int32Array(count);
    this.accel = new Int32Array(count);
    this.turnRate = new Int32Array(count);
    this.maxHpCol = new Int32Array(count);
    this.radiusCol = new Int32Array(count);
    this.visionCol = new Int32Array(count);
    this.maxSlopeCol = new Int32Array(count);
    this.layerCol = new Uint8Array(count);
    this.sizeClassCol = new Uint8Array(count);
    this.footprintWCol = new Uint8Array(count);
    this.footprintHCol = new Uint8Array(count);
    this.categoryMasks = new Uint32Array(count * SIM_BIN_CATEGORY_WORDS);
  }

  /** True if `bp` is a valid sim id. */
  has(bp: number): boolean {
    return bp >= 0 && bp < this.count && (bp | 0) === bp;
  }
  speedPerTick(bp: number): Fx {
    return asFx(this.speed[bp]!);
  }
  accelPerTick(bp: number): Fx {
    return asFx(this.accel[bp]!);
  }
  turnRatePerTick(bp: number): Ang16 {
    return asAng16(this.turnRate[bp]!);
  }
  maxHp(bp: number): number {
    return this.maxHpCol[bp]!;
  }
  radius(bp: number): Fx {
    return asFx(this.radiusCol[bp]!);
  }
  vision(bp: number): Fx {
    return asFx(this.visionCol[bp]!);
  }
  maxSlope(bp: number): Fx {
    return asFx(this.maxSlopeCol[bp]!);
  }
  layer(bp: number): number {
    return this.layerCol[bp]!;
  }
  sizeClass(bp: number): number {
    return this.sizeClassCol[bp]!;
  }
  footprintW(bp: number): number {
    return this.footprintWCol[bp]!;
  }
  footprintH(bp: number): number {
    return this.footprintHCol[bp]!;
  }
  /** Word `w` (0..3) of the category mask of `bp`. */
  categoryWord(bp: number, w: number): number {
    return this.categoryMasks[bp * SIM_BIN_CATEGORY_WORDS + w]!;
  }
  /** Copies the category mask of `bp` into `out` at `off` and returns `out`. */
  categories(bp: number, out: Uint32Array, off = 0): Uint32Array {
    const b = bp * SIM_BIN_CATEGORY_WORDS;
    for (let w = 0; w < SIM_BIN_CATEGORY_WORDS; w++) out[off + w] = this.categoryMasks[b + w]!;
    return out;
  }
  /** Offset of the mask of `bp` in `categoryMasks` (for `matchesMask(table.categoryMasks, expr, off)`). */
  categoryOffset(bp: number): number {
    return bp * SIM_BIN_CATEGORY_WORDS;
  }
  /** String id of `bp`. */
  idOf(bp: number): string {
    const id = this.ids[bp];
    if (id === undefined) throw new RangeError(`unknown blueprint sim id ${bp}`);
    return id;
  }
  /** Sim id of a string id (binary search), or −1. */
  indexOf(id: string): number {
    const ids = this.ids;
    let lo = 0;
    let hi = ids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const m = ids[mid]!;
      if (m === id) return mid;
      if (m < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

function readStrings(u8: Uint8Array, off: number, count: number, end: number, what: string): { list: string[]; end: number } {
  const list: string[] = [];
  let p = off;
  for (let i = 0; i < count; i++) {
    if (p >= end) throw new RangeError(`sim.bin: ${what} table truncated`);
    const len = u8[p++]!;
    if (len === 0 || p + len > end) throw new RangeError(`sim.bin: ${what} table corrupt`);
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(u8[p + k]!);
    list.push(s);
    p += len;
  }
  return { list, end: align4(p) };
}

/** Decodes and validates a sim.bin (throws RangeError on malformed input). */
export function decodeSimBin(bytes: Uint8Array): SimBpTable {
  if (bytes.length < SIM_BIN_HEADER_BYTES) throw new RangeError('sim.bin: truncated header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== SIM_BIN_MAGIC) throw new RangeError("sim.bin: bad magic (expected 'IFBP')");
  const version = dv.getUint16(4, true);
  if (version !== SIM_BIN_VERSION) throw new RangeError(`sim.bin: unsupported version ${version}`);
  const headerBytes = dv.getUint16(6, true);
  const count = dv.getUint16(8, true);
  const recBytes = dv.getUint16(10, true);
  const catCount = dv.getUint16(12, true);
  const catWords = dv.getUint16(14, true);
  const unitsOff = dv.getUint32(16, true);
  const catOff = dv.getUint32(20, true);
  const idsOff = dv.getUint32(24, true);
  const total = dv.getUint32(28, true);
  if (headerBytes < SIM_BIN_HEADER_BYTES || recBytes < SIM_BIN_UNIT_RECORD_BYTES || catWords !== SIM_BIN_CATEGORY_WORDS) {
    throw new RangeError('sim.bin: unsupported header geometry');
  }
  if (total !== bytes.length) throw new RangeError(`sim.bin: length ${bytes.length} ≠ header total ${total}`);
  if (catCount > SIM_BIN_CATEGORY_WORDS * 32) throw new RangeError('sim.bin: too many categories');
  if (unitsOff < headerBytes || unitsOff + count * recBytes > catOff || catOff > idsOff || idsOff > total) {
    throw new RangeError('sim.bin: section offsets out of order');
  }
  const cats = readStrings(bytes, catOff, catCount, idsOff, 'category');
  const ids = readStrings(bytes, idsOff, count, total, 'unit id');
  if (ids.end !== total) throw new RangeError('sim.bin: trailing bytes');
  for (let i = 1; i < ids.list.length; i++) {
    if (!(ids.list[i - 1]! < ids.list[i]!)) throw new RangeError('sim.bin: unit ids not sorted');
  }
  const t = new SimBpTable(count, xxHash32(bytes, 0, bytes.length, 0), ids.list, cats.list);
  for (let i = 0; i < count; i++) {
    const o = unitsOff + i * recBytes;
    t.speed[i] = dv.getInt32(o + SBU_SPEED, true);
    t.accel[i] = dv.getInt32(o + SBU_ACCEL, true);
    t.turnRate[i] = dv.getUint16(o + SBU_TURN_RATE, true);
    t.layerCol[i] = dv.getUint8(o + SBU_LAYER);
    t.sizeClassCol[i] = dv.getUint8(o + SBU_SIZE_CLASS);
    t.maxHpCol[i] = dv.getInt32(o + SBU_MAX_HP, true);
    t.radiusCol[i] = dv.getInt32(o + SBU_RADIUS, true);
    t.visionCol[i] = dv.getInt32(o + SBU_VISION, true);
    t.maxSlopeCol[i] = dv.getInt32(o + SBU_MAX_SLOPE, true);
    t.footprintWCol[i] = dv.getUint8(o + SBU_FOOTPRINT_W);
    t.footprintHCol[i] = dv.getUint8(o + SBU_FOOTPRINT_H);
    for (let w = 0; w < SIM_BIN_CATEGORY_WORDS; w++) {
      t.categoryMasks[i * SIM_BIN_CATEGORY_WORDS + w] = dv.getUint32(o + SBU_CATEGORIES + w * 4, true);
    }
    if (t.maxHpCol[i]! < 1 || t.radiusCol[i]! < 1 || t.speed[i]! < 0 || t.accel[i]! < 0) {
      throw new RangeError(`sim.bin: invalid values in unit record ${i}`);
    }
  }
  return t;
}
