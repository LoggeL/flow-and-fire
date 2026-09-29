/**
 * SAB triple buffer (used when `crossOriginIsolated`): three frame slots in one
 * SharedArrayBuffer plus Int32 control words, lock-free via Atomics.
 *
 * Classic triple-buffer protocol. Every slot is owned by exactly one role at any time:
 *   - back   (producer-local index): the slot the producer writes,
 *   - middle (control word MIDDLE):  the latest published frame (+ DIRTY bit if not yet taken),
 *   - front  (consumer-local index): the slot the consumer copies from.
 * `commit` swaps back ↔ middle (setting DIRTY), `poll` swaps front ↔ middle (clearing DIRTY),
 * each with one `Atomics.exchange`. Hence the producer never writes into the slot the consumer
 * holds nor into the most recently published one, and the consumer never sees a torn frame.
 * Atomics are sequentially consistent, so the slot bytes written before the publishing exchange
 * are visible to the consumer after its exchange.
 *
 * Exactly one producer and one consumer per buffer (initial roles: back = 0, middle = 1,
 * front = 2).
 *
 * SAB layout (bytes):
 *   0   Int32 control words (CTRL_BYTES = 64):
 *         0 magic 'FAFT'   1 version   2 slot capacity   3 middle (index | DIRTY)
 *         4 published      5 overwritten (published but replaced before being polled)
 *         6..8 slot byte length   9..11 slot sequence number (u32 as Int32)
 *   64  slot 0 | slot 1 | slot 2   (each `slotStride` = capacity rounded up to 8)
 */

import { checkFrameLength, viewOf, type FrameConsumer, type FrameProducer } from './types.ts';

export const SAB_MAGIC = 0x54464146; // 'FAFT' little-endian
export const SAB_VERSION = 1;
export const SAB_CTRL_BYTES = 64;
export const SAB_SLOT_COUNT = 3;

const C_MAGIC = 0;
const C_VERSION = 1;
const C_CAPACITY = 2;
const C_MIDDLE = 3;
const C_PUBLISHED = 4;
const C_OVERWRITTEN = 5;
const C_LEN = 6;
const C_SEQ = 9;
const CTRL_WORDS = SAB_CTRL_BYTES >> 2;

const DIRTY = 4;
const INDEX_MASK = 3;

const INITIAL_BACK = 0;
const INITIAL_MIDDLE = 1;
const INITIAL_FRONT = 2;

function slotStride(capacity: number): number {
  return (capacity + 7) & ~7;
}

/** Total SharedArrayBuffer size for frames of up to `capacity` bytes. */
export function sabFrameBufferBytes(capacity: number): number {
  return SAB_CTRL_BYTES + SAB_SLOT_COUNT * slotStride(capacity);
}

/**
 * Creates and initializes the shared triple buffer (main thread; send it to the sim worker in
 * `InitMessage.frameSab`).
 */
export function createSabFrameBuffer(capacity: number): SharedArrayBuffer {
  if (!Number.isInteger(capacity) || capacity < 16 || capacity > 0x10000000) {
    throw new RangeError(`invalid frame capacity ${capacity}`);
  }
  const sab = new SharedArrayBuffer(sabFrameBufferBytes(capacity));
  const ctrl = new Int32Array(sab, 0, CTRL_WORDS);
  Atomics.store(ctrl, C_MAGIC, SAB_MAGIC);
  Atomics.store(ctrl, C_VERSION, SAB_VERSION);
  Atomics.store(ctrl, C_CAPACITY, capacity);
  Atomics.store(ctrl, C_MIDDLE, INITIAL_MIDDLE);
  return sab;
}

interface SabParts {
  readonly ctrl: Int32Array;
  readonly capacity: number;
  readonly slots: readonly Uint8Array[];
}

function openSab(sab: SharedArrayBuffer): SabParts {
  if (sab.byteLength < SAB_CTRL_BYTES) throw new RangeError('frame SAB too small');
  const ctrl = new Int32Array(sab, 0, CTRL_WORDS);
  if (Atomics.load(ctrl, C_MAGIC) !== SAB_MAGIC || Atomics.load(ctrl, C_VERSION) !== SAB_VERSION) {
    throw new RangeError('not a frame triple buffer (magic/version mismatch)');
  }
  const capacity = Atomics.load(ctrl, C_CAPACITY);
  const stride = slotStride(capacity);
  if (sab.byteLength < sabFrameBufferBytes(capacity)) throw new RangeError('frame SAB smaller than its capacity');
  const slots: Uint8Array[] = [];
  for (let i = 0; i < SAB_SLOT_COUNT; i++) slots.push(new Uint8Array(sab, SAB_CTRL_BYTES + i * stride, capacity));
  return { ctrl, capacity, slots };
}

