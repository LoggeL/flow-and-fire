/**
 * Direct allocation measurement for the "warm < 1 MB over 10,000 ticks" criterion (PLAN §3.4).
 *
 * Measuring the heap after a forced GC only finds leaks: short-lived garbage is collected before
 * the second reading. Here the run is split into chunks; before each chunk a full GC empties the
 * young generation, and the heap growth *without* GC inside the chunk is exactly what the chunk
 * allocated. GCs are observed with a PerformanceObserver ('gc' entries): a chunk in which V8
 * collected (which only happens once a chunk has allocated a young generation's worth) counts as
 * a GC and its growth is no longer a lower bound — callers gate on both numbers.
 * Uses its own copy per package (tests must not import other packages' test code).
 */
import { PerformanceObserver } from 'node:perf_hooks';

export interface AllocationResult {
  /** Bytes allocated in chunks without a GC. */
  readonly bytes: number;
  /** Ticks covered by those chunks. */
  readonly ticks: number;
  /** Chunks that saw at least one GC (their growth is not counted). */
  readonly chunksWithGc: number;
  readonly chunks: number;
  /** GC events that started inside a measured chunk. */
  readonly gcEvents: number;
}

const gc = (globalThis as { gc?: () => void }).gc;

/** Runs `run(n)` for `ticks` ticks in chunks and measures what they allocate. */
export async function measureAllocation(run: (n: number) => void, ticks: number, chunk = 500): Promise<AllocationResult> {
  if (gc === undefined) throw new Error('measureAllocation needs --expose-gc');
  const gcStarts: number[] = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) gcStarts.push(e.startTime);
  });
  obs.observe({ entryTypes: ['gc'] });
  const windows: number[] = [];
  const growth: number[] = [];
  const sizes: number[] = [];
  try {
    for (let done = 0; done < ticks; done += chunk) {
      const n = Math.min(chunk, ticks - done);
      gc();
      gc();
      const h0 = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      run(n);
      const t1 = performance.now();
      const h1 = process.memoryUsage().heapUsed;
      windows.push(t0, t1);
      growth.push(h1 - h0);
      sizes.push(n);
    }
    // GC entries are delivered asynchronously.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    obs.disconnect();
  }
  let bytes = 0;
  let measuredTicks = 0;
  let chunksWithGc = 0;
  let gcEvents = 0;
  for (let c = 0; c < growth.length; c++) {
    const a = windows[2 * c]!;
    const b = windows[2 * c + 1]!;
    let k = 0;
    for (const s of gcStarts) if (s >= a && s <= b) k++;
    gcEvents += k;
    if (k > 0) chunksWithGc++;
    else {
      bytes += Math.max(0, growth[c]!);
      measuredTicks += sizes[c]!;
    }
  }
  return { bytes, ticks: measuredTicks, chunksWithGc, chunks: growth.length, gcEvents };
}
