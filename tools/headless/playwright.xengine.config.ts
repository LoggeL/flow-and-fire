import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-engine harness (L3/L6): Chromium, Firefox and WebKit strictly one after another
 * (workers 1, memory budget). No web server — the specs serve tools/headless/dist-harness through
 * page.route (https://flow-and-fire.test, COOP/COEP ⇒ crossOriginIsolated, fine timers).
 * Launch settings mirror the root playwright.config.ts.
 */
const dir = dirname(fileURLToPath(import.meta.url));

/** See root config: CFFIXED_USER_HOME works around the macOS profile-folder denial of Firefox. */
function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(dir, '../../node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

const ffEnv = firefoxEnv();

export default defineConfig({
  testDir: 'browser',
  outputDir: 'test-results/xengine-artifacts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 20 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    trace: 'off',
    screenshot: 'off',
    viewport: { width: 800, height: 600 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
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
});
