import { describe, expect, it, vi } from 'vitest';
import { AutoplayUnlocker, UNLOCK_EVENTS } from '../../src/unlock/index.ts';
import type { EngineState } from '../../src/types.ts';
import { FakeAudioContext } from '../support/index.ts';

/** EventTarget that records listener registrations (type, capture, passive). */
class SpyTarget extends EventTarget {
  readonly added: { type: string; capture: boolean; passive: boolean }[] = [];
  readonly removed: string[] = [];
  private live = new Map<string, number>();

  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: AddEventListenerOptions | boolean): void {
    const o = typeof opts === 'object' ? opts : { capture: opts === true };
    this.added.push({ type, capture: o.capture === true, passive: o.passive === true });
    this.live.set(type, (this.live.get(type) ?? 0) + 1);
    super.addEventListener(type, cb, opts);
  }

  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: EventListenerOptions | boolean): void {
    this.removed.push(type);
    this.live.set(type, Math.max(0, (this.live.get(type) ?? 0) - 1));
    super.removeEventListener(type, cb, opts);
  }

  liveCount(): number {
    let n = 0;
    for (const v of this.live.values()) n += v;
    return n;
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function gesture(t: EventTarget, type = 'pointerdown'): void {
  t.dispatchEvent(new Event(type));
}

describe('AutoplayUnlocker', () => {
  it('starts locked with capture+passive listeners and does not resume before a gesture', async () => {
    const ctx = new FakeAudioContext({ autoplay: 'blocked' });
    const t = new SpyTarget();
    const u = new AutoplayUnlocker(ctx, t);
    await flush();
    expect(u.state).toBe('locked');
    expect(u.listening).toBe(true);
    expect(ctx.resumeCalls).toBe(0);
    expect(t.added.map((a) => a.type).sort()).toEqual([...UNLOCK_EVENTS].sort());
    expect(t.added.every((a) => a.capture && a.passive)).toBe(true);
    u.dispose();
  });

  it('first gesture → resume + 1-sample silence; listeners removed once running', async () => {
    const ctx = new FakeAudioContext({ autoplay: 'blocked' });
    const t = new SpyTarget();
    const u = new AutoplayUnlocker(ctx, t);
    const changes: [EngineState, EngineState][] = [];
    u.onChange((s, p) => changes.push([s, p]));
    gesture(t, 'keydown');
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.createdByKind.source).toBe(1); // silent sample (iOS)
    expect(ctx.startedSources).toBe(1);
    // Browser grants playback only with the activation; the fake models it explicitly.
    await flush();
    expect(u.state).toBe('locked');
    expect(u.listening).toBe(true); // still armed: a gesture that did not unlock is retried
    ctx.grantAutoplay();
    await flush();
    expect(ctx.state).toBe('running');
    expect(u.state).toBe('running');
    expect(u.listening).toBe(false);
    expect(t.liveCount()).toBe(0);
    expect(changes).toEqual([['running', 'locked']]);
    gesture(t, 'pointerdown');
    gesture(t, 'touchend');
    expect(ctx.resumeCalls).toBe(1);
    u.dispose();
  });

  it('unlocks on pointerdown, keydown and touchend alike', async () => {
    for (const type of UNLOCK_EVENTS) {
      const ctx = new FakeAudioContext();
      const t = new EventTarget();
      const u = new AutoplayUnlocker(ctx, t);
      gesture(t, 'mousemove');
      expect(ctx.resumeCalls).toBe(0);
      gesture(t, type);
      await flush();
      expect(u.state).toBe('running');
      u.dispose();
    }
  });

  it('re-arms after a later suspend/interruption and unlocks again on the next gesture', async () => {
    const ctx = new FakeAudioContext();
    const t = new SpyTarget();
    const u = new AutoplayUnlocker(ctx, t);
    const states: EngineState[] = [];
    u.onChange((s) => states.push(s));
    gesture(t);
    await flush();
    expect(u.state).toBe('running');
    ctx.simulateStateChange('interrupted');
    expect(u.state).toBe('suspended');
    expect(u.listening).toBe(true);
    ctx.simulateStateChange('running');
    expect(u.state).toBe('running');
    expect(u.listening).toBe(false);
    ctx.simulateStateChange('suspended');
    expect(u.state).toBe('suspended');
    gesture(t);
    await flush();
    expect(u.state).toBe('running');
    expect(t.liveCount()).toBe(0);
    expect(states).toEqual(['running', 'suspended', 'running', 'suspended', 'running']);
    u.dispose();
  });

  it('rearm: false keeps the listeners off after a suspend', async () => {
    const ctx = new FakeAudioContext();
    const t = new SpyTarget();
    const u = new AutoplayUnlocker(ctx, t, { rearm: false });
    gesture(t);
    await flush();
    ctx.simulateStateChange('suspended');
    expect(u.state).toBe('suspended');
    expect(u.listening).toBe(false);
    expect(await u.unlock()).toBe(true);
    u.dispose();
  });

  it('unlock(): true when the context runs, false on timeout or when closed', async () => {
    const ok = new AutoplayUnlocker(new FakeAudioContext(), null);
    expect(ok.state).toBe('locked');
    expect(await ok.unlock()).toBe(true);
    expect(ok.state).toBe('running');
    expect(await ok.unlock()).toBe(true);

    const blockedCtx = new FakeAudioContext({ autoplay: 'blocked' });
    const blocked = new AutoplayUnlocker(blockedCtx, null, { resumeTimeoutMs: 5 });
    expect(await blocked.unlock()).toBe(false);
    expect(blocked.state).toBe('locked');
    blockedCtx.grantAutoplay();
    await flush();
    expect(blocked.state).toBe('running');

    const closedCtx = new FakeAudioContext();
    const closed = new AutoplayUnlocker(closedCtx, new EventTarget());
    const seen = vi.fn();
    closed.onChange(seen);
    await closedCtx.close();
    expect(closed.state).toBe('closed');
    expect(closed.listening).toBe(false);
    expect(seen).toHaveBeenCalledWith('closed', 'locked');
    expect(await closed.unlock()).toBe(false);
  });

  it('is idle when the context already runs at construction', async () => {
    const ctx = new FakeAudioContext();
    await ctx.resume();
    const t = new SpyTarget();
    const u = new AutoplayUnlocker(ctx, t);
    expect(u.state).toBe('running');
    expect(t.added.length).toBe(0);
    u.dispose();
  });

  it('chains a previous onstatechange handler and restores it on dispose', async () => {
    const ctx = new FakeAudioContext();
    const prev = vi.fn();
    ctx.onstatechange = prev;
    const t = new SpyTarget();
    const u = new AutoplayUnlocker(ctx, t);
    const listener = vi.fn();
    const off = u.onChange(listener);
    gesture(t);
    await flush();
    expect(prev).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    ctx.simulateStateChange('suspended');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(u.listening).toBe(true);
    u.dispose();
    expect(ctx.onstatechange).toBe(prev);
    expect(t.liveCount()).toBe(0);
    gesture(t);
    await flush();
    expect(ctx.resumeCalls).toBe(1); // disposed: gestures are ignored
    ctx.simulateStateChange('running');
    expect(u.state).toBe('suspended'); // no more tracking after dispose
    u.dispose(); // idempotent
  });

  it('survives a context whose resume() throws synchronously', async () => {
    const ctx = new FakeAudioContext();
    ctx.resume = () => {
      throw new Error('boom');
    };
    const t = new EventTarget();
    const u = new AutoplayUnlocker(ctx, t);
    expect(() => gesture(t)).not.toThrow();
    expect(await u.unlock()).toBe(false);
    expect(u.state).toBe('locked');
    u.dispose();
  });
});
