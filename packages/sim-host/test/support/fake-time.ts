import type { Clock, Wakeup } from '../../src/index.ts';

/** Manually advanced clock (ms). */
export class FakeClock implements Clock {
  t = 0;
  now(): number {
    return this.t;
  }
}

/** Wake-up driven by a FakeClock: `advance(ms)` fires every due wake-up in time order. */
export class FakeWakeup implements Wakeup {
  private cb: (() => void) | null = null;
  private dueAt = 0;
  /** Delays requested so far. */
  readonly requested: number[] = [];
  fired = 0;

  constructor(private readonly clock: FakeClock) {}

  schedule(delayMs: number, cb: () => void): void {
    this.cb = cb;
    this.dueAt = this.clock.t + Math.max(0, delayMs);
    this.requested.push(delayMs);
  }

  cancel(): void {
    this.cb = null;
  }

  dispose(): void {
    this.cb = null;
  }

  get pending(): boolean {
    return this.cb !== null;
  }

  get due(): number {
    return this.dueAt;
  }

  /** Fires the pending wake-up now if it is due (or `force`). */
  fire(force = false): boolean {
    const cb = this.cb;
    if (cb === null || (!force && this.dueAt > this.clock.t)) return false;
    this.cb = null;
    this.fired++;
    cb();
    return true;
  }

  /**
   * Advances the clock by `ms`, firing due wake-ups at their due time (the callback may move the
   * clock further, e.g. to simulate slow ticks). Guards against endless zero-delay loops.
   */
  advance(ms: number): void {
    const end = this.clock.t + ms;
    let guard = 0;
    while (this.cb !== null && this.dueAt <= end) {
      if (this.dueAt > this.clock.t) this.clock.t = this.dueAt;
      this.fire(true);
      if (++guard > 1_000_000) throw new Error('wake-up loop does not settle');
    }
    if (this.clock.t < end) this.clock.t = end;
  }
}
