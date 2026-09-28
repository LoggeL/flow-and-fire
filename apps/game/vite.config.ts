import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

const appDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(appDir, 'dist');

/** COOP/COEP make the page cross-origin isolated (SharedArrayBuffer transport). */
const COI_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function resolveBuildHash(): string {
  const fromEnv = process.env['IRONFLOW_BUILD_HASH'];
  if (fromEnv !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(fromEnv)) return fromEnv;
  try {
    const out = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (/^[0-9a-f]{4,40}$/.test(out)) return out;
  } catch {
    // not a git checkout (or git missing): fall through
  }
  return 'dev';
}

/** Writes dist/index.html (redirect to the current build) and dist/build.json. */
function buildManifestPlugin(buildHash: string): Plugin {
  return {
    name: 'faf-build-manifest',
    apply: 'build',
    closeBundle() {
      mkdirSync(distDir, { recursive: true });
      const target = `/b/${buildHash}/`;
      const html = [
        '<!doctype html>',
        '<html lang="de">',
        '<head>',
        '<meta charset="utf-8">',
        '<title>Flow &amp; Fire</title>',
        `<meta http-equiv="refresh" content="0; url=${target}">`,
        `<script>location.replace(${JSON.stringify(target)} + location.search + location.hash);</script>`,
        '</head>',
        `<body><a href="${target}">Flow &amp; Fire</a></body>`,
        '</html>',
        '',
      ].join('\n');
      writeFileSync(resolve(distDir, 'index.html'), html);
      writeFileSync(resolve(distDir, 'build.json'), JSON.stringify({ buildHash }, null, 2) + '\n');
    },
  };
}

export default defineConfig(({ command }) => {
  const buildHash = command === 'build' ? resolveBuildHash() : 'dev';
  return {
    root: appDir,
    base: command === 'build' ? `/b/${buildHash}/` : '/',
    plugins: [preact(), buildManifestPlugin(buildHash)],
    define: {
      __IRONFLOW_BUILD_HASH__: JSON.stringify(buildHash),
    },
    server: {
      port: 5173,
      strictPort: false,
      headers: COI_HEADERS,
    },
    preview: {
      headers: COI_HEADERS,
    },
    worker: {
      format: 'es',
    },
    build: {
      outDir: resolve(distDir, 'b', buildHash),
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: true,
      assetsInlineLimit: 0,
    },
  };
});
