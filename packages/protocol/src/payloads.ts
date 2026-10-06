/**
 * Command payload layouts (little-endian). Each payload has an encoder (tools/client), a
 * decoder into a fresh object, and allocation-free readers working on a DataView + offset
 * (used by the sim together with `CommandBatchView.dataView/payloadOffset`).
 *
 * Move          (12 B): i32 x | i32 y | i32 z                      (Fx raw, world position)
 * CheatSpawn    (18 B): u8 sub=1 | u16 bp | u8 army | u16 count | i32 x | i32 z | i32 spread
 * CheatKill     ( 1 B): u8 sub=2                                   (targets = envelope units)
 * CheatFootprint(14 B): u8 sub=3 | i32 cellX | i32 cellZ | u16 w | u16 h | i8 delta
 *                       (nav cells = WU; delta +1 adds, −1 removes the rectangle; MS3 obstacles)
 */

import { asFx, type Fx } from '@faf/fixed';
import { CheatSub } from './ops.ts';

export const MOVE_PAYLOAD_BYTES = 12;
export const CHEAT_SPAWN_PAYLOAD_BYTES = 18;
export const CHEAT_KILL_PAYLOAD_BYTES = 1;
export const CHEAT_FOOTPRINT_PAYLOAD_BYTES = 14;

export interface MovePayload {
  x: Fx;
  y: Fx;
  z: Fx;
}

export interface CheatSpawnPayload {
  /** Blueprint sim id (u16). */
  bp: number;
  /** Army that owns the spawned units (0..15). */
  army: number;
  /** Number of units (u16). */
  count: number;
  x: Fx;
  z: Fx;
  /** Spread radius (Fx raw, ≥ 0). */
  spread: Fx;
}

