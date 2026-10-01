/**
 * Command-log recorder (PLAN §3.11, §5 "der Command-Log-Recorder läuft ab MS1"). Records from
 * tick 0: every applied command batch (with its application tick), MARK entries and the rule hash
 * every `hashInterval` ticks. The log is kept in memory (for export) and — once a sink is
 * attached (OPFS in the worker) — appended to persistent storage block by block.
 *
 * Appending is allocation-free apart from the occasional doubling of the memory buffer.
 */

import { CommandBatchView, Op } from '@faf/protocol';
import {
  align4,
  encodeLogHeader,
  entryCheck,
  isTaintMark,
  LOG_ENTRY_HEADER_BYTES,
  LogEntryKind,
  MarkKind,
  type LogHeader,
} from './log-format.ts';

/** Persistent append target (OPFS file in the worker). */
export interface LogSink {
  /** Storage kind reported in status messages. */
  readonly kind: 'opfs';
  /** File name. */
  readonly name: string;
  /** Writes `bytes[off, off + len)` at file position `at`. */
  write(bytes: Uint8Array, off: number, len: number, at: number): void;
  /** Cuts the file to `size` bytes. */
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

/** Where the log currently lives. */
export type RecorderStorage = 'memory' | 'opfs';

export interface RecorderOptions {
  /** Initial memory buffer size (default 256 KiB). */
  readonly initialCapacity?: number;
  /** Flush the sink every N entries (default 64) — flush() also runs on pause/export. */
  readonly flushEveryEntries?: number;
  /** Wall-clock flush deadline while a sink is attached, including pauses (default 5000 ms). */
  readonly flushIntervalMs?: number;
}

export class CommandLogRecorder {
  readonly header: LogHeader;
  private buf: Uint8Array;
  private dv: DataView;
  private len: number;
  private readonly headerBytes: number;
  private sinkRef: LogSink | null = null;
  /** Bytes already written to the sink. */
  private sinkLen = 0;
  private readonly flushEvery: number;
  private sinceFlush = 0;
  private readonly flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly scratch4 = new Uint8Array(4);
  private readonly scratch4dv = new DataView(this.scratch4.buffer);
  private readonly view = new CommandBatchView();
  private lastTickValue = 0;
  private taintedFlag = false;
  private entries = 0;
  private finished = false;
  /** Last sink error (the recorder falls back to memory-only). */
  sinkError: string | null = null;

  constructor(header: LogHeader, options: RecorderOptions = {}) {
    this.header = header;
    const h = encodeLogHeader(header);
    this.headerBytes = h.length;
    this.buf = new Uint8Array(Math.max(options.initialCapacity ?? 256 * 1024, h.length * 2, 1024));
    this.dv = new DataView(this.buf.buffer);
    this.buf.set(h, 0);
    this.len = h.length;
    this.flushEvery = Math.max(1, options.flushEveryEntries ?? 64);
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
    if (!Number.isFinite(this.flushIntervalMs) || this.flushIntervalMs <= 0 || this.flushIntervalMs > 5000)
      throw new RangeError('flushIntervalMs must be in (0, 5000]');
  }

  /** Current log bytes (view into the internal buffer; valid until the next append). */
  get bytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  get byteLength(): number {
    return this.len;
  }

  get entryCount(): number {
    return this.entries;
  }

  /** Largest tick of any entry so far. */
  get lastTick(): number {
    return this.lastTickValue;
  }

  get tainted(): boolean {
    return this.taintedFlag;
  }

  get storage(): RecorderStorage {
    return this.sinkRef === null ? 'memory' : this.sinkRef.kind;
  }

  get sink(): LogSink | null {
    return this.sinkRef;
  }

  /**
   * Records the command batch applied in `tick` (already stamped with that tick). A batch that
   * contains an Op.Cheat command also records a Cheat MARK (taint).
   */
  commands(tick: number, batch: Uint8Array): void {
    if (batch.length === 0) return;
    this.append(LogEntryKind.Cmds, 0, 0, tick, batch, 0, batch.length);
    const v = this.view;
    v.reset(batch);
    while (v.next()) {
      if (v.op === Op.Cheat) {
        this.mark(tick, MarkKind.Cheat, v.army);
        break;
      }
    }
  }

  /** Records a MARK (pause, resume, speed, cheat, devReload, step, restore). */
  mark(tick: number, kind: MarkKind, value = 0): void {
    this.scratch4dv.setUint32(0, value >>> 0, true);
    this.append(LogEntryKind.Mark, kind, 0, tick, this.scratch4, 0, 4);
    if (isTaintMark(kind)) this.taintedFlag = true;
  }

  /** Records the rule hash of `tick`. */
  hash(tick: number, hash: number): void {
    this.scratch4dv.setUint32(0, hash >>> 0, true);
    this.append(LogEntryKind.Hash, 0, 0, tick, this.scratch4, 0, 4);
  }

