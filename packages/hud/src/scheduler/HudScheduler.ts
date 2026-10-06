import { batch } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { HudModel } from '../model/index.ts';
import type { ResourceSignals } from '../model/eco.ts';
import type { HudSnapshot, ResourceSnapshot } from '../model/snapshot.ts';
import type { PauseState } from '../model/status.ts';
import { sameData, sameRef } from './equal.ts';
import { HUD_RATES, HUD_RATE_CLASSES, RateGate } from './rates.ts';
import type { HudRateClass, HudRates } from './rates.ts';
import { nowMs, requestFrameFallback } from '../ui/frame.ts';

/** Name of the performance measure of one flush (PerformanceObserver type "measure"). */
export const HUD_FLUSH_MEASURE = 'hud-flush';
const FLUSH_MARK = 'hud-flush:start';

export interface HudFlushInfo {
  /** Wall clock (options.now) at the start and the end of the flush. */
  readonly startMs: number;
  readonly endMs: number;
  /** performance.now() at the start of the flush (for measurements that end after it). */
  readonly perfStart: number;
  readonly tick: number;
  /** Signals written in this flush. */
  readonly writes: number;
  /** Rate classes whose gate opened in this flush. */
  readonly classes: readonly HudRateClass[];
}

export interface HudSchedulerOptions {
  /** Wall clock in ms (default performance.now). */
  readonly now?: (() => number) | undefined;
  /** Schedules the flush for the next frame (default requestAnimationFrame, setTimeout(16) without it). */
  readonly requestFrame?: ((cb: () => void) => unknown) | undefined;
  /** performance.mark/measure "hud-flush" per flush (default true). */
  readonly measure?: boolean | undefined;
  /** Called after every flush that wrote (measurement hooks, e.g. forcing layout in the perf harness). */
  readonly onFlush?: ((info: HudFlushInfo) => void) | undefined;
  /** Rate overrides in Hz (tests). */
  readonly rates?: Partial<HudRates> | undefined;
}

export interface HudSchedulerStats {
  flushes: number;
  /** Signal writes in total. */
  writes: number;
  /** Gate openings per class ('event' counts flushes that wrote an event section). */
  readonly passes: Record<HudRateClass, number>;
  /** Signal writes per class. */
  readonly writesByClass: Record<HudRateClass, number>;
}

interface Pending {
  readonly snapshot: HudSnapshot;
  readonly tick: number;
  readonly speed: number;
  readonly paused: boolean;
}

type Eq = (a: unknown, b: unknown) => boolean;

const NO_VERSION = Number.NaN;


/**
 * HudScheduler (ui.md §9.1, §10): the only writer of the HUD signals during a match. The game calls
 * `push(snapshot, simTick, simSpeed, paused)` once per sim tick (and whenever an event section changes, e.g.
 * a selection while paused); the scheduler keeps only the newest snapshot and writes it in one
 * requestAnimationFrame inside one `batch()`:
 * - the first snapshot completely (also when it arrives paused);
 * - event sections (version changed) at once, including their hot values; banner fields always;
 * - rate classes (eco 10 Hz, hot 4 Hz, map 4 Hz staggered against hot, fog 2 Hz with map, slow 1 Hz) in
 *   wall-clock time, evaluated only for a new tick and never while paused;
 * - a signal is written only when its value changed (numbers by value, plain data structurally, typed-array
 *   wrappers by reference).
 * Each flush is wrapped in performance.mark/measure("hud-flush").
 */
export class HudScheduler {
  readonly stats: HudSchedulerStats;
  private readonly model: HudModel;
  private readonly now: () => number;
  private readonly requestFrame: (cb: () => void) => unknown;
  private readonly measure: boolean;
  private readonly onFlush: ((info: HudFlushInfo) => void) | undefined;
  private readonly gates: Readonly<Record<Exclude<HudRateClass, 'event'>, RateGate>>;
  private pending: Pending | null = null;
  private scheduled = false;
  private disposed = false;
  private lastTick = Number.NaN;
  private primed = false;
  private versions: Record<string, number> = {};
  private detailsWereOpen = false;
  private mapDeferred = false;
  private flushWrites = 0;
  private flushClass: HudRateClass = 'event';

