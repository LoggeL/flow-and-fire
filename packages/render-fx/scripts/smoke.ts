/**
 * Browser smoke harness of @faf/render-fx (`pnpm --filter @faf/render-fx run smoke`, root: `pnpm smoke:fx`).
 *
 * 1. Vite build of packages/render-fx/smoke → packages/render-fx/dist/smoke (programmatic, no dev server).
 * 2. Browsers ONE AFTER ANOTHER (memory budget) with the launch flags of the root playwright.config.ts
 *    (Firefox with CFFIXED_USER_HOME). The page is served through `page.route` under a virtual origin –
 *    no port is opened.
 * 3. Per case (smoke/cases/<name>.ts): load → wait for `window.__smoke.done` → check errors (page errors,
 *    GL/shader console errors, `check()` results) → screenshot test-results/render-fx-smoke/<case>-<browser>.png
 *    → context loss + restore (if WEBGL_lose_context exists) → frames + `check()` again → finish (destroy).
 * 4. Report test-results/render-fx-smoke.json; exit code 1 on any error. Browsers are always closed.
 *
 * Flags: --cases=core,post  --browsers=chromium,firefox,webkit (default chromium)  --headed  --no-build
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import type { Browser, BrowserType, LaunchOptions, Page } from '@playwright/test';
import { build } from 'vite';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = resolve(PKG_DIR, '../..');
const DIST_DIR = resolve(PKG_DIR, 'dist/smoke');
const CASES_DIR = resolve(PKG_DIR, 'smoke/cases');
const SHOTS_DIR = resolve(REPO_DIR, 'test-results/render-fx-smoke');
const REPORT = resolve(REPO_DIR, 'test-results/render-fx-smoke.json');
const ORIGIN = 'https://faf-render-fx-smoke.test';
const VIEWPORT = { width: 960, height: 600 };

// pnpm may forward a literal `--` before the flags.
const argv = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (argv.includes(`--${name}`) ? '' : undefined);
const headed = flag('headed') !== undefined;
const noBuild = flag('no-build') !== undefined;
const browserNames = (flag('browsers') ?? 'chromium').split(',').filter((s) => s.length > 0);
const allCases = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.slice(0, -3))
  .sort();
const caseNames = (flag('cases') ?? allCases.join(',')).split(',').filter((s) => s.length > 0);
for (const c of caseNames) if (!allCases.includes(c)) throw new Error(`unknown smoke case '${c}' (have: ${allCases.join(', ')})`);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
};

/** Console warnings that are real GL errors (everything else from WebGL is an implementation note). */
const GL_ERROR_RE = /GL_INVALID|INVALID_(OPERATION|ENUM|VALUE|FRAMEBUFFER_OPERATION)|OUT_OF_MEMORY|CONTEXT_LOST|compile|link(ing)? (failed|error)|shader.*error|error.*shader/i;
/** The context loss is provoked on purpose – its console notes are expected. */
const EXPECTED_LOSS_RE = /context (was )?lost|CONTEXT_LOST_WEBGL|WebGL context was lost|restored/i;

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

interface CaseResult {
  case: string;
  ok: boolean;
  frames: number;
  draws: number;
  jsMsP50: number;
  gpuMsP50: Record<string, number | null>;
  renderer: string;
  caps: { colorBufferFloat: boolean; timerQuery: boolean; loseContext: boolean } | null;
  contextLoss: 'passed' | 'failed' | 'unsupported' | 'skipped';
  errors: string[];
  screenshot: string | null;
}

interface BrowserResult {
  browser: string;
  version: string;
  cases: CaseResult[];
  errors: string[];
}

