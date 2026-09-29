/**
 * Worker used by transport.test.ts: runs a real SabFrameProducer on its own thread and
 * publishes `frames` self-describing frames as fast as possible.
 * Loaded by Node directly (native type stripping), so only erasable TS syntax is used.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { SabFrameProducer } from '../../src/transport/sab.ts';
import { fillPatternFrame, patternLength } from './pattern.ts';

interface Data {
  sab: SharedArrayBuffer;
  done: SharedArrayBuffer;
  frames: number;
}

const d = workerData as Data;
const p = new SabFrameProducer(d.sab);
const done = new Int32Array(d.done);
for (let n = 1; n <= d.frames; n++) {
  const buf = p.begin();
  const len = patternLength(n, p.capacity);
  fillPatternFrame(buf, n, len);
  p.commit(len);
}
Atomics.store(done, 0, 1);
parentPort?.postMessage({ produced: p.produced, dropped: p.dropped });
