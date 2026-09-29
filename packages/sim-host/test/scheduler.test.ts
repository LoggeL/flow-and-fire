import { describe, expect, it } from 'vitest';
import { MessageChannelWakeup, performanceClock, Scheduler, type SchedulerTarget } from '../src/index.ts';
import { FakeClock, FakeWakeup } from './support/fake-time.ts';

/** Counts ticks; can simulate slow ticks (advancing the fake clock) and a pending source. */
class CountingTarget implements SchedulerTarget {
  ticks = 0;
  slices: number[] = [];
  states = 0;
  tickCostMs = 0;
  blocked = false;
  errors: unknown[] = [];
  failOnTick = -1;
  constructor(private readonly clock: FakeClock) {}
  advance(): boolean {
    if (this.blocked) return false;
    if (this.ticks === this.failOnTick) throw new Error('boom');
    this.ticks++;
    this.clock.t += this.tickCostMs;
    return true;
  }
  sliceEnd(n: number): void {
    this.slices.push(n);
  }
  stateChanged(): void {
    this.states++;
  }
  failed(e: unknown): void {
    this.errors.push(e);
  }
}

function setup(speedPermille = 1000, paused = false): { clock: FakeClock; wake: FakeWakeup; target: CountingTarget; s: Scheduler } {
  const clock = new FakeClock();
  const wake = new FakeWakeup(clock);
  const target = new CountingTarget(clock);
  const s = new Scheduler(target, { clock, wakeup: wake, speedPermille, paused });
  s.start();
  return { clock, wake, target, s };
}

describe('Scheduler (fake clock)', () => {
  it.each([
    [250, 25],
    [1000, 100],
    [3000, 300],
  ])('runs 100 ms / speed per tick (speed %d‰ → %d ticks in 10 s)', (speed, expected) => {
    const { wake, target, s } = setup(speed);
    expect(s.tickPeriodMs).toBeCloseTo(100_000 / speed, 9);
    wake.advance(10_000);
    expect(target.ticks).toBe(expected);
    // On time: one tick per wake-up, never a backlog.
    expect(Math.max(...target.slices)).toBe(1);
    expect(s.ticksBehind).toBe(0);
    expect(s.lostTicks).toBe(0);
  });

  it('first tick comes one period after start, no tick before', () => {
    const { wake, target } = setup(1000);
    wake.advance(99.9);
    expect(target.ticks).toBe(0);
    wake.advance(0.1);
    expect(target.ticks).toBe(1);
  });

  it('runs at most 3 ticks per slice and does not catch up without bound (FA sim lag)', () => {
    const { clock, wake, target, s } = setup(1000);
    wake.advance(1000); // 10 ticks on time
    expect(target.ticks).toBe(10);
    // The worker is frozen for 1 s (e.g. GC, tab in background): the wake-up fires late.
    clock.t += 1000;
    wake.fire(true);
    expect(target.slices.at(-1)).toBe(3);
    expect(s.ticksBehind).toBe(3);
    wake.advance(0); // backlog slice fires immediately
    expect(target.slices.at(-1)).toBe(3);
    expect(target.ticks).toBe(16);
    expect(s.lostTicks).toBe(4); // 10 ticks due, 6 run, 4 dropped
    expect(s.ticksBehind).toBe(0);
    expect(s.maxTicksInSlice).toBe(3);
    wake.advance(1000);
    expect(target.ticks).toBe(26);
  });

  it('a sim slower than real time slows down and reports ticksBehind (lag), then recovers', () => {
    const { clock, wake, target, s } = setup(1000);
    target.tickCostMs = 150; // each tick needs 150 ms of wall time at a 100 ms period
    let maxBehind = 0;
    const before = s.lostMs;
    while (clock.t < 3000) {
      wake.advance(10);
      maxBehind = Math.max(maxBehind, s.ticksBehind);
    }
    // ~3 s of wall time: the sim runs ~20 ticks (1 per 150 ms) instead of 30.
    expect(target.ticks).toBeGreaterThanOrEqual(18);
    expect(target.ticks).toBeLessThanOrEqual(22);
    expect(maxBehind).toBeGreaterThan(0);
    expect(maxBehind).toBeLessThanOrEqual(3);
    expect(s.lostMs).toBeGreaterThan(before);
    expect(s.maxTicksInSlice).toBeLessThanOrEqual(3);
    // Load gone: the backlog is worked off (≤ 3 ticks) and the rate returns to 10/s.
    target.tickCostMs = 0;
    wake.advance(1000);
    expect(s.ticksBehind).toBe(0);
    const n = target.ticks;
    wake.advance(2000);
    expect(target.ticks - n).toBe(20);
  });

  it('pause stops ticking, step(n) runs exactly n ticks (≤ 3 per slice), resume continues', () => {
    const { wake, target, s } = setup(1000);
    wake.advance(500);
    expect(target.ticks).toBe(5);
    expect(s.pause()).toBe(true);
    expect(s.pause()).toBe(false);
    wake.advance(2000);
    expect(target.ticks).toBe(5);
    expect(wake.pending).toBe(false); // idle while paused: no wake-ups at all
    expect(s.step(7)).toBe(true);
    wake.advance(0);
    expect(target.ticks).toBe(12);
    expect(target.slices.slice(-3)).toEqual([3, 3, 1]);
    expect(s.paused).toBe(true);
    expect(s.queuedSteps).toBe(0);
    wake.advance(1000);
    expect(target.ticks).toBe(12);
    expect(s.resume()).toBe(true);
    wake.advance(99);
    expect(target.ticks).toBe(12);
    wake.advance(1);
    expect(target.ticks).toBe(13);
    // step is ignored while running
    expect(s.step(5)).toBe(false);
    wake.advance(100);
    expect(target.ticks).toBe(14);
  });

  it('paused time is not accumulated (no burst after resume)', () => {
    const { wake, target, s } = setup(1000);
    wake.advance(1000);
    s.pause();
    wake.advance(60_000);
    s.resume();
    wake.advance(1000);
    expect(target.ticks).toBe(20);
    expect(s.lostTicks).toBe(0);
  });

  it('speed changes the period immediately (0.25x … 3x, clamped)', () => {
    const { wake, target, s } = setup(1000);
    wake.advance(1000);
    s.setSpeedPermille(3000);
    wake.advance(1000);
    expect(target.ticks).toBe(40);
    s.setSpeedPermille(250);
    wake.advance(2000);
    expect(target.ticks).toBe(45);
    s.setSpeedPermille(10_000);
    expect(s.speedPermille).toBe(3000);
    s.setSpeedPermille(1);
    expect(s.speedPermille).toBe(250);
    expect(target.states).toBeGreaterThanOrEqual(3);
  });

  it("waits while a source is 'pending' and resumes when it is ready", () => {
    const { wake, target, s } = setup(1000);
    wake.advance(300);
    expect(target.ticks).toBe(3);
    target.blocked = true;
    wake.advance(1000);
    expect(target.ticks).toBe(3);
    expect(s.waitingForSource).toBe(true);
    expect(s.pendingWaits).toBeGreaterThan(0);
    target.blocked = false;
    wake.advance(1);
    expect(s.waitingForSource).toBe(false);
    // The waiting time counts as lag: at most 3 ticks are caught up per slice.
    expect(target.ticks).toBeGreaterThan(3);
    expect(s.maxTicksInSlice).toBeLessThanOrEqual(3);
    wake.advance(5000);
    expect(s.ticksBehind).toBe(0);
  });

  it('a throwing tick pauses the scheduler and reports the error', () => {
    const { wake, target, s } = setup(1000);
    target.failOnTick = 2;
    wake.advance(1000);
    expect(target.ticks).toBe(2);
    expect(target.errors).toHaveLength(1);
    expect(s.paused).toBe(true);
  });

  it('can start paused and stop/dispose cleanly', () => {
    const { wake, target, s } = setup(1000, true);
    wake.advance(1000);
    expect(target.ticks).toBe(0);
    s.step(1);
    wake.advance(0);
    expect(target.ticks).toBe(1);
    s.resume();
    s.stop();
    wake.advance(1000);
    expect(target.ticks).toBe(1);
    s.dispose();
    expect(s.isRunning).toBe(false);
  });
});

