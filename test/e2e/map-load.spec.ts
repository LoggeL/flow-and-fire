import { rmSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from './support/silent-test.ts';
import type { LoadTimings } from '../../apps/game/src/loading.ts';
import { attachJson, captureErrors, expectNoErrors, MEASURED_LOCALLY, PERF_GATE, SERVERS, writeReport } from './support/game.ts';
import { installSilentOutput } from '../../apps/game/test/support/silent-output.ts';

// Map load (P3, MS2 acceptance "Laden ≤ 3 s aus dem Cache, ≤ 8 s kalt"; since the Setons package on
// the default map Setons, 1,024 WU ≈ 2.7 MB – 4.5× the MS2 map, so the MS2 limits are kept as a
// stricter check):
// - cold: a new persistent browser context on a fresh profile directory (empty HTTP cache, empty
//   Cache API – like a first visit in a normal browser window) loads the manifest, sim.bin,
//   view.json, setons.rtsmap and the models over the network, verifies them (SHA-256) and puts
//   them into the Cache API;
// - cached: a second navigation in the same context serves every asset from the Cache API (cache
//   hits > 0, no network bytes for assets; only the unhashed manifest is revalidated).
// The loading screen shows the progress (`data-loading-progress`, recorded by an init script).
// Persistent instead of Playwright's default ephemeral contexts: WebKit's ephemeral sessions (private
// browsing) drop Cache Storage on every navigation, which a normal Safari window does not.
// Times are measured every run and written to test-results/map-load-<browser>-<transport>.json; the
// millisecond limits are gated only with FAF_PERF_GATE=1 (DECISIONS 16).

const COLD_LIMIT_MS = 8000;
const CACHED_LIMIT_MS = 3000;

interface LoadRecord {
  progress: number[];
  phases: string[];
  screenSeen: boolean;
}

declare global {
  interface Window {
    __fafLoad?: LoadRecord;
  }
}

/** Init script: records every `data-loading-progress` value and loading-screen phase of the page. */
function recordLoading(): void {
  const rec: LoadRecord = { progress: [], phases: [], screenSeen: false };
  window.__fafLoad = rec;
  // At init-script time <html> may not exist yet: observe the document node itself.
  const sample = (): void => {
    const root = document.documentElement as HTMLElement | null;
    if (root === null) return;
    const v = root.dataset['loadingProgress'];
    if (v !== undefined) {
      const n = Number(v);
      if (rec.progress[rec.progress.length - 1] !== n) rec.progress.push(n);
    }
    const screen = document.querySelector('[data-testid="loading-screen"]');
    if (screen !== null) {
      rec.screenSeen = true;
      const ph = screen.getAttribute('data-phase') ?? '';
      if (rec.phases[rec.phases.length - 1] !== ph) rec.phases.push(ph);
    }
  };
  const obs = new MutationObserver(() => {
    sample();
    if (document.documentElement?.dataset['ready'] === '1') obs.disconnect();
  });
  obs.observe(document, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-loading-progress', 'data-phase', 'data-ready'] });
}

interface LoadResult {
  wallMs: number;
  timings: LoadTimings;
  record: LoadRecord;
}

async function loadOnce(page: Page, url: string): Promise<LoadResult> {
  await installSilentOutput(page);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForURL(/\/b\/[^/]+\/(\?.*)?$/);
  await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', null, { timeout: 30_000 });
  const wallMs = Date.now() - t0;
  const r = await page.evaluate(() => ({ timings: window.__faf!.loadTimings()!, record: window.__fafLoad! }));
  return { wallMs, ...r };
}

function checkProgress(rec: LoadRecord, cold: boolean): void {
  expect(rec.screenSeen, 'loading screen shown').toBe(true);
  expect(rec.progress.length, `progress values ${rec.progress.join(',')}`).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < rec.progress.length; i++) expect(rec.progress[i]!).toBeGreaterThanOrEqual(rec.progress[i - 1]!);
  expect(rec.progress[0]!).toBeLessThan(100);
  expect(rec.progress[rec.progress.length - 1]).toBe(100);
  // Between start and ready: at least one intermediate value (asset bytes 1–90 %, sim start 95 %).
  expect(rec.progress.some((p) => p > 0 && p < 100)).toBe(true);
  if (cold) expect(rec.progress.some((p) => p > 0 && p <= 90), 'asset byte progress').toBe(true);
  expect(rec.phases).toContain('assets');
  expect(rec.phases).toContain('sim');
}

for (const server of SERVERS) {
  test(`map-load: kalt ≤ 8 s, aus dem Cache ≤ 3 s, Ladebildschirm mit Fortschritt – ${server.label}`, async ({ playwright, browserName }, testInfo) => {
    const profile = testInfo.outputPath('profile');
    rmSync(profile, { recursive: true, force: true });
    let ctx: BrowserContext | undefined;
    try {
      ctx = await playwright[browserName].launchPersistentContext(profile, {
        ...(testInfo.project.use.launchOptions ?? {}),
        viewport: { width: 1280, height: 720 },
      });
      await ctx.addInitScript(recordLoading);
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const errors = captureErrors(page);

      const cold = await loadOnce(page, server.url + "?spawn=cubes");
      await page.waitForFunction(() => (window.__faf?.unitCount ?? 0) >= 1024, null, { timeout: 20_000 });
      const cached = await loadOnce(page, server.url + "?spawn=cubes");
      await page.waitForFunction(() => (window.__faf?.unitCount ?? 0) >= 1024, null, { timeout: 20_000 });

      const report = {
        browser: testInfo.project.name,
        transport: server.transport,
        crossOriginIsolated: server.coi,
        measuredLocally: MEASURED_LOCALLY,
        perfGate: PERF_GATE,
        limits: { coldMs: COLD_LIMIT_MS, cachedMs: CACHED_LIMIT_MS },
        cold: { wallMs: cold.wallMs, ...cold.timings, progress: cold.record.progress, phases: cold.record.phases },
        cached: { wallMs: cached.wallMs, ...cached.timings, progress: cached.record.progress, phases: cached.record.phases },
        criteria: {
          coldLe8s: cold.wallMs <= COLD_LIMIT_MS,
          cachedLe3s: cached.wallMs <= CACHED_LIMIT_MS,
          cachedNoNetworkBytes: cached.timings.bytesNetwork === 0,
        },
      };
      writeReport(`map-load-${testInfo.project.name}-${server.transport}`, report);
      await attachJson(testInfo, 'map-load', report);

      // Cold: everything from the network into the (empty) Cache API.
      expect(cold.timings.fromCache).toBe(0);
      expect(cold.timings.fromNetwork).toBeGreaterThanOrEqual(4);
      expect(cold.timings.bytesNetwork).toBeGreaterThan(2_600_000);
      expect(cold.timings.sources['maps/setons']).toBe('network');
      expect(cold.timings.cacheApi, 'Cache API available').toBe(true);
      // Cached: every asset is a Cache API hit, no network bytes for assets.
      expect(cached.timings.fromCache).toBeGreaterThan(0);
      expect(cached.timings.fromCache).toBe(cold.timings.fromNetwork);
      expect(cached.timings.fromNetwork).toBe(0);
      expect(cached.timings.bytesNetwork).toBe(0);
      expect(cached.timings.bytesCache).toBe(cold.timings.bytesNetwork);
      expect(Object.values(cached.timings.sources).every((s) => s === 'cache')).toBe(true);
      // Models decoded with meshopt (compressed GLB) in every engine.
      for (const m of Object.values(cold.timings.models)) expect(m.variant).toBe('meshopt');

      checkProgress(cold.record, true);
      checkProgress(cached.record, false);
      for (const t of [cold.timings, cached.timings]) {
        expect(t.navigationToReadyMs).not.toBeNull();
        expect(Number.isFinite(t.navigationToReadyMs)).toBe(true);
      }
      if (PERF_GATE) {
        expect(cold.wallMs, 'cold load ≤ 8 s').toBeLessThanOrEqual(COLD_LIMIT_MS);
        expect(cached.wallMs, 'cached load ≤ 3 s').toBeLessThanOrEqual(CACHED_LIMIT_MS);
      }
      expectNoErrors(errors);
    } finally {
      try { await ctx?.close(); }
      finally { rmSync(profile, { recursive: true, force: true }); }
    }
  });
}
