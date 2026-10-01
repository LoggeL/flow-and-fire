import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env['FAF_E2E_PORT'] ?? 4583);
export function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(import.meta.dirname, '../../node_modules/.cache/faf-audio-firefox-home'); mkdirSync(home, { recursive: true });
  return { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), CFFIXED_USER_HOME: home };
}
const ff = firefoxEnv();
export default defineConfig({ testDir: 'test/e2e', outputDir: 'test-results', workers: 1, fullyParallel: false, retries: 0, forbidOnly: true, timeout: 120000, expect: { timeout: 30000 }, reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]], use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1400, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' }, projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }, { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { ...(ff ? { env: ff } : {}) } } }, { name: 'webkit', use: devices['Desktop Safari'] }], webServer: { command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}/offline.html`, reuseExistingServer: false, timeout: 60000, stdout: 'ignore', stderr: 'pipe' } });
