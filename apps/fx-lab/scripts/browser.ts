import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
import type { BrowserType, LaunchOptions, Page } from '@playwright/test';
export const REPO = resolve(import.meta.dirname, '../../..');
export const APP = resolve(REPO, 'apps/fx-lab');
export const ORIGIN = 'https://faf-fx-lab.test';
export const GL_ERROR = /GL_INVALID|INVALID_(OPERATION|ENUM|VALUE|FRAMEBUFFER_OPERATION)|OUT_OF_MEMORY|compile.*(fail|error)|link.*(fail|error)|shader.*error|error.*shader/i;
export function launchConfig(name: string): { type: BrowserType; options: LaunchOptions } {
  if (name === 'chromium') return { type: chromium, options: { args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };
  if (name === 'webkit') return { type: webkit, options: {} };
  if (name !== 'firefox') throw new Error(`Unknown engine: ${name}`);
  const home = resolve(REPO, 'node_modules/.cache/faf-firefox-home'); mkdirSync(home, { recursive: true });
  return { type: firefox, options: { ...(process.platform === 'darwin' ? { env: { ...process.env, CFFIXED_USER_HOME: home } } : {}), firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false, 'webgl.enable-privileged-extensions': true } } };
}
export async function serve(page: Page): Promise<void> {
  const dist = resolve(APP, 'dist');
  await page.route(`${ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const file = resolve(dist, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
    if (!file.startsWith(dist + sep) || !existsSync(file)) { await route.fulfill({ status: 404, body: 'not found' }); return; }
    await route.fulfill({ body: readFileSync(file), contentType: extname(file) === '.html' ? 'text/html' : extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'application/octet-stream', headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store' } });
  });
}
export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__fxlab?.ready || window.__fxlab?.error, undefined, { timeout: 30_000 });
  const error = await page.evaluate(() => window.__fxlab?.error);
  if (error) throw new Error(error);
}
