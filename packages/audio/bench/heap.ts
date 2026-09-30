/**
 * Allocation measurement (Node only; tests and benchmarks).
 *
 * `heapUsed` after a forced gc() only shows what is RETAINED; garbage produced on a hot path is
 * collected by that gc and never shows up. This helper measures what is ALLOCATED instead:
 *
 *   allocated = usedHeap(end) − usedHeap(start) + Σ over every GC in between (before − after)
 *
 * The GCs in between are recorded synchronously by `v8.GCProfiler`, so scavenges during the
 * measured loop are accounted for and no gc() runs between the loop and the second reading.
 * A single gc() before the baseline (if exposed) only makes the baseline stable.
 */

import v8 from 'node:v8';

export interface AllocationResult {
  /** Bytes allocated on the V8 heap while `fn` ran (garbage included). */
  allocatedBytes: number;
  /** Bytes still live after `fn` compared to the baseline (no gc at the end). */
  heapDeltaBytes: number;
  /** GCs that ran during `fn`. */
  gcs: number;
}

interface GcStat {
  beforeGC: { heapStatistics: { usedHeapSize: number } };
  afterGC: { heapStatistics: { usedHeapSize: number } };
}

/** Runs `fn` and returns the bytes it allocated (see module comment). */
export function measureAllocation(fn: () => void): AllocationResult {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const profiler = new v8.GCProfiler();
  profiler.start();
  const before = v8.getHeapStatistics().used_heap_size;
  fn();
  const after = v8.getHeapStatistics().used_heap_size;
  const report = profiler.stop() as unknown as { statistics: readonly GcStat[] } | undefined;
  let freed = 0;
  const stats = report?.statistics ?? [];
  for (const s of stats) freed += s.beforeGC.heapStatistics.usedHeapSize - s.afterGC.heapStatistics.usedHeapSize;
  return { allocatedBytes: after - before + freed, heapDeltaBytes: after - before, gcs: stats.length };
}
