/**
 * Transfer ping-pong (fallback without cross-origin isolation): the producer owns a fixed pool
 * of ArrayBuffers (≥ 3). Each frame travels to the consumer by `postMessage` with the buffer
 * transferred; the consumer copies it on arrival into its own buffer and transfers the buffer
 * straight back. If the pool is empty (consumer lagging), the frame is written into a private
 * scratch buffer and skipped instead of allocating — counted in `dropped`.
 *
 * Messages on the port (other messages are ignored, so the port can be shared with ctl/status):
 *   producer → consumer  { t: 'frame', seq, byteLength, buffer }   (buffer transferred)
 *   consumer → producer  { t: 'frameReturn', buffer }              (buffer transferred)
 *
 * Note: `postMessage` itself allocates (message object, structured clone); the SAB transport
 * is the allocation-free path.
 */

import {
  FRAME_MSG,
  FRAME_RETURN_MSG,
  checkFrameLength,
  messageData,
  viewOf,
  type FrameConsumer,
  type FrameMsg,
  type FrameProducer,
  type FrameReturnMsg,
  type PortLike,
} from './types.ts';

/** Minimum pool size (one in flight to the consumer, one returning, one being written). */
export const MIN_TRANSFER_POOL = 3;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Type guard for frame messages (main thread: route worker messages). */
export function isFrameMsg(x: unknown): x is FrameMsg {
  return (
    isRecord(x) &&
    x.t === FRAME_MSG &&
    typeof x.seq === 'number' &&
    typeof x.byteLength === 'number' &&
    x.buffer instanceof ArrayBuffer
  );
}

/** Type guard for returned frame buffers (sim worker: route main messages). */
export function isFrameReturnMsg(x: unknown): x is FrameReturnMsg {
  return isRecord(x) && x.t === FRAME_RETURN_MSG && x.buffer instanceof ArrayBuffer;
}

/** Producer side (sim worker). */
export class TransferFrameProducer implements FrameProducer {
  readonly capacity: number;
  readonly poolSize: number;
  private readonly port: PortLike;
  /** Free buffers (stack, pre-sized to poolSize so push/pop never reallocate). */
  private readonly pool: ArrayBuffer[];
  private poolCount = 0;
  private readonly scratch: Uint8Array;
  private current: Uint8Array | null = null;
  private currentIsScratch = false;
  private seqCounter = 0;
  private producedCount = 0;
  private droppedCount = 0;
  private readonly onMessage: (ev: object) => void;
  private readonly transferList: ArrayBuffer[] = [];

  constructor(port: PortLike, capacity: number, poolSize = MIN_TRANSFER_POOL) {
    if (!Number.isInteger(capacity) || capacity < 16) throw new RangeError(`invalid frame capacity ${capacity}`);
    if (!Number.isInteger(poolSize) || poolSize < MIN_TRANSFER_POOL) {
      throw new RangeError(`transfer pool needs ≥ ${MIN_TRANSFER_POOL} buffers, got ${poolSize}`);
    }
    this.port = port;
    this.capacity = capacity;
    this.poolSize = poolSize;
    this.pool = new Array<ArrayBuffer>(poolSize);
    for (let i = 0; i < poolSize; i++) this.pool[i] = new ArrayBuffer(capacity);
    this.poolCount = poolSize;
    this.scratch = new Uint8Array(capacity);
    this.onMessage = (ev: object): void => {
      const d = messageData(ev);
      if (!isFrameReturnMsg(d)) return;
      if (d.buffer.byteLength !== this.capacity || this.poolCount >= this.poolSize) return;
      this.pool[this.poolCount++] = d.buffer;
    };
    port.addEventListener('message', this.onMessage);
    port.start?.();
  }

  get produced(): number {
    return this.producedCount;
  }

  /** Frames skipped because every pool buffer was in flight. */
  get dropped(): number {
    return this.droppedCount;
  }

  /** Buffers currently available in the pool. */
  get available(): number {
    return this.poolCount;
  }

  begin(): Uint8Array {
    if (this.current !== null) return this.current;
    if (this.poolCount > 0) {
      const buf = this.pool[--this.poolCount]!;
      this.current = new Uint8Array(buf);
      this.currentIsScratch = false;
    } else {
      this.current = this.scratch;
      this.currentIsScratch = true;
    }
    return this.current;
  }

