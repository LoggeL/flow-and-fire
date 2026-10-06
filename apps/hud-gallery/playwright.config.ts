/**
 * Playwright for the HUD gallery (own config, independent of the root game E2E config).
 *   vite build first (writes <outDir>/stories.json), then: playwright test -c playwright.config.ts
 * Parallel runs: FAF_HUD_E2E_PORT (preview port, default 4483), FAF_HUD_OUT_DIR (build dir, default dist),
 * FAF_HUD_SHOT_DIR (screenshots/artifacts/report relative to the repo root, default test-results/hud-gallery).
 * perf.spec.ts (hud-p5) only runs with FAF_HUD_PERF=1 – and then alone: FAF_HUD_PERF=1 selects perf.spec.ts
 * only, otherwise it is ignored, so the gallery run and the benchmark never mix.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { APP_DIR, BASE_URL, OUT_DIR_ARG, PORT, SHOT_DIR } from './e2e/support/env.ts';

/**
 * macOS (Darwin 25+) denies non-Apple-signed apps access to ~/Library/Application Support/Firefox; Playwright's
 * Firefox then dies with "Could not find profile folder". CFFIXED_USER_HOME points CoreFoundation's home
 * lookup at a private directory instead (same workaround as the root playwright.config.ts).
 */
function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(APP_DIR, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

const ffEnv = firefoxEnv();
const perf = process.env['FAF_HUD_PERF'] === '1';

export default defineConfig({
  testDir: 'e2e',
  ...(perf ? { testMatch: ['**/perf.spec.ts'] } : { testIgnore: ['**/perf.spec.ts'] }),
  outputDir: join(SHOT_DIR, 'artifacts'),
  workers: 1,
  fullyParallel: false,
  // The Chromium time gate (FAF_PERF_GATE=1) is load-sensitive on a shared dev machine: one repeat after a failure,
  // both attempts are printed with the load average (docs/status/track-hud.md §7). Everything else: no retries.
  retries: perf && process.env['FAF_PERF_GATE'] === '1' ? 1 : 0,
  forbidOnly: true,
  timeout: perf ? 300_000 : 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: join(SHOT_DIR, 'results.json') }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        launchOptions: {
          // Same flags as the root config (hardware WebGL via ANGLE/Metal, SwiftShader fallback).
          args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        deviceScaleFactor: 1,
        launchOptions: {
          ...(ffEnv !== undefined ? { env: ffEnv } : {}),
          firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false },
        },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --outDir ${JSON.stringify(OUT_DIR_ARG)} --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: APP_DIR,
    url: `${BASE_URL}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
