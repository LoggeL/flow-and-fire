import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Browser smoke harness of @faf/render-fx (packages/render-fx/smoke → packages/render-fx/dist/smoke).
// Built programmatically by scripts/smoke.ts (no dev server) and served to Playwright through page.route.
const pkgDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(pkgDir, 'smoke'),
  base: './',
  logLevel: 'warn',
  clearScreen: false,
  build: {
    outDir: resolve(pkgDir, 'dist/smoke'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
});
