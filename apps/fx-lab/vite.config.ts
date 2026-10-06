import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const appDir = dirname(fileURLToPath(import.meta.url));

/** Playwright/E2E port of the fx-lab (preview server); FAF_E2E_PORT overrides it. Port 5199 is reserved for the user. */
const e2ePort = Number(process.env['FAF_E2E_PORT'] ?? '4683');

export default defineConfig({
  root: appDir,
  base: './',
  // The dev server defaults to 4685 and moves on if taken.
  server: { port: 4685, strictPort: false, fs: { allow: [resolve(appDir, '../..')] } },
  preview: { port: e2ePort, strictPort: true },
  build: {
    outDir: resolve(appDir, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
