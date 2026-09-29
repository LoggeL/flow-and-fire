import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// SPK4 benchmark page (tools/render-bench/page → tools/render-bench/dist). Built by `build:bench` and by
// scripts/spk4.ts (programmatic build, no dev server); served to Playwright through page.route.
const pkgDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(pkgDir, 'page'),
  base: './',
  logLevel: 'warn',
  clearScreen: false,
  build: {
    outDir: resolve(pkgDir, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