function need(bytes: Uint8Array, n: number, what: string): DataView {
  if (bytes.length !== n) throw new RangeError(`${what} payload must be ${n} bytes, got ${bytes.length}`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function checkRange(what: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${what} out of range: ${v}`);
}

const I32_MIN = -0x80000000;
const I32_MAX = 0x7fffffff;

// ---- Move ------------------------------------------------------------------------------------

/** Writes a Move payload at `off`. */
export function writeMove(dv: DataView, off: number, x: number, y: number, z: number): void {
  dv.setInt32(off, x, true);
  dv.setInt32(off + 4, y, true);
  dv.setInt32(off + 8, z, true);
}

export function encodeMove(p: MovePayload): Uint8Array {
  checkRange('x', p.x, I32_MIN, I32_MAX);
  checkRange('y', p.y, I32_MIN, I32_MAX);
  checkRange('z', p.z, I32_MIN, I32_MAX);
  const out = new Uint8Array(MOVE_PAYLOAD_BYTES);
  writeMove(new DataView(out.buffer), 0, p.x, p.y, p.z);
  return out;
}

export function decodeMove(bytes: Uint8Array): MovePayload {
  const dv = need(bytes, MOVE_PAYLOAD_BYTES, 'Move');
  return { x: readMoveX(dv, 0), y: readMoveY(dv, 0), z: readMoveZ(dv, 0) };
}

export function readMoveX(dv: DataView, off: number): Fx {
  return asFx(dv.getInt32(off, true));
}
export function readMoveY(dv: DataView, off: number): Fx {
  return asFx(dv.getInt32(off + 4, true));
}
export function readMoveZ(dv: DataView, off: number): Fx {
  return asFx(dv.getInt32(off + 8, true));
}

/** Reads a Move payload into `out` (no allocation). */
export function readMoveInto(dv: DataView, off: number, out: MovePayload): MovePayload {
  out.x = readMoveX(dv, off);
  out.y = readMoveY(dv, off);
  out.z = readMoveZ(dv, off);
  return out;
}

// ---- Cheat -----------------------------------------------------------------------------------

/** Sub-command byte of a Cheat payload. */
export function readCheatSub(dv: DataView, off: number): number {
  return dv.getUint8(off);
}

/** Writes a CheatSpawn payload at `off`. */
export function writeCheatSpawn(
  dv: DataView,
  off: number,
  bp: number,
  army: number,
  count: number,
  x: number,
  z: number,
  spread: number,
): void {
  dv.setUint8(off, CheatSub.Spawn);
  dv.setUint16(off + 1, bp, true);
  dv.setUint8(off + 3, army);
  dv.setUint16(off + 4, count, true);
  dv.setInt32(off + 6, x, true);
  dv.setInt32(off + 10, z, true);
  dv.setInt32(off + 14, spread, true);
}

export function encodeCheatSpawn(p: CheatSpawnPayload): Uint8Array {
  checkRange('bp', p.bp, 0, 0xffff);
  checkRange('army', p.army, 0, 15);
  checkRange('count', p.count, 0, 0xffff);
  checkRange('x', p.x, I32_MIN, I32_MAX);
  checkRange('z', p.z, I32_MIN, I32_MAX);
  checkRange('spread', p.spread, 0, I32_MAX);
  const out = new Uint8Array(CHEAT_SPAWN_PAYLOAD_BYTES);
  writeCheatSpawn(new DataView(out.buffer), 0, p.bp, p.army, p.count, p.x, p.z, p.spread);
  return out;
}

export function decodeCheatSpawn(bytes: Uint8Array): CheatSpawnPayload {
  const dv = need(bytes, CHEAT_SPAWN_PAYLOAD_BYTES, 'CheatSpawn');
  if (readCheatSub(dv, 0) !== CheatSub.Spawn) throw new RangeError('not a CheatSpawn payload');
  return readCheatSpawnInto(dv, 0, { bp: 0, army: 0, count: 0, x: asFx(0), z: asFx(0), spread: asFx(0) });
}

export function readCheatSpawnBp(dv: DataView, off: number): number {
  return dv.getUint16(off + 1, true);
}
export function readCheatSpawnArmy(dv: DataView, off: number): number {
  return dv.getUint8(off + 3);
}
export function readCheatSpawnCount(dv: DataView, off: number): number {
  return dv.getUint16(off + 4, true);
}
export function readCheatSpawnX(dv: DataView, off: number): Fx {
  return asFx(dv.getInt32(off + 6, true));
}
export function readCheatSpawnZ(dv: DataView, off: number): Fx {
  return asFx(dv.getInt32(off + 10, true));
}
export function readCheatSpawnSpread(dv: DataView, off: number): Fx {
  return asFx(dv.getInt32(off + 14, true));
}

/** Reads a CheatSpawn payload into `out` (no allocation). */
export function readCheatSpawnInto(dv: DataView, off: number, out: CheatSpawnPayload): CheatSpawnPayload {
  out.bp = readCheatSpawnBp(dv, off);
  out.army = readCheatSpawnArmy(dv, off);
  out.count = readCheatSpawnCount(dv, off);
  out.x = readCheatSpawnX(dv, off);
  out.z = readCheatSpawnZ(dv, off);
  out.spread = readCheatSpawnSpread(dv, off);
  return out;
}

/** CheatKill payload (targets are the envelope's units). */
export function encodeCheatKill(): Uint8Array {
  return Uint8Array.of(CheatSub.Kill);
}

/** True if `bytes` is a valid CheatKill payload. */
export function isCheatKill(bytes: Uint8Array): boolean {
  return bytes.length === CHEAT_KILL_PAYLOAD_BYTES && bytes[0] === CheatSub.Kill;
}

// ---- CheatFootprint ----------------------------------------------------------------------------

export interface CheatFootprintPayload {
  /** Lower-left cell (WU, may lie partly outside the map; the sim clips). */
  cellX: number;
  cellZ: number;
  /** Size in cells (u16; the sim accepts 1..64). */
  w: number;
  h: number;
  /** +1 adds the footprint, −1 removes it. */
  delta: 1 | -1;
}

/** Writes a CheatFootprint payload at `off`. */
export function writeCheatFootprint(dv: DataView, off: number, cellX: number, cellZ: number, w: number, h: number, delta: number): void {
  dv.setUint8(off, CheatSub.Footprint);
  dv.setInt32(off + 1, cellX, true);
  dv.setInt32(off + 5, cellZ, true);
  dv.setUint16(off + 9, w, true);
  dv.setUint16(off + 11, h, true);
  dv.setInt8(off + 13, delta);
}

export function encodeCheatFootprint(p: CheatFootprintPayload): Uint8Array {
  checkRange('cellX', p.cellX, I32_MIN, I32_MAX);
  checkRange('cellZ', p.cellZ, I32_MIN, I32_MAX);
  checkRange('w', p.w, 0, 0xffff);
  checkRange('h', p.h, 0, 0xffff);
  if (p.delta !== 1 && p.delta !== -1) throw new RangeError(`delta must be 1 or -1: ${String(p.delta)}`);
  const out = new Uint8Array(CHEAT_FOOTPRINT_PAYLOAD_BYTES);
  writeCheatFootprint(new DataView(out.buffer), 0, p.cellX, p.cellZ, p.w, p.h, p.delta);
  return out;
}

export function decodeCheatFootprint(bytes: Uint8Array): CheatFootprintPayload {
  const dv = need(bytes, CHEAT_FOOTPRINT_PAYLOAD_BYTES, 'CheatFootprint');
  if (readCheatSub(dv, 0) !== CheatSub.Footprint) throw new RangeError('not a CheatFootprint payload');
  const d = readCheatFootprintDelta(dv, 0);
  if (d !== 1 && d !== -1) throw new RangeError(`CheatFootprint delta must be 1 or -1, got ${d}`);
  return readCheatFootprintInto(dv, 0, { cellX: 0, cellZ: 0, w: 0, h: 0, delta: 1 });
}

export function readCheatFootprintX(dv: DataView, off: number): number {
  return dv.getInt32(off + 1, true);
}
export function readCheatFootprintZ(dv: DataView, off: number): number {
  return dv.getInt32(off + 5, true);
}
export function readCheatFootprintW(dv: DataView, off: number): number {
  return dv.getUint16(off + 9, true);
}
export function readCheatFootprintH(dv: DataView, off: number): number {
  return dv.getUint16(off + 11, true);
}
/** Raw delta byte (i8); valid payloads carry +1 or −1. */
export function readCheatFootprintDelta(dv: DataView, off: number): number {
  return dv.getInt8(off + 13);
}

/** Reads a CheatFootprint payload into `out` (no allocation; delta other than ±1 reads as −1 if negative, else +1). */
export function readCheatFootprintInto(dv: DataView, off: number, out: CheatFootprintPayload): CheatFootprintPayload {
  out.cellX = readCheatFootprintX(dv, off);
  out.cellZ = readCheatFootprintZ(dv, off);
  out.w = readCheatFootprintW(dv, off);
  out.h = readCheatFootprintH(dv, off);
  out.delta = readCheatFootprintDelta(dv, off) < 0 ? -1 : 1;
  return out;
}

/** Expected payload length of a Cheat sub-command, or −1 if unknown. */
export function cheatPayloadBytes(sub: number): number {
  if (sub === CheatSub.Spawn) return CHEAT_SPAWN_PAYLOAD_BYTES;
  if (sub === CheatSub.Kill) return CHEAT_KILL_PAYLOAD_BYTES;
  if (sub === CheatSub.Footprint) return CHEAT_FOOTPRINT_PAYLOAD_BYTES;
  return -1;
}