  constructor(model: HudModel, options: HudSchedulerOptions = {}) {
    this.model = model;
    this.now = options.now ?? nowMs;
    this.requestFrame = options.requestFrame ?? requestFrameFallback;
    this.measure = options.measure ?? true;
    this.onFlush = options.onFlush;
    const rates: HudRates = { ...HUD_RATES, ...options.rates };
    this.gates = {
      eco: new RateGate(rates.eco),
      hot: new RateGate(rates.hot),
      map: new RateGate(rates.map),
      fog: new RateGate(rates.fog),
      slow: new RateGate(rates.slow),
    };
    const zero = (): Record<HudRateClass, number> => {
      const r = {} as Record<HudRateClass, number>;
      for (const c of HUD_RATE_CLASSES) r[c] = 0;
      return r;
    };
    this.stats = { flushes: 0, writes: 0, passes: zero(), writesByClass: zero() };
  }

  /**
   * Hands over the newest snapshot. `simTick` identifies the sim step (a repeated tick only carries events),
   * `simSpeed` is the requested speed factor, `paused` stops all rate-driven writes.
   */
  push(snapshot: HudSnapshot, simTick: number, simSpeed: number, paused: boolean): void {
    if (this.disposed) return;
    this.pending = { snapshot, tick: simTick, speed: simSpeed, paused };
    if (this.scheduled) return;
    this.scheduled = true;
    this.requestFrame(() => this.flush());
  }

  /** True while a flush is scheduled. */
  get isScheduled(): boolean {
    return this.scheduled;
  }

  /** Writes the pending snapshot now (normally called from the scheduled frame). */
  flush(): void {
    this.scheduled = false;
    const p = this.pending;
    if (p === null || this.disposed) return;
    this.pending = null;
    const perfStart = nowMs();
    if (this.measure) mark(FLUSH_MARK);
    const startMs = this.now();
    const classes: HudRateClass[] = [];
    this.flushWrites = 0;
    batch(() => this.apply(p, startMs, classes));
    const endMs = this.now();
    this.stats.flushes++;
    if (this.measure) measureSince(FLUSH_MARK);
    this.onFlush?.({ startMs, endMs, perfStart, tick: p.tick, writes: this.flushWrites, classes });
  }

  /** Stops accepting snapshots (a scheduled frame becomes a no-op). */
  dispose(): void {
    this.disposed = true;
    this.pending = null;
  }

  // -------------------------------------------------------------------------------------------------------

  private set<T>(sig: Signal<T>, value: T, eq: Eq = sameData): void {
    if (eq(sig.peek(), value)) return;
    sig.value = value;
    this.flushWrites++;
    this.stats.writes++;
    this.stats.writesByClass[this.flushClass]++;
  }

  private versionChanged(section: string, version: number): boolean {
    const old = this.versions[section] ?? NO_VERSION;
    if (Object.is(old, version)) return false;
    this.versions[section] = version;
    return true;
  }

  private gate(cls: Exclude<HudRateClass, 'event'>, now: number, open: boolean, classes: HudRateClass[]): boolean {
    if (!open) return false;
    const g = this.gates[cls];
    if (!g.due(now)) return false;
    g.fire(now);
    this.stats.passes[cls]++;
    classes.push(cls);
    return true;
  }

