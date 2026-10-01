import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { fafAudioAssets } from './audio-assets.ts';

const appDir = dirname(fileURLToPath(import.meta.url));
const measurementHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: appDir,
  base: './',
  plugins: [fafAudioAssets({ distDir: resolve(appDir, '../../content/audio/dist') })],
  server: { port: 5583, strictPort: true, headers: measurementHeaders },
  // E2E/bench port of this track (FAF_E2E_PORT, default 4583).
  preview: { port: Number(process.env['FAF_E2E_PORT'] ?? 4583), strictPort: true, headers: measurementHeaders },
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
