import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of @faf/audio with a real (Offline)AudioContext and the battle demo
 * (TRACK-AUDIOENG, audioeng-c2). Run: `FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo test:e2e`.
 *
 * The web server first builds the demo (`vite build`) and then serves `dist/` with
 * `vite preview --port <FAF_E2E_PORT|4583> --strictPort` (COOP/COEP headers from vite.config.ts);
 * `FAF_AUDIO_SKIP_BUILD=1` reuses an existing `dist/`. The server is always started fresh and
 * stopped by Playwright afterwards (reuseExistingServer false).
 */

const appDir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env['FAF_E2E_PORT'] ?? 4583);
const origin = `http://127.0.0.1:${port}`;
const build = process.env['FAF_AUDIO_SKIP_BUILD'] === '1' ? '' : 'pnpm exec vite build --logLevel warn && ';

/**
 * macOS (Darwin 25+) denies non-Apple-signed apps access to ~/Library/Application Support/Firefox
 * and Playwright's Firefox then dies with "Could not find profile folder". CFFIXED_USER_HOME points
 * CoreFoundation's home lookup at a private directory instead (same workaround as the root config).
 */
function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(appDir, 'node_modules/.cache/faf-firefox-home');
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
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], launchOptions: { ...(ffEnv !== undefined ? { env: ffEnv } : {}) } },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `${build}pnpm exec vite preview --port ${port} --strictPort --host 127.0.0.1`,
    cwd: appDir,
    url: `${origin}/index.html`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
