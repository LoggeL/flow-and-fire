/**
 * Command builder (PLAN §3.6 "Commands", S3/S8): encodes player commands with the protocol
 * encoder, numbers them with a per-client sequence and keeps book of unconfirmed commands.
 *
 * - `seq` is a u16 per client/army, starting at 1; 0 is skipped on wrap-around so that
 *   `ackSeq = 0` always means "nothing applied yet".
 * - A command counts as confirmed on arrival of a committed host ACK or a `FrameHeader.ackSeq`
 *   (highest applied seq of the viewer army) that confirms its seq using u16 serial-number
 *   arithmetic (RFC 1982), so wrap-around is handled.
 * - Each command goes out as its own batch (tick 0; the host stamps the application tick).
 */
import {
  CHEAT_SPAWN_PAYLOAD_BYTES,
  encodeCheatFootprint,
  CommandBatchEncoder,
  CmdFlags,
  Op,
  writeCheatSpawn,
  writeMove,
  MOVE_PAYLOAD_BYTES,
  CheatSub,
} from '@faf/protocol';

/** Sink for encoded batches (a SimLink). */
export interface CommandSink {
  sendCommands(batch: ArrayBuffer): void;
}

/** True if `ackSeq` confirms `seq` (u16 serial-number comparison: ackSeq ≥ seq). */
export function seqAcked(ackSeq: number, seq: number): boolean {
  return ((ackSeq - seq) & 0xffff) < 0x8000;
}

/** Called when a command is confirmed: its seq, op and the time from send to confirmation. */
/** Synchronous local issue notification after successful send; never an acceptance signal. */
export type IssuedListener = (seq: number, op: number, flags: number, units: ArrayLike<number>, payload: Uint8Array, nowMs: number) => void;

export type AckListener = (seq: number, op: number, latencyMs: number, ackMs: number) => void;

/** Maximum number of tracked unconfirmed commands (oldest are dropped beyond that). */
export const MAX_PENDING_COMMANDS = 256;

const EMPTY_UNITS: readonly number[] = [];

export class CommandBuilder {
  /** Army the commands are issued for. */
  army: number;
  private readonly sink: CommandSink;
  private readonly enc = new CommandBatchEncoder(1024);
  private readonly movePayload = new Uint8Array(MOVE_PAYLOAD_BYTES);
  private readonly moveDv = new DataView(this.movePayload.buffer);
  private readonly spawnPayload = new Uint8Array(CHEAT_SPAWN_PAYLOAD_BYTES);
  private readonly spawnDv = new DataView(this.spawnPayload.buffer);
  private readonly killPayload = Uint8Array.of(CheatSub.Kill);
  private readonly emptyPayload = new Uint8Array(0);
  private next = 1;

  // Ring of pending commands (oldest first).
  private readonly pSeq = new Int32Array(MAX_PENDING_COMMANDS);
  private readonly pOp = new Uint8Array(MAX_PENDING_COMMANDS);
  private readonly pSent = new Float64Array(MAX_PENDING_COMMANDS);
  private head = 0;
  private size = 0;
  private readonly ackListeners: AckListener[] = [];
  private readonly issuedListeners: IssuedListener[] = [];

  /** Last seq issued (0 = none). */
  lastSeq = 0;
  /** Highest applied ackSeq received through a frame or a host commit notification. */
  lastAckSeq = 0;
  /** Commands sent / confirmed / dropped from the pending ring because it overflowed. */
  sent = 0;
  confirmed = 0;
  overflowed = 0;

  constructor(sink: CommandSink, army: number, readonly readOnly = false) {
    this.sink = sink;
    this.army = army;
  }

  /** Subscribes to confirmations; returns the unsubscribe function. */
  onAck(l: AckListener): () => void {
    this.ackListeners.push(l);
    return () => {
      const i = this.ackListeners.indexOf(l);
      if (i >= 0) this.ackListeners.splice(i, 1);
    };
  }

  onIssued(listener: IssuedListener): () => void {
    this.issuedListeners.push(listener);
    return () => { const i = this.issuedListeners.indexOf(listener); if (i >= 0) this.issuedListeners.splice(i, 1); };
  }

  /** Number of unconfirmed commands. */
  get pendingCount(): number {
    return this.size;
  }

  /** True if `seq` was sent and is not confirmed yet. */
  isPending(seq: number): boolean {
    for (let k = 0; k < this.size; k++) if (this.pSeq[(this.head + k) % MAX_PENDING_COMMANDS] === seq) return true;
    return false;
  }

  /** Move `units` to (x, y, z) raw. `queue` appends to the order queue (Shift). Returns the seq, −1 if no units. */
  move(units: ArrayLike<number>, x: number, y: number, z: number, queue = false, nowMs = 0): number {
    if (units.length === 0) return -1;
    writeMove(this.moveDv, 0, x | 0, y | 0, z | 0);
    return this.send(Op.Move, queue ? CmdFlags.Queue : 0, units, this.movePayload, nowMs);
  }

