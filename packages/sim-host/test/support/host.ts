import {
  createSabConsumer,
  createSabFrameBuffer,
  createTransferConsumer,
  DEFAULT_FRAME_CAPS,
  frameCapacityBytes,
  type FrameConsumer,
  type HostMessage,
  type TransportKind,
} from '@faf/protocol';
import { SimHost, type HostInitMessage, type SimHostOptions } from '../../src/index.ts';
import { FakeClock, FakeWakeup } from './fake-time.ts';
import { gameSimBinBuffer } from './fixtures.ts';

export const FRAME_CAP = frameCapacityBytes(DEFAULT_FRAME_CAPS);

export interface TestHost {
  host: SimHost;
  clock: FakeClock;
  wake: FakeWakeup;
  msgs: HostMessage[];
  consumer: FrameConsumer;
  /** Closes host, consumer and channel. */
  close(): void;
  of<T extends HostMessage['t']>(t: T): Extract<HostMessage, { t: T }>[];
}

export interface TestHostOptions {
  readonly transport?: TransportKind;
  readonly seed?: number;
  readonly startPaused?: boolean;
  readonly autoStart?: boolean;
  readonly host?: Partial<Omit<SimHostOptions, 'post' | 'port' | 'wakeup'>>;
}

/**
 * A SimHost on a fake clock. SAB: consumer on the same SAB. Transfer: host on port1 of a Node
 * MessageChannel, consumer on port2 (frames arrive asynchronously).
 */
export function makeTestHost(o: TestHostOptions = {}): TestHost {
  const transport = o.transport ?? 'sab';
  const clock = new FakeClock();
  const wake = new FakeWakeup(clock);
  const msgs: HostMessage[] = [];
  let consumer: FrameConsumer;
  let channel: MessageChannel | null = null;
  let host: SimHost;
  const sab = transport === 'sab' ? createSabFrameBuffer(FRAME_CAP) : undefined;
  if (transport === 'sab') {
    host = new SimHost({ ...(o.host ?? {}), opfs: o.host?.opfs ?? null, post: (m) => msgs.push(m), clock: o.host?.clock ?? clock, wakeup: wake, ...(o.autoStart !== undefined ? { autoStart: o.autoStart } : {}) });
    consumer = createSabConsumer(sab!);
  } else {
    channel = new MessageChannel();
    const port1 = channel.port1;
    host = new SimHost({
      ...(o.host ?? {}),
      opfs: o.host?.opfs ?? null,
      post: (m, tr) => {
        msgs.push(m);
        port1.postMessage(m, tr);
      },
      port: port1,
      clock: o.host?.clock ?? clock,
      wakeup: wake,
      ...(o.autoStart !== undefined ? { autoStart: o.autoStart } : {}),
    });
    consumer = createTransferConsumer(channel.port2, FRAME_CAP);
  }
  const init: HostInitMessage = {
    t: 'init',
    simBin: gameSimBinBuffer(),
    seed: o.seed ?? 77,
    armyCount: 2,
    playerArmy: 0,
    transport,
    ...(sab !== undefined ? { frameSab: sab } : {}),
    frameCapacity: FRAME_CAP,
    buildHash: 'test-build',
    ...(o.startPaused !== undefined ? { startPaused: o.startPaused } : {}),
  };
  host.init(init);
  return {
    host,
    clock,
    wake,
    msgs,
    consumer,
    close(): void {
      host.dispose();
      consumer.close();
      channel?.port1.close();
      channel?.port2.close();
    },
    of<T extends HostMessage['t']>(t: T): Extract<HostMessage, { t: T }>[] {
      return msgs.filter((m): m is Extract<HostMessage, { t: T }> => m.t === t);
    },
  };
}

/** Waits (macrotasks) until the consumer delivers a frame; returns a copy. */
export async function nextFrame(consumer: FrameConsumer, timeoutMs = 2000): Promise<Uint8Array> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const f = consumer.poll();
    if (f !== null) return f.slice();
    if (performance.now() > end) throw new Error('no frame arrived');
    await new Promise((r) => setImmediate(r));
  }
}
