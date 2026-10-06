import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { FX_E2E_ORIGIN, FX_E2E_PORT } from './test/e2e/support/port.ts';

// Screenshot E2E of the fx-lab (`FAF_E2E_PORT=4683 tools/heavy pnpm test:e2e:fx`): own preview server on
// port FAF_E2E_PORT ?? 4683 (never collides with the game E2E on 4183/4184), one worker, browsers one
// after another. The launch options are those of the root playwright.config.ts.

const REPO_DIR = resolve(import.meta.dirname, '../..');

/**
 * macOS (Darwin 25+) denies non-Apple-signed apps access to ~/Library/Application Support/Firefox; as
 * in the root config, CFFIXED_USER_HOME points CoreFoundation at a private directory.
 */
function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(REPO_DIR, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

const ffEnv = firefoxEnv();

export default defineConfig({
  testDir: 'test/e2e',
  // Vitest unit tests of the benchmark helpers live next to the specs as *.test.ts.
  testMatch: '**/*.spec.ts',
  outputDir: resolve(REPO_DIR, 'test-results/fx-lab-e2e'),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: resolve(REPO_DIR, 'test-results/fx-lab-e2e.json') }]],
  use: {
    baseURL: FX_E2E_ORIGIN,
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
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
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
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
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
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    // `test:e2e:fx` builds apps/fx-lab/dist first; the preview server only serves it.
    command: `pnpm --filter @faf/fx-lab exec vite preview --host 127.0.0.1 --port ${FX_E2E_PORT} --strictPort`,
    url: `${FX_E2E_ORIGIN}/index.html`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
