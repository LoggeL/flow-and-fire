import { effect } from '@preact/signals';
import { describe, expect, test, vi } from 'vitest';
import { createHudScenario, createSnapshotGenerator } from '../../src/demo/scenarios.ts';
import { createHudModel } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import type { HudSnapshot } from '../../src/model/snapshot.ts';
import { cardSpec } from '../../src/hud/card/spec.ts';
import { HUD_FLUSH_MEASURE, HUD_RATES, HudScheduler, RateGate, sameData } from '../../src/scheduler/index.ts';
import type { HudFlushInfo, HudRateClass } from '../../src/scheduler/index.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

/** Scheduler on a fake clock with manually run frames. */
function rig(model: HudModel = createHudModel({ units: CAT })) {
  let clock = 0;
  const frames: (() => void)[] = [];
  const flushes: HudFlushInfo[] = [];
  const requestFrame = vi.fn((cb: () => void) => {
    frames.push(cb);
  });
  const scheduler = new HudScheduler(model, { now: () => clock, requestFrame, measure: false, onFlush: (i) => flushes.push(i) });
  const frame = (): void => {
    const run = frames.splice(0);
    for (const f of run) f();
  };
  return {
    model,
    scheduler,
    flushes,
    requestFrame,
    frame,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

/** Every signal of the sections the scheduler writes, as effects counting notifications. */
function watchAll(model: HudModel): { readonly count: () => number; readonly dispose: () => void } {
  const sigs: { readonly value: unknown }[] = [];
  const collect = (o: object): void => {
    for (const v of Object.values(o)) {
      if (v !== null && typeof v === 'object' && 'peek' in v && 'value' in v) sigs.push(v as { readonly value: unknown });
      else if (v !== null && typeof v === 'object' && !ArrayBuffer.isView(v)) collect(v as object);
    }
  };
  for (const s of [model.eco, model.match, model.alerts, model.selection, model.factory, model.card, model.orders, model.strip, model.minimap]) collect(s);
  let n = 0;
  let armed = false;
  const disposers = sigs.map((s) =>
    effect(() => {
      void s.value;
      if (armed) n++;
    }),
  );
  armed = true;
  return { count: () => n, dispose: () => disposers.forEach((d) => d()) };
}

/** Drives `seconds` of sim at `speed` (10 Hz × speed ticks) and returns the gate openings per second window. */
function drive(speed: number, seconds: number, paused = false) {
  const r = rig();
  const scenario = createHudScenario('perf-500');
  const gen = createSnapshotGenerator(scenario);
  r.scheduler.push(gen.current(), 0, speed, paused);
  r.frame();
  const tickMs = 100 / speed;
  const perSecond: Record<HudRateClass, number>[] = [];
  const classes: HudRateClass[] = ['eco', 'hot', 'map', 'fog', 'slow', 'event'];
  const ticks = Math.round((seconds * 1000) / tickMs);
  for (let i = 0; i < ticks; i++) {
    r.advance(tickMs);
    const snap = paused ? gen.current() : gen.next();
    r.scheduler.push(snap, paused ? 0 : gen.tick, speed, paused);
    r.frame();
    const info = r.flushes[r.flushes.length - 1]!;
    const sec = Math.floor((r.now() - 1) / 1000);
    const bucket = (perSecond[sec] ??= Object.fromEntries(classes.map((c) => [c, 0])) as Record<HudRateClass, number>);
    for (const c of info.classes) bucket[c]++;
  }
  return { ...r, perSecond, gen };
}

describe('HudScheduler rates (ui.md §9.1, fake clock)', () => {
  test.each([1, 3])('×%d: eco 10 Hz, hot/map 4 Hz, fog 2 Hz, slow 1 Hz – ±1 per second', (speed) => {
    const { perSecond } = drive(speed, 10);
    expect(perSecond).toHaveLength(10);
    for (const s of perSecond) {
      expect(Math.abs(s.eco - HUD_RATES.eco)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.hot - HUD_RATES.hot)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.map - HUD_RATES.map)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.fog - HUD_RATES.fog)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.slow - HUD_RATES.slow)).toBeLessThanOrEqual(1);
    }
  });

  test('at ×3 the economy still updates at 10 Hz (every third tick), not per tick', () => {
    const { scheduler } = drive(3, 10);
    // 300 ticks in 10 s; 1 initial flush + ~100 eco passes.
    expect(scheduler.stats.flushes).toBe(301);
    expect(scheduler.stats.passes.eco).toBeGreaterThanOrEqual(99);
    expect(scheduler.stats.passes.eco).toBeLessThanOrEqual(102);
  });

  test('averages hold at slow speed (×0.5, 5 ticks/s): the staggered map pass does not starve', () => {
    const { scheduler } = drive(0.5, 20);
    const s = scheduler.stats.passes;
    expect(s.eco).toBeGreaterThanOrEqual(99); // limited by the 5 ticks/s
    expect(s.hot / 20).toBeGreaterThanOrEqual(3);
    expect(s.map / 20).toBeGreaterThanOrEqual(2.5);
    expect(s.fog / 20).toBeGreaterThanOrEqual(1.5);
  });

  test('map (minimap units) never shares a flush with hot (selection HP), except the first', () => {
    const { flushes } = drive(1, 10);
    for (const f of flushes.slice(1)) expect(f.classes.includes('hot') && f.classes.includes('map')).toBe(false);
    for (const f of flushes) if (f.classes.includes('fog')) expect(f.classes).toContain('map');
  });

  test('paused: 0 non-event updates, even for new ticks; the first snapshot is still written completely', () => {
    const r = drive(1, 5, true);
    const s = r.scheduler.stats;
    // First flush primes everything (a match loaded in pause), then nothing but events.
    for (const c of ['eco', 'hot', 'map', 'fog', 'slow'] as const) expect(s.passes[c]).toBe(1);
    expect(r.model.eco.mass.capacity.value).toBeGreaterThan(0);
    expect(r.model.match.pause.value).toBe('user');
    const before = { ...s.writesByClass };
    // New tick numbers while paused (e.g. a sim step): still no rate-driven writes.
    const snap = r.gen.next();
    r.advance(500);
    r.scheduler.push(snap, 999, 1, true);
    r.frame();
    for (const c of ['eco', 'hot', 'map', 'fog', 'slow'] as const) expect(s.writesByClass[c]).toBe(before[c]);
  });

  test('events are written in the next flush, also while paused (alerts, selection, banner, speed)', () => {
    const r = rig();
    const scenario = createHudScenario('armee');
    const s0 = scenario.snapshot;
    r.scheduler.push(s0, 0, 1, true);
    r.frame();
    const alert = { ...s0.alerts.items[0]!, id: 99, count: 1 };
    const s1: HudSnapshot = {
      ...s0,
      alerts: { ...s0.alerts, version: s0.alerts.version + 1, items: [alert, ...s0.alerts.items] },
      selection: { ...s0.selection, version: s0.selection.version + 1, kind: 'none', multi: null, multiStats: null },
      match: { ...s0.match, simLag: 0.8 },
    };
    r.advance(10);
    r.scheduler.push(s1, 0, 2, true);
    r.frame();
    expect(r.model.alerts.items.value[0]!.id).toBe(99);
    expect(r.model.selection.kind.value).toBe('none');
    expect(r.model.match.simLag.value).toBe(0.8);
    expect(r.model.match.speed.value).toBe(2);
    // Resuming writes the pause state at once.
    r.scheduler.push(s1, 1, 2, false);
    r.frame();
    expect(r.model.match.pause.value).toBe('none');
  });

  test('a new selection resets tab, armed slot and placement (model/card.ts contract, ui.md §5.6)', () => {
    const r = rig();
    const s0 = createHudScenario('vogt').snapshot;
    const eng3: HudSnapshot = { ...s0, card: { ...s0.card, version: 100, selectedTypes: ['core:lnd_t3_engineer'] } };
    r.scheduler.push(eng3, 0, 1, false);
    r.frame();
    expect(cardSpec(r.model).value.tab).toBe(3);
    // Player clicks T1 and arms a placement (client-local state, written directly on the input event).
    r.model.card.tab.value = 1;
    r.model.card.armedSlot.value = 'KeyQ';
    r.model.card.placingTypeId.value = 'core:str_t1_mex';
    expect(cardSpec(r.model).value.tab).toBe(1);
    // Queue/cap edits of the same selection keep the local state.
    r.advance(100);
    r.scheduler.push({ ...eng3, card: { ...eng3.card, version: 101, capReached: true } }, 1, 1, false);
    r.frame();
    expect(r.model.card.tab.value).toBe(1);
    expect(r.model.card.armedSlot.value).toBe('KeyQ');
    // New selection (T2 engineer): highest buildable tier preselected again, placement ends.
    r.advance(100);
    const eng2: HudSnapshot = { ...eng3, card: { ...eng3.card, version: 102, selectedTypes: ['core:lnd_t2_engineer'] } };
    r.scheduler.push(eng2, 2, 1, false);
    r.frame();
    expect(r.model.card.tab.value).toBeNull();
    expect(r.model.card.armedSlot.value).toBeNull();
    expect(r.model.card.placingTypeId.value).toBeNull();
    const spec = cardSpec(r.model).value;
    expect(spec.defaultTab).toBe(2);
    expect(spec.tab).toBe(2);
  });

  test('a version bump writes the section with its hot values (no stale numbers with a new structure)', () => {
    const r = rig();
    const s0 = createHudScenario('fabrik').snapshot;
    r.scheduler.push(s0, 0, 1, false);
    r.frame();
    // Same tick (no rate pass), new factory version with a different progress: written because of the event.
    const s1: HudSnapshot = { ...s0, factory: { ...s0.factory, version: s0.factory.version + 1, progress: 0.1 } };
    r.scheduler.push(s1, 0, 1, false);
    r.frame();
    expect(r.model.factory.progress.value).toBeCloseTo(0.1);
  });

  test('no signal writes without a change (identical snapshots, new ticks)', () => {
    const r = rig();
    const snap = createHudScenario('vogt').snapshot;
    r.scheduler.push(snap, 0, 1, false);
    r.frame();
    const w = watchAll(r.model);
    const writes = r.scheduler.stats.writes;
    for (let t = 1; t <= 50; t++) {
      r.advance(100);
      // Structurally equal copies (new objects, same data) must not write either.
      const copy: HudSnapshot = JSON.parse(JSON.stringify({ ...snap, minimap: undefined })) as HudSnapshot;
      r.scheduler.push({ ...copy, minimap: snap.minimap }, t, 1, false);
      r.frame();
    }
    expect(r.scheduler.stats.passes.eco).toBeGreaterThanOrEqual(50);
    expect(r.scheduler.stats.writes).toBe(writes);
    expect(w.count()).toBe(0);
    w.dispose();
  });

  test('pushes are coalesced into one frame with the newest snapshot', () => {
    const r = rig();
    const gen = createSnapshotGenerator(createHudScenario('vogt'));
    r.scheduler.push(gen.current(), 0, 1, false);
    const a = gen.next();
    const b = gen.next();
    r.scheduler.push(a, 1, 1, false);
    r.scheduler.push(b, 2, 1, false);
    expect(r.requestFrame).toHaveBeenCalledTimes(1);
    r.frame();
    expect(r.flushes).toHaveLength(1);
    expect(r.model.eco.mass.stored.value).toBe(b.eco.mass.stored);
  });

  test('every flush is measured as performance "hud-flush" and runs inside one batch', () => {
    const measure = vi.spyOn(performance, 'measure');
    const model = createHudModel({ units: CAT });
    let frame: (() => void) | null = null;
    const s = new HudScheduler(model, { now: () => 0, requestFrame: (cb) => void (frame = cb) });
    const runs: number[] = [];
    const stop = effect(() => {
      runs.push(model.eco.mass.stored.value + model.eco.energy.stored.value + model.match.timeS.value);
    });
    s.push(createHudScenario('vogt').snapshot, 0, 1, false);
    frame!();
    expect(measure.mock.calls.some((c) => c[0] === HUD_FLUSH_MEASURE)).toBe(true);
    // One re-run for all three signals (batch), not three.
    expect(runs).toHaveLength(2);
    stop();
    measure.mockRestore();
  });

  test('dispose turns a scheduled flush into a no-op', () => {
    const r = rig();
    r.scheduler.push(createHudScenario('vogt').snapshot, 0, 1, false);
    r.scheduler.dispose();
    r.frame();
    expect(r.flushes).toHaveLength(0);
    expect(r.model.match.timeS.value).toBe(0);
  });

  test('flow details: consumers only while open, at once when opened', () => {
    const r = rig();
    const gen = createSnapshotGenerator(createHudScenario('fabrik-stall'));
    r.model.eco.detailsOpen.value = false;
    r.scheduler.push(gen.current(), 0, 1, false);
    r.frame();
    expect(r.model.eco.consumers.value).toEqual([]);
    r.model.eco.detailsOpen.value = true;
    r.advance(100);
    r.scheduler.push(gen.current(), 0, 1, false); // same tick: only the "opened" event
    r.frame();
    expect(r.model.eco.consumers.value.length).toBeGreaterThan(0);
  });
});

