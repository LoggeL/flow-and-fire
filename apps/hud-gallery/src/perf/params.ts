/**
 * Perf route of the gallery (hud-p5-root): `#/perf?units=500&ticks=600&speed=1` is an alias of the story
 * `hud--perf-500` in measurement mode. The router (src/app) stays untouched: this module rewrites the hash
 * before the app reads it (imported by hud.stories.tsx, which the registry loads eagerly).
 */
export const PERF_STORY_ID = 'hud--perf-500';

export interface PerfParams {
  /** Measurement mode (set by the #/perf alias or perf=1). */
  readonly perf: boolean;
  /** Own units on the minimap and in the match counter. */
  readonly units: number;
  /** Measured sim ticks (each flushed in its own animation frame). */
  readonly ticks: number;
  /** Warm-up ticks before measuring. */
  readonly warmup: number;
  /** Sim speed factor (the simulated wall clock advances 100 ms / speed per tick). */
  readonly speed: number;
}

function num(q: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = q.get(key);
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Parses the perf parameters from a hash query ("…?units=500&ticks=600&speed=1"). */
export function parsePerfParams(hash: string): PerfParams {
  const i = hash.indexOf('?');
  const q = new URLSearchParams(i < 0 ? '' : hash.slice(i + 1));
  return {
    perf: q.get('perf') === '1',
    units: Math.round(num(q, 'units', 500, 1, 5000)),
    ticks: Math.round(num(q, 'ticks', 600, 10, 100000)),
    warmup: Math.round(num(q, 'warmup', 60, 0, 10000)),
    speed: num(q, 'speed', 1, 0.25, 10),
  };
}

/** `#/perf?…` → `#/story/hud--perf-500?…&perf=1&shot=1`; null for other hashes. */
export function perfAliasHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const qi = h.indexOf('?');
  const path = qi < 0 ? h : h.slice(0, qi);
  if (path !== '/perf' && path !== '/perf/') return null;
  const q = new URLSearchParams(qi < 0 ? '' : h.slice(qi + 1));
  q.set('perf', '1');
  if (!q.has('shot')) q.set('shot', '1');
  return `#/story/${PERF_STORY_ID}?${q.toString()}`;
}

let installed = false;

/** Rewrites `#/perf` to the perf story (at import and on every hash change); no-op outside a browser. */
export function installPerfRoute(): void {
  if (installed || typeof window === 'undefined' || typeof location === 'undefined' || typeof history === 'undefined') return;
  installed = true;
  const apply = (): void => {
    const next = perfAliasHash(location.hash);
    if (next !== null) history.replaceState(history.state, '', next);
  };
  apply();
  // Registered before the app's own listener (this module is imported first), so the router sees the rewrite.
  window.addEventListener('hashchange', apply);
}
