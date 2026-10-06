/**
 * Browser benchmark of the full HUD (hud-p5-root, ui.md §9.3; DECISIONS 5/16: measured locally, a
 * measurement is not a gate). Runs only with FAF_HUD_PERF=1 (playwright.config.ts) in chromium, firefox and
 * webkit: opens #/perf?units=500&ticks=600&speed=1, waits for window.__HUD_PERF__.done and writes
 * apps/hud-gallery/results/hud-perf-<browser>.json.
 * Hard gates (always): DOM nodes under [data-hud-root] ≤ 700 and no layout shift caused by the HUD (ui.md §9.3
 * „Layout-Shift-Observer ohne Einträge durch das HUD“): neither panels (ui.md §4.4) nor content inside them
 * (values keep a constant width, padFigures). The only exception is the alert feed re-ordering when a new
 * alert arrives (an event by design, DECISIONS HUD-7); it is reported separately.
 * Time gates only with FAF_PERF_GATE=1, Chromium: p95 script ≤ 1.0 ms, p95 script + style/layout ≤ 1.5 ms
 * (the minimap's ≤ 0.5 ms is reported, not gated). The gate run repeats once after a failure (retries in
 * playwright.config.ts); every attempt prints the machine load average, which is also written to the JSON.
 * Query overrides: FAF_HUD_PERF_QUERY="units=500&ticks=600&speed=1".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { HudPerfResult } from '../src/perf/harness.ts';
import { APP_DIR } from './support/env.ts';
import { attachErrorCollector } from './support/layout-check.ts';

const QUERY = process.env['FAF_HUD_PERF_QUERY'] || 'units=500&ticks=600&speed=1';
const GATE = process.env['FAF_PERF_GATE'] === '1';
const RESULTS = join(APP_DIR, 'results');

test.describe.configure({ timeout: 300_000 });

test('grp=perf hud perf-500', async ({ page, browserName }) => {
  const pageErrors = attachErrorCollector(page);
  // Cross-origin isolation (COOP/COEP) for fine performance.now() resolution: without it Firefox and WebKit
  // clamp timers to 1 ms, which is coarser than the budget. All assets are same-origin, so require-corp holds.
  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' },
    });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/#/perf?${QUERY}`);
  await page.waitForFunction(() => window.__HUD_PERF__?.done === true, null, { timeout: 280_000, polling: 500 });
  const r = (await page.evaluate(() => window.__HUD_PERF__)) as HudPerfResult;
  mkdirSync(RESULTS, { recursive: true });
  const out = {
    browser: browserName,
    date: new Date().toISOString(),
    note: 'lokal gemessen (Apple M5 Pro), kein Referenz-Laptop; Messung ≠ Gate (DECISIONS 16)',
    gate: GATE,
    attempt: test.info().retry,
    loadAvg: loadavg().map((x) => Math.round(x * 100) / 100),
    ...r,
  };
  writeFileSync(join(RESULTS, `hud-perf-${browserName}.json`), `${JSON.stringify(out, null, 2)}\n`);
  const line = (name: string, s: HudPerfResult['script']): string =>
    `${name.padEnd(13)} p50 ${s.p50.toFixed(3)} · p95 ${s.p95.toFixed(3)} · p99 ${s.p99.toFixed(3)} · max ${s.max.toFixed(3)} ms (n=${s.n})`;
  console.log(
    [
      `[hud-perf] ${browserName}: ${r.params.units} Einheiten, ${r.params.ticks} Ticks ×${r.params.speed}, ${r.nodes} Knoten, ${Math.round(r.durationMs)} ms, isoliert ${r.crossOriginIsolated}, Versuch ${out.attempt + 1}, Load ${out.loadAvg.join(' / ')}`,
      line('flush', r.flush),
      line('script', r.script),
      line('script+layout', r.scriptLayout),
      line('minimap', r.minimap),
      `LoAF ${r.loaf.supported ? `${r.loaf.count} (max ${r.loaf.maxMs.toFixed(1)} ms)` : 'n/a'} · layout shifts ${
        r.layoutShifts.supported
          ? `${r.layoutShifts.hud} HUD / ${r.layoutShifts.total} (panels ${r.layoutShifts.box}, content ${r.layoutShifts.text}, alerts ${r.layoutShifts.alerts})`
          : 'n/a'
      }`,
    ].join('\n  '),
  );
  test.info().annotations.push({ type: 'hud-perf', description: `script p95 ${r.script.p95} ms, script+layout p95 ${r.scriptLayout.p95} ms, nodes ${r.nodes}` });

  expect([...pageErrors, ...r.errors], 'errors').toEqual([]);
  expect(r.script.n, 'measured flushes').toBeGreaterThanOrEqual(Math.floor(r.params.ticks * 0.95));
  expect(r.nodes, 'DOM nodes under [data-hud-root]').toBeLessThanOrEqual(700);
  if (r.layoutShifts.supported) {
    expect(r.layoutShifts.box, 'layout shifts of HUD panels').toBe(0);
    expect(r.layoutShifts.hud - r.layoutShifts.alerts, `HUD layout shifts outside the alert feed: ${JSON.stringify(r.layoutShifts.sources)}`).toBe(0);
  }
  if (GATE && browserName === 'chromium') {
    expect(r.script.p95, 'p95 script per flush (ms)').toBeLessThanOrEqual(1.0);
    expect(r.scriptLayout.p95, 'p95 script + style/layout per flush (ms)').toBeLessThanOrEqual(1.5);
  }
});