  /**
   * The complete log as a standalone copy, closed with an END entry at `endTick` (the live log
   * itself stays open and continues).
   */
  export(endTick: number): ArrayBuffer {
    if (this.finished) return this.bytes.slice().buffer;
    const t = Math.max(endTick, this.lastTickValue) >>> 0;
    const out = new ArrayBuffer(this.len + LOG_ENTRY_HEADER_BYTES);
    const u8 = new Uint8Array(out);
    u8.set(this.buf.subarray(0, this.len), 0);
    const dv = new DataView(out);
    const p = this.len;
    dv.setUint8(p, LogEntryKind.End);
    dv.setUint8(p + 1, 0);
    dv.setUint16(p + 2, 0, true);
    dv.setUint32(p + 4, t, true);
    dv.setUint32(p + 8, 0, true);
    dv.setUint32(p + 12, entryCheck(LogEntryKind.End, 0, 0, t, u8, p, 0), true);
    this.flush();
    return out;
  }

  /**
   * Drops every entry with a tick greater than `tick` (timeline branch after a restore to an
   * earlier state). The sink file is cut accordingly.
   */
  truncateAfter(tick: number): void {
    if (this.finished) throw new Error('command log is finished');
    const dv = this.dv;
    let p = this.headerBytes;
    let last = 0;
    let n = 0;
    while (p < this.len) {
      const t = dv.getUint32(p + 4, true);
      if (t > tick) break;
      last = t;
      n++;
      p += LOG_ENTRY_HEADER_BYTES + align4(dv.getUint32(p + 8, true));
    }
    if (p === this.len) return;
    this.len = p;
    this.entries = n;
    this.lastTickValue = last;
    if (this.sinkRef !== null && this.sinkLen > p) {
      try {
        this.sinkRef.truncate(p);
        this.sinkLen = p;
      } catch (e) {
        this.dropSink(e);
      }
    }
  }

  /**
   * Attaches persistent storage: writes everything recorded so far, then appends each new
   * entry. On a write error the recorder falls back to memory-only (`sinkError`).
   */
  attachSink(sink: LogSink): boolean {
    if (this.finished) throw new Error('command log is finished');
    this.detachSink();
    this.sinkRef = sink;
    this.sinkLen = 0;
    this.sinkError = null;
    try {
      sink.truncate(0);
      sink.write(this.buf, 0, this.len, 0);
      sink.flush();
      this.sinkLen = this.len;
      this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
      // Node recordings must not keep the process alive merely because a sink was attached.
      (this.flushTimer as unknown as { unref?: () => void }).unref?.();
      return true;
    } catch (e) {
      this.dropSink(e);
      return false;
    }
  }

  /** Detaches (and closes) the sink; recording continues in memory. */
  detachSink(): void {
    this.clearFlushTimer();
    const s = this.sinkRef;
    if (s === null) return;
    this.sinkRef = null;
    try {
      s.flush();
    } catch (error) {
      this.sinkError = error instanceof Error ? error.message : String(error);
    } finally {
      try { s.close(); }
      catch (error) { this.sinkError ??= error instanceof Error ? error.message : String(error); }
    }
  }

  flush(): void {
    if (this.sinkRef === null) return;
    try {
      this.sinkRef.flush();
      this.sinceFlush = 0;
    } catch (e) {
      this.dropSink(e);
    }
  }

  /** Flushes and closes the sink. */
  close(): void {
    this.detachSink();
  }
  /** A normal session exit appends a durable END; crash recovery still has no END. */
  finish(endTick: number): void {
    if (this.finished) { this.close(); return; }
    this.append(LogEntryKind.End, 0, 0, Math.max(endTick, this.lastTickValue), this.scratch4, 0, 0);
    this.finished = true;
    this.close();
  }

  private dropSink(e: unknown): void {
    this.clearFlushTimer();
    this.sinkError = e instanceof Error ? e.message : String(e);
    const s = this.sinkRef;
    this.sinkRef = null;
    if (s !== null) {
      try {
        s.close();
      } catch {
        // already broken
      }
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) clearInterval(this.flushTimer);
    this.flushTimer = null;
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

  private append(kind: number, sub: number, aux: number, tick: number, data: Uint8Array, off: number, len: number): void {
    if (this.finished) throw new Error('command log is finished');
    if (tick < this.lastTickValue) throw new RangeError(`command log is tick-ordered: ${tick} < ${this.lastTickValue}`);
    const padded = align4(len);
    this.ensure(LOG_ENTRY_HEADER_BYTES + padded);
    const dv = this.dv;
    const p = this.len;
    dv.setUint8(p, kind);
    dv.setUint8(p + 1, sub);
    dv.setUint16(p + 2, aux, true);
    dv.setUint32(p + 4, tick >>> 0, true);
    dv.setUint32(p + 8, len, true);
    dv.setUint32(p + 12, entryCheck(kind, sub, aux, tick, data, off, len), true);
    const d = p + LOG_ENTRY_HEADER_BYTES;
    const buf = this.buf;
    if (len <= 16) {
      for (let i = 0; i < len; i++) buf[d + i] = data[off + i]!;
    } else {
      buf.set(len === data.length && off === 0 ? data : data.subarray(off, off + len), d);
    }
    for (let i = len; i < padded; i++) buf[d + i] = 0;
    this.len = d + padded;
    this.entries++;
    this.lastTickValue = tick;
    const sink = this.sinkRef;
    if (sink !== null) {
      try {
        sink.write(buf, this.sinkLen, this.len - this.sinkLen, this.sinkLen);
        this.sinkLen = this.len;
        if (++this.sinceFlush >= this.flushEvery) {
          sink.flush();
          this.sinceFlush = 0;
        }
      } catch (e) {
        this.dropSink(e);
      }
    }
  }
}
