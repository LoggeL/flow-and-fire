import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { EDITOR_ORIGIN, EDITOR_PORT } from './test/e2e/support/ports.ts';

/**
 * Marker editor E2E (TRACK-EDITOR). One preview server of the built app (`pnpm test:e2e:editor`
 * builds first) on FAF_E2E_PORT (default 4783); no COOP/COEP needed. Launch options match the
 * root playwright.config.ts.
 */
const repoRoot = resolve(import.meta.dirname, '../..');

/**
 * macOS (Darwin 25+) denies non-Apple-signed apps access to ~/Library/Application Support/Firefox;
 * CFFIXED_USER_HOME points CoreFoundation's home lookup at a private directory (as in the root config).
 */
function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(repoRoot, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

const ffEnv = firefoxEnv();

export default defineConfig({
  testDir: 'test/e2e',
  outputDir: '../../test-results/marker-editor/artifacts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: '../../test-results/marker-editor/e2e.json' }]],
  use: {
    baseURL: EDITOR_ORIGIN,
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
          // Headless Chromium on macOS: ANGLE on Metal gives hardware WebGL2; SwiftShader stays the fallback.
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
  webServer: {
    command: `pnpm --filter @faf/marker-editor run serve --port ${EDITOR_PORT}`,
    url: `${EDITOR_ORIGIN}/maps/index.json`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
