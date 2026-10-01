// Allocation probe for CameraShake.sample(), run by shake.test.ts in a plain Node process
// (`node --expose-gc --import tsx`): inside the vitest worker the harness itself allocates in hot
// loops, which hides the signal. Prints the heap growth in bytes for 500k warm calls as JSON.
import { CameraShake } from '../../../src/effects/shake.ts';

const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) throw new Error('run with --expose-gc');
const s = new CameraShake();
s.add([0, 0, 0], 2, 1e6, 100, 8, 0);
s.add([4, 0, 2], 1, 1e6, 50, 5, 0);
const target = [1, 0, 1];
// Generic (boxed) elements: reading an unboxed double and passing it to a call would make the
// CALLER allocate a HeapNumber, which is not what this probe measures.
const boxedTimes: unknown[] = ['generic'];
for (let i = 0; i < 1024; i++) boxedTimes.push(0.05 + i * 0.013);
boxedTimes.shift();
const times = boxedTimes as number[];
for (let i = 0; i < 300_000; i++) s.sample(times[i & 1023]!, target);
let best = Infinity;
for (let round = 0; round < 3; round++) {
  gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 500_000; i++) s.sample(times[i & 1023]!, target);
  best = Math.min(best, process.memoryUsage().heapUsed - h0);
}
process.stdout.write(JSON.stringify({ growth: best }));
