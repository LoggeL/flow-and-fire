/**
 * FX benchmark of the fx-lab (`pnpm bench:fx` → `pnpm --filter @faf/fx-lab run fxbench`; always through
 * the memory gate: `tools/heavy pnpm bench:fx [-- --quick] [--update-docs]`).
 *
 * 1. Vite build of apps/fx-lab → apps/fx-lab/dist (programmatic, no dev server).
 * 2. Chromium → Firefox → WebKit ONE AFTER ANOTHER (memory budget), launch flags as in the root
 *    playwright.config.ts; the page is served through `page.route` under a virtual cross-origin-isolated
 *    origin (COOP/COEP/CORP, fine timers) – no port is opened. Viewport 1920×1080, DPR 1.
 * 3. Per scenario a fresh page (`bench=1`: HUD off; `flight=1` where the camera should move): wait for
 *    `__fxlab.ready`, warm-up, `resetSamples()`, measure; an in-page poll (~10 Hz) records the maximum
 *    draws per segment and FX state; afterwards `__fxlab.samples()` + `stats()` → p50/p95/p99 of frame,
 *    Main-JS, FX-JS, Lab-JS, GPU total/segments (timer query where available, else "n/v"), draws,
 *    particle counts. Screenshot test-results/fx-bench/<browser>-<scenario>.png.
 * 4. Report apps/fx-lab/results/fx-<date>[-quick].json (git-ignored); `--update-docs` rewrites the block
 *    between `<!-- fx:results:begin -->` and `<!-- fx:results:end -->` in docs/status/track-renderfx.md.
 *
 * Exit code 1 ONLY on errors (GL/shader/page errors, `__fxlab.error`, scene not registered, draw budget
 * exceeded: FX draws > 6 or total > 40), never because of ms values (DECISIONS 16). Browsers are always
 * closed.
 *
 * Flags: --quick (Chromium only, 1 s warm-up + 3 s, battle/shields/big)  --update-docs
 *        --browsers=chromium,firefox,webkit  --scenarios=battle,shields,…  --seconds=8  --warmup=2
 *        --seed=1  --no-build  --headed  --wait=240 (s to wait for foreign GPU load, 0 = off)  --attempts=3
 *        --docs-only (no measurement: rewrite the doc block from results/, detail = newest full run over the most browsers)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from '@playwright/test';
import { build } from 'vite';
import type { FxLabStats } from '../src/app/hooks.ts';
import { BENCH_ORIGIN, BROWSER_NAMES, PageErrorLog, isBrowserName, launchConfig, serveDist } from './bench/browsers.ts';
import type { BrowserName } from './bench/browsers.ts';
import { concurrentLoad, gpuContention, idleContention, waitQuiet } from './bench/load.ts';
import { docBlock, evaluateRun, markdownTables, replaceDocBlock } from './bench/report.ts';
import type { BrowserReport, FxBenchReport, PagePoll, ScenarioResult } from './bench/report.ts';
import { BENCH_VIEWPORT, FX_SCENARIOS, FX_SCENARIO_NAMES, QUICK_SCENARIOS, parseFxScenario, scenarioQuery, scenarioScene } from './bench/scenarios.ts';
import type { FxScenario, FxScenarioName } from './bench/scenarios.ts';
import { fmt, fmtInt } from './bench/stats.ts';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = resolve(APP_DIR, '../..');
const DIST_DIR = resolve(APP_DIR, 'dist');
const RESULTS_DIR = resolve(APP_DIR, 'results');
const SHOTS_DIR = resolve(REPO_DIR, 'test-results/fx-bench');
const STATUS_DOC = resolve(REPO_DIR, 'docs/status/track-renderfx.md');

// pnpm may forward a literal `--` before the flags.
const argv = process.argv.slice(2).filter((a) => a !== '--');
const KNOWN = new Set(['quick', 'update-docs', 'docs-only', 'browsers', 'scenarios', 'seconds', 'warmup', 'seed', 'no-build', 'headed', 'wait', 'attempts']);
for (const a of argv) {
  const m = /^--([a-z-]+)/.exec(a);
  if (m === null || !KNOWN.has(m[1]!)) throw new Error(`bench:fx: unknown argument '${a}' (known: ${[...KNOWN].map((k) => `--${k}`).join(' ')})`);
}
const flag = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (argv.includes(`--${name}`) ? '' : undefined);
const num = (name: string, def: number): number => {
  const raw = flag(name);
  if (raw === undefined) return def;
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n) || n < 0) throw new Error(`bench:fx: --${name} needs a non-negative number, got '${raw}'`);
  return n;
};

const quick = flag('quick') !== undefined;
const updateDocs = flag('update-docs') !== undefined;
const headed = flag('headed') !== undefined;
const noBuild = flag('no-build') !== undefined;
const browserNames: BrowserName[] = (flag('browsers') ?? (quick ? 'chromium' : BROWSER_NAMES.join(',')))
  .split(',')
  .filter((s) => s.length > 0)
  .map((s) => {
    if (!isBrowserName(s)) throw new Error(`bench:fx: unknown browser '${s}' (have: ${BROWSER_NAMES.join(', ')})`);
    return s;
  });
const scenarioNames: FxScenarioName[] = (flag('scenarios') ?? (quick ? QUICK_SCENARIOS : FX_SCENARIO_NAMES).join(','))
  .split(',')
  .filter((s) => s.length > 0)
  .map((s) => {
    const n = parseFxScenario(s);
    if (n === undefined) throw new Error(`bench:fx: unknown scenario '${s}' (have: ${FX_SCENARIO_NAMES.join(', ')})`);
    return n;
  });
const measureS = num('seconds', quick ? 3 : 8);
const warmupS = num('warmup', quick ? 1 : 2);
const seed = Math.floor(num('seed', 1));
/** Full runs wait for foreign GPU load (other agents' Playwright runs, MLX jobs) and repeat contended scenarios. */
const waitMaxS = num('wait', quick ? 0 : 240);
const maxAttempts = quick ? 1 : Math.max(1, Math.floor(num('attempts', 3)));
if (measureS <= 0) throw new Error('bench:fx: --seconds must be > 0');

