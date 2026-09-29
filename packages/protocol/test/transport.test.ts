import fc from 'fast-check';
import { MessageChannel, Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  FrameWriter,
  SabFrameConsumer,
  SabFrameProducer,
  TransferFrameConsumer,
  TransferFrameProducer,
  canUseSab,
  createFrameConsumer,
  createFrameProducer,
  createSabFrameBuffer,
  frameCapacityBytes,
  sabFrameCapacity,
  type FrameConsumer,
  type FrameProducer,
} from '../src/index.ts';
import { TEST_CAPS, writeTestFrame } from './support/frames.ts';
import { checkPatternFrame, fillPatternFrame, patternLength } from './support/pattern.ts';

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

async function pollUntil(c: FrameConsumer, maxTurns = 1000): Promise<Uint8Array> {
  for (let i = 0; i < maxTurns; i++) {
    const f = c.poll();
    if (f !== null) return f;
    await tick();
  }
  throw new Error('no frame arrived');
}

/** Produces `count` FrameWriter frames through a producer/consumer pair and collects copies. */
async function runSequence(p: FrameProducer, c: FrameConsumer, count: number): Promise<Uint8Array[]> {
  const w = new FrameWriter(TEST_CAPS);
  const out: Uint8Array[] = [];
  for (let n = 0; n < count; n++) {
    const buf = p.begin();
    const len = writeTestFrame(w, buf, n);
    p.commit(len);
    out.push((await pollUntil(c)).slice());
  }
  return out;
}

