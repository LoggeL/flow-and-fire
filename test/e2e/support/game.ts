/**
 * Shared E2E helpers for the game page: navigation, readiness, test-hook access, error capture.
 * Servers (playwright.config.ts, ports in ./ports.ts): COI_PORT with COOP/COEP (SAB transport), NO_COI_PORT without (transfer).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { FafTestHooks } from '../../../apps/game/src/hooks.ts';
import { COI_ORIGIN, COI_PORT, NO_COI_ORIGIN, NO_COI_PORT } from './ports.ts';
import { installSilentOutput } from '../../../apps/game/test/support/silent-output.ts';

export const COI_URL = `${COI_ORIGIN}/`;
export const NO_COI_URL = `${NO_COI_ORIGIN}/`;

export const SERVERS = [
  { name: 'sab', label: `COOP/COEP (${COI_PORT}, SAB)`, url: COI_URL, coi: true, transport: 'sab' },
  { name: 'transfer', label: `ohne COOP/COEP (${NO_COI_PORT}, Transfer)`, url: NO_COI_URL, coi: false, transport: 'transfer' },
] as const;

export type ServerSpec = (typeof SERVERS)[number];


/**
 * Machine-dependent millisecond limits (load times, FPS, Main-JS) are only gated in an explicit
 * measurement run (DECISIONS 16): `FAF_PERF_GATE=1 pnpm test:e2e`. Otherwise they are measured and
 * reported in test-results/*.json.
 */
export const PERF_GATE = process.env['FAF_PERF_GATE'] === '1';

/** Label for locally measured performance numbers (DECISIONS 5). */
export const MEASURED_LOCALLY = 'lokal gemessen (Apple M5 Pro, Playwright headless), kein iGPU-/GPU-Runner';

/** Setons (content/maps/setons.rtsmap), the default map: identities fixed by the Setons package. */
export const SETONS = {
  name: 'Setons',
  sizeWu: 1024,
  mapSimHash: 0x52eccf92,
  /** Starts in WU: army 0 (player) SW mid, army 1 NO mid, across the land bridge. */
  own: { x: 354, z: 678 },
  enemy: { x: 670, z: 346 },
  starts: 8,
  mass: 108,
  hydro: 8,
} as const;

/** hollow-ridge (content/maps/hollow-ridge.rtsmap): identities fixed by ms2-p0/ms2-p2. */
export const HOLLOW_RIDGE = {
  name: 'Hollow Ridge',
  mapSimHash: 0x90ec94f0,
  /** Starts in WU: army 0 (player) NW plateau, army 1 SE plateau. */
  own: { x: 96, z: 96 },
  enemy: { x: 416, z: 416 },
  /** Deep lake centre (3.5 WU deep), a contested mass spot, a hydro spot. */
  deepWater: { x: 256, z: 256 },
  massSpot: { x: 112, z: 244 },
  hydroSpot: { x: 200, z: 150 },
} as const;

/** Writes a report to test-results/<name>.json and returns its path. */
export function writeReport(name: string, data: unknown): string {
  const dir = resolve(import.meta.dirname, '../../../test-results');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

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

/**
 * Map the MS1/MS2 specs run on unless their query names one: they assert hollow-ridge identities and
 * positions (starts, lake, spots). The default map of the game is Setons since the Setons package
 * (setons.spec.ts, map-load.spec.ts open the page without `map=`).
 */
export const PINNED_MAP_QUERY = 'map=hollow-ridge';

/** Adds {@link PINNED_MAP_QUERY} unless the query already selects a map. */
export function withPinnedMap(query: string): string {
  if (/(^|&)map=/.test(query)) return query;
  return query === '' ? PINNED_MAP_QUERY : `${PINNED_MAP_QUERY}&${query}`;
}

/**
 * Opens the game (root URL → redirect to /b/<hash>/) and waits for `ready` and the first units.
 * Without `map=` in the query the page opens hollow-ridge ({@link withPinnedMap}); `pinMap: false`
 * opens the game's default map (Setons).
 */
export async function openGame(page: Page, base: string, query = '', minUnits = 1, opts: { pinMap?: boolean; legacySelection?: boolean } = {}): Promise<void> {
  await installSilentOutput(page);
  const supplied = /(^|&)spawn=/.test(query) ? query : `${query}${query === '' ? '' : '&'}spawn=cubes`;
  const q = opts.pinMap === false ? supplied : withPinnedMap(supplied);
  // 'commit': the root page redirects with an inline location.replace before its load event
  // (Firefox then resolves goto() with null / may report an aborted navigation).
  await page.goto(base + (q === '' ? '' : `?${q}`), { waitUntil: 'commit' });
  await page.waitForURL(/\/b\/[^/]+\/(\?.*)?$/);
  await page.waitForFunction(() => window.__faf?.ready === true, null, { timeout: 30_000 });
  if (minUnits > 0) {
    await page.waitForFunction((n) => (window.__faf?.unitCount ?? 0) >= n, minUnits, { timeout: 30_000 });
  }
  // MS1/MS2 tests exercise the old all-units command scenario with an explicit selection.
  if (opts.legacySelection !== false) await page.evaluate(() => window.__faf!.select(null));
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
