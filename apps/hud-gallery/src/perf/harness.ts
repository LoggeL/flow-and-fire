/**
 * Browser perf harness of the full HUD (hud-p5-root, ui.md §9.3; DECISIONS 16: measurement, gates only in
 * perf.spec.ts with FAF_PERF_GATE=1). Drives the perf-500 scenario through a real HudScheduler, one sim tick
 * per animation frame on a simulated 10 Hz clock, and measures per flush:
 *   flush        – performance.measure("hud-flush") (scheduler diff + signal writes + direct DOM bindings),
 *   script       – flush + the Preact re-renders it queued (drained synchronously right after the flush),
 *   scriptLayout – script + the style/layout it causes (getBoundingClientRect forced at the end of the flush),
 *   minimap      – performance.measure("hud-minimap") of the dynamic layer,
 * plus Long Animation Frames (Chromium, styleAndLayoutStart), layout shifts attributed to the HUD and the DOM
 * node count under [data-hud-root]. The result lands in window.__HUD_PERF__.
 */
import { HUD_FLUSH_MEASURE, HudScheduler, MINIMAP_DRAW_MEASURE, applyHudScenarioUi, createHudScenario, createSnapshotGenerator } from '@faf/hud';
import type { HudModel } from '@faf/hud';
import { options } from 'preact';
import type { PerfParams } from './params.ts';
import { EMPTY_SUMMARY, countHudNodes, summarize } from './stats.ts';
import type { PerfSummary } from './stats.ts';

export interface HudPerfResult {
  readonly done: boolean;
  /** Ticks flushed so far (progress while running). */
  readonly progress: number;
  readonly params: PerfParams;
  readonly userAgent: string;
  /** Cross-origin isolated page (fine timer resolution; otherwise Firefox/WebKit clamp to 1 ms). */
  readonly crossOriginIsolated: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly flushes: number;
  readonly flush: PerfSummary;
  readonly script: PerfSummary;
  readonly scriptLayout: PerfSummary;
  readonly minimap: PerfSummary;
  readonly loaf: {
    readonly supported: boolean;
    readonly count: number;
    readonly maxMs: number;
    /** Style + layout share of the longest frame (styleAndLayoutStart → end). */
    readonly maxStyleLayoutMs: number;
    /** Largest script time attributed inside one long frame (sum of its script entries). */
    readonly maxScriptMs: number;
    /** Largest time before rendering started in one long frame (startTime → renderStart: tasks + rAF). */
    readonly maxBeforeRenderMs: number;
  };
  readonly layoutShifts: {
    readonly supported: boolean;
    readonly total: number;
    readonly hud: number;
    readonly value: number;
    /** HUD shifts that moved a panel ([data-panel] or a container of one) – gated: must be 0. */
    readonly box: number;
    /**
     * Content moved inside a fixed panel (text or an element, e.g. a right-aligned number or badge whose text
     * length changed), outside the alert feed – gated as well: must be 0 (values keep a constant width).
     */
    readonly text: number;
    /** The alert feed re-ordered (a new alert on top pushes the others down – an event by design, DECISIONS HUD-7). */
    readonly alerts: number;
    /** Shifted HUD nodes ("tag.class" → count), for diagnosis. */
    readonly sources: Readonly<Record<string, number>>;
  };
  /** script + style/layout per combination of rate classes that fired in a flush ("eco+hot", …). */
  readonly byClass: Readonly<Record<string, PerfSummary>>;
  readonly nodes: number;
  readonly durationMs: number;
  readonly errors: readonly string[];
}

declare global {
  interface Window {
    __HUD_PERF__?: HudPerfResult;
  }
}

interface LoafEntry extends PerformanceEntry {
  readonly styleAndLayoutStart?: number;
  readonly renderStart?: number;
  readonly scripts?: readonly { readonly duration: number }[];
}

interface LayoutShiftEntry extends PerformanceEntry {
  readonly value: number;
  readonly hadRecentInput: boolean;
  readonly sources?: readonly { readonly node?: Node | null }[];
}

function observe(type: string, cb: (entries: readonly PerformanceEntry[]) => void): PerformanceObserver | null {
  const supported = typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes(type);
  if (!supported) return null;
  const po = new PerformanceObserver((list) => cb(list.getEntries()));
  try {
    po.observe({ type, buffered: false });
  } catch {
    return null;
  }
  return po;
}