const log = (s: string): void => {
  process.stdout.write(s + '\n');
};

/** In-page stats poll (runs inside the browser): maximum draws per segment and FX state every ~100 ms. */
function installPoll(page: Page): Promise<void> {
  return page.evaluate(() => {
    const segs = ['shadow', 'opaque', 'shields', 'particles', 'beams', 'post'] as const;
    const acc: PagePoll = {
      polls: 0,
      segMax: { shadow: 0, opaque: 0, shields: 0, particles: 0, beams: 0, post: 0 },
      fxDrawsMax: 0,
      aliveMax: 0,
      windowMax: 0,
      decalOverflowMax: 0,
      beamsMax: 0,
      trailsMax: 0,
      shieldsMax: 0,
      ripplesMax: 0,
      shakePolls: 0,
    };
    const w = window as unknown as { __fxbenchPoll?: PagePoll; __fxbenchTimer?: number };
    w.__fxbenchPoll = acc;
    w.__fxbenchTimer = window.setInterval(() => {
      const h = window.__fxlab;
      if (h === undefined || h.error !== null) return;
      const s = h.stats();
      acc.polls++;
      for (const k of segs) acc.segMax[k] = Math.max(acc.segMax[k], s.drawsBySeg[k]);
      acc.fxDrawsMax = Math.max(acc.fxDrawsMax, s.drawsBySeg.shields + s.drawsBySeg.particles + s.drawsBySeg.beams);
      acc.aliveMax = Math.max(acc.aliveMax, s.fx.particles?.alive ?? 0);
      acc.windowMax = Math.max(acc.windowMax, s.fx.particles?.window ?? 0);
      acc.decalOverflowMax = Math.max(acc.decalOverflowMax, s.decals.chunkOverflow);
      acc.beamsMax = Math.max(acc.beamsMax, s.fx.beams);
      acc.trailsMax = Math.max(acc.trailsMax, s.fx.trails);
      acc.shieldsMax = Math.max(acc.shieldsMax, s.fx.shields?.count ?? 0);
      acc.ripplesMax = Math.max(acc.ripplesMax, s.fx.shields?.ripplesActive ?? 0);
      if (s.shakeActive) acc.shakePolls++;
    }, 100);
  });
}

/** Unmasked GPU renderer string of the browser (separate throw-away context). */
function gpuRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return 'kein WebGL2';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const r = dbg !== null ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return r;
  });
}

async function sleepWithTriggers(page: Page, seconds: number, s: FxScenario, clock: { lastTrigger: number }): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const now = Date.now();
    if (s.triggerEveryS > 0 && now - clock.lastTrigger >= s.triggerEveryS * 1000) {
      clock.lastTrigger = now;
      await page.evaluate(() => window.__fxlab!.triggerBigExplosion());
    }
    const next = s.triggerEveryS > 0 ? Math.min(end, clock.lastTrigger + s.triggerEveryS * 1000) : end;
    await page.waitForTimeout(Math.max(10, Math.min(1000, next - Date.now())));
  }
}

interface Attempt {
  result: ScenarioResult;
}

