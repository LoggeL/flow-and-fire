/**
 * Kind-agnostic factories: the sim host and the client pick the transport from
 * `InitMessage.transport` and get the same FrameProducer / FrameConsumer interface.
 */

import { SabFrameConsumer, SabFrameProducer } from './sab.ts';
import { MIN_TRANSFER_POOL, TransferFrameConsumer, TransferFrameProducer } from './transfer.ts';
import type { FrameConsumer, FrameProducer, PortLike } from './types.ts';

export type FrameTransportKind = 'sab' | 'transfer';

export interface FrameTransportOptions {
  readonly kind: FrameTransportKind;
  /** Frame slot capacity in bytes (must match on both sides). */
  readonly capacity: number;
  /** Shared triple buffer (kind 'sab'). */
  readonly sab?: SharedArrayBuffer | undefined;
  /** Port to the other side (kind 'transfer'). */
  readonly port?: PortLike | undefined;
  /** Transfer pool size (producer, kind 'transfer'; default 3). */
  readonly poolSize?: number | undefined;
}

function needSab(o: FrameTransportOptions): SharedArrayBuffer {
  if (o.sab === undefined) throw new Error("frame transport 'sab' needs a SharedArrayBuffer");
  return o.sab;
}

function needPort(o: FrameTransportOptions): PortLike {
  if (o.port === undefined) throw new Error("frame transport 'transfer' needs a port");
  return o.port;
}

/** Producer for the given transport kind (sim worker). */
export function createFrameProducer(o: FrameTransportOptions): FrameProducer {
  if (o.kind === 'sab') {
    const p = new SabFrameProducer(needSab(o));
    if (p.capacity < o.capacity) throw new RangeError(`frame SAB capacity ${p.capacity} < ${o.capacity}`);
    return p;
  }
  return new TransferFrameProducer(needPort(o), o.capacity, o.poolSize ?? MIN_TRANSFER_POOL);
}

/** Consumer for the given transport kind (main thread). */
export function createFrameConsumer(o: FrameTransportOptions): FrameConsumer {
  if (o.kind === 'sab') {
    const c = new SabFrameConsumer(needSab(o));
    if (c.capacity < o.capacity) throw new RangeError(`frame SAB capacity ${c.capacity} < ${o.capacity}`);
    return c;
  }
  return new TransferFrameConsumer(needPort(o), o.capacity);
}