/** Slot capacity stored in a frame SAB. */
export function sabFrameCapacity(sab: SharedArrayBuffer): number {
  return openSab(sab).capacity;
}

/** Producer side of the triple buffer (sim worker). Allocation-free. */
export class SabFrameProducer implements FrameProducer {
  readonly capacity: number;
  private readonly ctrl: Int32Array;
  private readonly slots: readonly Uint8Array[];
  private back = INITIAL_BACK;
  private seqCounter = 0;
  private producedCount = 0;

  constructor(sab: SharedArrayBuffer) {
    const p = openSab(sab);
    this.ctrl = p.ctrl;
    this.slots = p.slots;
    this.capacity = p.capacity;
  }

  get produced(): number {
    return this.producedCount;
  }

  /** Frames published but replaced by a newer one before the consumer took them. */
  get dropped(): number {
    return Atomics.load(this.ctrl, C_OVERWRITTEN);
  }

  begin(): Uint8Array {
    return this.slots[this.back]!;
  }

  commit(byteLength: number): void {
    checkFrameLength(byteLength, this.capacity);
    const ctrl = this.ctrl;
    const b = this.back;
    const seq = (this.seqCounter + 1) >>> 0 || 1;
    this.seqCounter = seq;
    Atomics.store(ctrl, C_LEN + b, byteLength);
    Atomics.store(ctrl, C_SEQ + b, seq | 0);
    const old = Atomics.exchange(ctrl, C_MIDDLE, b | DIRTY);
    this.back = old & INDEX_MASK;
    if ((old & DIRTY) !== 0) Atomics.add(ctrl, C_OVERWRITTEN, 1);
    Atomics.add(ctrl, C_PUBLISHED, 1);
    this.producedCount++;
  }

  close(): void {
    // Nothing to detach; the SAB is garbage-collected with both sides.
  }
}

/** Consumer side of the triple buffer (main thread). Copies the newest frame on `poll()`. */
export class SabFrameConsumer implements FrameConsumer {
  readonly capacity: number;
  private readonly ctrl: Int32Array;
  private readonly slots: readonly Uint8Array[];
  private readonly local: Uint8Array;
  /** Cached view of each slot's used prefix (see poll). */
  private readonly parts: Uint8Array[];
  private front = INITIAL_FRONT;
  private lastSeq = 0;
  private receivedCount = 0;
  private view: Uint8Array | null = null;

  constructor(sab: SharedArrayBuffer) {
    const p = openSab(sab);
    this.ctrl = p.ctrl;
    this.slots = p.slots;
    this.capacity = p.capacity;
    this.local = new Uint8Array(p.capacity);
    this.parts = this.slots.map((s) => s);
  }

  get seq(): number {
    return this.lastSeq;
  }

  get received(): number {
    return this.receivedCount;
  }

  /** Total frames the producer has published so far (shared counter). */
  get published(): number {
    return Atomics.load(this.ctrl, C_PUBLISHED);
  }

  poll(): Uint8Array | null {
    const ctrl = this.ctrl;
    if ((Atomics.load(ctrl, C_MIDDLE) & DIRTY) === 0) return null;
    const old = Atomics.exchange(ctrl, C_MIDDLE, this.front);
    const f = old & INDEX_MASK;
    this.front = f;
    const len = Atomics.load(ctrl, C_LEN + f);
    const seq = Atomics.load(ctrl, C_SEQ + f) >>> 0;
    if (seq === this.lastSeq) return null;
    const src = this.slots[f]!;
    // Views of the used prefix are cached per slot: steady frames (same length) allocate nothing.
    let part = this.parts[f]!;
    if (part.length !== len) {
      part = len === src.length ? src : src.subarray(0, len);
      this.parts[f] = part;
    }
    this.local.set(part, 0);
    this.lastSeq = seq;
    this.receivedCount++;
    const v = viewOf(this.local, len, this.view);
    this.view = v;
    return v;
  }

  close(): void {
    // Nothing to detach.
  }
}

/** Producer factory (sim worker, `InitMessage.transport === 'sab'`). */
export function createSabProducer(sab: SharedArrayBuffer): SabFrameProducer {
  return new SabFrameProducer(sab);
}

/** Consumer factory (main thread). */
export function createSabConsumer(sab: SharedArrayBuffer): SabFrameConsumer {
  return new SabFrameConsumer(sab);
}

/**
 * True if the SAB transport can be used in this context: SharedArrayBuffer exists and the page
 * is cross-origin isolated (COOP/COEP). Workers inherit the flag.
 */
export function canUseSab(scope: unknown = globalThis): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false;
  const g = scope as { crossOriginIsolated?: unknown };
  return g.crossOriginIsolated === true;
}
