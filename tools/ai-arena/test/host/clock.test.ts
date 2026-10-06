/**
 * Emergency-stop clocks of the arena hosts (bench/clock.ts): the thread CPU clock ignores time the
 * thread does not run (sleep, freezes of a loaded machine) but still aborts a think that computes
 * longer than the headless limit (ai.md §2.3) — synchronous host and Node worker host.
 */
import { describe, expect, it } from 'vitest';
import { replayMatch, runMatch, runMatchAsync, type RunMatchOptions } from '../../src/index.ts';
import { closeAiSides, createAiSide, type AiSide } from '../../src/host-node/index.ts';
import { hostClock, threadCpuAvailable, threadCpuClock } from '../../src/bench/clock.ts';
import { STALL_TICK, createBusyStallBrain, createStallBrain, sleepMs, spinCpuMs } from './fixtures/brains.ts';

const FIXTURES = new URL('./fixtures/brains.ts', import.meta.url).href;

describe('thread CPU clock', () => {
  it('is available on this Node and ignores sleeping, but counts computing', () => {
    expect(threadCpuAvailable()).toBe(true);
    const a = threadCpuClock.now();
    sleepMs(60);
    const slept = threadCpuClock.now() - a;
    expect(slept).toBeLessThan(20);
    const b = threadCpuClock.now();
    spinCpuMs(30);
    expect(threadCpuClock.now() - b).toBeGreaterThanOrEqual(30);
    expect(hostClock('thread')).toBe(threadCpuClock);
    expect(hostClock('wall')).not.toBe(threadCpuClock);
  });
});

async function stallGame(host: 'sync' | 'worker', brain: 'sleep' | 'spin'): Promise<{ sides: AiSide[]; hash: number; replay: number }> {
  const sides: AiSide[] = [];
  const spec = `${FIXTURES}#${brain === 'sleep' ? 'createStallBrain' : 'createBusyStallBrain'}`;
  const factory = brain === 'sleep' ? createStallBrain : createBusyStallBrain;
  const opts: RunMatchOptions = {
    map: 'setons',
    seed: 7,
    maxTicks: 900,
    sides: [0, 1].map((army) => ({
      army,
      source: (ctx) => {
        const s = createAiSide(ctx.world, {
          army,
          profile: 'normal',
          host,
          clockKind: 'thread',
          brainSpec: spec,
          ...(host === 'sync' ? { brainFactory: factory } : {}),
        });
        sides.push(s);
        return s.source;
      },
    })),
  };
  try {
    const r = host === 'sync' ? runMatch(opts) : await runMatchAsync(opts);
    return { sides, hash: r.hash, replay: replayMatch(r.log.setup, r.log).hash };
  } finally {
    await closeAiSides(sides);
  }
}

describe('emergency stop on the thread CPU clock', () => {
  it('sync host: a 250-ms sleep inside a step is no timeout, 250 ms of computing is', async () => {
    const slept = await stallGame('sync', 'sleep');
    for (const s of slept.sides) expect(s.marks).toEqual([]);
    const spun = await stallGame('sync', 'spin');
    for (const s of spun.sides) {
      expect(s.marks.map((m) => m.tick)).toEqual([STALL_TICK]);
      expect(s.marks[0]!.elapsedMs).toBeGreaterThan(200);
    }
    expect(spun.replay).toBe(spun.hash);
  });

  it('worker host: the clock kind reaches the thread (sleep ⇒ no timeout, computing ⇒ timeout)', async () => {
    const slept = await stallGame('worker', 'sleep');
    for (const s of slept.sides) expect(s.marks).toEqual([]);
    const spun = await stallGame('worker', 'spin');
    for (const s of spun.sides) expect(s.marks.map((m) => m.tick)).toEqual([STALL_TICK]);
    expect(spun.replay).toBe(spun.hash);
  });
});
