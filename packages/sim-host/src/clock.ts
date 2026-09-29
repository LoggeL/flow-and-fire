/**
 * Time sources of the sim host (PLAN §3.4 "Scheduler"). The host is not part of the simulation
 * state, so wall-clock time is allowed here — it only decides *when* a tick runs, never what it
 * computes. Both the clock and the wake-up mechanism are injectable so the scheduler can be
 * driven by a fake clock in tests.
 */

/** Monotonic millisecond clock. */
export interface Clock {
  now(): number;
}

/** Default clock: `performance.now()` (worker, main thread and Node). */
export const performanceClock: Clock = {
  now(): number {
    return performance.now();
  },
};

/**
 * One-shot wake-up. `schedule` replaces any pending wake-up; `cancel` drops it. The callback is
 * called at the earliest `delayMs` after scheduling (0 = as soon as possible, but asynchronously).
 */
export interface Wakeup {
  schedule(delayMs: number, cb: () => void): void;
  cancel(): void;
  /** Releases resources (message ports, timers). */
  dispose(): void;
}

/** Structural subset of MessageChannel / MessagePort (browser + Node). */
interface ChannelPortLike {
  onmessage: ((ev: never) => unknown) | null;
  postMessage(message: unknown): void;
  close(): void;
}
interface ChannelLike {
  readonly port1: ChannelPortLike;
  readonly port2: ChannelPortLike;
}

export interface MessageChannelWakeupOptions {
  readonly clock?: Clock;
  /**
   * Waits longer than this (ms) first sleep coarsely on one timer and hand over to self-pings
   * `coarseMarginMs` before the deadline; shorter waits self-ping only. `Infinity` = pure
   * self-ping (spins one core while waiting).
   */
  readonly coarseSleepAboveMs?: number;
  /** Safety margin before the deadline where the coarse sleep ends (timer clamping/jitter). */
  readonly coarseMarginMs?: number;
}

/**
 * MessageChannel self-ping (PLAN §3.4): a message posted to our own channel runs as a new task
 * without the 4 ms clamping of nested `setTimeout`, so deadlines are hit to within tens of µs.
 * Each ping re-checks the clock until the deadline passes. To avoid spinning a whole core for
 * the ~100 ms between ticks, long waits sleep once on a single coarse timer that ends
 * `coarseMarginMs` early; the precise part is always the self-ping (no timer polling).
 */
export class MessageChannelWakeup implements Wakeup {
  private readonly clock: Clock;
  private readonly channel: ChannelLike;
  private readonly coarseAbove: number;
  private readonly coarseMargin: number;
  private cb: (() => void) | null = null;
  private dueAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pingInFlight = false;
  private disposed = false;
  /** Self-pings sent (diagnostics). */
  pings = 0;

  constructor(options: MessageChannelWakeupOptions = {}) {
    this.clock = options.clock ?? performanceClock;
    this.coarseAbove = options.coarseSleepAboveMs ?? 8;
    this.coarseMargin = options.coarseMarginMs ?? 4;
    const ch = new MessageChannel() as unknown as ChannelLike;
    this.channel = ch;
    ch.port1.onmessage = (): void => {
      this.pingInFlight = false;
      this.check();
    };
  }

  schedule(delayMs: number, cb: () => void): void {
    if (this.disposed) return;
    this.clearTimer();
    this.cb = cb;
    const d = delayMs > 0 ? delayMs : 0;
    this.dueAt = this.clock.now() + d;
    if (d > this.coarseAbove) {
      this.timer = setTimeout(this.onTimer, d - this.coarseMargin);
    } else {
      this.ping();
    }
  }

  cancel(): void {
    this.cb = null;
    this.clearTimer();
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    this.channel.port1.onmessage = null;
    this.channel.port1.close();
    this.channel.port2.close();
  }

  private readonly onTimer = (): void => {
    this.timer = null;
    this.check();
  };

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private ping(): void {
    if (this.pingInFlight || this.disposed) return;
    this.pingInFlight = true;
    this.pings++;
    this.channel.port2.postMessage(null);
  }

  private check(): void {
    const cb = this.cb;
    if (cb === null || this.timer !== null) return;
    if (this.clock.now() < this.dueAt) {
      this.ping();
      return;
    }
    this.cb = null;
    cb();
  }
}
