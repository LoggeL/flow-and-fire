/**
 * SPK4 render-load benchmark (`pnpm --filter @faf/render-bench spk4`, root: `pnpm bench:spk4`).
 *
 * 1. Vite build of the benchmark page into tools/render-bench/dist (programmatic, no dev server).
 * 2. Chromium → Firefox → WebKit ONE AFTER ANOTHER (memory budget), launch flags as in the root
 *    playwright.config.ts (Firefox with CFFIXED_USER_HOME). The page is served through `page.route`
 *    under the virtual origin https://faf-render-bench.test with COOP/COEP/CORP (cross-origin
 *    isolated ⇒ fine timers) – no port is opened.
 * 3. Per scenario a fresh page: 2 s warm-up + 10 s measured camera flight; per frame draws, Main-JS,
 *    GPU time (EXT_disjoint_timer_query_webgl2 where exposed) and the frame interval; p50/p95/p99.
 * 4. Report tools/render-bench/results/spk4-<date>[-quick].json (git-ignored), screenshots under
 *    test-results/spk4/; `--update-docs` rewrites the tables in docs/status/ms2-p5-spk4.md.
 *
 * Exit code 1 only on errors (shader/GL/console/page errors, draw budget exceeded), never because of
 * ms values (DECISIONS 16). Browsers are always closed.
 *
 * Flags: --quick (Chromium only, 1 s warm-up + 3 s, scenarios ms2 + full)  --update-docs
 *        --browsers=chromium,firefox,webkit  --scenarios=ms2,full,fallback  --seconds=10  --warmup=2
 *        --no-build  --headed  --wait=240 (s to wait for foreign GPU load, 0 = off)  --attempts=3
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import type { Browser, BrowserType, LaunchOptions, Page } from '@playwright/test';
import { build } from 'vite';
import type { BrowserReport, RunOptions, ScenarioResult, Spk4Report } from '../src/report.ts';
import { SCENARIO_NAMES, SPK4_GPU_MS, SPK4_MAIN_JS_MS, VIEWPORT, parseScenario } from '../src/scenarios.ts';
import type { ScenarioName } from '../src/scenarios.ts';
import { fmt, fmtRange } from '../src/stats.ts';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = resolve(PKG_DIR, '../..');
const DIST_DIR = resolve(PKG_DIR, 'dist');
const RESULTS_DIR = resolve(PKG_DIR, 'results');
const SHOTS_DIR = resolve(REPO_DIR, 'test-results/spk4');
const STATUS_DOC = resolve(REPO_DIR, 'docs/status/ms2-p5-spk4.md');
const ORIGIN = 'https://faf-render-bench.test';
export const DOC_BEGIN = '<!-- spk4:results:begin -->';
export const DOC_END = '<!-- spk4:results:end -->';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (argv.includes(`--${name}`) ? '' : undefined);
const quick = flag('quick') !== undefined;
const updateDocs = flag('update-docs') !== undefined;
const headed = flag('headed') !== undefined;
const noBuild = flag('no-build') !== undefined;
const browserNames = (flag('browsers') ?? (quick ? 'chromium' : 'chromium,firefox,webkit')).split(',').filter((s) => s.length > 0);
const scenarioNames: ScenarioName[] = (flag('scenarios') ?? (quick ? 'ms2,full' : SCENARIO_NAMES.join(',')))
  .split(',')
  .map((s) => {
    const n = parseScenario(s);
    if (n === undefined) throw new Error(`unknown scenario '${s}'`);
    return n;
  });
const measureS = Number(flag('seconds') ?? (quick ? 3 : 10));
const warmupS = Number(flag('warmup') ?? (quick ? 1 : 2));
/** Full runs wait for foreign GPU load (MLX jobs, parallel E2E) and repeat contended scenarios. */
const waitMaxS = Number(flag('wait') ?? (quick ? 0 : 240));
const maxAttempts = quick ? 1 : Math.max(1, Number(flag('attempts') ?? 3));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.rtsmap': 'application/octet-stream',
};

/** Console warnings that are real GL errors (everything else from WebGL is an implementation note). */
const GL_ERROR_RE = /GL_INVALID|INVALID_(OPERATION|ENUM|VALUE|FRAMEBUFFER_OPERATION)|OUT_OF_MEMORY|CONTEXT_LOST|compile|link(ing)? (failed|error)|shader.*error|error.*shader/i;

const COI_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

