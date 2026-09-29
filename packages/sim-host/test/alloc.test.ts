/**
 * Allocation (PLAN §3.4 / §5.2: "Allokation warm < 1 MB über 10.000 Ticks"): the complete host
 * tick path — sources, recorder, sim step incl. hash tick, keyframes, phase probe, frame writing
 * and SAB publishing — with 1,000 driving cubes and fresh move targets every 100 ticks.
 */
import { describe, expect, it } from 'vitest';
import { unitHandles } from '@faf/sim';
import { makeTestHost } from './support/host.ts';
import { bufferOf, driveBatches, spawnCmd } from './support/fixtures.ts';
import { performanceClock } from '../src/index.ts';

const gc = (globalThis as { gc?: () => void }).gc;

function heap(): { used: number; ab: number } {
  gc!();
  gc!();
  const m = process.memoryUsage();
  return { used: m.heapUsed, ab: m.arrayBuffers };
}

/** Cold tolerance (first 1,000 ticks incl. world creation, JIT, first keyframes). */
const COLD_TOLERANCE_BYTES = 8 * 1024 * 1024;

describe('allocation of the host tick path', () => {
  it('warm: 10,000 ticks with 1,000 driving cubes grow the heap by < 1 MB; cold within tolerance', () => {
    expect(gc).toBeTypeOf('function');
    const cold0 = heap();
    const h = makeTestHost({ autoStart: false, seed: 3, host: { clock: performanceClock, logCapacity: 4 << 20 } });
    try {
      h.host.submit(bufferOf([spawnCmd(0, 1000, 256, 256, 80, 1)]));
      h.host.runTicks(1);
      const batches = driveBatches(unitHandles(h.host.core.world, 0), 10, 4, 2);
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
      run(1000); // warm-up
      const before = heap();
      run(10_000);
      const after = heap();
      const grown = after.used - before.used;
      const abGrown = after.ab - before.ab;
      console.log(
        `[alloc] host tick path: warm heap growth over 10,000 ticks ${(grown / 1024).toFixed(1)} KiB, ` +
          `ArrayBuffer growth ${(abGrown / 1024).toFixed(0)} KiB (keyframes), cold (1,000 ticks) ${(cold / 1024 / 1024).toFixed(2)} MiB, ` +
          `moving ${moving}, frames ${h.host.framesWritten}, log ${h.host.core.recorder!.byteLength} B`,
      );
      expect(moving).toBeGreaterThan(300);
      expect(h.host.tick).toBe(12_000);
      expect(grown).toBeLessThan(1024 * 1024);
      expect(cold).toBeLessThan(COLD_TOLERANCE_BYTES);
      // Keyframes: every 600 ticks one snapshot, nothing else keeps ArrayBuffers alive.
      expect(h.host.core.keyframes!.count).toBe(21);
      expect(abGrown).toBeLessThanOrEqual(17 * h.host.core.world.snapshotByteLength + 64 * 1024);
    } finally {
      h.close();
    }
  });
});