  commit(byteLength: number): void {
    const cur = this.current;
    if (cur === null) throw new Error('TransferFrameProducer.commit without begin');
    checkFrameLength(byteLength, this.capacity);
    this.current = null;
    if (this.currentIsScratch) {
      this.droppedCount++;
      return;
    }
    const seq = (this.seqCounter + 1) >>> 0 || 1;
    this.seqCounter = seq;
    const buffer = cur.buffer as ArrayBuffer;
    const msg: FrameMsg = { t: FRAME_MSG, seq, byteLength, buffer };
    const tl = this.transferList;
    tl[0] = buffer;
    this.port.postMessage(msg, tl);
    tl.length = 0;
    this.producedCount++;
  }

  close(): void {
    this.port.removeEventListener('message', this.onMessage);
  }
}

/** Consumer side (main thread). Copy-on-arrival into a local double buffer. */
export class TransferFrameConsumer implements FrameConsumer {
  readonly capacity: number;
  private readonly port: PortLike;
  /** Two local buffers: `incoming` receives arrivals, the other backs the last poll() result. */
  private readonly bufs: readonly [Uint8Array, Uint8Array];
  private incoming: 0 | 1 = 0;
  private incomingLen = 0;
  private incomingSeq = 0;
  private lastSeq = 0;
  private receivedCount = 0;
  private arrivedCount = 0;
  /** Cached result views, one per local buffer. */
  private readonly views: [Uint8Array | null, Uint8Array | null] = [null, null];
  private readonly onMessage: (ev: object) => void;
  private readonly transferList: ArrayBuffer[] = [];

  constructor(port: PortLike, capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 16) throw new RangeError(`invalid frame capacity ${capacity}`);
    this.port = port;
    this.capacity = capacity;
    this.bufs = [new Uint8Array(capacity), new Uint8Array(capacity)];
    this.onMessage = (ev: object): void => {
      const d = messageData(ev);
      if (isFrameMsg(d)) this.arrive(d);
    };
    port.addEventListener('message', this.onMessage);
    port.start?.();
  }

  get seq(): number {
    return this.lastSeq;
  }

  get received(): number {
    return this.receivedCount;
  }

  /** Frames that arrived (≥ received; the difference was superseded before a poll). */
  get arrived(): number {
    return this.arrivedCount;
  }

  /** Handles a frame message (also usable directly if the caller routes port messages itself). */
  arrive(msg: FrameMsg): void {
    const buffer = msg.buffer;
    const len = msg.byteLength;
    if (len >= 0 && len <= this.capacity && len <= buffer.byteLength) {
      this.bufs[this.incoming].set(new Uint8Array(buffer, 0, len), 0);
      this.incomingLen = len;
      this.incomingSeq = msg.seq >>> 0;
      this.arrivedCount++;
    }
    const tl = this.transferList;
    tl[0] = buffer;
    const back: FrameReturnMsg = { t: FRAME_RETURN_MSG, buffer };
    this.port.postMessage(back, tl);
    tl.length = 0;
  }

  poll(): Uint8Array | null {
    const seq = this.incomingSeq;
    if (seq === 0 || seq === this.lastSeq) return null;
    const idx = this.incoming;
    this.incoming = idx === 0 ? 1 : 0;
    this.lastSeq = seq;
    this.receivedCount++;
    const i = idx;
    const v = viewOf(this.bufs[i], this.incomingLen, this.views[i]);
    this.views[i] = v;
    return v;
  }

  close(): void {
    this.port.removeEventListener('message', this.onMessage);
  }
}

/** Producer factory (sim worker, `InitMessage.transport === 'transfer'`). */
export function createTransferProducer(port: PortLike, capacity: number, poolSize = MIN_TRANSFER_POOL): TransferFrameProducer {
  return new TransferFrameProducer(port, capacity, poolSize);
}

/** Consumer factory (main thread). */
export function createTransferConsumer(port: PortLike, capacity: number): TransferFrameConsumer {
  return new TransferFrameConsumer(port, capacity);
}
