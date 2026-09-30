/**
 * Shared helpers of the harness specs: serve dist-harness through page.route and run series.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { Job } from '../src/jobs.ts';
import type { FafHarness } from '../src/harness/page/main.ts';
import type { SeriesResult } from '../src/series.ts';

const HEADLESS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST_DIR = resolve(HEADLESS_DIR, 'dist-harness');
export const GOLDENS_DIR = resolve(HEADLESS_DIR, 'goldens');
export const REPO_DIR = resolve(HEADLESS_DIR, '../..');
/** Raw per-engine outputs (*.tmp.json, git-ignored); the scripts aggregate them. */
export const RAW_DIR = process.env['FAF_HARNESS_RAW_DIR'] ?? resolve(HEADLESS_DIR, 'results');

/**
 * Secure origin (https) so that COOP/COEP make the page cross-origin isolated; otherwise
 * browsers clamp performance.now() to 0.1–1 ms. Nothing leaves the machine: every request is
 * fulfilled from dist-harness.
 */
export const ORIGIN = 'https://flow-and-fire.test';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.rtsmap': 'application/octet-stream',
  '.rtsreplay': 'application/octet-stream',
  '.json': 'application/json',
};

const COI_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

export async function openHarness(page: Page): Promise<void> {
  if (!existsSync(resolve(DIST_DIR, 'index.html'))) {
    throw new Error('dist-harness missing: run `pnpm --filter @faf/headless build:harness` first');
  }
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(DIST_DIR, '.' + rel);
    if (!(file === DIST_DIR || file.startsWith(DIST_DIR + sep)) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: 'not found', headers: COI_HEADERS });
      return;
    }
    await route.fulfill({
      status: 200,
      body: readFileSync(file),
      contentType: TYPES[extname(file)] ?? 'application/octet-stream',
      headers: COI_HEADERS,
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => 'fafHarness' in window);
  if (errors.length > 0) throw new Error(`harness page errors: ${errors.join('; ')}`);
}

export async function runSeriesIn(page: Page, job: Job, engine: string): Promise<SeriesResult> {
  return page.evaluate(
    ({ job, engine }) => (window as unknown as { fafHarness: FafHarness }).fafHarness.series(job, engine),
    { job, engine },
  );
}

export function writeRaw(name: string, data: unknown): string {
  mkdirSync(RAW_DIR, { recursive: true });
  const file = resolve(RAW_DIR, `${name}.tmp.json`);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}
