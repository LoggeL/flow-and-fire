import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Render demo (packages/render/demo): `pnpm --filter @faf/render demo` (manual only) and the browser
// smoke test (`smoke`), which builds into dist/demo (covered by the dist ignore patterns).
const pkgDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(pkgDir, 'demo'),
  base: './',
  logLevel: 'warn',
  clearScreen: false,
  server: { port: 5190, strictPort: false },
  build: {
    outDir: resolve(pkgDir, 'dist/demo'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
});
