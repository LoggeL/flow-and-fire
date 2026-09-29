/**
 * Frame transport contracts (PLAN §2 "Threads und Transport", §3.6). DOM-free: ports are typed
 * structurally so a browser `Worker`, a worker's global scope, a `MessagePort` and Node's
 * `worker_threads` ports all fit.
 *
 * Both implementations deliver exactly the committed bytes of each frame; the frame layout
 * itself (see ../frame.ts) is opaque to the transport.
 */

/** Minimal message event (browser MessageEvent and Node's MessageEvent both match). */
export interface MessageEventLike {
  readonly data: unknown;
}

/** `data` of a message event delivered to a PortLike listener. */
export function messageData(ev: object): unknown {
  return (ev as MessageEventLike).data;
}

/** Structural message port: Worker, DedicatedWorkerGlobalScope, MessagePort (browser + Node). */
export interface PortLike {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  /**
   * The listener receives a MessageEvent-like object (read it via `messageData(ev)`). Its
   * parameter is typed `object` so that DOM (`(ev: MessageEvent) => …`) and Node
   * (`EventListener`) signatures are both structurally assignable.
   */
  addEventListener(type: 'message', listener: (ev: object) => void): void;
  removeEventListener(type: 'message', listener: (ev: object) => void): void;
  /** MessagePort.start(); called if present (browser MessagePorts need it with addEventListener). */
  start?(): void;
}

/** Sim side: write a frame into `begin()`'s buffer, then publish its first `byteLength` bytes. */
export interface FrameProducer {
  /**
   * Buffer for the next frame (length ≥ the transport's capacity). Calling `begin()` twice
   * without `commit()` returns the same buffer.
   */
  begin(): Uint8Array;
  /** Publishes bytes [0, byteLength) of the buffer returned by `begin()`. */
  commit(byteLength: number): void;
  /** Frames published to the consumer. */
  readonly produced: number;
  /**
   * Frames that never reached the consumer: overwritten before being polled (SAB) or skipped
   * because the buffer pool was empty (transfer).
   */
  readonly dropped: number;
  /** Detaches listeners (transfer) — the producer must not be used afterwards. */
  close(): void;
}

/** Main side: copy-on-arrival consumer of the newest frame. */
export interface FrameConsumer {
  /**
   * The newest frame if one arrived since the last call, else null. The returned view points
   * into a consumer-owned buffer and stays valid (unchanged) until the next `poll()`.
   */
  poll(): Uint8Array | null;
  /** Transport sequence number of the frame returned by the last successful poll (0 = none). */
  readonly seq: number;
  /** Frames returned by `poll()`. */
  readonly received: number;
  /** Detaches listeners — the consumer must not be used afterwards. */
  close(): void;
}

/** Message type tags used on the port by the transfer transport. */
export const FRAME_MSG = 'frame';
export const FRAME_RETURN_MSG = 'frameReturn';

/** Sim → main: one frame, `buffer` transferred. */
export interface FrameMsg {
  readonly t: typeof FRAME_MSG;
  /** Transport sequence number (u32, starts at 1). */
  readonly seq: number;
  readonly byteLength: number;
  readonly buffer: ArrayBuffer;
}

/** Main → sim: the frame buffer handed back to the producer's pool, `buffer` transferred. */
export interface FrameReturnMsg {
  readonly t: typeof FRAME_RETURN_MSG;
  readonly buffer: ArrayBuffer;
}

/** Messages the transfer transport puts on a port (listeners ignore everything else). */
export type TransportMessage = FrameMsg | FrameReturnMsg;

/** Checks a frame byte length against a capacity. */
export function checkFrameLength(byteLength: number, capacity: number): void {
  if (!Number.isInteger(byteLength) || byteLength < 0 || byteLength > capacity) {
    throw new RangeError(`frame byteLength ${byteLength} outside [0, ${capacity}]`);
  }
}

/**
 * Returns a view of `buf[0, len)`, reusing `cached` if it already has that exact shape.
 * Keeps `poll()` allocation-free while frame sizes stay constant.
 */
export function viewOf(buf: Uint8Array, len: number, cached: Uint8Array | null): Uint8Array {
  if (cached !== null && cached.buffer === buf.buffer && cached.byteOffset === buf.byteOffset && cached.length === len) {
    return cached;
  }
  return buf.subarray(0, len);
}
