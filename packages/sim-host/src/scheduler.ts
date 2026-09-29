/**
 * Tick scheduler (PLAN §3.4): accumulator-driven fixed-rate loop with a nominal period of
 * 100 ms / speed (A6: 0.25x–3x), at most `maxTicksPerSlice` ticks per slice, FA-style sim lag
 * (a sim that cannot keep up slows down instead of catching up without bound), pause/resume,
 * single stepping while paused, and waiting on a 'pending' command source.
 *
 * The scheduler owns no simulation state; it only decides *when* `target.advance()` runs.
 */

import { SPEED_MAX_PERMILLE, SPEED_MIN_PERMILLE } from '@faf/protocol';
import { MessageChannelWakeup, performanceClock, type Clock, type Wakeup } from './clock.ts';

/** Nominal tick period at 1x speed (10 Hz sim). */
export const BASE_TICK_MS = 100;
/** Default upper bound of ticks executed in one slice. */
export const DEFAULT_MAX_TICKS_PER_SLICE = 3;
/** Default backlog (in ticks) the accumulator may hold before time is dropped as sim lag. */
export const DEFAULT_MAX_BACKLOG_TICKS = 3;
/** Tolerance (ms) for float rounding of the accumulator (fractional periods at 3x). */
const EPS_MS = 1e-6;
/** Retry delay while a command source reports 'pending'. */
export const DEFAULT_PENDING_RETRY_MS = 1;

/** What the scheduler drives (the sim host). */
export interface SchedulerTarget {
  /** Runs one tick. Returns false if a command source is 'pending' (the tick did not run). */
  advance(): boolean;
  /** Called after a slice that ran ≥ 1 tick (e.g. publish one frame). */
  sliceEnd(ticksRun: number): void;
  /** Called when paused/speed/ticksBehind/step state changed (e.g. send a status message). */
  stateChanged?(): void;
  /** Called if `advance()` or `sliceEnd()` threw; the scheduler pauses itself afterwards. */
  failed?(error: unknown): void;
}

export interface SchedulerOptions {
  readonly clock?: Clock;
  /** Wake-up mechanism; default: MessageChannel self-ping on `clock`. */
  readonly wakeup?: Wakeup;
  readonly maxTicksPerSlice?: number;
  readonly maxBacklogTicks?: number;
  readonly pendingRetryMs?: number;
  /** Initial speed in ‰ (default 1000). */
  readonly speedPermille?: number;
  /** Start paused (default false). */
  readonly paused?: boolean;
}

/** Clamps a speed in permille to the A6 range [250, 3000]. */
export function clampSpeedPermille(p: number): number {
  if (!Number.isFinite(p)) return 1000;
  const r = Math.round(p);
  return r < SPEED_MIN_PERMILLE ? SPEED_MIN_PERMILLE : r > SPEED_MAX_PERMILLE ? SPEED_MAX_PERMILLE : r;
}

export class Scheduler {
  private readonly target: SchedulerTarget;
  private readonly clock: Clock;
  private readonly wakeup: Wakeup;
  private readonly ownsWakeup: boolean;
  private readonly maxPerSlice: number;
  private readonly maxBacklog: number;
  private readonly pendingRetryMs: number;
  private readonly onWake: () => void;

  private running = false;
  private disposed = false;
  private pausedFlag: boolean;
  private speed: number;
  private period: number;
  /** Accumulated, not yet simulated wall time (ms). */
  private acc = 0;
  private last = 0;
  private pendingSteps = 0;
  private behind = 0;
  private stalled = false;

  /** Ticks executed in total. */
  ticksRun = 0;
  /** Slices executed (wake-ups that ran the loop). */
  slices = 0;
  /** Wall time dropped because the sim could not keep up (FA sim lag), in ms. */
  lostMs = 0;
  /** Tick attempts refused because a source was 'pending'. */
  pendingWaits = 0;
  /** Largest number of ticks run in one slice. */
  maxTicksInSlice = 0;

  constructor(target: SchedulerTarget, options: SchedulerOptions = {}) {
    this.target = target;
    this.clock = options.clock ?? performanceClock;
    this.ownsWakeup = options.wakeup === undefined;
    this.wakeup = options.wakeup ?? new MessageChannelWakeup({ clock: this.clock });
    this.maxPerSlice = Math.max(1, options.maxTicksPerSlice ?? DEFAULT_MAX_TICKS_PER_SLICE);
    this.maxBacklog = Math.max(1, options.maxBacklogTicks ?? DEFAULT_MAX_BACKLOG_TICKS);
    this.pendingRetryMs = options.pendingRetryMs ?? DEFAULT_PENDING_RETRY_MS;
    this.speed = clampSpeedPermille(options.speedPermille ?? 1000);
    this.period = (BASE_TICK_MS * 1000) / this.speed;
    this.pausedFlag = options.paused ?? false;
    this.onWake = (): void => {
      this.slice();
    };
  }

  // ---- state -------------------------------------------------------------------------------

  get paused(): boolean {
    return this.pausedFlag;
  }

  get speedPermille(): number {
    return this.speed;
  }

  /** Speed multiplier (0.25–3). */
  get speedFactor(): number {
    return this.speed / 1000;
  }

  /** Nominal tick period in ms (100 / speed). */
  get tickPeriodMs(): number {
    return this.period;
  }

  /**
   * Ticks the sim is currently behind its schedule (backlog in the accumulator, 0 when it keeps
   * up). Bounded by `maxBacklogTicks`: older lag is dropped (`lostTicks`), not caught up.
   */
  get ticksBehind(): number {
    return this.behind;
  }

