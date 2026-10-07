/**
 * Interaction helpers of the marker editor E2E specs (TRACK-EDITOR P7): real mouse input at
 * terrain points (window.__editor.worldToClient), tool selection, panel inputs, downloads and
 * byte/hash helpers on the Node side.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Download, expect, type Page, test } from '@playwright/test';
import { xxHash32 } from '@faf/fixed';
// Brings the window.__editor declaration (global augmentation) into the test program.
import type {} from '../../../src/app/hooks.ts';
import { REPO_ROOT } from './editor.ts';

export const WU = 4096;

export type ToolTestId = 'select' | 'start' | 'mass' | 'hydro' | 'field-circle' | 'field-polygon' | 'delete';

/** xxHash32 (seed 0, unsigned) of bytes: the same function as window.__editor.exportHash(). */
export function hashOf(bytes: Uint8Array): number {
  return xxHash32(bytes, 0, bytes.length, 0) >>> 0;
}

export function mapFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(REPO_ROOT, 'content/maps', `${name}.rtsmap`)));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Waits until the editor shows `name` and has rendered it. */
export async function waitForMap(page: Page, name: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction((n) => window.__editor?.ready === true && window.__editor.mapName === n, name, { timeout });
}

/** One rendered frame (overlay and camera are up to date afterwards). */
export async function frame(page: Page): Promise<void> {
  await page.evaluate(() => window.__editor!.waitForRender());
}

/** Client pixel of a terrain point in WU; fails the test if it is not visible. */
export async function clientOf(page: Page, xWu: number, zWu: number): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(([x, z]) => window.__editor!.worldToClient(x!, z!), [xWu, zWu]);
  expect(p, `terrain point (${xWu}, ${zWu}) WU must be visible`).not.toBeNull();
  return p!;
}

/** Real left click on a terrain point. */
export async function clickWorld(page: Page, xWu: number, zWu: number): Promise<void> {
  const p = await clientOf(page, xWu, zWu);
  await page.mouse.click(p.x, p.y);
  await frame(page);
}

/** Real left drag between two terrain points (pointer moves in several steps). */
export async function dragWorld(page: Page, from: readonly [number, number], to: readonly [number, number], steps = 8): Promise<void> {
  const a = await clientOf(page, from[0], from[1]);
  const b = await clientOf(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await frame(page);
}

export async function selectTool(page: Page, tool: ToolTestId): Promise<void> {
  await page.getByTestId(`tool-${tool}`).click();
  await expect(page.getByTestId(`tool-${tool}`)).toHaveAttribute('aria-pressed', 'true');
}

/** Types a value into a panel input and commits it with Enter (one store command). */
export async function commitInput(page: Page, testId: string, value: string): Promise<void> {
  const input = page.getByTestId(testId);
  await input.fill(value);
  await input.press('Enter');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
}

/** Moves keyboard focus to the terrain canvas so the editor shortcuts apply. */
export async function focusCanvas(page: Page): Promise<void> {
  await page.locator('#terrain').focus();
}

export async function exportBytes(page: Page): Promise<Uint8Array> {
  return Uint8Array.from(await page.evaluate(() => Array.from(window.__editor!.exportBytes())));
}

export async function exportHash(page: Page): Promise<number> {
  return page.evaluate(() => window.__editor!.exportHash());
}

export async function undoDepth(page: Page): Promise<number> {
  return page.evaluate(() => window.__editor!.undoDepth());
}

/**
 * Clicks the button `testId` and returns the download it starts. Headless Chromium's download
 * request limiter occasionally drops one of several page-initiated downloads that follow each other
 * within a few milliseconds (the app has run its handler, but no download event arrives — about one
 * roundtrip run in five). Real users never click that fast, so the helper re-clicks (the exports are
 * idempotent) when no download starts within `attemptMs`; every other failure still fails the test.
 */
export async function downloadVia(page: Page, testId: string, attempts = 3, attemptMs = 5_000): Promise<Download> {
  for (let i = 1; ; i++) {
    const pending = page.waitForEvent('download', { timeout: attemptMs }).then(
      (download) => ({ download }),
      (error: unknown) => ({ error }),
    );
    await page.getByTestId(testId).click();
    const r = await pending;
    if ('download' in r) return r.download;
    if (i >= attempts) throw r.error;
    test.info().annotations.push({ type: 'download-retry', description: `${testId}: no download after ${attemptMs} ms, click ${i + 1}` });
  }
}

/** Downloaded bytes and suggested file name of a finished download. */
export async function downloadBytes(download: Download): Promise<{ bytes: Uint8Array; fileName: string }> {
  const path = await download.path();
  return { bytes: new Uint8Array(readFileSync(path)), fileName: download.suggestedFilename() };
}

/** Clicks "Speichern" and returns the downloaded bytes and file name. */
export async function saveDownload(page: Page): Promise<{ bytes: Uint8Array; fileName: string }> {
  return downloadBytes(await downloadVia(page, 'btn-save'));
}

/** Counts of the open map (window.__editor.counts()). */
export async function counts(page: Page): Promise<{ starts: number; mass: number; hydro: number; fields: number; props: number; expandedProps: number }> {
  return page.evaluate(() => window.__editor!.counts());
}

/** Error/warning/info issue codes of the open map. */
export async function issueCodes(page: Page): Promise<{ severity: string; code: string }[]> {
  return page.evaluate(() => window.__editor!.issues().map((i) => ({ severity: i.severity, code: i.code })));
}

/** Zooms the camera towards a terrain point with real wheel input. */
export async function zoomAt(page: Page, xWu: number, zWu: number, deltaY: number, repeats = 1): Promise<void> {
  for (let i = 0; i < repeats; i++) {
    const p = await clientOf(page, xWu, zWu);
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, deltaY);
    await frame(page);
  }
}

/**
 * Pans the camera with a real right-button drag so that the terrain point (WU) lands in the middle
 * of the free map area between the panel columns.
 */
export async function centerOn(page: Page, xWu: number, zWu: number): Promise<void> {
  const target = await page.evaluate(() => {
    const c = document.getElementById('terrain')!.getBoundingClientRect();
    const left = document.querySelector('.me-col-left')?.getBoundingClientRect().right ?? c.left;
    const right = document.querySelector('.me-col-right')?.getBoundingClientRect().left ?? c.right;
    const top = document.querySelector('.me-topbar')?.getBoundingClientRect().bottom ?? c.top;
    const bottom = document.querySelector('.me-statusbar')?.getBoundingClientRect().top ?? c.bottom;
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  });
  const from = await clientOf(page, xWu, zWu);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await frame(page);
}
