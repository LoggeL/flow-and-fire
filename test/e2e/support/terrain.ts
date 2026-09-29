/**
 * Terrain/water/decal pixel checks shared by the E2E specs and the dev-check script: the camera is
 * placed via the test hooks, world points are projected with the live camera and the canvas
 * screenshot is sampled there (same criteria as `pnpm --filter @faf/render smoke`).
 */
import type { Page } from '@playwright/test';
import { decodePng, pixelAt, type DecodedImage } from './png.ts';

/** Clear color of the game renderer (0.043, 0.059, 0.078) in 8 bit. */
export const CLEAR_RGB = [11, 15, 20] as const;

/** Waits until the renderer has drawn `n` more frames (camera changes are visible). */
export async function settle(page: Page, n = 3): Promise<void> {
  const f0 = await page.evaluate(() => window.__faf!.renderStats().frames);
  await page.waitForFunction(({ f, k }) => window.__faf!.renderStats().frames >= f + k, { f: f0, k: n }, { timeout: 10_000 });
}

export async function canvasShot(page: Page): Promise<DecodedImage> {
  return decodePng(await page.locator('#game-canvas').screenshot());
}

/**
 * Canvas screenshot plus a sampler in CSS pixels: screenshots have device pixels (WebKit's
 * "Desktop Safari" profile runs at devicePixelRatio 2), projected positions are CSS pixels.
 */
async function cssShot(page: Page): Promise<{ img: DecodedImage; at: (x: number, y: number) => [number, number, number] }> {
  const img = await canvasShot(page);
  const cssW = await page.evaluate(() => document.getElementById('game-canvas')!.clientWidth);
  const k = img.width / Math.max(1, cssW);
  return { img, at: (x, y) => pixelAt(img, x * k, y * k) };
}

export function isWaterColored(c: readonly [number, number, number]): boolean {
  return c[2] > c[0] + 10 && c[2] >= c[1] - 30;
}

export function isMassDecal(c: readonly [number, number, number]): boolean {
  return c[1] > 150 && c[1] > c[0] + 40 && c[1] > c[2] + 20;
}

export function isHydroDecal(c: readonly [number, number, number]): boolean {
  return c[2] > 150 && c[1] > 120 && c[0] < c[1] - 40 && c[0] < c[2] - 40;
}

export interface WaterCheck {
  readonly point: { x: number; z: number };
  readonly screen: { x: number; y: number } | null;
  readonly pixel: [number, number, number] | null;
  /** Share of water-colored pixels in a 21 × 21 px box around the point. */
  readonly boxShare: number;
  readonly ok: boolean;
}

/** Deep water at the lake centre of hollow-ridge (3.5 WU deep) must be water-colored. */
export async function checkWater(page: Page, x = 256, z = 256, distance = 40): Promise<WaterCheck> {
  await page.evaluate(({ px, pz, d }) => window.__faf!.setCamera(px, pz, d), { px: x, pz: z, d: distance });
  await settle(page);
  const screen = await page.evaluate(({ px, pz }) => {
    const h = window.__faf!;
    const w = h.mapInfo()?.waterLevel ?? 0;
    return h.project(px, w, pz);
  }, { px: x, pz: z });
  const shot = await cssShot(page);
  if (screen === null) return { point: { x, z }, screen, pixel: null, boxShare: 0, ok: false };
  const pixel = shot.at(screen.x, screen.y);
  let n = 0;
  let w = 0;
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      n++;
      if (isWaterColored(shot.at(screen.x + dx, screen.y + dy))) w++;
    }
  }
  return { point: { x, z }, screen, pixel, boxShare: w / n, ok: isWaterColored(pixel) };
}

export interface SpotCheck {
  readonly kind: 'mass' | 'hydro';
  readonly spot: { x: number; z: number };
  readonly hits: number;
  readonly samples: number;
}

/** Samples 16 points on the decal ring of a spot (mass r 1.6 WU green, hydro r 2.6 WU cyan). */
export async function checkSpot(page: Page, kind: 'mass' | 'hydro', spot: { x: number; z: number }, distance = 16): Promise<SpotCheck> {
  const radius = kind === 'mass' ? 1.6 : 2.6;
  await page.evaluate(({ s, d }) => window.__faf!.setCamera(s.x, s.z, d), { s: spot, d: distance });
  await settle(page);
  const pts = await page.evaluate(({ s, r }) => {
    const h = window.__faf!;
    const out: ({ x: number; y: number } | null)[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = s.x + Math.cos(a) * r;
      const z = s.z + Math.sin(a) * r;
      out.push(h.project(x, h.heightAt(x, z), z));
    }
    return out;
  }, { s: spot, r: radius });
  const shot = await cssShot(page);
  const test = kind === 'mass' ? isMassDecal : isHydroDecal;
  let hits = 0;
  for (const p of pts) {
    if (p === null) continue;
    // Ring line ≈ 0.35–0.45 WU wide: accept the best pixel within ±1 px.
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) hit = test(shot.at(p.x + dx, p.y + dy));
    if (hit) hits++;
  }
  return { kind, spot, hits, samples: pts.length };
}
