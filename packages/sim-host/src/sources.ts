/**
 * Command sources (PLAN §3.1 "CommandSource"): where the commands of a tick come from.
 * `LocalSource` collects `cmd` batches from the main thread and assigns them to the next tick
 * (inputDelay = 0); `ReplaySource` plays a recorded command log. Both implement
 * protocol.CommandSource (envelope objects, for tools/AI) plus the allocation-free byte form the
 * host uses in the tick loop.
 */

import {
  BATCH_HEADER_BYTES,
  COMMAND_BATCH_VERSION,
  decodeBatch,
  MAX_BATCH_COMMANDS,
  validateBatch,
  type CommandEnvelope,
  type CommandSource,
} from '@faf/protocol';
import type { Tick } from '@faf/fixed';
import type { ParsedCommandLog } from './log-format.ts';

/** A command source the host can drive without allocating. */
export interface TickSource extends CommandSource {
  /**
   * True if the commands of `tick` are not available yet (the scheduler waits and retries;
   * e.g. a tick-synchronous AI). Must not consume anything.
   */
  pending(tick: number): boolean;
  /**
   * Consumes the commands of `tick`: a batch (valid until the next call), or null if there are
   * none. Only called when `pending(tick)` is false.
   */
  batchFor(tick: number): Uint8Array | null;
}

const EMPTY: readonly CommandEnvelope[] = [];

/** Growable batch buffer that concatenates the envelopes of several batches. */
export class BatchBuilder {
  private buf: Uint8Array;
  private dv: DataView;
  private len = BATCH_HEADER_BYTES;
  private n = 0;
  private cachedView: Uint8Array | null = null;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(Math.max(initialCapacity, 64));
    this.dv = new DataView(this.buf.buffer);
    this.clear();
  }

  get count(): number {
    return this.n;
  }

  get byteLength(): number {
    return this.len;
  }

  clear(): void {
    this.len = BATCH_HEADER_BYTES;
    this.n = 0;
    this.buf[0] = COMMAND_BATCH_VERSION;
    this.dv.setUint16(1, 0, true);
  }

  /**
   * Appends all envelopes of a batch (validated). Throws RangeError if the batch is malformed or
   * the combined batch would exceed the u16 envelope count.
   */
  append(batch: Uint8Array): number {
    const c = validateBatch(batch);
    if (c < 0) throw new RangeError('malformed command batch');
    if (c === 0) return 0;
    if (this.n + c > MAX_BATCH_COMMANDS) throw new RangeError('too many commands for one tick');
    const body = batch.length - BATCH_HEADER_BYTES;
    const need = this.len + body;
    if (need > this.buf.length) {
      let cap = this.buf.length * 2;
      while (cap < need) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
      this.dv = new DataView(nb.buffer);
      this.cachedView = null;
    }
    this.buf.set(batch.subarray(BATCH_HEADER_BYTES), this.len);
    this.len = need;
    this.n += c;
    this.dv.setUint16(1, this.n, true);
    return c;
  }

  /** The combined batch (view; valid until the next append/clear). */
  view(): Uint8Array {
    const v = this.cachedView;
    if (v !== null && v.length === this.len) return v;
    const nv = this.buf.subarray(0, this.len);
    this.cachedView = nv;
    return nv;
  }
}

/**
 * Local player input: `push()` collects `cmd` batches as they arrive from the port; all of them
 * belong to the next tick that runs (inputDelay = 0). Never pending.
 */
export class LocalSource implements TickSource {
  /** Double buffer: `front` is handed out by batchFor, `back` collects new pushes. */
  private back = new BatchBuilder();
  private front = new BatchBuilder();
  /** Batches received in total. */
  received = 0;
  /** Envelopes received in total. */
  commandsReceived = 0;

  /** Queues a batch for the next tick. Throws RangeError if it is malformed. */
  push(batch: Uint8Array): void {
    this.commandsReceived += this.back.append(batch);
    this.received++;
  }

  /** Envelopes waiting for the next tick. */
  get queued(): number {
    return this.back.count;
  }

  pending(_tick: number): boolean {
    return false;
  }

  batchFor(_tick: number): Uint8Array | null {
    if (this.back.count === 0) return null;
    const out = this.back;
    this.back = this.front;
    this.front = out;
    this.back.clear();
    return out.view();
  }

  commandsFor(tick: Tick): readonly CommandEnvelope[] | 'pending' {
    const b = this.batchFor(tick);
    return b === null ? EMPTY : decodeBatch(b);
  }

  /** Drops queued commands. */
  clear(): void {
    this.back.clear();
  }
}

/**
 * Replays a parsed command log: `batchFor(t)` returns the batch recorded for tick t (as applied,
 * i.e. already stamped). Ticks are usually requested in increasing order (cursor), a jump
 * backwards (seek) re-positions by binary search. `expectedHash(t)` exposes the recorded rule
 * hash for verification.
 */
export class ReplaySource implements TickSource {
  readonly log: ParsedCommandLog;
  private cmdCursor = 0;
  private hashCursor = 0;
  private lastCmdTick = -1;
  private readonly views: (Uint8Array | null)[];

  constructor(log: ParsedCommandLog) {
    this.log = log;
    this.views = new Array<Uint8Array | null>(log.commands.length).fill(null);
  }

  /** Last recorded tick of the log. */
  get lastTick(): number {
    return this.log.lastTick;
  }

  pending(_tick: number): boolean {
    return false;
  }

  batchFor(tick: number): Uint8Array | null {
    const cmds = this.log.commands;
    if (tick < this.lastCmdTick) this.cmdCursor = lowerBound(cmds, tick);
    this.lastCmdTick = tick;
    let i = this.cmdCursor;
    while (i < cmds.length && cmds[i]!.tick < tick) i++;
    this.cmdCursor = i;
    if (i >= cmds.length || cmds[i]!.tick !== tick) return null;
    this.cmdCursor = i + 1;
    let v = this.views[i]!;
    if (v === null) {
      const e = cmds[i]!;
      v = this.log.bytes.subarray(e.offset, e.offset + e.length);
      this.views[i] = v;
    }
    return v;
  }

  commandsFor(tick: Tick): readonly CommandEnvelope[] | 'pending' {
    const b = this.batchFor(tick);
    return b === null ? EMPTY : decodeBatch(b);
  }

  /** Recorded rule hash of `tick`, or −1 if the log has none for it. Returned as u32 otherwise. */
  expectedHash(tick: number): number {
    const hs = this.log.hashes;
    let i = this.hashCursor;
    if (i > 0 && hs[i - 1]!.tick >= tick) i = lowerBound(hs, tick);
    while (i < hs.length && hs[i]!.tick < tick) i++;
    this.hashCursor = i;
    if (i < hs.length && hs[i]!.tick === tick) return hs[i]!.hash >>> 0;
    return -1;
  }

  /** Re-positions the cursors (optional; batchFor handles backward jumps itself). */
  rewind(): void {
    this.cmdCursor = 0;
    this.hashCursor = 0;
    this.lastCmdTick = -1;
  }
}

function lowerBound(a: readonly { readonly tick: number }[], tick: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid]!.tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
