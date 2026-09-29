/**
 * Build of the cross-engine harness (script `build:harness`): page + module worker into
 * tools/headless/dist-harness/. Served by the Playwright specs via page.route (no web server).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(dir, 'src/harness/page'),
  base: './',
  publicDir: false,
  logLevel: 'warn',
  worker: { format: 'es' },
  build: {
    outDir: resolve(dir, 'dist-harness'),
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    sourcemap: false,
    assetsInlineLimit: 0,
    reportCompressedSize: false,
  },
});
