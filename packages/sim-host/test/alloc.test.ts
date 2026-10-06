/**
 * Allocation (PLAN §3.4 / §5.2: "Allokation warm < 1 MB über 10.000 Ticks"): the complete host
 * tick path — sources, recorder, sim step incl. hash tick, keyframes, phase probe, frame writing
 * and SAB publishing — with 1,000 driving cubes and fresh move targets every 100 ticks.
 */
import { describe, expect, it } from 'vitest';
import { unitHandles } from '@faf/sim';
import { makeTestHost } from './support/host.ts';
import { measureAllocation } from './support/alloc.ts';
import { bufferOf, driveBatches, hollowRidgeBuffer, spawnCmd } from './support/fixtures.ts';
import type { Clock } from '../src/index.ts';

const gc = (globalThis as { gc?: () => void }).gc;

function heap(): { used: number; ab: number } {
  gc!();
  gc!();
  const m = process.memoryUsage();
  return { used: m.heapUsed, ab: m.arrayBuffers };
}

/** Cold tolerance (first 1,000 ticks incl. world creation, JIT, first keyframes). */
const COLD_TOLERANCE_BYTES = 8 * 1024 * 1024;

/**
 * Test plane (MS1) and hollow-ridge (MS2: terrain height and the deep-water rule in every
 * position update; targets on the NW side of the river, x/z in [40, 200)).
 */
const CASES = [
  { name: 'test plane', map: false, spawn: [256, 256, 80], area: [64, 384] },
  // MS3: targets in [40, 200)² of the NW side; paths around the plateau cliffs and mesas.
  { name: 'hollow-ridge', map: true, spawn: [100, 100, 20], area: [40, 160] },
] as const;

describe.each(CASES)('allocation of the host tick path ($name)', { timeout: 300_000 }, (c) => {
  it('warm: 10,000 ticks with 1,000 driving cubes allocate < 1 MB; cold within tolerance', async () => {
    expect(gc).toBeTypeOf('function');
    const cold0 = heap();
    // A counting clock instead of performance.now(): Node's performance.now() allocates on
    // every call (JS wrapper), which is the engine's cost, not the host path's. The host still
    // takes all its timing readings (phase probe, frame, host), they just return small ints.
    let clockMs = 0;
    const clock: Clock = { now: () => (clockMs += 1) };
    // Messages are not recorded (a real worker serializes them in postMessage).
    const h = makeTestHost({ autoStart: false, seed: 3, keepMessages: false, host: { clock, logCapacity: 4 << 20 }, ...(c.map ? { map: hollowRidgeBuffer() } : {}) });
    try {
      h.host.submit(bufferOf([spawnCmd(0, 1000, c.spawn[0], c.spawn[1], c.spawn[2], 1)]));
      h.host.runTicks(1);
      expect(unitHandles(h.host.core.world, 0).length).toBe(1000);
      const batches = driveBatches(unitHandles(h.host.core.world, 0), 10, 4, 2, c.area[0], c.area[1]);
      let moving = 0;
      const run = (n: number): void => {
        for (let i = 0; i < n; i++) {
          const t = h.host.tick;
          if (t % 100 === 0) h.host.submit(batches[(t / 100) % 4]!);
          h.host.runTicks(1);
          h.consumer.poll();
          if (t % 1000 === 999) {
            moving = 0;
            const M = h.host.core.world.movers;
            for (let r = 0; r < M.count; r++) if (M.col.speed[r]! > 0) moving++;
          }
          h.msgs.length = 0;
        }
      };
      run(999);
      const cold = heap().used - cold0.used;
      // Warm-up: JIT incl. the cold per-command paths (group offsets, order records, requests).
      run(4000);
      const before = heap();
      // Allocation, not retention: heap growth between GCs, chunk by chunk (support/alloc.ts).
      const m = await measureAllocation(run, 10_000);
      const after = heap();
      const retained = after.used - before.used;
      const abGrown = after.ab - before.ab;
      console.log(
        `[alloc] host tick path (${c.name}): allocated ${(m.bytes / 1024).toFixed(1)} KiB in ${m.ticks} GC-free warm ticks ` +
          `(${m.chunks - m.chunksWithGc}/${m.chunks} chunks, ${m.gcEvents} GCs inside chunks), retained ${(retained / 1024).toFixed(1)} KiB, ` +
          `ArrayBuffer growth ${(abGrown / 1024).toFixed(0)} KiB (keyframes), cold (1,000 ticks) ${(cold / 1024 / 1024).toFixed(2)} MiB, ` +
          `moving ${moving}, frames ${h.host.framesWritten}, log ${h.host.core.recorder!.byteLength} B`,
      );
      expect(moving).toBeGreaterThan(300);
      expect(h.host.tick).toBe(15_000);
      // Keyframe snapshots (external ArrayBuffers) may let V8 collect inside a chunk; at most a
      // few chunks may be excluded that way, the rest must be GC-free and within budget.
      expect(m.chunksWithGc, JSON.stringify(m)).toBeLessThanOrEqual(2);
      expect(m.bytes * (10_000 / m.ticks)).toBeLessThan(1024 * 1024);
      expect(retained).toBeLessThan(1024 * 1024);
      expect(cold).toBeLessThan(COLD_TOLERANCE_BYTES);
      // Keyframes: every 600 ticks one snapshot (thinned out at the byte budget), nothing else
      // keeps ArrayBuffers alive.
      const kf = h.host.core.keyframes!;
      expect(kf.count).toBeGreaterThan(1);
      expect(kf.count).toBeLessThanOrEqual(kf.capacity);
      expect(abGrown).toBeLessThanOrEqual(kf.capacity * h.host.core.world.snapshotByteLength + 64 * 1024);
    } finally {
      h.close();
    }
  });
});
