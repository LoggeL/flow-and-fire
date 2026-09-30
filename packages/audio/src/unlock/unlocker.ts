/**
 * AutoplayUnlocker: gets a realtime AudioContext past the browser autoplay policy.
 *
 * A context created without a user gesture starts 'suspended'. The unlocker listens for the first
 * gesture (pointerdown / keydown / touchend, capture + passive) on a target, calls `ctx.resume()`
 * inside that gesture and plays one sample of silence (iOS only unlocks output once a source has
 * started inside a gesture). The listeners stay armed until the context actually reports
 * 'running', then they are removed. If the context later drops to 'suspended' or 'interrupted'
 * (OS audio session, device change, iOS background), the listeners are armed again.
 *
 * State (EngineState): 'locked' = never ran yet, waiting for a gesture; 'running';
 * 'suspended' = ran before, now suspended/interrupted (armed again unless `rearm: false`);
 * 'closed'.
 *
 * The unlocker takes over `ctx.onstatechange` and chains any handler that was installed before;
 * other modules observe the state through {@link AutoplayUnlocker.onChange}.
 */

import type { AudioContextLike } from '../ports.ts';
import type { EngineState } from '../types.ts';

/** Gestures that count as user activation in all target browsers. */
export const UNLOCK_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'touchend'];

export interface AutoplayUnlockerOptions {
  /** Event types to listen for (default {@link UNLOCK_EVENTS}). */
  events?: readonly string[] | undefined;
  /** Re-arm the gesture listeners after a later suspend/interruption (default true). */
  rearm?: boolean | undefined;
  /** Play one sample of silence on each unlock attempt (default true; needed on iOS). */
  silentSample?: boolean | undefined;
  /** Max wait of {@link AutoplayUnlocker.unlock} for `resume()` in ms (default 1000). */
  resumeTimeoutMs?: number | undefined;
}

export type UnlockListener = (state: EngineState, previous: EngineState) => void;

const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

export class AutoplayUnlocker {
  private readonly ctx: AudioContextLike;
  private readonly target: EventTarget | null;
  private readonly events: readonly string[];
  private readonly rearm: boolean;
  private readonly silentSample: boolean;
  private readonly resumeTimeoutMs: number;
  private readonly listeners: UnlockListener[] = [];
  private readonly onGesture: () => void;
  private readonly onStateChange: (ev: Event) => unknown;
  private readonly previousHandler: ((ev: Event) => unknown) | null;
  private current: EngineState;
  private hasRun = false;
  private armed = false;
  private disposed = false;
  /** Gesture unlock attempts (resume calls triggered by gestures). */
  gestureAttempts = 0;

  /**
   * @param ctx the realtime context to unlock
   * @param target where gestures are observed (usually `document`); null = only explicit {@link unlock}
   */
  constructor(ctx: AudioContextLike, target: EventTarget | null, opts: AutoplayUnlockerOptions = {}) {
    this.ctx = ctx;
    this.target = target;
    this.events = opts.events ?? UNLOCK_EVENTS;
    this.rearm = opts.rearm ?? true;
    this.silentSample = opts.silentSample ?? true;
    this.resumeTimeoutMs = opts.resumeTimeoutMs ?? 1000;
    this.onGesture = () => this.handleGesture();
    this.previousHandler = ctx.onstatechange;
    const prev = this.previousHandler;
    this.onStateChange = (ev: Event) => {
      this.sync();
      return prev === null ? undefined : prev.call(ctx, ev);
    };
    ctx.onstatechange = this.onStateChange;
    this.current = 'locked';
    this.sync();
    if (this.current === 'locked') this.arm();
  }

  get state(): EngineState {
    return this.current;
  }

  /** True while gesture listeners are installed. */
  get listening(): boolean {
    return this.armed;
  }

  /** Subscribes to state changes; returns the unsubscribe function. */
  onChange(fn: UnlockListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /**
   * Explicit unlock (call it from a gesture handler, e.g. an overlay click). Resolves true if the
   * context runs afterwards; false if it is closed or did not start within `resumeTimeoutMs`.
   */
  async unlock(): Promise<boolean> {
    if (this.disposed || this.ctx.state === 'closed') return false;
    if (this.ctx.state !== 'running') {
      const resumed = this.attempt();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.resumeTimeoutMs);
      });
      try {
        await Promise.race([resumed, timeout]);
      } finally {
        clearTimeout(timer);
      }
    }
    this.sync();
    return this.ctx.state === 'running';
  }

  /** Removes the listeners and the statechange hook (restores a previous handler). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disarm();
    if (this.ctx.onstatechange === this.onStateChange) this.ctx.onstatechange = this.previousHandler;
    this.listeners.length = 0;
  }

  // -------------------------------------------------------------------------------------------

  private handleGesture(): void {
    if (this.disposed) return;
    if (this.ctx.state === 'running') {
      this.sync();
      return;
    }
    this.gestureAttempts++;
    void this.attempt();
  }

  /** resume() + silent sample; never rejects. */
  private attempt(): Promise<void> {
    let p: Promise<void>;
    try {
      p = this.ctx.resume().then(
        () => this.sync(),
        () => this.sync(),
      );
    } catch {
      p = Promise.resolve();
    }
    if (this.silentSample) this.playSilence();
    return p;
  }

  private playSilence(): void {
    try {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.onended = () => src.disconnect();
      src.start(0);
    } catch {
      // A closed or broken context cannot play; resume() reports the real state.
    }
  }

  private sync(): void {
    if (this.disposed) return;
    const s = this.ctx.state;
    let next: EngineState;
    if (s === 'running') {
      next = 'running';
      this.hasRun = true;
    } else if (s === 'closed') {
      next = 'closed';
    } else {
      // 'suspended', 'interrupted' (WebKit) or anything unknown: not producing sound.
      next = this.hasRun ? 'suspended' : 'locked';
    }
    if (next === 'running' || next === 'closed') this.disarm();
    else if (next === 'locked' || this.rearm) this.arm();
    if (next === this.current) return;
    const prev = this.current;
    this.current = next;
    for (const fn of this.listeners.slice()) fn(next, prev);
  }

  private arm(): void {
    if (this.armed || this.target === null || this.disposed) return;
    for (const type of this.events) this.target.addEventListener(type, this.onGesture, LISTENER_OPTIONS);
    this.armed = true;
  }

  private disarm(): void {
    if (!this.armed || this.target === null) return;
    for (const type of this.events) this.target.removeEventListener(type, this.onGesture, LISTENER_OPTIONS);
    this.armed = false;
  }
}