  /** Stop `units`. Returns the seq, −1 if no units. */
  stop(units: ArrayLike<number>, nowMs = 0): number {
    if (units.length === 0) return -1;
    return this.send(Op.Stop, 0, units, this.emptyPayload, nowMs);
  }

  /** Build placement, shared 12-byte wire contract: bp/yaw u16, x/z raw i32. */
  build(units: ArrayLike<number>, bp: number, x: number, z: number, yaw = 0, queue = false, nowMs = 0): number {
    if (units.length === 0) return -1;
    checkInt('bp', bp, 0, 0xffff);
    checkInt('yaw', yaw, 0, 0xffff);
    const payload = new Uint8Array(12);
    const dv = new DataView(payload.buffer);
    dv.setUint16(0, bp, true); dv.setUint16(2, yaw, true);
    dv.setInt32(4, x | 0, true); dv.setInt32(8, z | 0, true);
    return this.send(Op.Build, queue ? CmdFlags.Queue : 0, units, payload, nowMs);
  }

  /** Typed application adapters may send supported protocol commands through the same guard. */
  issue(op: number, units: ArrayLike<number>, payload: Uint8Array, queue = false, nowMs = 0): number {
    if (units.length === 0) return -1;
    return this.send(op, queue ? CmdFlags.Queue : 0, units, payload, nowMs);
  }

  /**
   * Cheat spawn (dev console, S8): `count` units of blueprint `bp` for `army` around (x, z) raw
   * with `spread` raw radius.
   */
  spawn(bp: number, count: number, army: number, x: number, z: number, spread: number, nowMs = 0): number {
    checkInt('bp', bp, 0, 0xffff);
    checkInt('count', count, 1, 0xffff);
    checkInt('army', army, 0, 15);
    checkInt('spread', spread, 0, 0x7fffffff);
    writeCheatSpawn(this.spawnDv, 0, bp, army, count, x | 0, z | 0, spread);
    return this.send(Op.Cheat, 0, EMPTY_UNITS, this.spawnPayload, nowMs);
  }

  footprint(x: number, z: number, w: number, h: number, delta: 1 | -1, nowMs = 0): number {
    return this.send(Op.Cheat, 0, EMPTY_UNITS, encodeCheatFootprint({ cellX: x, cellZ: z, w, h, delta }), nowMs);
  }

  /** Cheat kill (dev console): destroys `units`. Returns the seq, −1 if no units. */
  kill(units: ArrayLike<number>, nowMs = 0): number {
    if (units.length === 0) return -1;
    return this.send(Op.Cheat, 0, units, this.killPayload, nowMs);
  }

  /**
   * Processes an applied `ackSeq`: confirms every pending command with
   * seq ≤ ackSeq. Returns the number of newly confirmed commands.
   */
  acknowledge(ackSeq: number, nowMs: number): number {
    const ack = ackSeq & 0xffff;
    this.lastAckSeq = ackSeq >>> 0;
    let n = 0;
    while (this.size > 0) {
      const h = this.head;
      const seq = this.pSeq[h]!;
      if (!seqAcked(ack, seq)) break;
      const op = this.pOp[h]!;
      const lat = nowMs - this.pSent[h]!;
      this.head = (h + 1) % MAX_PENDING_COMMANDS;
      this.size--;
      this.confirmed++;
      n++;
      for (let i = 0; i < this.ackListeners.length; i++) this.ackListeners[i]!(seq, op, lat, nowMs);
    }
    return n;
  }

  // ---- internals ------------------------------------------------------------------------------

  private nextSeq(): number {
    const s = this.next;
    this.next = s >= 0xffff ? 1 : s + 1;
    return s;
  }

  private send(op: number, flags: number, units: ArrayLike<number>, payload: Uint8Array, nowMs: number): number {
    if (this.readOnly) return -1;
    const seq = this.nextSeq();
    const enc = this.enc.reset();
    enc.addRaw(0, this.army, seq, op, flags, units, payload);
    this.sink.sendCommands(enc.toArrayBuffer());
    this.lastSeq = seq;
    this.sent++;
    if (this.size === MAX_PENDING_COMMANDS) {
      this.head = (this.head + 1) % MAX_PENDING_COMMANDS;
      this.size--;
      this.overflowed++;
    }
    const slot = (this.head + this.size) % MAX_PENDING_COMMANDS;
    this.pSeq[slot] = seq;
    this.pOp[slot] = op;
    this.pSent[slot] = nowMs;
    this.size++;
    for (let i = 0; i < this.issuedListeners.length; i++) this.issuedListeners[i]!(seq, op, flags, units, payload, nowMs);
    return seq;
  }
}

function checkInt(what: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${what} out of range: ${v}`);
}