async function runScenario(browser: Browser, browserName: BrowserName, name: FxScenarioName): Promise<Attempt> {
  const s = FX_SCENARIOS[name];
  // Before the page exists the benchmark renders nothing: a busy GPU now is foreign load.
  const before = await idleContention();
  const context = await browser.newContext({ viewport: { width: BENCH_VIEWPORT.width, height: BENCH_VIEWPORT.height }, deviceScaleFactor: BENCH_VIEWPORT.dpr });
  const seen = new Set<string>(before);
  const probe = setInterval(() => {
    for (const c of gpuContention()) seen.add(c);
  }, 1000);
  try {
    const page = await context.newPage();
    const errs = new PageErrorLog().attach(page);
    await serveDist(page, DIST_DIR, BENCH_ORIGIN);
    // Fresh pages start at about:blank: read the renderer there with a throw-away context.
    const renderer = await gpuRenderer(page).catch(() => 'unbekannt');
    await page.goto(`${BENCH_ORIGIN}/index.html?${scenarioQuery(s, seed)}`);
    await page.waitForFunction(() => window.__fxlab !== undefined && (window.__fxlab.ready || window.__fxlab.error !== null), undefined, { timeout: 120_000 });
    const head = await page.evaluate(() => ({ scene: window.__fxlab!.scene as string, error: window.__fxlab!.error, coi: window.crossOriginIsolated }));
    process.stdout.write(`  ${browserName} ${name}: ${fmt(warmupS, 0)} s warm-up + ${fmt(measureS, 0)} s … `);
    const trig = { lastTrigger: 0 };
    if (head.error === null) {
      await sleepWithTriggers(page, warmupS, s, trig);
      await page.evaluate(() => window.__fxlab!.resetSamples());
    }
    const statsStart = await page.evaluate(() => window.__fxlab!.stats());
    await installPoll(page);
    if (head.error === null) await sleepWithTriggers(page, measureS, s, trig);
    const end = await page.evaluate(() => {
      const w = window as unknown as { __fxbenchPoll?: PagePoll; __fxbenchTimer?: number };
      window.clearInterval(w.__fxbenchTimer);
      const h = window.__fxlab!;
      return { samples: h.samples(), stats: h.stats() as FxLabStats, poll: w.__fxbenchPoll!, error: h.error, scene: h.scene as string };
    });
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: resolve(SHOTS_DIR, `${browserName}-${name}.png`) });
    const result = evaluateRun({
      scenario: name,
      requestedScene: scenarioScene(s),
      scene: end.scene,
      hookError: end.error,
      samples: end.samples,
      statsStart,
      statsEnd: end.stats,
      poll: end.poll,
      pageErrors: errs.errors,
      warnings: errs.warnings,
      contention: [...seen],
      gpuRenderer: renderer,
      crossOriginIsolated: head.coi,
    });
    const p = result.particles;
    process.stdout.write(
      `${result.ok ? 'ok' : 'ERROR'} | ${result.frames} frames ${fmt(result.fps, 1)} fps | draws max ${result.totalDrawsMax} (fx ${result.fxDrawsMax}) | ` +
        `main p95 ${fmt(result.mainJsMs.p95)} ms | fx p95 ${fmt(result.fxJsMs.p95)} ms | gpu p50 ${result.gpuMs === null ? 'n/v' : fmt(result.gpuMs.p50) + ' ms'} | ` +
        `particles ${p === null ? '–' : `${fmtInt(p.aliveP50)}/${fmtInt(p.cap)} dropped ${p.droppedRun.join('/')}`}${result.contention.length > 0 ? ' | CONTENDED' : ''}\n`,
    );
    for (const e of result.errors) log(`    ! ${e}`);
    return { result };
  } finally {
    clearInterval(probe);
    await context.close();
  }
}