describe('frame transports', () => {
  const capacity = frameCapacityBytes(TEST_CAPS);

  it('SAB and transfer deliver byte-identical frames for the same sequence', async () => {
    const sab = createSabFrameBuffer(capacity);
    expect(sabFrameCapacity(sab)).toBe(capacity);
    const sabFrames = await runSequence(new SabFrameProducer(sab), new SabFrameConsumer(sab), 60);

    const ch = new MessageChannel();
    const tp = new TransferFrameProducer(ch.port1, capacity, 3);
    const tc = new TransferFrameConsumer(ch.port2, capacity);
    const trFrames = await runSequence(tp, tc, 60);
    tp.close();
    tc.close();
    ch.port1.close();

    // Reference: frames written directly.
    const w = new FrameWriter(TEST_CAPS);
    const ref = new Uint8Array(capacity);
    expect(sabFrames).toHaveLength(60);
    expect(trFrames).toHaveLength(60);
    for (let n = 0; n < 60; n++) {
      const len = writeTestFrame(w, ref, n);
      expect(sabFrames[n]!.length).toBe(len);
      expect(Buffer.compare(sabFrames[n]!, ref.subarray(0, len))).toBe(0);
      expect(Buffer.compare(trFrames[n]!, sabFrames[n]!)).toBe(0);
    }
    expect(tp.dropped).toBe(0);
    expect(tp.produced).toBe(60);
    expect(tc.received).toBe(60);
  });

  it('factories select the transport kind', async () => {
    const sab = createSabFrameBuffer(capacity);
    const p = createFrameProducer({ kind: 'sab', capacity, sab });
    const c = createFrameConsumer({ kind: 'sab', capacity, sab });
    expect(p).toBeInstanceOf(SabFrameProducer);
    expect(c).toBeInstanceOf(SabFrameConsumer);
    expect(() => createFrameProducer({ kind: 'sab', capacity: capacity + 8, sab })).toThrow(RangeError);
    expect(() => createFrameProducer({ kind: 'transfer', capacity })).toThrow();
    const ch = new MessageChannel();
    const tp = createFrameProducer({ kind: 'transfer', capacity, port: ch.port1 });
    const tc = createFrameConsumer({ kind: 'transfer', capacity, port: ch.port2 });
    expect(tp).toBeInstanceOf(TransferFrameProducer);
    expect(tc).toBeInstanceOf(TransferFrameConsumer);
    const b = tp.begin();
    b[0] = 77;
    tp.commit(4);
    const f = await pollUntil(tc);
    expect(Array.from(f)).toEqual([77, 0, 0, 0]);
    tp.close();
    tc.close();
    ch.port1.close();
    expect(canUseSab({ crossOriginIsolated: true })).toBe(true);
    expect(canUseSab({})).toBe(false);
  });

  it('SAB consumer returns only new frames and the newest one', () => {
    const cap = 256;
    const sab = createSabFrameBuffer(cap);
    const p = new SabFrameProducer(sab);
    const c = new SabFrameConsumer(sab);
    expect(c.poll()).toBeNull();
    for (let n = 1; n <= 5; n++) {
      const len = patternLength(n, cap);
      fillPatternFrame(p.begin(), n, len);
      p.commit(len);
    }
    const f = c.poll();
    expect(f).not.toBeNull();
    expect(checkPatternFrame(f!)).toBe(5);
    expect(c.seq).toBe(5);
    expect(c.poll()).toBeNull();
    expect(p.produced).toBe(5);
    expect(p.dropped).toBe(4);
    expect(c.published).toBe(5);
  });

  it('SAB triple buffer never tears under random producer/consumer interleavings', () => {
    const cap = 512;
    type Step = { kind: 'write'; chunk: number } | { kind: 'commit' } | { kind: 'poll' };
    const stepArb: fc.Arbitrary<Step> = fc.oneof(
      fc.integer({ min: 1, max: 200 }).map<Step>((chunk) => ({ kind: 'write', chunk })),
      fc.constant<Step>({ kind: 'commit' }),
      fc.constant<Step>({ kind: 'poll' }),
    );
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 300 }), (steps) => {
        const sab = createSabFrameBuffer(cap);
        const p = new SabFrameProducer(sab);
        const c = new SabFrameConsumer(sab);
        let n = 1;
        let written = 0;
        let lastPolled = 0;
        let held: Uint8Array | null = null;
        let heldCopy: Uint8Array | null = null;
        const scratch = new Uint8Array(cap);
        for (const s of steps) {
          if (s.kind === 'write') {
            // Write the next chunk of frame n directly into the producer's buffer.
            const len = patternLength(n, cap);
            fillPatternFrame(scratch, n, len);
            const buf = p.begin();
            const end = Math.min(len, written + s.chunk);
            buf.set(scratch.subarray(written, end), written);
            written = end;
          } else if (s.kind === 'commit') {
            const len = patternLength(n, cap);
            if (written < len) {
              const buf = p.begin();
              fillPatternFrame(scratch, n, len);
              buf.set(scratch.subarray(written, len), written);
            }
            p.commit(len);
            n++;
            written = 0;
          } else {
            // The previously returned view must be unchanged up to this poll.
            if (held !== null) expect(Buffer.compare(held, heldCopy!)).toBe(0);
            const f = c.poll();
            if (f !== null) {
              const got = checkPatternFrame(f);
              expect(got).toBeGreaterThan(lastPolled);
              expect(got).toBe(n - 1); // always the newest committed frame
              lastPolled = got;
              held = f;
              heldCopy = f.slice();
            }
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('SAB triple buffer has no tearing across real threads', async () => {
    const cap = 4096;
    const frames = 20_000;
    const sab = createSabFrameBuffer(cap);
    const done = new SharedArrayBuffer(4);
    const doneFlag = new Int32Array(done);
    const c = new SabFrameConsumer(sab);
    const worker = new Worker(new URL('./support/sab-producer.worker.ts', import.meta.url), {
      workerData: { sab, done, frames },
    });
    const result = new Promise<{ produced: number; dropped: number }>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    let last = 0;
    let got = 0;
    let torn = 0;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const finished = Atomics.load(doneFlag, 0) === 1;
      const f = c.poll();
      if (f !== null) {
        const k = checkPatternFrame(f);
        if (k < 0 || k <= last) torn++;
        else last = k;
        got++;
      } else if (finished) break;
      if ((got & 63) === 0) await tick();
    }
    const stats = await result;
    await worker.terminate();
    expect(torn).toBe(0);
    expect(last).toBe(frames);
    expect(got).toBeGreaterThan(1);
    expect(stats.produced).toBe(frames);
    expect(stats.dropped + got).toBe(frames);
  }, 30_000);

  it('transfer producer skips frames instead of allocating when the pool is empty', async () => {
    const ch = new MessageChannel();
    const cap = 128;
    const p = new TransferFrameProducer(ch.port1, cap, 3);
    const c = new TransferFrameConsumer(ch.port2, cap);
    // Five frames synchronously: the pool (3) runs dry, two are skipped.
    for (let n = 1; n <= 5; n++) {
      const len = patternLength(n, cap);
      fillPatternFrame(p.begin(), n, len);
      p.commit(len);
    }
    expect(p.produced).toBe(3);
    expect(p.dropped).toBe(2);
    expect(p.available).toBe(0);
    const f = await pollUntil(c);
    // Copy-on-arrival: all three arrived before the poll, the newest wins.
    for (let i = 0; i < 20 && c.arrived < 3; i++) await tick();
    const newest = c.poll() ?? f;
    expect(checkPatternFrame(newest)).toBe(3);
    // Buffers come back to the pool.
    for (let i = 0; i < 50 && p.available < 3; i++) await tick();
    expect(p.available).toBe(3);
    // The last polled view stays valid while a new frame arrives.
    const held = newest.slice();
    const len6 = patternLength(6, cap);
    fillPatternFrame(p.begin(), 6, len6);
    p.commit(len6);
    for (let i = 0; i < 50 && c.arrived < 4; i++) await tick();
    expect(Buffer.compare(newest, held)).toBe(0);
    expect(checkPatternFrame(await pollUntil(c))).toBe(6);
    p.close();
    c.close();
    ch.port1.close();
  });

  it('transfer consumer ignores unrelated messages on a shared port', async () => {
    const ch = new MessageChannel();
    const c = new TransferFrameConsumer(ch.port2, 64);
    ch.port1.postMessage({ t: 'status', tick: 1 });
    ch.port1.postMessage({ t: 'frame', seq: 'x' });
    for (let i = 0; i < 10; i++) await tick();
    expect(c.poll()).toBeNull();
    c.close();
    ch.port1.close();
  });

  it('SAB produce/poll is allocation-free', () => {
    const cap = 1024;
    const sab = createSabFrameBuffer(cap);
    const p = new SabFrameProducer(sab);
    const c = new SabFrameConsumer(sab);
    const cycle = (): number => {
      const b = p.begin();
      b[0] = 1;
      p.commit(512);
      const f = c.poll();
      return f === null ? 0 : f.length;
    };
    for (let i = 0; i < 1000; i++) cycle();
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    let acc = 0;
    for (let i = 0; i < 100_000; i++) acc += cycle();
    gc?.();
    const grown = process.memoryUsage().heapUsed - before;
    expect(acc).toBe(512 * 100_000);
    if (gc !== undefined) expect(grown).toBeLessThan(256 * 1024);
  });
});