function nextFrame(): Promise<number> {
  return new Promise((r) => requestAnimationFrame(r));
}

/**
 * Preact batches component re-renders into a microtask. To attribute them to the flush that caused them, the
 * harness captures the render queue callback and drains it synchronously inside the flush hook.
 */
function captureRenderQueue(): { readonly drain: () => void; readonly restore: () => void } {
  const prev = options.debounceRendering;
  let queued: (() => void) | null = null;
  options.debounceRendering = (cb: () => void) => {
    queued = cb;
    queueMicrotask(() => {
      if (queued === cb) {
        queued = null;
        cb();
      }
    });
  };
  return {
    drain: () => {
      const cb = queued;
      queued = null;
      cb?.();
    },
    restore: () => {
      if (prev !== undefined) options.debounceRendering = prev;
      else delete options.debounceRendering;
    },
  };
}

function publish(r: HudPerfResult): void {
  window.__HUD_PERF__ = r;
}

/** Runs the measurement against the mounted HUD (`root` = the [data-hud-root] element). */
export async function runHudPerf(model: HudModel, root: HTMLElement, params: PerfParams): Promise<HudPerfResult> {
  const errors: string[] = [];
  const scenario = createHudScenario('perf-500', { units: params.units });
  applyHudScenarioUi(model, scenario);
  const gen = createSnapshotGenerator(scenario);
  const flush: number[] = [];
  const script: number[] = [];
  const scriptLayout: number[] = [];
  const minimap: number[] = [];
  const loaf = { count: 0, maxMs: 0, maxStyleLayoutMs: 0, maxScriptMs: 0, maxBeforeRenderMs: 0 };
  const shifts = { total: 0, hud: 0, value: 0, box: 0, text: 0, alerts: 0 };
  const alertFeed = root.querySelector('[data-component="AlertFeed"]');
  const shiftSources: Record<string, number> = {};
  const byClass: Record<string, number[]> = {};
  const describe = (n: Node): string => {
    // Diagnosis only: which HUD node moved (text nodes are named by their parent).
    if (!(n instanceof Element)) {
      const parent = n.parentElement;
      return `${n.nodeName.toLowerCase()} in ${parent !== null ? describe(parent) : '?'} "${(n.textContent ?? '').slice(0, 12)}"`;
    }
    const cls = typeof n.className === 'string' && n.className !== '' ? `.${n.className.trim().split(/\s+/).join('.')}` : '';
    const tid = n.getAttribute('data-testid');
    return `${n.tagName.toLowerCase()}${cls}${tid !== null ? `[${tid}]` : ''}`;
  };
  let measuring = false;
  let progress = 0;
  const base = {
    params,
    userAgent: navigator.userAgent,
    crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false,
    viewport: { width: innerWidth, height: innerHeight },
  };
  const snapshotResult = (done: boolean, flushes: number, durationMs: number): HudPerfResult => ({
    ...base,
    done,
    progress,
    flushes,
    flush: summarize(flush),
    script: summarize(script),
    scriptLayout: summarize(scriptLayout),
    minimap: summarize(minimap),
    loaf: { supported: loafPo !== null, ...loaf },
    layoutShifts: { supported: shiftPo !== null, ...shifts, sources: { ...shiftSources } },
    byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, summarize(v)])),
    nodes: countHudNodes(root),
    durationMs,
    errors,
  });

  const measurePo = observe('measure', (entries) => {
    if (!measuring) return;
    for (const e of entries) {
      if (e.name === HUD_FLUSH_MEASURE) flush.push(e.duration);
      else if (e.name === MINIMAP_DRAW_MEASURE) minimap.push(e.duration);
    }
  });
  const loafPo = observe('long-animation-frame', (entries) => {
    if (!measuring) return;
    for (const e of entries as readonly LoafEntry[]) {
      loaf.count++;
      loaf.maxMs = Math.max(loaf.maxMs, e.duration);
      if (typeof e.styleAndLayoutStart === 'number' && e.styleAndLayoutStart > 0) {
        loaf.maxStyleLayoutMs = Math.max(loaf.maxStyleLayoutMs, e.startTime + e.duration - e.styleAndLayoutStart);
      }
      let scriptMs = 0;
      for (const sc of e.scripts ?? []) scriptMs += sc.duration;
      loaf.maxScriptMs = Math.max(loaf.maxScriptMs, scriptMs);
      if (typeof e.renderStart === 'number' && e.renderStart > 0) loaf.maxBeforeRenderMs = Math.max(loaf.maxBeforeRenderMs, e.renderStart - e.startTime);
    }
  });
  const shiftPo = observe('layout-shift', (entries) => {
    if (!measuring) return;
    for (const e of entries as readonly LayoutShiftEntry[]) {
      if (e.hadRecentInput) continue;
      shifts.total++;
      const nodes = (e.sources ?? []).map((s) => s.node).filter((n): n is Node => n !== null && n !== undefined && root.contains(n));
      if (nodes.length > 0) {
        shifts.hud++;
        shifts.value += e.value;
        const inAlerts = (n: Node): boolean => alertFeed !== null && alertFeed.contains(n);
        const isPanel = (n: Node): boolean => n instanceof Element && (n.matches('[data-panel]') || n.querySelector('[data-panel]') !== null);
        if (nodes.some(isPanel)) shifts.box++;
        else if (nodes.some(inAlerts)) shifts.alerts++;
        else shifts.text++;
        for (const n of nodes) {
          const k = describe(n);
          shiftSources[k] = (shiftSources[k] ?? 0) + 1;
        }
      }
    }
  });

  const renders = captureRenderQueue();
  let clock = 0;
  const scheduler = new HudScheduler(model, {
    now: () => clock,
    onFlush: (info) => {
      renders.drain();
      const scriptEnd = performance.now();
      // Forced style + layout of everything this flush dirtied (measurement only, never in the game).
      root.getBoundingClientRect();
      const layoutEnd = performance.now();
      if (!measuring) return;
      script.push(scriptEnd - info.perfStart);
      scriptLayout.push(layoutEnd - info.perfStart);
      const key = info.classes.length > 0 ? info.classes.join('+') : 'none';
      (byClass[key] ??= []).push(layoutEnd - info.perfStart);
    },
  });

  const t0 = performance.now();
  try {
    scheduler.push(gen.current(), 0, params.speed, false);
    await nextFrame();
    await nextFrame();
    const total = params.warmup + params.ticks;
    for (let i = 0; i < total; i++) {
      clock += 100 / params.speed;
      measuring = i >= params.warmup;
      scheduler.push(gen.next(), gen.tick, params.speed, false);
      // The scheduler's frame callback was registered first, so the flush has run when this frame resolves.
      await nextFrame();
      progress = i + 1;
      if (i % 60 === 0) publish(snapshotResult(false, scheduler.stats.flushes, performance.now() - t0));
    }
    // Let observers deliver the last entries.
    await nextFrame();
    await new Promise((r) => setTimeout(r, 50));
  } catch (e) {
    errors.push(e instanceof Error ? (e.stack ?? e.message) : String(e));
  } finally {
    measuring = false;
    renders.restore();
    scheduler.dispose();
    measurePo?.disconnect();
    loafPo?.disconnect();
    shiftPo?.disconnect();
  }
  const result = snapshotResult(true, scheduler.stats.flushes, performance.now() - t0);
  publish(result);
  return result;
}

/** Placeholder result while the harness has not started (perf.spec waits for done). */
export function pendingPerfResult(params: PerfParams): HudPerfResult {
  return {
    done: false,
    progress: 0,
    params,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    crossOriginIsolated: false,
    viewport: { width: 0, height: 0 },
    flushes: 0,
    flush: EMPTY_SUMMARY,
    script: EMPTY_SUMMARY,
    scriptLayout: EMPTY_SUMMARY,
    minimap: EMPTY_SUMMARY,
    loaf: { supported: false, count: 0, maxMs: 0, maxStyleLayoutMs: 0, maxScriptMs: 0, maxBeforeRenderMs: 0 },
    layoutShifts: { supported: false, total: 0, hud: 0, value: 0, box: 0, text: 0, alerts: 0, sources: {} },
    byClass: {},
    nodes: 0,
    durationMs: 0,
    errors: [],
  };
}
