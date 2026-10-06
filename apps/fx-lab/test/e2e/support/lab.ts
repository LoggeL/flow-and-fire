/**
 * Helpers of the fx-lab E2E specs: open a scene with URL parameters, wait for `__fxlab.ready`, collect
 * page/GL errors, read hooks and stats, and take canvas screenshots with pixel statistics.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import type { FxLabSample, FxLabStats } from '../../../src/app/hooks.ts';
import { PageErrorLog } from '../../../scripts/bench/browsers.ts';
import { decodePng, imageStats } from '../../../scripts/bench/png.ts';
import type { ImageStats, Region, RgbImage } from '../../../scripts/bench/png.ts';

export const REPO_DIR = resolve(import.meta.dirname, '../../../../..');
export const SHOTS_DIR = resolve(REPO_DIR, 'test-results/fx-lab-e2e/shots');

/** Minimum luma spread of a rendered (non-uniform) canvas, as in scripts/shot.ts. */
export const MIN_LUMA_SPREAD = 12;

export interface HookState {
  ready: boolean;
  frame: number;
  scene: string;
  preset: string;
  error: string | null;
  restoreCount: number;
}

export interface OpenOptions {
  /** Script run before any page script (e.g. hide WebGL extensions). */
  initScript?: () => void;
  /** Timeout for `ready` (freeze catch-up of long scenes takes a while in slow browsers). */
  readyTimeoutMs?: number;
}

/**
 * Opens the fx-lab with `params` (bench=1 and seed=1 unless given), waits until `__fxlab.ready` or
 * `__fxlab.error`, and returns the error log attached to the page.
 */
export async function openLab(page: Page, params: Readonly<Record<string, string | number>>, o: OpenOptions = {}): Promise<PageErrorLog> {
  const log = new PageErrorLog().attach(page);
  if (o.initScript !== undefined) await page.addInitScript(o.initScript);
  const q = new URLSearchParams({ bench: '1', seed: '1' });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`/index.html?${q.toString()}`);
  await page.waitForFunction(() => window.__fxlab !== undefined && (window.__fxlab.ready || window.__fxlab.error !== null), undefined, {
    timeout: o.readyTimeoutMs ?? 90_000,
  });
  return log;
}

export function hookState(page: Page): Promise<HookState> {
  return page.evaluate(() => {
    const h = window.__fxlab!;
    return { ready: h.ready, frame: h.frame, scene: h.scene, preset: h.preset, error: h.error, restoreCount: h.restoreCount };
  });
}

export function labStats(page: Page): Promise<FxLabStats> {
  return page.evaluate(() => window.__fxlab!.stats());
}

export function labSamples(page: Page): Promise<FxLabSample[]> {
  return page.evaluate(() => [...window.__fxlab!.samples()]);
}

/** Waits until at least `n` more frames were rendered. */
export async function waitFrames(page: Page, n: number, timeoutMs = 20_000): Promise<void> {
  const f0 = await page.evaluate(() => window.__fxlab!.frame);
  await page.waitForFunction((f) => window.__fxlab!.frame >= f, f0 + n, { timeout: timeoutMs });
}

/** No page/GL console errors, `__fxlab.error` null, requested scene active. */
export async function expectHealthy(page: Page, log: PageErrorLog, scene: string): Promise<HookState> {
  const h = await hookState(page);
  expect(h.error, '__fxlab.error').toBeNull();
  expect(h.scene, `scene '${scene}' registered and active`).toBe(scene);
  expect(log.errors, 'page errors / GL console errors').toEqual([]);
  return h;
}

export interface CanvasShot {
  file: string;
  png: Buffer;
  img: RgbImage;
  stats: ImageStats;
}

/** Screenshot of the canvas → test-results/fx-lab-e2e/shots/<name>-<project>.png, decoded with statistics. */
export async function canvasShot(page: Page, name: string, info: TestInfo): Promise<CanvasShot> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const file = resolve(SHOTS_DIR, `${name}-${info.project.name}.png`);
  const png = await page.locator('canvas').screenshot({ path: file });
  const img = decodePng(png);
  await info.attach(`${name}.png`, { body: png, contentType: 'image/png' });
  return { file, png, img, stats: imageStats(img) };
}

/** Pixel statistics of a region of a shot (relative coordinates). */
export function regionStats(shot: CanvasShot, region: Region): ImageStats {
  return imageStats(shot.img, region, 2);
}

/** Region of ±`half` (relative) around the image centre. */
export function centreRegion(half: number): Region {
  return { x0: 0.5 - half, y0: 0.5 - half, x1: 0.5 + half, y1: 0.5 + half };
}
