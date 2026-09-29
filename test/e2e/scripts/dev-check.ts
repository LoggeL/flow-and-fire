/**
 * Dev check (MS2): opens a running game (dev server or `serve.mjs`) in a real browser and checks
 * the map session: terrain drawn, deep water water-colored, mass/hydro spot decals visible, the
 * cubes stand on the terrain (frame y == CPU height), CPU == GPU heights, no console errors.
 *
 *   node --import tsx test/e2e/scripts/dev-check.ts --url http://localhost:5173/ [--browser chromium|firefox|webkit]
 *
 * Writes test-results/dev-check-<browser>.json and a screenshot; exit code 1 on a failed check.
 * The server is not started or stopped here (whoever started it stops it).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit, type BrowserType, type LaunchOptions } from '@playwright/test';
import { decodePng, pixelStats } from '../support/png.ts';
import { checkSpot, checkWater, settle } from '../support/terrain.ts';
import type { FafTestHooks } from '../../../apps/game/src/hooks.ts';

declare global {
  interface Window {
    __faf?: FafTestHooks;
  }
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : def;
}

function launch(name: string): { type: BrowserType; options: LaunchOptions } {
  if (name === 'firefox') {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    if (process.platform === 'darwin') {
      const home = resolve(import.meta.dirname, '../../../node_modules/.cache/faf-firefox-home');
      mkdirSync(home, { recursive: true });
      env['CFFIXED_USER_HOME'] = home;
    }
    return { type: firefox, options: { env, firefoxUserPrefs: { 'webgl.force-enabled': true } } };
  }
  if (name === 'webkit') return { type: webkit, options: {} };
  return { type: chromium, options: { args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };
}

async function main(): Promise<void> {
  const url = arg('url', 'http://localhost:5173/');
  const browserName = arg('browser', 'chromium');
  const { type, options } = launch(browserName);
  const browser = await type.launch(options);
  const failures: string[] = [];
  const errors: string[] = [];
  const outDir = resolve(import.meta.dirname, '../../../test-results');
  mkdirSync(outDir, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    const res = await page.goto(url, { waitUntil: 'commit' });
    const headers = res === null ? {} : res.headers();
    await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', null, { timeout: 60_000 });
    await page.waitForFunction(() => (window.__faf?.unitCount ?? 0) >= 1000 && window.__faf!.tick >= 10, null, { timeout: 30_000 });
    const info = await page.evaluate(() => {
      const h = window.__faf!;
      return {
        coi: h.crossOriginIsolated,
        transport: h.transport,
        map: h.mapName,
        mapSimHash: h.mapSimHash,
        simId: h.simId,
        units: h.unitCount,
        render: h.renderStats(),
        heights: h.unitHeights(),
        probe: h.probeHeights(4000, 42),
        timings: h.loadTimings(),
        camera: h.camera(),
      };
    });
    await settle(page);
    const shot = await page.screenshot();
    writeFileSync(resolve(outDir, `dev-check-${browserName}.png`), shot);
    const pixels = pixelStats(decodePng(shot));
    const water = await checkWater(page);
    const mass = await checkSpot(page, 'mass', { x: 112, z: 244 });
    const hydro = await checkSpot(page, 'hydro', { x: 200, z: 150 });

    if (info.map !== 'Hollow Ridge') failures.push(`map ${info.map}`);
    if (info.units < 1024) failures.push(`units ${info.units} < 1024`);
    if (info.render.drawsByPass.terrain !== 1) failures.push(`terrain draws ${info.render.drawsByPass.terrain} ≠ 1`);
    if (info.render.unitInstances === 0) failures.push('no unit instances drawn');
    if (info.heights.mismatches !== 0) failures.push(`${info.heights.mismatches} units off the terrain`);
    if (info.probe.mismatches !== 0) failures.push(`CPU ≠ GPU in ${info.probe.mismatches} of ${info.probe.n} probes`);
    if (!water.ok) failures.push(`water pixel not water-colored: ${JSON.stringify(water.pixel)}`);
    if (mass.hits < 6) failures.push(`mass ring ${mass.hits}/16`);
    if (hydro.hits < 6) failures.push(`hydro ring ${hydro.hits}/16`);
    if (pixels.distinctColors < 16 || pixels.dominantShare > 0.9) failures.push(`canvas looks flat: ${JSON.stringify(pixels)}`);
    failures.push(...errors);

    const report = {
      url,
      browser: browserName,
      coop: headers['cross-origin-opener-policy'] ?? null,
      coep: headers['cross-origin-embedder-policy'] ?? null,
      ...info,
      pixels,
      water,
      mass,
      hydro,
      errors,
      failures,
    };
    writeFileSync(resolve(outDir, `dev-check-${browserName}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ url, browser: browserName, map: info.map, units: info.units, water: water.pixel, mass: mass.hits, hydro: hydro.hits, heights: info.heights.mismatches, probe: info.probe.mismatches, coep: report.coep, failures }, null, 1));
  } finally {
    await browser.close();
  }
  if (failures.length > 0) process.exitCode = 1;
}

await main();