describe('RateGate', () => {
  test('4 Hz over 10 Hz ticks averages 4 per second, 1 Hz over 30 Hz ticks 1 per second', () => {
    const count = (hz: number, tickMs: number, ms: number): number => {
      const g = new RateGate(hz);
      let n = 0;
      for (let t = 0; t < ms; t += tickMs) {
        if (g.due(t)) {
          g.fire(t);
          n++;
        }
      }
      return n;
    };
    expect(count(4, 100, 10_000)).toBe(40);
    // First write at t = 0, then every second (the 20 % tolerance lets the tick at 800 ms count): 10–11.
    expect(count(1, 1000 / 30, 10_000)).toBeGreaterThanOrEqual(10);
    expect(count(1, 1000 / 30, 10_000)).toBeLessThanOrEqual(11);
    expect(count(10, 100, 10_000)).toBe(100);
  });

  test('tolerates early ticks (jitter) and re-synchronises after a stall instead of bursting', () => {
    const g = new RateGate(10);
    g.fire(0);
    expect(g.due(85)).toBe(true); // 15 ms early: within 20 % of the period
    g.fire(85);
    expect(g.due(150)).toBe(false);
    // 5 s stall → one write, then the normal period again.
    expect(g.due(5000)).toBe(true);
    g.fire(5000);
    expect(g.due(5010)).toBe(false);
    expect(g.due(5100)).toBe(true);
  });

  test('rejects non-positive rates', () => {
    expect(() => new RateGate(0)).toThrow();
  });
});

describe('sameData', () => {
  test('structural equality of plain data, typed arrays and nesting', () => {
    expect(sameData({ a: [1, { b: 'x' }], c: null }, { a: [1, { b: 'x' }], c: null })).toBe(true);
    expect(sameData({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData(new Float32Array([1, 2]), new Float32Array([1, 2]))).toBe(true);
    expect(sameData(new Float32Array([1, 2]), new Uint8Array([1, 2]))).toBe(false);
    expect(sameData([1], { 0: 1, length: 1 })).toBe(false);
    expect(sameData(Number.NaN, Number.NaN)).toBe(true);
  });
});
