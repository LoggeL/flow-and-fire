/**
 * Browser plumbing of the FX benchmark (and shared console filters of the fx-lab E2E specs): launch
 * options as in the root playwright.config.ts, serving apps/fx-lab/dist through `page.route` under a
 * virtual cross-origin-isolated origin (no port), and the console classification of GL errors.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
import type { BrowserType, ConsoleMessage, LaunchOptions, Page } from '@playwright/test';

export const BENCH_ORIGIN = 'https://faf-fx-lab-bench.test';

export const BROWSER_NAMES = ['chromium', 'firefox', 'webkit'] as const;
export type BrowserName = (typeof BROWSER_NAMES)[number];

export function isBrowserName(s: string): s is BrowserName {
  return (BROWSER_NAMES as readonly string[]).includes(s);
}

/** Console messages that are real GL/shader errors (everything else from WebGL is an implementation note). */
export const GL_ERROR_RE =
  /GL_INVALID|INVALID_(OPERATION|ENUM|VALUE|FRAMEBUFFER_OPERATION)|OUT_OF_MEMORY|CONTEXT_LOST|compile|link(ing)? (failed|error)|shader.*error|error.*shader/i;

/** Console notes a deliberate context loss produces (expected in the context-loss spec only). */
export const EXPECTED_LOSS_RE = /context (was )?lost|CONTEXT_LOST_WEBGL|WebGL context was lost|restored/i;

/**
 * Classifies a console message: 'error' for console errors and GL/shader warnings, 'warning' for other
 * WebGL warnings (browser implementation notes, reported but not fatal), null otherwise.
 */
export function classifyConsole(type: string, text: string): 'error' | 'warning' | null {
  if (type === 'error') return 'error';
  if (type === 'warning' && GL_ERROR_RE.test(text)) return 'error';
  if (type === 'warning' && /WebGL/i.test(text)) return 'warning';
  return null;
}

/** Collects page errors and GL console errors of a page (optionally ignoring expected context-loss notes). */
export class PageErrorLog {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  /** While true, context-loss console notes are not errors. */
  expectLoss = false;

  attach(page: Page): this {
    page.on('pageerror', (e) => this.errors.push(`pageerror: ${e.message.split('\n')[0]}`));
    page.on('console', (msg: ConsoleMessage) => this.onConsole(msg.type(), msg.text()));
    return this;
  }

  onConsole(type: string, text: string): void {
    if (this.expectLoss && EXPECTED_LOSS_RE.test(text)) return;
    const c = classifyConsole(type, text);
    if (c === 'error') this.errors.push(`console.${type}: ${text.slice(0, 400)}`);
    else if (c === 'warning' && !this.warnings.includes(text.slice(0, 300))) this.warnings.push(text.slice(0, 300));
  }
}

export const COI_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

/** Serves `distDir` under `origin` through request interception (no port is opened). */
export async function serveDist(page: Page, distDir: string, origin = BENCH_ORIGIN): Promise<void> {
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(distDir, '.' + rel);
    if (!(file === distDir || file.startsWith(distDir + sep)) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: 'not found', headers: { ...COI_HEADERS } });
      return;
    }
    await route.fulfill({ status: 200, body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream', headers: { ...COI_HEADERS } });
  });
}

/**
 * macOS (Darwin 25+) denies non-Apple-signed apps their default Firefox profile folder; as in the root
 * playwright.config.ts, CFFIXED_USER_HOME points CoreFoundation at a private directory.
 */
export function firefoxEnv(repoDir: string): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(repoDir, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

/** Chromium flags of the root playwright.config.ts: ANGLE on Metal (hardware WebGL2), SwiftShader as fallback. */
export const CHROMIUM_ARGS: readonly string[] = ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

/** Firefox prefs of the root config (WebGL forced on). */
export const FIREFOX_PREFS: Readonly<Record<string, boolean>> = { 'webgl.force-enabled': true, 'webgl.disabled': false };

/**
 * Launch options per browser. `measure` additionally enables Firefox's privileged WebGL extensions,
 * which expose the GPU timer query (measurement only, as in the SPK4 benchmark).
 */
export function launchConfig(name: BrowserName, repoDir: string, o: { headed?: boolean; measure?: boolean } = {}): { type: BrowserType; options: LaunchOptions } {
  const headless = o.headed !== true;
  switch (name) {
    case 'chromium':
      return { type: chromium, options: { headless, args: [...CHROMIUM_ARGS] } };
    case 'firefox': {
      const env = firefoxEnv(repoDir);
      return {
        type: firefox,
        options: {
          headless,
          ...(env !== undefined ? { env } : {}),
          firefoxUserPrefs: { ...FIREFOX_PREFS, ...(o.measure === true ? { 'webgl.enable-privileged-extensions': true } : {}) },
        },
      };
    }
    case 'webkit':
      return { type: webkit, options: { headless } };
  }
}
