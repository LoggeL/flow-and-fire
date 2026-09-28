/**
 * Command envelopes and their binary batch format (PLAN §3.1 "Command-Format", §3.6).
 * The same bytes travel through the worker `cmd` channel, the replay CMDS chunk and — later —
 * the network.
 *
 * Batch (little-endian, versioned):
 *   u8 version (= COMMAND_BATCH_VERSION), u16 count, then `count` envelopes:
 *   u32 tick | u8 army | u16 seq | u8 op | u8 flags | u16 unitCount | u32[unitCount] units |
 *   u16 payloadLen | u8[payloadLen] payload
 *
 * The main thread sends batches with tick 0; the sim host stamps the application tick with
 * `setBatchTick` before stepping (inputDelay = 0) and records exactly those bytes.
 */

import { asArmyId, asHandle, asTick, MAX_ARMIES, type ArmyId, type Handle, type Tick } from '@faf/fixed';
import { DataViewCache } from './bytes.ts';
import type { Op } from './ops.ts';

export const COMMAND_BATCH_VERSION = 1;
/** Bytes before the first envelope (version + count). */
export const BATCH_HEADER_BYTES = 3;
/** Fixed bytes of one envelope (without units and payload). */
export const ENVELOPE_FIXED_BYTES = 13;
/** Limits imposed by the u16 length fields. */
export const MAX_BATCH_COMMANDS = 0xffff;
export const MAX_COMMAND_UNITS = 0xffff;
export const MAX_PAYLOAD_BYTES = 0xffff;

// Envelope field offsets (relative to the envelope start).
const E_TICK = 0;
const E_ARMY = 4;
const E_SEQ = 5;
const E_OP = 7;
const E_FLAGS = 8;
const E_UNITS = 9;
const E_UNIT0 = 11;

/** One command as issued by a player / AI / replay. */
export interface CommandEnvelope {
  readonly tick: Tick;
  readonly army: ArmyId;
  /** Per-army sequence number (u16, wraps); acknowledged via FrameHeader.ackSeq. */
  readonly seq: number;
  readonly op: Op;
  /** CmdFlags bit set (u8). */
  readonly flags: number;
  readonly units: readonly Handle[];
  readonly payload: Uint8Array;
}

/** Tick-synchronous command source (local input, replay, AI, later network). */
export interface CommandSource {
  /** Commands for `tick`, or 'pending' if the source is not ready yet (the sim waits). */
  commandsFor(tick: Tick): readonly CommandEnvelope[] | 'pending';
}

function checkU(what: string, v: number, max: number): void {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`${what} out of range: ${v}`);
}

/**
 * Builds command batches into a reusable, growing buffer (main thread / AI / tools).
 * `view()` exposes the encoded bytes without copying; `toArrayBuffer()` returns a copy suitable
 * for transfer via postMessage.
 */
export class CommandBatchEncoder {
  private buf: Uint8Array;
  private dv: DataView;
  private len = BATCH_HEADER_BYTES;
  private n = 0;

  constructor(initialCapacity = 256) {
    this.buf = new Uint8Array(Math.max(initialCapacity, 16));
    this.dv = new DataView(this.buf.buffer);
    this.reset();
  }

  /** Starts a new, empty batch. */
  reset(): this {
    this.len = BATCH_HEADER_BYTES;
    this.n = 0;
    this.buf[0] = COMMAND_BATCH_VERSION;
    this.dv.setUint16(1, 0, true);
    return this;
  }

  /** Number of envelopes in the batch. */
  get count(): number {
    return this.n;
  }

  /** Encoded size in bytes. */
  get byteLength(): number {
    return this.len;
  }

  private ensure(extra: number): void {
    const need = this.len + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }

  /** Appends an envelope object. */
  add(env: CommandEnvelope): this {
    return this.addRaw(env.tick, env.army, env.seq, env.op, env.flags, env.units, env.payload);
  }

