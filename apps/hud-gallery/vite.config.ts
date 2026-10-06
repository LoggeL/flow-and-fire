/**
 * HUD gallery (Vite + Preact). Parallel-friendly (several agents build/test at once):
 *   FAF_HUD_OUT_DIR   build output, relative to apps/hud-gallery (default dist)
 *   FAF_HUD_E2E_PORT  preview port (default 4483, strictPort)
 * After the build, the story registry is evaluated once in Node (Vite module runner) and written to
 * <outDir>/stories.json, so Playwright can declare one test per story at collection time.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, runnerImport } from 'vite';
import type { Plugin } from 'vite';

const appDir = dirname(fileURLToPath(import.meta.url));
const outDir = process.env['FAF_HUD_OUT_DIR'] || 'dist';
const port = Number(process.env['FAF_HUD_E2E_PORT'] || 4483);

interface RegistryModule {
  storyManifest(): unknown[];
  REGISTRY_ERRORS: readonly string[];
}

/**
 * Stylesheets are irrelevant for the manifest; Vite 8's CSS plugin also fails inside runnerImport
 * (cssModulesCache not initialised), so CSS imports resolve to an empty virtual module there.
 */
function stubCss(): Plugin {
  // One shared virtual id without a .css suffix (vite:css-post matches ids by extension).
  const STUB = '\0faf-stub-css';
  return {
    name: 'faf-hud-stub-css',
    enforce: 'pre',
    resolveId(source) {
      return /\.css(?:$|\?)/.test(source) ? STUB : null;
    },
    load(id) {
      return id === STUB ? 'export default "";' : null;
    },
  };
}

/** Writes <outDir>/stories.json ({ stories: StoryMeta[], errors: string[] }) after the bundle is written. */
function storyManifest(): Plugin {
  let out = '';
  return {
    name: 'faf-hud-story-manifest',
    apply: 'build',
    configResolved(config) {
      out = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const { module } = await runnerImport<RegistryModule>(resolve(appDir, 'src/registry.ts'), {
        configFile: false,
        root: appDir,
        logLevel: 'error',
        plugins: [stubCss(), preact()],
      });
      const manifest = { stories: module.storyManifest(), errors: module.REGISTRY_ERRORS };
      writeFileSync(resolve(out, 'stories.json'), `${JSON.stringify(manifest, null, 1)}\n`);
      console.log(`[hud-gallery] stories.json: ${manifest.stories.length} stories, ${manifest.errors.length} registry errors`);
    },
  };
}

export default defineConfig({
  root: appDir,
  base: './',
  plugins: [preact(), storyManifest()],
  build: {
    outDir,
    emptyOutDir: true,
    // One app chunk is fine for a dev tool; the strategic icon sprite alone is ~75 kB.
    chunkSizeWarningLimit: 2048,
  },
  preview: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
  server: {
    host: '127.0.0.1',
  },
});
