import { describe, expect, it } from 'vitest';
import type { PlayRequest, VoiceHandle } from '../../src/types.ts';
import { createVoiceStats } from '../../src/voices/index.ts';
import { loadRealManifest } from '../support/index.ts';
import { makeRig, seededRandom } from './fakes.ts';

const gc = (globalThis as { gc?: () => void }).gc;

/**
 * Heap growth after 50 000 play() calls (warm).
 *
 * Bound 2 MB: what may legitimately still be alive at the second measurement is at most
 * 32 voices + 8 tails, each with three fake nodes (params with small event arrays), i.e. well
 * below 100 KB, plus V8 noise (inline caches, lazily compiled code) in the order of a few
 * hundred KB. A leak of just 40 bytes per call would already add 2 MB over 50 000 calls, so
 * the bound catches any per-request retention (lost records, unbounded tables, handlers kept by
 * the mixer's bus inputs, …) while staying robust against GC timing.
 */
describe('VoiceManager allocation', () => {
  it.skipIf(gc === undefined)('50 000 play() calls after warm-up: pool constant, heap growth < 2 MB', async () => {
    const manifest = loadRealManifest();
    const r = await makeRig(manifest, { random: seededRandom(7), logAutomation: false });
    const n = manifest.sounds.length;
    const rnd = seededRandom(99);
    const req: PlayRequest = { sound: 0, x: 0, z: 0, gain: 1 };
    const stats = createVoiceStats();
    const pool = r.vm.poolSize;
    // Recent handles; the one started 24 voices ago is stopped (keeps long loops from filling the pool).
    const ring: (VoiceHandle | null)[] = new Array<VoiceHandle | null>(24).fill(null);
    let ringPos = 0;
    const run = (count: number): void => {
      for (let k = 0; k < count; k++) {
        req.sound = Math.floor(rnd() * n);
        req.x = rnd() * 200 - 100;
        req.z = rnd() * 1400 - 700;
        req.gain = 0.2 + rnd();
        const h = r.vm.play(req, r.ctx.nowMs);
        if (h !== null) {
          const old = ring[ringPos];
          if (old != null) old.stop(k % 3 === 0 ? 0 : 40);
          ring[ringPos] = h;
          ringPos = (ringPos + 1) % ring.length;
        }
        if (k % 4 === 0) r.ctx.advance(5);
        if (k % 64 === 0) {
          r.vm.update();
          r.vm.snapshotStats(stats);
        }
      }
    };
    run(10_000);
    gc!();
    gc!();
    const before = process.memoryUsage().heapUsed;
    run(50_000);
    gc!();
    gc!();
    const after = process.memoryUsage().heapUsed;
    const growth = after - before;
    r.vm.snapshotStats(stats);
    expect(r.vm.poolSize).toBe(pool);
    expect(stats.voices).toBeLessThanOrEqual(32);
    expect(stats.played).toBeGreaterThan(20_000);
    expect(stats.stolen).toBeGreaterThan(0);
    expect(growth).toBeLessThan(2 * 1024 * 1024);
  });
});