async function runBrowser(name: BrowserName): Promise<BrowserReport> {
  const { type, options } = launchConfig(name, REPO_DIR, { headed, measure: true });
  const results: ScenarioResult[] = [];
  const errors: string[] = [];
  let browser: Browser | null = null;
  let version = '';
  try {
    browser = await type.launch(options);
    version = browser.version();
    log(`bench:fx: ${name} ${version}`);
    for (const scenario of scenarioNames) {
      try {
        let attempt: Attempt | null = null;
        for (let k = 0; k < maxAttempts; k++) {
          if (waitMaxS > 0) {
            const still = await waitQuiet(waitMaxS, log);
            if (still.length > 0) log(`    (still loaded after ${waitMaxS} s: ${still[0]} – measuring anyway, marked as contended)`);
          }
          attempt = await runScenario(browser, name, scenario);
          if (attempt.result.contention.length === 0 || !attempt.result.ok) break;
          if (k + 1 < maxAttempts) log('    (foreign GPU load during the run – repeating)');
        }
        results.push(attempt!.result);
      } catch (e) {
        const msg = e instanceof Error ? e.message.split('\n')[0]! : String(e);
        errors.push(`${scenario}: ${msg}`);
        log(`\n  ${name} ${scenario}: FAILED ${msg}`);
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message.split('\n')[0]! : String(e));
    log(`  ${name}: FAILED ${errors[errors.length - 1]}`);
  } finally {
    if (browser !== null) await browser.close();
  }
  return { browser: name, version, results, errors };
}

function loadReports(): FxBenchReport[] {
  if (!existsSync(RESULTS_DIR)) return [];
  const out: FxBenchReport[] = [];
  for (const f of readdirSync(RESULTS_DIR).filter((n) => /^fx-.*\.json$/.test(n)).sort()) {
    try {
      out.push(JSON.parse(readFileSync(resolve(RESULTS_DIR, f), 'utf8')) as FxBenchReport);
    } catch {
      log(`bench:fx: skipping unreadable report ${f}`);
    }
  }
  return out;
}

/** Local date + time for the report name (several runs per day are kept for the value ranges). */
function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** `--docs-only`: rewrites the doc block from the reports in results/ (newest full run in detail). */
function docsOnly(): number {
  const all = loadReports();
  const full = all.filter((r) => r.mode === 'full');
  // Detail table: the newest full run over the most browsers (partial runs only feed the ranges).
  const widest = Math.max(0, ...full.map((r) => r.browsers.length));
  const last = full.filter((r) => r.browsers.length === widest).pop() ?? all[all.length - 1];
  if (last === undefined) throw new Error('bench:fx --docs-only: no report in apps/fx-lab/results');
  const text = existsSync(STATUS_DOC) ? readFileSync(STATUS_DOC, 'utf8') : '# TRACK-RENDERFX\n';
  writeFileSync(STATUS_DOC, replaceDocBlock(text, docBlock(last, all)));
  log(`bench:fx: docs rewritten from ${all.length} report(s): ${STATUS_DOC}`);
  return 0;
}

async function main(): Promise<number> {
  if (flag('docs-only') !== undefined) return docsOnly();
  if (!noBuild) {
    log('bench:fx: vite build → apps/fx-lab/dist');
    await build({ configFile: resolve(APP_DIR, 'vite.config.ts'), logLevel: 'warn' });
  }
  if (!existsSync(resolve(DIST_DIR, 'index.html'))) throw new Error('apps/fx-lab/dist/index.html missing (build failed?)');
  log(`bench:fx: ${quick ? 'quick' : 'full'} | browsers ${browserNames.join(', ')} | scenarios ${scenarioNames.join(', ')} | ${warmupS} s + ${measureS} s`);
  const before = loadavg();
  const concurrent = concurrentLoad();
  if (concurrent.length > 0) log(`bench:fx: concurrent load detected:\n  ${concurrent.join('\n  ')}`);
  const browsers: BrowserReport[] = [];
  for (const name of browserNames) {
    browsers.push(await runBrowser(name));
    for (const c of concurrentLoad()) if (!concurrent.includes(c)) concurrent.push(c);
  }
  const failed = browsers.some((b) => b.errors.length > 0 || b.results.some((r) => !r.ok));
  const exitCode = failed ? 1 : 0;
  const c0 = cpus()[0];
  const report: FxBenchReport = {
    date: new Date().toISOString(),
    mode: quick ? 'quick' : 'full',
    machine: {
      platform: `${platform()} ${arch()}`,
      arch: arch(),
      cpus: `${cpus().length}× ${c0?.model ?? '?'}`,
      memGB: Math.round(totalmem() / 2 ** 30),
      note: 'lokal gemessen (Apple M5 Pro, Playwright headless), kein Iris Xe/echtes Safari',
    },
    options: { warmupS, measureS, viewport: `${BENCH_VIEWPORT.width}×${BENCH_VIEWPORT.height} @${BENCH_VIEWPORT.dpr}x`, seed },
    load: { before, after: loadavg(), concurrent },
    browsers,
    exitCode,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = resolve(RESULTS_DIR, `fx-${stamp()}${quick ? '-quick' : ''}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  log(`bench:fx: report ${file}`);
  log(markdownTables(report));
  if (updateDocs) {
    const text = existsSync(STATUS_DOC) ? readFileSync(STATUS_DOC, 'utf8') : '# TRACK-RENDERFX\n';
    writeFileSync(STATUS_DOC, replaceDocBlock(text, docBlock(report, loadReports())));
    log(`bench:fx: docs updated: ${STATUS_DOC}`);
  }
  if (failed) console.error('bench:fx: FAILED (errors above)');
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