describe('MessageChannel self-ping wake-up (real clock)', () => {
  it('fires no earlier than requested and close to the deadline', async () => {
    const w = new MessageChannelWakeup();
    try {
      // Node delivers the very first message of a fresh MessageChannel up to ~40 ms late (port start-up);
      // warm the channel once so the measurement covers the steady-state self-ping.
      await new Promise<void>((resolve) => w.schedule(0, resolve));
      const errs: number[] = [];
      for (const d of [0, 3, 20, 40]) {
        const t0 = performance.now();
        const t1 = await new Promise<number>((resolve) => w.schedule(d, () => resolve(performance.now())));
        const late = t1 - t0 - d;
        expect(late).toBeGreaterThanOrEqual(-0.001);
        errs.push(late);
      }
      // Generous bound for a loaded CI machine; typical lateness is < 0.5 ms.
      expect(Math.max(...errs)).toBeLessThan(25);
      expect(w.pings).toBeGreaterThan(0);
    } finally {
      w.dispose();
    }
  });

  it('drives the scheduler in real time (3x for ~0.5 s)', async () => {
    let ticks = 0;
    const target: SchedulerTarget = {
      advance: () => {
        ticks++;
        return true;
      },
      sliceEnd: () => undefined,
    };
    const s = new Scheduler(target, { clock: performanceClock, speedPermille: 3000 });
    s.start();
    await new Promise((r) => setTimeout(r, 520));
    s.dispose();
    // 520 ms / 33.3 ms ≈ 15 ticks
    expect(ticks).toBeGreaterThanOrEqual(12);
    expect(ticks).toBeLessThanOrEqual(16);
  });
});