  private apply(p: Pending, now: number, classes: HudRateClass[]): void {
    const s = p.snapshot;
    const m = this.model;
    const newTick = !Object.is(p.tick, this.lastTick);
    this.lastTick = p.tick;
    // The very first snapshot is written completely, also while paused (a match loaded in pause).
    const rated = !this.primed || (newTick && !p.paused);
    this.primed = true;

    // ---- events: versioned sections, banner fields, speed/pause, camera --------------------------------
    this.flushClass = 'event';
    const before = this.flushWrites;
    const ev = {
      eco: this.versionChanged('eco', s.eco.version),
      alerts: this.versionChanged('alerts', s.alerts.version),
      selection: this.versionChanged('selection', s.selection.version),
      factory: this.versionChanged('factory', s.factory.version),
      card: this.versionChanged('card', s.card.version),
      orders: this.versionChanged('orders', s.orders.version),
      strip: this.versionChanged('strip', s.strip.version),
      minimap: this.versionChanged('minimap', s.minimap.version),
    };
    const pause: PauseState = p.paused ? s.match.pauseReason : 'none';
    this.set(m.match.pause, pause);
    this.set(m.match.speed, p.speed);
    this.set(m.match.simLag, s.match.simLag);
    this.set(m.match.contextLost, s.match.contextLost);
    this.set(m.match.replay, s.match.replay);
    if (ev.eco) {
      this.set(m.eco.interactive, s.eco.interactive);
      this.set(m.eco.stallPriority, s.eco.stallPriority);
    }
    if (ev.alerts) {
      this.set(m.alerts.items, s.alerts.items, sameRef);
      this.set(m.alerts.historyCount, s.alerts.historyCount);
      this.set(m.alerts.nextId, s.alerts.nextId);
    }
    if (ev.selection) {
      const sel = m.selection;
      this.set(sel.kind, s.selection.kind);
      this.set(sel.multi, s.selection.multi);
      this.set(sel.focusTypeId, s.selection.focusTypeId);
      this.set(sel.groupLabel, s.selection.groupLabel);
      this.set(sel.controlGroup, s.selection.controlGroup);
      this.set(sel.single, s.selection.single);
      this.set(sel.multiStats, s.selection.multiStats, sameRef);
    }
    if (ev.factory) {
      this.set(m.factory.detail, s.factory.detail);
      this.set(m.factory.queue, s.factory.queue);
      this.set(m.factory.progress, s.factory.progress);
      this.set(m.factory.remainingS, s.factory.remainingS);
    }
    if (ev.card) {
      const c = m.card;
      // A new selection resets the client-local card state (model/card.ts contract): the tab returns to the
      // highest buildable tier (ui.md §5.6) and an armed placement ends. Same selection (queue edit, cap) keeps it.
      if (!sameData(c.selectedTypes.peek(), s.card.selectedTypes)) {
        this.set(c.tab, null);
        this.set(c.armedSlot, null);
        this.set(c.placingTypeId, null);
      }
      this.set(c.selectedTypes, s.card.selectedTypes);
      this.set(c.unitCount, s.card.unitCount);
      this.set(c.capReached, s.card.capReached);
      this.set(c.buildPower, s.card.buildPower);
      this.set(c.queueCounts, s.card.queueCounts);
      this.set(c.progress, s.card.progress);
    }
    if (ev.orders) {
      this.set(m.orders.states, s.orders.states);
      this.set(m.orders.selfDestructCountdown, s.orders.selfDestructCountdown);
    }
    if (ev.strip) {
      this.set(m.strip.groups, s.strip.groups);
      this.set(m.strip.activeGroup, s.strip.activeGroup);
      this.set(m.strip.idleEngineers, s.strip.idleEngineers);
      this.set(m.strip.idleFactories, s.strip.idleFactories);
    }
    if (ev.minimap) {
      const mm = m.minimap;
      this.set(mm.mapName, s.minimap.mapName);
      this.set(mm.mapSizeWu, s.minimap.mapSizeWu);
      this.set(mm.terrain, s.minimap.terrain, sameRef);
      this.set(mm.spots, s.minimap.spots);
      this.set(mm.available, s.minimap.available);
      this.set(mm.units, s.minimap.units, sameRef);
      this.set(mm.pings, s.minimap.pings);
      this.set(mm.fog, s.minimap.fog, sameRef);
    }
    if (s.minimap.camera !== undefined) this.set(m.minimap.camera, s.minimap.camera);
    // Flow details just opened: show the consumers at once instead of waiting for the next 4 Hz slot.
    const detailsOpen = m.eco.detailsOpen.peek();
    if (detailsOpen && !this.detailsWereOpen) this.set(m.eco.consumers, s.eco.consumers);
    this.detailsWereOpen = detailsOpen;
    if (this.flushWrites > before) {
      this.stats.passes.event++;
      classes.push('event');
    }

    // ---- 10 Hz: economy and progress ---------------------------------------------------------------------
    if (this.gate('eco', now, rated, classes)) {
      this.flushClass = 'eco';
      this.writeResource(m.eco.mass, s.eco.mass);
      this.writeResource(m.eco.energy, s.eco.energy);
      this.set(m.factory.progress, s.factory.progress);
      this.set(m.factory.remainingS, s.factory.remainingS);
      this.set(m.card.progress, s.card.progress);
    }

    // ---- 4 Hz: HP, vet, order chain, toggles, tooltip data, flow details ------------------------------------
    const hot = this.gate('hot', now, rated, classes);
    if (hot) {
      this.flushClass = 'hot';
      this.set(m.selection.single, s.selection.single);
      this.set(m.selection.multiStats, s.selection.multiStats, sameRef);
      this.set(m.factory.detail, s.factory.detail);
      this.set(m.orders.states, s.orders.states);
      this.set(m.orders.selfDestructCountdown, s.orders.selfDestructCountdown);
      this.set(m.eco.mass.incomeBySource, s.eco.mass.incomeBySource);
      this.set(m.eco.mass.storageByBuilding, s.eco.mass.storageByBuilding);
      this.set(m.eco.energy.incomeBySource, s.eco.energy.incomeBySource);
      this.set(m.eco.energy.storageByBuilding, s.eco.energy.storageByBuilding);
      if (detailsOpen) this.set(m.eco.consumers, s.eco.consumers);
    }

    // ---- 4 Hz, staggered against `hot`: minimap units, blips, ghosts, pings --------------------------------
    // The first flush writes everything at once; afterwards a due map pass that meets a hot pass waits one
    // tick (at most once, so slow sim speeds with few ticks cannot starve it).
    const mapDue = rated && this.gates.map.due(now);
    const mapNow = mapDue && (!hot || this.mapDeferred || this.stats.flushes === 0);
    if (mapDue && !mapNow) this.mapDeferred = true;
    const map = this.gate('map', now, mapNow, classes);
    if (map) {
      this.mapDeferred = false;
      this.flushClass = 'map';
      this.set(m.minimap.units, s.minimap.units, sameRef);
      this.set(m.minimap.pings, s.minimap.pings);
    }

    // ---- 2 Hz: fog, aligned with a map pass so the minimap redraws once for units and fog ----------------
    if (this.gate('fog', now, map, classes)) {
      this.flushClass = 'fog';
      this.set(m.minimap.fog, s.minimap.fog, sameRef);
    }

    // ---- 1 Hz: timer (and with it the alert age), cap, idle counters, group counts ------------------------
    if (this.gate('slow', now, rated, classes)) {
      this.flushClass = 'slow';
      this.set(m.match.timeS, s.match.timeS);
      this.set(m.match.units, s.match.units);
      this.set(m.match.unitCap, s.match.unitCap);
      this.set(m.match.scores, s.match.scores);
      this.set(m.strip.idleEngineers, s.strip.idleEngineers);
      this.set(m.strip.idleFactories, s.strip.idleFactories);
      this.set(m.strip.groups, s.strip.groups);
    }
    this.flushClass = 'event';
  }

  private writeResource(r: ResourceSignals, v: ResourceSnapshot): void {
    this.set(r.stored, v.stored);
    this.set(r.capacity, v.capacity);
    this.set(r.income, v.income);
    this.set(r.demand, v.demand);
    this.set(r.served, v.served);
    this.set(r.flow, v.flow);
  }
}

function mark(name: string): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  performance.mark(name);
}

/**
 * Ends the measure started by `mark(start)`. Marks and measures are cleared right away so a long match does
 * not grow the performance buffer; PerformanceObservers still receive every entry.
 */
function measureSince(start: string): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  try {
    performance.measure(HUD_FLUSH_MEASURE, start);
  } catch {
    // The start mark can be missing if a test cleared the timeline mid-flush.
  }
  performance.clearMarks(start);
  performance.clearMeasures(HUD_FLUSH_MEASURE);
}
