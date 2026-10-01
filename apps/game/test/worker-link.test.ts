import { MessageChannel, type MessagePort } from 'node:worker_threads';
import {
  createFrameProducer,
  DEFAULT_FRAME_CAPS,
  frameCapacityBytes,
  FrameReader,
  FrameWriter,
  type HostMessage,
} from '@faf/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerSimLink, type WorkerLike } from '../src/worker-link.ts';

const CAP = frameCapacityBytes(DEFAULT_FRAME_CAPS);
const open: MessagePort[] = [];

/** A Node MessagePort pair: `worker` is the main-thread side, `host` the sim-worker side. */
function pair(): { worker: WorkerLike & { terminated: boolean }; host: MessagePort } {
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  const worker = Object.assign(port1, {
    terminated: false,
    terminate(this: { terminated: boolean }) {
      this.terminated = true;
      port1.close();
    },
  }) as unknown as WorkerLike & { terminated: boolean };
  return { worker, host: port2 };
}

function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((res) => port.once('message', (d: unknown) => res(d)));
}

function until(pred: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const poll = (): void => {
      if (pred()) res();
      else if (Date.now() - t0 > ms) rej(new Error('timeout'));
      else setTimeout(poll, 2);
    };
    poll();
  });
}

function writeFrame(target: Uint8Array, tick: number): number {
  const w = new FrameWriter(DEFAULT_FRAME_CAPS);
  w.beginFrame(target, tick, tick, 0, 1000, 0, 0, 0xffffffff, 0, 0);
  w.writeUnit(0, 0, 0, tick, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 1, 0, 0);
  return w.endFrame();
}

afterEach(() => {
  for (const p of open.splice(0)) p.close();
  vi.useRealTimers();
});

describe('WorkerSimLink', () => {
  it('waits for the durable shutdown acknowledgement before terminating the worker', async () => {
    const { worker, host } = pair();
    const link = new WorkerSimLink(worker, 'transfer', CAP);
    const message = nextMessage(host), closing = link.closeGracefully();
    expect(await message).toEqual({ t: 'shutdown' });
    expect(worker.terminated).toBe(false);
    host.postMessage({ t: 'closed' }); await closing;
    expect(worker.terminated).toBe(true);
  });
  it('terminates an unresponsive worker after the bounded shutdown wait', async () => {
    vi.useFakeTimers();
    const { worker } = pair();
    const link = new WorkerSimLink(worker, 'transfer', CAP);
    const closing = expect(link.closeGracefully()).rejects.toThrow('Session close timed out');
    await vi.advanceTimersByTimeAsync(3000); await closing;
    expect(worker.terminated).toBe(true);
  });
  it('posts commands with the batch transferred and ctl messages as they are', async () => {
    const { worker, host } = pair();
    const link = new WorkerSimLink(worker, 'transfer', CAP);
    const batch = new Uint8Array([1, 2, 3, 4]).buffer;
    const got = nextMessage(host);
    link.sendCommands(batch);
    expect(batch.byteLength).toBe(0); // detached = transferred
    const msg = (await got) as { t: string; batch: ArrayBuffer };
    expect(msg.t).toBe('cmd');
    expect([...new Uint8Array(msg.batch)]).toEqual([1, 2, 3, 4]);
    const ctl = nextMessage(host);
    link.sendCtl({ t: 'step', ticks: 3 });
    expect(await ctl).toEqual({ t: 'step', ticks: 3 });
    link.close();
  });

  it('fans host messages out to subscribers and keeps frames away from them', async () => {
    const { worker, host } = pair();
    const link = new WorkerSimLink(worker, 'transfer', CAP);
    const seen: HostMessage[] = [];
    const off = link.onHostMessage((m) => seen.push(m));
    const producer = createFrameProducer({ kind: 'transfer', capacity: CAP, port: host });
    const buf = producer.begin();
    producer.commit(writeFrame(buf, 42));
    host.postMessage({ t: 'status', tick: 42, paused: false, speed: 1, ticksBehind: 0 });
    host.postMessage({ t: 'somethingElse' });
    // End-of-match totals are a regular host message (it was dropped by the tag filter before).
    host.postMessage({ t: 'matchStats', stats: { fromTick: 1, toTick: 2, complete: true, sampleTicks: 100, armies: [] } });
    await until(() => seen.length === 2 && link.frames.poll() !== null);
    expect(seen.map(m => m.t)).toEqual(['status', 'matchStats']);
    off();
    host.postMessage({ t: 'error', message: 'late' });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(2);
    link.close();
  });

  it('delivers frames through the transfer ping-pong', async () => {
    const { worker, host } = pair();
    const link = new WorkerSimLink(worker, 'transfer', CAP);
    const producer = createFrameProducer({ kind: 'transfer', capacity: CAP, port: host });
    producer.commit(writeFrame(producer.begin(), 7));
    let view: Uint8Array | null = null;
    await until(() => (view = link.frames.poll()) !== null);
    const r = new FrameReader();
    expect(r.reset(view!)).toBe(true);
    expect(r.tick).toBe(7);
    expect(r.unitCount).toBe(1);
    link.close();
  });

  it('delivers frames through the SAB triple buffer it allocates', () => {
    const { worker } = pair();
    const link = new WorkerSimLink(worker, 'sab', CAP);
    expect(link.sab).toBeInstanceOf(SharedArrayBuffer);
    const producer = createFrameProducer({ kind: 'sab', capacity: CAP, sab: link.sab });
    producer.commit(writeFrame(producer.begin(), 9));
    const view = link.frames.poll();
    expect(view).not.toBeNull();
    const r = new FrameReader();
    expect(r.reset(view!)).toBe(true);
    expect(r.tick).toBe(9);
    link.close();
  });

  it('turns worker errors into error host messages; close terminates and silences', () => {
    const { worker } = pair();
    const link = new WorkerSimLink(worker, 'transfer', CAP);
    const seen: HostMessage[] = [];
    link.onHostMessage((m) => seen.push(m));
    const ev = new Event('error', { cancelable: true });
    Object.defineProperty(ev, 'message', { value: 'boom' });
    (worker as unknown as EventTarget).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(seen).toEqual([{ t: 'error', message: 'worker: boom' }]);
    link.close();
    expect(worker.terminated).toBe(true);
    link.sendCtl({ t: 'pause' }); // no throw after close
    link.close();
  });
});
