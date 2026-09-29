import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { COI_ORIGIN, COI_PORT, NO_COI_ORIGIN, NO_COI_PORT } from './test/e2e/support/ports.ts';

// FINAL root config: packages only add specs under test/e2e.
// Server COI_PORT (default 4183): COOP/COEP (crossOriginIsolated, SAB transport); NO_COI_PORT (4184): plain
// (transfer transport). See test/e2e/support/ports.ts (FAF_E2E_PORT).
const COI_URL = COI_ORIGIN;
const NO_COI_URL = NO_COI_ORIGIN;

/**
 * macOS (Darwin 25+) denies non-Apple-signed apps access to ~/Library/Application Support/Firefox
 * ("Operation not permitted"), and Playwright's Firefox then dies with "Could not find profile folder."
 * CFFIXED_USER_HOME points CoreFoundation's home lookup at a private directory instead.
 */
function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(import.meta.dirname, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

const ffEnv = firefoxEnv();

export default defineConfig({
  testDir: 'test/e2e',
  outputDir: 'test-results/e2e-artifacts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL: COI_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Headless Chromium on macOS: ANGLE on Metal gives hardware WebGL2; keep SwiftShader as explicit fallback.
          args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          ...(ffEnv !== undefined ? { env: ffEnv } : {}),
          firefoxUserPrefs: {
            'webgl.force-enabled': true,
            'webgl.disabled': false,
          },
        },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @faf/game run serve --port ${COI_PORT} --coi`,
      url: `${COI_URL}/build.json`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @faf/game run serve --port ${NO_COI_PORT}`,
      url: `${NO_COI_URL}/build.json`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