async function runCase(browser: Browser, browserName: string, name: string): Promise<CaseResult> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors: string[] = [];
  let losing = false;
  const result: CaseResult = {
    case: name,
    ok: false,
    frames: 0,
    draws: 0,
    jsMsP50: 0,
    gpuMsP50: {},
    renderer: '',
    caps: null,
    contextLoss: 'skipped',
    errors,
    screenshot: null,
  };
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      const t = msg.type();
      const text = msg.text();
      if (losing && EXPECTED_LOSS_RE.test(text)) return;
      if (t === 'error' || (t === 'warning' && GL_ERROR_RE.test(text))) errors.push(`console.${t}: ${text.slice(0, 400)}`);
    });
    await servePage(page);
    await page.goto(`${ORIGIN}/index.html?case=${encodeURIComponent(name)}`);
    await page.waitForFunction(() => window.__smoke !== undefined && window.__smoke.done, undefined, { timeout: 90_000 });
    const s = await page.evaluate(() => {
      const st = window.__smoke!;
      return { error: st.error, frames: st.frames, draws: st.draws, checks: st.checks, gpuMs: st.gpuMs, jsMs: st.jsMs, renderer: st.renderer, caps: st.caps };
    });
    result.frames = s.frames;
    result.draws = s.draws;
    result.jsMsP50 = s.jsMs;
    result.gpuMsP50 = s.gpuMs;
    result.renderer = s.renderer;
    result.caps = s.caps;
    if (s.error !== null) errors.push(`page: ${s.error}`);
    for (const c of s.checks) errors.push(`check: ${c}`);
    mkdirSync(SHOTS_DIR, { recursive: true });
    const shot = resolve(SHOTS_DIR, `${name}-${browserName}.png`);
    await page.locator('canvas').screenshot({ path: shot });
    result.screenshot = shot;

    if (s.error === null) {
      losing = true;
      const r = await page.evaluate(() => window.__smoke!.loseAndRestore());
      losing = false;
      if (!r.supported) result.contextLoss = 'unsupported';
      else {
        for (const c of r.checks) errors.push(`after restore: ${c}`);
        result.contextLoss = r.checks.length === 0 ? 'passed' : 'failed';
      }
      const rest = await page.evaluate(() => window.__smoke!.finish());
      for (const e of rest) errors.push(`GL error after destroy: ${e}`);
      const late = await page.evaluate(() => window.__smoke!.error);
      if (late !== null && late !== s.error) errors.push(`page: ${late}`);
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    await context.close();
  }
  result.ok = errors.length === 0;
  return result;
}

async function runBrowser(name: string): Promise<BrowserResult> {
  const { type, options } = launchConfig(name);
  const out: BrowserResult = { browser: name, version: '', cases: [], errors: [] };
  let browser: Browser | null = null;
  try {
    browser = await type.launch(options);
    out.version = browser.version();
    for (const c of caseNames) {
      process.stdout.write(`  ${name} ${c} … `);
      const r = await runCase(browser, name, c);
      out.cases.push(r);
      const gpu = Object.entries(r.gpuMsP50)
        .map(([k, v]) => `${k} ${v === null ? 'n/a' : v.toFixed(3) + ' ms'}`)
        .join(', ');
      process.stdout.write(
        `${r.ok ? 'ok' : 'ERROR'} | ${r.frames} frames | ${r.draws} draws | js p50 ${r.jsMsP50.toFixed(3)} ms | gpu p50 ${gpu || 'n/a'} | context loss ${r.contextLoss}\n`,
      );
      for (const e of r.errors) process.stdout.write(`    ! ${e}\n`);
    }
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e));
    process.stdout.write(`  ${name}: FAILED ${out.errors.at(-1)}\n`);
  } finally {
    if (browser !== null) await browser.close();
  }
  return out;
}

async function main(): Promise<number> {
  if (!noBuild) {
    console.log('render-fx smoke: building smoke page …');
    await build({ configFile: resolve(PKG_DIR, 'vite.config.ts'), logLevel: 'warn' });
  }
  if (!existsSync(resolve(DIST_DIR, 'index.html'))) throw new Error('dist/smoke/index.html missing (build failed?)');
  console.log(`render-fx smoke: cases ${caseNames.join(', ')} | browsers ${browserNames.join(', ')}`);
  const browsers: BrowserResult[] = [];
  for (const b of browserNames) browsers.push(await runBrowser(b));
  const failed = browsers.some((b) => b.errors.length > 0 || b.cases.some((c) => !c.ok));
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify({ date: new Date().toISOString(), ok: !failed, cases: caseNames, browsers }, null, 2) + '\n');
  console.log(`render-fx smoke: ${failed ? 'FAILED' : 'ok'} – report ${REPORT}`);
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