  /** Ticks' worth of wall time dropped because of sim lag. */
  get lostTicks(): number {
    return Math.floor(this.lostMs / this.period);
  }

  /** Steps requested while paused that have not run yet. */
  get queuedSteps(): number {
    return this.pendingSteps;
  }

  /** True while the last tick attempt was refused by a 'pending' source. */
  get waitingForSource(): boolean {
    return this.stalled;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ---- control ------------------------------------------------------------------------------

  /** Starts the loop (ticks begin after one period unless paused). */
  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.acc = 0;
    this.last = this.clock.now();
    this.reschedule();
  }

  /** Stops the loop (no further wake-ups); `start()` resumes it. */
  stop(): void {
    this.running = false;
    this.wakeup.cancel();
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    if (this.ownsWakeup) this.wakeup.dispose();
  }

  /** Pauses: no tick runs until resume/step. Returns false if already paused. */
  pause(): boolean {
    if (this.pausedFlag) return false;
    this.pausedFlag = true;
    this.acc = 0;
    this.behind = 0;
    if (this.pendingSteps === 0) this.wakeup.cancel();
    this.target.stateChanged?.();
    return true;
  }

  /** Resumes; the next tick is due one period later. Returns false if not paused. */
  resume(): boolean {
    if (!this.pausedFlag) return false;
    this.pausedFlag = false;
    this.pendingSteps = 0;
    this.acc = 0;
    this.last = this.clock.now();
    this.target.stateChanged?.();
    this.reschedule();
    return true;
  }

  /**
   * Queues `n` ticks while paused (they run as fast as possible, `maxTicksPerSlice` per slice).
   * Ignored (returns false) while running.
   */
  step(n = 1): boolean {
    if (!this.pausedFlag || !(n >= 1)) return false;
    this.pendingSteps += Math.floor(n);
    if (this.running) this.wakeup.schedule(0, this.onWake);
    return true;
  }

  /** Sets the speed (‰, clamped to 250–3000). The accumulated time is kept. */
  setSpeedPermille(permille: number): void {
    const p = clampSpeedPermille(permille);
    if (p === this.speed) return;
    this.speed = p;
    this.period = (BASE_TICK_MS * 1000) / p;
    this.clampBacklog();
    this.target.stateChanged?.();
    if (this.running && !this.pausedFlag) this.reschedule();
  }

  /** Re-checks sources now (e.g. an AI source became ready). */
  wake(): void {
    if (this.running && !this.disposed) this.wakeup.schedule(0, this.onWake);
  }

  // ---- loop ---------------------------------------------------------------------------------

  /**
   * One slice: adds the elapsed wall time to the accumulator, runs due ticks (≤ maxTicksPerSlice),
   * drops backlog beyond `maxBacklogTicks` (sim lag) and schedules the next wake-up. Called by
   * the wake-up; public for tests with a fake clock.
   */
  slice(): number {
    if (this.disposed) return 0;
    const now = this.clock.now();
    if (!this.pausedFlag) this.acc += now - this.last;
    this.last = now;
    this.slices++;
    let ran = 0;
    const wasStalled = this.stalled;
    this.stalled = false;
    try {
      while (ran < this.maxPerSlice) {
        if (this.pendingSteps > 0) {
          if (!this.target.advance()) {
            this.stalled = true;
            this.pendingWaits++;
            break;
          }
          this.pendingSteps--;
        } else {
          if (this.pausedFlag || this.acc + EPS_MS < this.period) break;
          if (!this.target.advance()) {
            this.stalled = true;
            this.pendingWaits++;
            break;
          }
          this.acc -= this.period;
          if (this.acc < 0) this.acc = 0;
        }
        ran++;
        this.ticksRun++;
      }
      if (ran > 0) {
        if (ran > this.maxTicksInSlice) this.maxTicksInSlice = ran;
        this.target.sliceEnd(ran);
      }
    } catch (e) {
      this.pendingSteps = 0;
      this.pausedFlag = true;
      this.acc = 0;
      this.target.failed?.(e);
      this.target.stateChanged?.();
      return ran;
    }
    this.clampBacklog();
    const behind = this.pausedFlag ? 0 : Math.floor((this.acc + EPS_MS) / this.period);
    const changed = behind !== this.behind || wasStalled !== this.stalled;
    this.behind = behind;
    const stepsDone = ran > 0 && this.pausedFlag && this.pendingSteps === 0;
    if (changed || stepsDone) this.target.stateChanged?.();
    this.reschedule();
    return ran;
  }

  private clampBacklog(): void {
    const max = this.maxBacklog * this.period;
    if (this.acc > max) {
      this.lostMs += this.acc - max;
      this.acc = max;
    }
  }

  private reschedule(): void {
    if (!this.running || this.disposed) return;
    if (this.stalled) {
      this.wakeup.schedule(this.pendingRetryMs, this.onWake);
      return;
    }
    if (this.pendingSteps > 0) {
      this.wakeup.schedule(0, this.onWake);
      return;
    }
    if (this.pausedFlag) {
      this.wakeup.cancel();
      return;
    }
    // Due when the accumulator (as of `last`) plus the time elapsed since reaches one period.
    const wait = this.period - this.acc - (this.clock.now() - this.last);
    this.wakeup.schedule(wait > EPS_MS ? wait : 0, this.onWake);
  }
}