  /**
   * Appends an envelope from raw fields. `units` may be a Handle[] or a Uint32Array;
   * `payload` bytes [payloadOff, payloadOff + payloadLen) are copied.
   */
  addRaw(
    tick: number,
    army: number,
    seq: number,
    op: number,
    flags: number,
    units: ArrayLike<number>,
    payload: Uint8Array,
    payloadOff = 0,
    payloadLen = payload.length - payloadOff,
  ): this {
    if (this.n >= MAX_BATCH_COMMANDS) throw new RangeError('command batch is full');
    checkU('tick', tick, 0xffffffff);
    checkU('army', army, MAX_ARMIES - 1);
    checkU('seq', seq, 0xffff);
    checkU('op', op, 0xff);
    checkU('flags', flags, 0xff);
    checkU('unit count', units.length, MAX_COMMAND_UNITS);
    checkU('payload length', payloadLen, MAX_PAYLOAD_BYTES);
    if (payloadOff < 0 || payloadOff + payloadLen > payload.length) throw new RangeError('payload range out of bounds');
    const size = ENVELOPE_FIXED_BYTES + units.length * 4 + payloadLen;
    this.ensure(size);
    const dv = this.dv;
    let p = this.len;
    dv.setUint32(p + E_TICK, tick, true);
    dv.setUint8(p + E_ARMY, army);
    dv.setUint16(p + E_SEQ, seq, true);
    dv.setUint8(p + E_OP, op);
    dv.setUint8(p + E_FLAGS, flags);
    dv.setUint16(p + E_UNITS, units.length, true);
    p += E_UNIT0;
    for (let i = 0; i < units.length; i++) {
      dv.setUint32(p, units[i]! >>> 0, true);
      p += 4;
    }
    dv.setUint16(p, payloadLen, true);
    p += 2;
    this.buf.set(payload.subarray(payloadOff, payloadOff + payloadLen), p);
    p += payloadLen;
    this.len = p;
    this.n++;
    dv.setUint16(1, this.n, true);
    return this;
  }

  /** The encoded batch (view into the internal buffer; valid until the next add/reset). */
  view(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  /** A standalone copy of the encoded batch (e.g. to transfer to the sim worker). */
  toArrayBuffer(): ArrayBuffer {
    const out = new ArrayBuffer(this.len);
    new Uint8Array(out).set(this.buf.subarray(0, this.len));
    return out;
  }
}

/**
 * Validates the structure of a batch without allocating. Returns the envelope count, or −1 if
 * the version is unknown, a length field points past the end, or trailing bytes remain.
 */
export function validateBatch(bytes: Uint8Array, dv?: DataView): number {
  const n = bytes.length;
  if (n < BATCH_HEADER_BYTES || bytes[0] !== COMMAND_BATCH_VERSION) return -1;
  const view = dv ?? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(1, true);
  let p = BATCH_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    if (p + E_UNIT0 > n) return -1;
    const units = view.getUint16(p + E_UNITS, true);
    p += E_UNIT0 + units * 4;
    if (p + 2 > n) return -1;
    const pl = view.getUint16(p, true);
    p += 2 + pl;
    if (p > n) return -1;
  }
  return p === n ? count : -1;
}

/**
 * Allocation-free cursor over a batch (used by the sim's CommandApply phase).
 *
 * ```ts
 * view.reset(bytes);
 * while (view.next()) { if (view.op === Op.Move) readMoveInto(view.dataView, view.payloadOffset, out); }
 * ```
 */
export class CommandBatchView {
  private readonly dvCache = new DataViewCache(4);
  private dv: DataView = new DataView(new ArrayBuffer(0));
  private pos = 0;
  private remaining = 0;
  private unitsOff = 0;

