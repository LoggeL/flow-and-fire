/**
 * Worker-based SimLink (PLAN §3.6): the main thread's connection to the sim worker.
 *
 * - `cmd`: command batches are posted as `{t:'cmd', batch}` with the buffer transferred.
 * - `ctl`: control messages are posted as they are (structured clone).
 * - frames: SAB triple buffer (cross-origin isolated) or transfer ping-pong on the worker port;
 *   the transfer consumer filters `t:'frame'` messages on the worker itself.
 * - host messages (ready, status, stats, log, error) are fanned out to subscribers; transport
 *   messages are ignored here. A worker crash becomes an `error` host message.
 */
import type { SimLink } from '@faf/client';
import {
  createFrameConsumer,
  createSabFrameBuffer,
  isFrameMsg,
  type CtlMessage,
  type FrameConsumer,
  type HostMessage,
  type PortLike,
  type TransportKind,
} from '@faf/protocol';

/** The worker surface the link needs (a DOM `Worker` fits). */
export interface WorkerLike extends PortLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  postMessage(message: unknown): void;
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (ev: object) => void): void;
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: (ev: object) => void): void;
  terminate(): void;
}

const HOST_TAGS = new Set(['ready', 'status', 'stats', 'log', 'error']);

function isHostMessage(x: unknown): x is HostMessage {
  return typeof x === 'object' && x !== null && HOST_TAGS.has((x as { t?: unknown }).t as string);
}

export class WorkerSimLink implements SimLink {
  readonly frames: FrameConsumer;
  readonly transport: TransportKind;
  readonly capacity: number;
  /** Frame triple buffer (transport 'sab' only). */
  readonly sab: SharedArrayBuffer | undefined;
  private readonly worker: WorkerLike;
  private readonly listeners: ((m: HostMessage) => void)[] = [];
  private readonly onMessage: (ev: object) => void;
  private readonly onError: (ev: object) => void;
  private closed = false;

  constructor(worker: WorkerLike, transport: TransportKind, capacity: number) {
    this.worker = worker;
    this.transport = transport;
    this.capacity = capacity;
    this.sab = transport === 'sab' ? createSabFrameBuffer(capacity) : undefined;
    this.frames = createFrameConsumer({ kind: transport, capacity, sab: this.sab, port: worker });
    this.onMessage = (ev) => {
      const data = (ev as { data?: unknown }).data;
      if (isFrameMsg(data)) return; // handled by the transfer consumer
      if (isHostMessage(data)) this.emit(data);
    };
    this.onError = (ev) => {
      const e = ev as { message?: unknown; preventDefault?: () => void };
      e.preventDefault?.();
      const msg = typeof e.message === 'string' && e.message !== '' ? e.message : 'sim worker failed to load or crashed';
      this.emit({ t: 'error', message: `worker: ${msg}` });
    };
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
    worker.addEventListener('messageerror', this.onError);
  }

  sendCommands(batch: ArrayBuffer): void {
    if (this.closed) return;
    this.worker.postMessage({ t: 'cmd', batch }, [batch]);
  }

  sendCtl(msg: CtlMessage): void {
    if (this.closed) return;
    this.worker.postMessage(msg);
  }

  /** Posts the init message (simBin is transferred). */
  sendInit(msg: object, transfer: ArrayBuffer[]): void {
    this.worker.postMessage(msg, transfer);
  }

  onHostMessage(cb: (m: HostMessage) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Detaches all listeners and terminates the worker. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.removeEventListener('messageerror', this.onError);
    this.frames.close();
    this.worker.terminate();
  }

  private emit(m: HostMessage): void {
    for (const l of this.listeners.slice()) l(m);
  }
}
