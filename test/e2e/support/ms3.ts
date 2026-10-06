/**
 * Shared helpers of the MS3 E2E specs (selection, control groups, orders, pathing, strategic zoom):
 * paused sims stepped tick by tick, screen geometry of the units (`__faf.screenUnits()`), the
 * box-select hit rule as an independent expectation, CSS-pixel screenshots and HUD avoidance.
 */
import { expect, type Page } from '@playwright/test';
import type { ScreenUnit } from '../../../apps/game/src/hooks.ts';
import { decodePng, pixelAt, type DecodedImage } from './png.ts';

export type { ScreenUnit };

/** MS3 default scene: placeholder tanks (150 per army) on hollow-ridge. */
export const TANKS = 'spawn=tanks';

/** Opens the page and waits for `ready` plus `minUnits` units (tank scene: 2 × 150). */
export async function waitUnits(page: Page, minUnits: number, timeout = 30_000): Promise<void> {
  await page.waitForFunction((n) => (window.__faf?.unitCount ?? 0) >= n, minUnits, { timeout });
}

/** Pauses the sim (ctl) and waits for a paused frame. */
export async function pauseSim(page: Page): Promise<void> {
  await page.evaluate(() => window.__faf!.ctl({ t: 'pause' }));
  await page.waitForFunction(() => window.__faf!.paused === true, null, { timeout: 10_000 });
}

export async function resumeSim(page: Page): Promise<void> {
  await page.evaluate(() => window.__faf!.ctl({ t: 'resume' }));
  await page.waitForFunction(() => window.__faf!.paused === false, null, { timeout: 10_000 });
}

/** Waits until the renderer has drawn `n` more frames. */
export async function frames(page: Page, n = 3): Promise<void> {
  const f0 = await page.evaluate(() => window.__faf!.renderStats().frames);
  await page.waitForFunction(({ f, k }) => window.__faf!.renderStats().frames >= f + k, { f: f0, k: n }, { timeout: 10_000 });
}

/** Screen geometry of every unit of the current frame. */
export function screenUnits(page: Page): Promise<ScreenUnit[]> {
  return page.evaluate(() => window.__faf!.screenUnits());
}

export function selection(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__faf!.selection());
}

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Box-select hit rule (C3, independent of the client code): icon mode (fade ≥ 0.5) = the icon square
 * intersects the box, mesh mode = the projected selection disc intersects the box. Returns 1 for a
 * hit, 0 for a miss and −1 when the unit is within `edgePx` of the decision boundary (ambiguous at
 * sub-pixel level: excluded from the comparison).
 */
export function boxHit(u: ScreenUnit, b: Box, edgePx = 0.75): -1 | 0 | 1 {
  const lx = Math.min(b.x0, b.x1);
  const hx = Math.max(b.x0, b.x1);
  const ly = Math.min(b.y0, b.y1);
  const hy = Math.max(b.y0, b.y1);
  if (u.x === null || u.y === null) return 0;
  if (u.icon) {
    const r = u.iconRect;
    if (r === null) return 0;
    // Signed overlap: > 0 overlapping, < 0 separated (smallest axis gap).
    const ox = Math.min(r[2], hx) - Math.max(r[0], lx);
    const oy = Math.min(r[3], hy) - Math.max(r[1], ly);
    const m = Math.min(ox, oy);
    if (Math.abs(m) < edgePx) return -1;
    return m > 0 ? 1 : 0;
  }
  const cx = Math.min(Math.max(u.x, lx), hx);
  const cy = Math.min(Math.max(u.y, ly), hy);
  const d = Math.hypot(u.x - cx, u.y - cy);
  const inside = u.x > lx && u.x < hx && u.y > ly && u.y < hy;
  const margin = inside ? Math.min(u.x - lx, hx - u.x, u.y - ly, hy - u.y) + u.radiusPx : u.radiusPx - d;
  if (Math.abs(margin) < edgePx) return -1;
  return margin > 0 ? 1 : 0;
}

/** Real left-drag from (x0, y0) to (x1, y1) with optional Shift. */
export async function dragBox(page: Page, b: Box, shift = false, steps = 4): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(b.x0, b.y0);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(b.x1, b.y1, { steps });
  await page.mouse.up({ button: 'left' });
  if (shift) await page.keyboard.up('Shift');
}

/** Bounding rectangles (CSS px) of the HUD overlays that take pointer input (boxes avoid them). */
export async function uiRects(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('#game-root *'))) {
      if (el.id === 'game-canvas') continue;
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === 'none' || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // Only elements that paint something or catch input (skip full-screen transparent wrappers).
      if (r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1) continue;
      out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    }
    return out;
  });
}

export function boxesIntersect(a: Box, b: Box, pad = 0): boolean {
  return Math.min(a.x0, a.x1) - pad < Math.max(b.x0, b.x1) && Math.max(a.x0, a.x1) + pad > Math.min(b.x0, b.x1) &&
    Math.min(a.y0, a.y1) - pad < Math.max(b.y0, b.y1) && Math.max(a.y0, a.y1) + pad > Math.min(b.y0, b.y1);
}

/** Canvas screenshot with a sampler in CSS pixels (WebKit's profile runs at DPR 2). */
export interface CssShot {
  readonly img: DecodedImage;
  readonly k: number;
  at(x: number, y: number): [number, number, number];
}

export async function cssShot(page: Page): Promise<CssShot> {
  const img = decodePng(await page.locator('#game-canvas').screenshot());
  const cssW = await page.evaluate(() => document.getElementById('game-canvas')!.clientWidth);
  const k = img.width / Math.max(1, cssW);
  return { img, k, at: (x, y) => pixelAt(img, x * k, y * k) };
}

export type Rgb = readonly [number, number, number];

export function colorDist(a: Rgb, b: Rgb): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** Team colors of the default render palette: army 0 blue, army 1 red (same test as `render smoke`). */
export function teamColored(c: Rgb, army: number): boolean {
  return army === 0 ? c[2] > c[0] + 60 && c[2] > c[1] + 30 : c[0] > c[1] + 60 && c[0] > c[2] + 60;
}

/** Any pixel within ±r CSS px of (x, y) satisfying `pred`. */
export function anyNear(shot: CssShot, x: number, y: number, r: number, pred: (c: Rgb) => boolean): boolean {
  const step = 1 / shot.k;
  for (let dy = -r; dy <= r + 1e-9; dy += step) {
    for (let dx = -r; dx <= r + 1e-9; dx += step) if (pred(shot.at(x + dx, y + dy))) return true;
  }
  return false;
}

/** Deterministic xorshift32 in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Centroid (WU) of the given units in the newest frame. */
export async function centroid(page: Page, handles: readonly number[]): Promise<{ x: number; z: number; n: number }> {
  return page.evaluate((hs) => {
    const h = window.__faf!;
    let x = 0;
    let z = 0;
    let n = 0;
    for (const handle of hs) {
      const p = h.unitPos(handle);
      if (p === null) continue;
      x += p.x;
      z += p.z;
      n++;
    }
    return { x: n > 0 ? x / n : 0, z: n > 0 ? z / n : 0, n };
  }, handles as number[]);
}

/** Sorted copy (set comparison of handle lists). */
export function sorted(a: readonly number[]): number[] {
  return [...a].sort((x, y) => x - y);
}

export function expectSameSet(actual: readonly number[], expected: readonly number[], msg?: string): void {
  expect(sorted(actual), msg).toEqual(sorted(expected));
}

/** Focuses the canvas without clicking (a click would change the selection). */
export async function focusCanvas(page: Page): Promise<void> {
  await page.locator('#game-canvas').focus();
}