  /** Envelope count of the current batch. */
  count = 0;
  /** Index of the current envelope (−1 before the first `next()`). */
  index = -1;
  tick = 0;
  army = 0;
  seq = 0;
  op = 0;
  flags = 0;
  unitCount = 0;
  /** Byte offset of the payload inside the batch bytes (use with `dataView`). */
  payloadOffset = 0;
  payloadLength = 0;

  /** DataView over the current batch bytes (offsets as in `payloadOffset`). */
  get dataView(): DataView {
    return this.dv;
  }

  /**
   * Binds the cursor to `bytes` (validated; throws RangeError if malformed) and positions it
   * before the first envelope. Returns the envelope count. DataViews are cached per buffer.
   */
  reset(bytes: Uint8Array): number {
    const dv = this.dvCache.get(bytes);
    const count = validateBatch(bytes, dv);
    if (count < 0) throw new RangeError('malformed command batch');
    this.dv = dv;
    this.count = count;
    this.remaining = count;
    this.pos = BATCH_HEADER_BYTES;
    this.index = -1;
    return count;
  }

  /** Advances to the next envelope; false at the end. */
  next(): boolean {
    if (this.remaining === 0) return false;
    this.remaining--;
    this.index++;
    const dv = this.dv;
    const p = this.pos;
    this.tick = dv.getUint32(p + E_TICK, true);
    this.army = dv.getUint8(p + E_ARMY);
    this.seq = dv.getUint16(p + E_SEQ, true);
    this.op = dv.getUint8(p + E_OP);
    this.flags = dv.getUint8(p + E_FLAGS);
    const uc = dv.getUint16(p + E_UNITS, true);
    this.unitCount = uc;
    this.unitsOff = p + E_UNIT0;
    const pl = this.unitsOff + uc * 4;
    this.payloadLength = dv.getUint16(pl, true);
    this.payloadOffset = pl + 2;
    this.pos = this.payloadOffset + this.payloadLength;
    return true;
  }

  /** Unit handle `i` (0 ≤ i < unitCount) of the current envelope. */
  unitAt(i: number): Handle {
    return this.dv.getUint32(this.unitsOff + i * 4, true) as Handle;
  }
}

/** Decodes a batch into envelope objects (tools, tests, replay inspection). Throws if malformed. */
export function decodeBatch(bytes: Uint8Array): CommandEnvelope[] {
  const v = new CommandBatchView();
  v.reset(bytes);
  const out: CommandEnvelope[] = [];
  while (v.next()) {
    const units: Handle[] = [];
    for (let i = 0; i < v.unitCount; i++) units.push(asHandle(v.unitAt(i)));
    out.push({
      tick: asTick(v.tick),
      army: asArmyId(v.army),
      seq: v.seq,
      op: v.op as Op,
      flags: v.flags,
      units,
      payload: bytes.slice(v.payloadOffset, v.payloadOffset + v.payloadLength),
    });
  }
  return out;
}

/** Encodes envelopes into a fresh batch (convenience for tools/tests). */
export function encodeBatch(envs: readonly CommandEnvelope[]): Uint8Array {
  const e = new CommandBatchEncoder();
  for (const env of envs) e.add(env);
  return e.view().slice();
}

/**
 * Writes `tick` into every envelope of a batch in place (host: application tick of a `cmd`
 * batch). Returns the envelope count; throws RangeError if the batch is malformed.
 */
export function setBatchTick(bytes: Uint8Array, tick: number, dv?: DataView): number {
  checkU('tick', tick, 0xffffffff);
  const view = dv ?? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = validateBatch(bytes, view);
  if (count < 0) throw new RangeError('malformed command batch');
  let p = BATCH_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    view.setUint32(p + E_TICK, tick, true);
    const units = view.getUint16(p + E_UNITS, true);
    p += E_UNIT0 + units * 4;
    p += 2 + view.getUint16(p, true);
  }
  return count;
}

/** Number of envelopes of a (valid) batch, −1 if malformed. */
export function batchCount(bytes: Uint8Array): number {
  return validateBatch(bytes);
}
