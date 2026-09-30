import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { fafAudioAssets } from './audio-assets.ts';

const appDir = dirname(fileURLToPath(import.meta.url));

/**
 * Cross-origin isolation (COOP/COEP) for dev and preview: browsers only expose fine-grained
 * `performance.now()` (µs instead of 0.1–1 ms steps) to isolated pages, which the main-thread
 * measurement of the demo needs. All resources are same-origin, so COEP costs nothing here.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: appDir,
  base: './',
  plugins: [fafAudioAssets({ distDir: resolve(appDir, '../../content/audio/dist') })],
  server: { port: 5583, strictPort: true, headers: isolationHeaders },
  // E2E/bench port of this track (FAF_E2E_PORT, default 4583).
  preview: { port: Number(process.env['FAF_E2E_PORT'] ?? 4583), strictPort: true, headers: isolationHeaders },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        main: resolve(appDir, 'index.html'),
        offline: resolve(appDir, 'offline.html'),
      },
    },
  },
});
