import { defineConfig, devices } from '@playwright/test';
import { launchConfig } from './scripts/browser.ts';
const port = Number(process.env['FAF_E2E_PORT'] ?? 4683);
export default defineConfig({
  testDir: './test/e2e', testMatch: '**/*.spec.ts', outputDir: '../../test-results/fx-lab-e2e',
  workers: 1, retries: 0, timeout: 45_000, fullyParallel: false, reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: launchConfig('chromium').options } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: launchConfig('firefox').options } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], launchOptions: launchConfig('webkit').options } },
  ],
  webServer: { command: `pnpm --filter @faf/fx-lab exec vite preview --port ${port} --strictPort`, cwd: '../..', url: `http://localhost:${port}`, reuseExistingServer: false, timeout: 30_000 },
});