/** See root playwright.config.ts: macOS denies Firefox its default profile folder. */
function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(REPO_DIR, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

function launchConfig(name: string): { type: BrowserType; options: LaunchOptions } {
  switch (name) {
    case 'chromium':
      return { type: chromium, options: { headless: !headed, args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };
    case 'firefox': {
      const env = firefoxEnv();
      return {
        type: firefox,
        options: {
          headless: !headed,
          ...(env !== undefined ? { env } : {}),
          // As playwright.config.ts; privileged extensions additionally expose the GPU timer query (measurement only).
          firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false, 'webgl.enable-privileged-extensions': true },
        },
      };
    }
    case 'webkit':
      return { type: webkit, options: { headless: !headed } };
    default:
      throw new Error(`unknown browser '${name}'`);
  }
}

async function servePage(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(DIST_DIR, '.' + rel);
    if (!(file === DIST_DIR || file.startsWith(DIST_DIR + sep)) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: 'not found', headers: COI_HEADERS });
      return;
    }
    await route.fulfill({ status: 200, body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream', headers: COI_HEADERS });
  });
}

/** Other processes that load the machine (parallel E2E, dev servers, GPU jobs) – noted in the report. */
function concurrentLoad(): string[] {
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,pcpu=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const own = String(process.pid);
    const hits: string[] = [];
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
      if (m === null) continue;
      const [, pid, cpu, cmd] = m as unknown as [string, string, string, string];
      if (pid === own || cmd.includes('spk4')) continue;
      if (/playwright|vite|test:e2e|mlx|ms-playwright|vitest|tsc -b/i.test(cmd) && Number(cpu) >= 1) {
        hits.push(`${cpu}% ${cmd.slice(0, 120)}`);
      }
    }
    return hits;
  } catch {
    return [];
  }
}

/**
 * Foreign GPU/browser load that falsifies GPU timings (the user's MLX jobs, a parallel Playwright E2E
 * run of another package, vitest). Detection only – nothing is stopped or locked.
 */
const GPU_LOAD_RE = /h3mlx|mlx_lm|\bmlx\b|tools\/gpurun|playwright test|@playwright\/test\/cli\.js test|vitest/i;

function gpuContention(): string[] {
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const hits: string[] = [];
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (m === null || m[1] === String(process.pid)) continue;
      const cmd = m[2]!;
      if (cmd.includes('spk4') || cmd.startsWith('ps ')) continue;
      if (GPU_LOAD_RE.test(cmd)) hits.push(cmd.slice(0, 100));
    }
    return hits;
  } catch {
    return [];
  }
}

/** Waits (polling) until no foreign GPU load is visible, at most `maxS` seconds. Returns the wait in s. */
async function waitQuiet(maxS: number): Promise<number> {
  const t0 = Date.now();
  let announced = false;
  while ((Date.now() - t0) / 1000 < maxS) {
    const busy = gpuContention();
    if (busy.length === 0) return (Date.now() - t0) / 1000;
    if (!announced) {
      process.stdout.write(`  (waiting for foreign GPU load to finish: ${busy[0]} …)\n`);
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return (Date.now() - t0) / 1000;
}

interface Attempt {
  result: ScenarioResult;
  contention: string[];
}

async function runScenario(browser: Browser, name: string, scenario: ScenarioName, warnings: string[]): Promise<Attempt> {
  const context = await browser.newContext({ viewport: { width: VIEWPORT.width, height: VIEWPORT.height }, deviceScaleFactor: VIEWPORT.dpr });
  const seen = new Set<string>();
  const probe = setInterval(() => {
    for (const c of gpuContention()) seen.add(c);
  }, 1000);
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      const t = msg.type();
      const text = msg.text();
      if (t === 'error' || (t === 'warning' && GL_ERROR_RE.test(text))) pageErrors.push(`console.${t}: ${text.slice(0, 400)}`);
      else if (t === 'warning' && /WebGL/i.test(text)) {
        const w = `${scenario}: ${text.slice(0, 300)}`;
        if (!warnings.includes(w)) warnings.push(w);
      }
    });
    await servePage(page);
    await page.goto(`${ORIGIN}/index.html`);
    await page.waitForFunction(() => window.__spk4 !== undefined && (window.__spk4.ready || window.__spk4.error !== null), undefined, { timeout: 60_000 });
    const loadError = await page.evaluate(() => window.__spk4?.error ?? null);
    if (loadError !== null) throw new Error(`page load: ${loadError}`);
    const opts: RunOptions = { scenario, warmupS, measureS };
    process.stdout.write(`  ${name} ${scenario}: ${warmupS} s warm-up + ${measureS} s flight … `);
    const r = await page.evaluate((o) => window.__spk4!.run(o), opts);
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: resolve(SHOTS_DIR, `${name}-${scenario}.png`) });
    const contention = [...seen];
    const result: ScenarioResult = { ...r, errors: [...r.errors, ...pageErrors], ok: r.ok && pageErrors.length === 0, contention };
    process.stdout.write(
      `${result.ok ? 'ok' : 'ERROR'} | draws max ${result.draws.max} | js p95 ${fmt(result.mainJsMs.p95)} ms | gpu p95 ${result.gpuMs === null ? 'n/a' : fmt(result.gpuMs.p95) + ' ms'} | ${fmt(result.fps, 1)} fps${contention.length > 0 ? ' | CONTENDED' : ''}\n`,
    );
    for (const e of result.errors) process.stdout.write(`    ! ${e}\n`);
    return { result, contention };
  } finally {
    clearInterval(probe);
    await context.close();
  }
}

