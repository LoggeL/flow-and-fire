/**
 * Shared helpers of the marker editor E2E specs: console-error capture, screenshots under
 * test-results/marker-editor/, measurement reports and waiting for the terrain view.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
// Brings the window.__editorView declaration (global augmentation) into the test program.
import type {} from '../../../src/env.d.ts';
import type {} from '../../../src/app/hooks.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');
/** Screenshots and reports of the editor E2E (test-results/marker-editor/<name>.png|json). */
export const RESULTS_DIR = resolve(REPO_ROOT, 'test-results/marker-editor');
export const MAP_NAMES = ['hollow-ridge', 'tessera', 'braidwater', 'setons'] as const;
export type MapName = (typeof MAP_NAMES)[number];
export const MEASURED_LOCALLY = 'lokal gemessen (Apple M5 Pro, Playwright headless), kein iGPU-/GPU-Runner';

/** Console messages that are not errors of the page (browser/driver noise). */
const IGNORED = [/GPU stall due to ReadPixels/i, /WebGL: too many errors/i, /Automatic fallback to software WebGL/i];

/** Collects console errors and uncaught page errors (call before page.goto). */
export function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED.some((re) => re.test(text))) return;
    errors.push(`console: ${text}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

export function expectNoErrors(errors: readonly string[]): void {
  expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
}

/** Path of a named result file (creates the directory). */
export function resultPath(fileName: string): string {
  const p = resolve(RESULTS_DIR, fileName);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/** Full-page screenshot to test-results/marker-editor/<name>.png; returns the PNG bytes. */
export async function screenshot(page: Page, name: string): Promise<Uint8Array> {
  const buf = await page.screenshot({ path: resultPath(`${name}.png`) });
  return new Uint8Array(buf);
}

export function writeReport(name: string, data: unknown): string {
  const p = resultPath(`${name}.json`);
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  return p;
}

/** Opens the editor with ?map=<name> and waits for the first rendered frame of that map. */
export async function openEditor(page: Page, map: string, timeout = 30_000): Promise<void> {
  await page.goto(`/?map=${encodeURIComponent(map)}`);
  await page.waitForFunction((name) => window.__editorView?.ready === true && window.__editorView.mapName === name, map, { timeout });
}

/** Real pointer operations use the same projection as the overlay, never mutate the store. */
export async function worldPixel(page: Page, x: number, z: number): Promise<{ x: number; y: number }> {
  await page.evaluate(() => window.__editor!.waitForRender());
  const p = await page.evaluate(([x, z]) => window.__editor!.worldToClient(x!, z!), [x, z]);
  expect(p, `visible map point ${x}, ${z}`).not.toBeNull();
  return p!;
}

export async function clickWorld(page: Page, x: number, z: number): Promise<void> {
  const p = await worldPixel(page, x, z);
  await page.mouse.click(p.x, p.y);
  await page.evaluate(() => window.__editor!.waitForRender());
}

export async function dragWorld(page: Page, from: readonly [number, number], to: readonly [number, number]): Promise<void> {
  const a = await worldPixel(page, ...from);
  const b = await worldPixel(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => window.__editor!.waitForRender());
}

export async function commitInput(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press('Enter');
  await page.locator('#terrain').focus();
}
