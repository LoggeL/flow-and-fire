/**
 * Shared E2E helpers for the game page: navigation, readiness, test-hook access, error capture.
 * Servers (playwright.config.ts): 4173 with COOP/COEP (SAB transport), 4174 without (transfer).
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { FafTestHooks } from '../../../apps/game/src/hooks.ts';

export const COI_URL = 'http://localhost:4173/';
export const NO_COI_URL = 'http://localhost:4174/';

export const SERVERS = [
  { name: 'sab', label: 'COOP/COEP (4173, SAB)', url: COI_URL, coi: true, transport: 'sab' },
  { name: 'transfer', label: 'ohne COOP/COEP (4174, Transfer)', url: NO_COI_URL, coi: false, transport: 'transfer' },
] as const;

export type ServerSpec = (typeof SERVERS)[number];

declare global {
  interface Window {
    __faf?: FafTestHooks;
  }
}

/** Collects page errors and console errors (checked with `expectNoErrors`). */
export function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

export function expectNoErrors(errors: readonly string[]): void {
  expect(errors, errors.join('\n')).toEqual([]);
}

/** Opens the game (root URL → redirect to /b/<hash>/) and waits for `ready` and the first units. */
export async function openGame(page: Page, base: string, query = '', minUnits = 1): Promise<void> {
  await page.goto(base + (query === '' ? '' : `?${query}`));
  await page.waitForURL(/\/b\/[^/]+\/(\?.*)?$/);
  await page.waitForFunction(() => window.__faf?.ready === true, null, { timeout: 30_000 });
  if (minUnits > 0) {
    await page.waitForFunction((n) => (window.__faf?.unitCount ?? 0) >= n, minUnits, { timeout: 30_000 });
  }
}

/** Waits until the sim tick reaches at least `tick`. */
export async function waitTick(page: Page, tick: number, timeout = 20_000): Promise<void> {
  await page.waitForFunction((t) => (window.__faf?.tick ?? -1) >= t, tick, { timeout });
}

/** Steps `n` ticks one by one (paused sim), waiting for each frame. Returns the final tick. */
export async function stepTicks(page: Page, n: number): Promise<number> {
  return page.evaluate(async (count) => {
    const h = window.__faf!;
    const waitFor = (pred: () => boolean, ms: number): Promise<void> =>
      new Promise((res, rej) => {
        const t0 = performance.now();
        const poll = (): void => {
          if (pred()) res();
          else if (performance.now() - t0 > ms) rej(new Error(`timeout at tick ${h.tick}`));
          else setTimeout(poll, 2);
        };
        poll();
      });
    for (let i = 0; i < count; i++) {
      const target = h.tick + 1;
      h.ctl({ t: 'step', ticks: 1 });
      await waitFor(() => h.tick >= target, 5000);
    }
    return h.tick;
  }, n);
}

/** Attaches a JSON object to the report and returns it. */
export async function attachJson(testInfo: TestInfo, name: string, data: unknown): Promise<void> {
  await testInfo.attach(name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
}