async function runBrowser(name: string): Promise<BrowserReport> {
  const { type, options } = launchConfig(name);
  const results: ScenarioResult[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let browser: Browser | null = null;
  let version = '';
  try {
    browser = await type.launch(options);
    version = browser.version();
    for (const scenario of scenarioNames) {
      try {
        let attempt: Attempt | null = null;
        for (let k = 0; k < maxAttempts; k++) {
          if (waitMaxS > 0) await waitQuiet(waitMaxS);
          attempt = await runScenario(browser, name, scenario, warnings);
          if (attempt.contention.length === 0 || !attempt.result.ok) break;
          if (k + 1 < maxAttempts) process.stdout.write(`    (foreign GPU load during the run – repeating)\n`);
        }
        results.push({ ...attempt!.result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${scenario}: ${msg}`);
        process.stdout.write(`\n  ${name} ${scenario}: FAILED ${msg}\n`);
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    if (browser !== null) await browser.close();
  }
  return { browser: name, version, results, errors, warnings };
}

// ---------------------------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------------------------

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 300);
}

function verdict(ok: boolean | null): string {
  return ok === null ? 'n/a' : ok ? '✅' : '❌';
}

export function markdownTables(report: Spk4Report): string {
  const lines: string[] = [];
  lines.push(`Lauf ${report.date} (${report.mode === 'quick' ? 'quick' : 'voll'}), ${report.machine.note}; Viewport ${VIEWPORT.width}×${VIEWPORT.height}, DPR ${VIEWPORT.dpr}, Backbuffer 1536×864 (Render-Scale 0,8).`);
  lines.push(`Last: loadavg vorher ${report.load.before.map((v) => fmt(v, 1)).join('/')}, nachher ${report.load.after.map((v) => fmt(v, 1)).join('/')}; parallel: ${report.load.concurrent.length === 0 ? 'nichts Auffälliges' : report.load.concurrent.length + ' Prozess(e) – ' + report.load.concurrent.slice(0, 4).map((s) => '`' + s.replace(/`/g, "'").slice(0, 70) + '`').join(', ')}.`);
  lines.push('');
  lines.push('| Browser | Szenario | Frames / FPS | Draws p50 / max (Grenze) | Main-JS p50 / p95 / p99 | GPU p50 / p95 / p99 | Frame-Intervall p95 | Units sichtbar p50 | Props (Mesh/Impostor) p50 | Schatten-Refresh | Fremdlast | Draws | JS ≤ 5 | GPU ≤ 12 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of report.browsers) {
    for (const r of b.results) {
      const gpu = r.gpuMs;
      const gpuTxt = gpu === null || gpu.n === 0 ? 'n/a' : `${fmt(gpu.p50)} / ${fmt(gpu.p95)} / ${fmt(gpu.p99)} ms`;
      const coarse = r.clockResolutionMs >= 0.1;
      const jsOk = (coarse ? r.mainJsMs.mean : r.mainJsMs.p95) <= SPK4_MAIN_JS_MS;
      const jsTxt = coarse
        ? `Ø ${fmt(r.mainJsMs.mean)} ms (Takt ${fmt(r.clockResolutionMs, 1)} ms, p95 ${fmt(r.mainJsMs.p95)})`
        : `${fmt(r.mainJsMs.p50)} / ${fmt(r.mainJsMs.p95)} / ${fmt(r.mainJsMs.p99)} ms`;
      const gpuOk = gpu === null || gpu.n === 0 ? null : gpu.p95 <= SPK4_GPU_MS;
      lines.push(
        `| ${b.browser} ${b.version} | ${r.scenario} | ${r.frames} / ${fmt(r.fps, 1)} | ${r.draws.p50} / ${r.draws.max} (${r.drawBudget.limit}) | ${jsTxt} | ${gpuTxt} | ${fmt(r.frameMs.p95, 1)} ms | ${r.unitInstances.p50} | ${r.propInstances.p50} / ${r.impostorInstances.p50} | ${r.shadowRefreshes} | ${r.contention !== undefined && r.contention.length > 0 ? '⚠️ ' + oneLine(r.contention[0]!).slice(0, 40) : 'keine'} | ${verdict(r.drawBudget.framesOver === 0)} | ${verdict(jsOk)} | ${verdict(gpuOk)} |`,
      );
    }
    for (const e of b.errors) lines.push(`| ${b.browser} | – | Fehler: ${oneLine(e)} | | | | | | | | | | | |`);
  }
  lines.push('');
  lines.push('Draws je Pass (Maximum im Flug):');
  lines.push('');
  lines.push('| Browser | Szenario | Schatten statisch | Schatten Units | Terrain | Props | Units | Blob | Impostor | Wasser | Post | Overlay |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of report.browsers) {
    for (const r of b.results) {
      const p = r.drawsByPassMax;
      lines.push(`| ${b.browser} | ${r.scenario} | ${p.shadowStatic} | ${p.shadowUnits} | ${p.terrain} | ${p.props} | ${p.units} | ${p.blob} | ${p.impostors} | ${p.water} | ${p.post} | ${p.overlay} |`);
    }
  }
  lines.push('');
  const seg = report.browsers.flatMap((b) => b.results.filter((r) => r.gpuSegmentsMs !== null).map((r) => ({ b, r })));
  if (seg.length > 0) {
    lines.push('GPU-Zeit je Abschnitt (Timer-Query, p50 / p95):');
    lines.push('');
    lines.push('| Browser | Szenario | Uploads + Schatten | Szene (Terrain, Props, Units, Wasser …) | Post (Bloom, ACES, FXAA) |');
    lines.push('|---|---|---|---|---|');
    for (const { b, r } of seg) {
      const s = r.gpuSegmentsMs!;
      const cell = (k: number): string => (s[k] === undefined || s[k]!.n === 0 ? 'n/a' : `${fmt(s[k]!.p50)} / ${fmt(s[k]!.p95)} ms`);
      lines.push(`| ${b.browser} | ${r.scenario} | ${cell(0)} | ${cell(1)} | ${cell(2)} |`);
    }
    lines.push('');
  }
  const gpus = new Set<string>();
  for (const b of report.browsers) for (const r of b.results) gpus.add(`${b.browser}: ${r.gpuRenderer} (Timer-Query ${r.caps.timerQuery ? 'ja' : 'nein'}, EXT_color_buffer_float ${r.caps.colorBufferFloat ? 'ja' : 'nein'}, COI ${r.caps.crossOriginIsolated ? 'ja' : 'nein'})`);
  lines.push(`GPU/Treiber: ${[...gpus].join('; ')}.`);
  const warns = report.browsers.flatMap((b) => b.warnings.map((w) => `${b.browser}: ${oneLine(w)}`));
  if (warns.length > 0) {
    lines.push('');
    lines.push('Browser-Hinweise (Warnungen, keine Fehler):');
    lines.push('');
    for (const w of warns) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}

/** Value ranges over every full run in results/ (DECISIONS 16: ranges instead of single values). */
export function rangeTables(reports: readonly Spk4Report[]): string {
  const full = reports.filter((r) => r.mode === 'full');
  if (full.length === 0) return '';
  const keys = new Map<string, ScenarioResult[]>();
  for (const rep of full) for (const b of rep.browsers) for (const r of b.results) {
    const k = `${b.browser}|${r.scenario}`;
    const list = keys.get(k) ?? [];
    list.push(r);
    keys.set(k, list);
  }
  const lines: string[] = [];
  lines.push(`Wertebereiche über ${full.length} Volllauf/Volläufe (${full[0]!.date.slice(0, 10)} … ${full[full.length - 1]!.date.slice(0, 10)}); GPU-Werte nur aus Läufen ohne Fremdlast:`);
  lines.push('');
  lines.push('| Browser | Szenario | Läufe (ohne Fremdlast) | Draws max | Main-JS p95 (WebKit: Ø) | GPU p50 | GPU p95 | FPS | Frame-Intervall p95 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const [k, list] of keys) {
    const [browser, scenario] = k.split('|') as [string, string];
    const clean = list.filter((r) => r.contention === undefined || r.contention.length === 0);
    const js = list.map((r) => (r.clockResolutionMs >= 0.1 ? r.mainJsMs.mean : r.mainJsMs.p95));
    const gpu50 = clean.filter((r) => r.gpuMs !== null && r.gpuMs.n > 0).map((r) => r.gpuMs!.p50);
    const gpu95 = clean.filter((r) => r.gpuMs !== null && r.gpuMs.n > 0).map((r) => r.gpuMs!.p95);
    lines.push(
      `| ${browser} | ${scenario} | ${list.length} (${clean.length}) | ${fmtRange(list.map((r) => r.draws.max), 0)} | ${fmtRange(js)} ms | ${gpu50.length > 0 ? fmtRange(gpu50) + ' ms' : 'n/a'} | ${gpu95.length > 0 ? fmtRange(gpu95) + ' ms' : 'n/a'} | ${fmtRange(list.map((r) => r.fps), 1)} | ${fmtRange(list.map((r) => r.frameMs.p95), 1)} ms |`,
    );
  }
  return lines.join('\n');
}

function loadReports(): Spk4Report[] {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR)
    .filter((f) => /^spk4-.*\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(RESULTS_DIR, f), 'utf8')) as Spk4Report);
}

function updateStatusDoc(report: Spk4Report): void {
  const ranges = rangeTables(loadReports());
  const block = `${DOC_BEGIN}\n${ranges.length > 0 ? ranges + '\n\nLetzter Lauf im Detail:\n\n' : ''}${markdownTables(report)}\n${DOC_END}`;
  let text = existsSync(STATUS_DOC) ? readFileSync(STATUS_DOC, 'utf8') : '# ms2-p5-spk4\n';
  const a = text.indexOf(DOC_BEGIN);
  const b = text.indexOf(DOC_END);
  if (a >= 0 && b > a) text = text.slice(0, a) + block + text.slice(b + DOC_END.length);
  else text = `${text.trimEnd()}\n\n## Messwerte (automatisch, \`spk4 --update-docs\`)\n\n${block}\n`;
  writeFileSync(STATUS_DOC, text);
  console.log(`docs updated: ${STATUS_DOC}`);
}

/** Local date + time for the report name (several runs per day are kept for the value ranges). */
function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main(): Promise<number> {
  if (!noBuild) {
    console.log('spk4: vite build → tools/render-bench/dist');
    await build({ configFile: resolve(PKG_DIR, 'vite.config.ts'), logLevel: 'warn' });
  }
  if (!existsSync(resolve(DIST_DIR, 'index.html'))) throw new Error('dist/index.html missing (build failed?)');
  const before = loadavg();
  const concurrent = concurrentLoad();
  if (concurrent.length > 0) console.log(`spk4: concurrent load detected:\n  ${concurrent.join('\n  ')}`);
  const browsers: BrowserReport[] = [];
  for (const name of browserNames) {
    console.log(`spk4: ${name}`);
    browsers.push(await runBrowser(name));
    for (const c of concurrentLoad()) if (!concurrent.includes(c)) concurrent.push(c);
  }
  const failed = browsers.some((b) => b.errors.length > 0 || b.results.some((r) => !r.ok));
  const exitCode = failed ? 1 : 0;
  const c0 = cpus()[0];
  const report: Spk4Report = {
    date: new Date().toISOString(),
    mode: quick ? 'quick' : 'full',
    machine: {
      platform: `${platform()} ${arch()}`,
      arch: arch(),
      cpus: `${cpus().length}× ${c0?.model ?? '?'}`,
      memGB: Math.round(totalmem() / 2 ** 30),
      note: 'lokal gemessen (Apple M5 Pro, Playwright headless), kein Iris Xe/echtes Safari',
    },
    load: { before, after: loadavg(), concurrent },
    browsers,
    exitCode,
  };
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = resolve(RESULTS_DIR, `spk4-${stamp()}${quick ? '-quick' : ''}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`spk4: report ${file}`);
  console.log(markdownTables(report));
  if (updateDocs) updateStatusDoc(report);
  if (failed) console.error('spk4: FAILED (errors above)');
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
