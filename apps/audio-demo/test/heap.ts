/**
 * Allocation measurement for the demo tests (copy of packages/audio/bench/heap.ts, which is not
 * part of the @faf/audio exports): bytes ALLOCATED while `fn` runs, garbage included —
 * usedHeap(end) − usedHeap(start) + Σ (before − after) over the GCs recorded by v8.GCProfiler.
 * No gc() runs between the loop and the second reading.
 */
import v8 from 'node:v8';

interface GcStat {
  beforeGC: { heapStatistics: { usedHeapSize: number } };
  afterGC: { heapStatistics: { usedHeapSize: number } };
}

export function measureAllocatedBytes(fn: () => void): number {
  (globalThis as { gc?: () => void }).gc?.();
  const profiler = new v8.GCProfiler();
  profiler.start();
  const before = v8.getHeapStatistics().used_heap_size;
  fn();
  const after = v8.getHeapStatistics().used_heap_size;
  const report = profiler.stop() as unknown as { statistics: readonly GcStat[] } | undefined;
  let freed = 0;
  for (const s of report?.statistics ?? []) freed += s.beforeGC.heapStatistics.usedHeapSize - s.afterGC.heapStatistics.usedHeapSize;
  return after - before + freed;
}
