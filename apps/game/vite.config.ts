import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function git(args: string[]): Buffer {
  return execFileSync('git', args, { cwd: appDir, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
}

/**
 * Build hash for `/b/<buildHash>/` (PLAN §3.1 build versioning): the short commit hash; a build from a
 * dirty working tree gets `-d<8 hex>` over the diff against HEAD plus the untracked files, so it never
 * overwrites (or shares an immutable URL with) the clean build of the same commit.
 */
function resolveBuildHash(): string {
  // FAF_BUILD_HASH wins; IRONFLOW_BUILD_HASH is the pre-rename name (still documented in README).
  for (const name of ['FAF_BUILD_HASH', 'IRONFLOW_BUILD_HASH']) {
    const fromEnv = process.env[name];
    if (fromEnv !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(fromEnv)) return fromEnv;
  }
  try {
    const head = git(['rev-parse', '--short=12', 'HEAD']).toString().trim();
    if (!/^[0-9a-f]{4,40}$/.test(head)) return 'dev';
    const root = git(['rev-parse', '--show-toplevel']).toString().trim();
    const diff = git(['diff', 'HEAD', '--binary']);
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter((f) => f !== '').sort();
    if (diff.length === 0 && untracked.length === 0) return head;
    const h = createHash('sha256').update(diff);
    for (const f of untracked) {
      h.update(`\0${f}\0`);
      try {
        h.update(readFileSync(resolve(root, f)));
      } catch {
        // vanished or unreadable: the name alone still distinguishes it
      }
    }
    return `${head}-d${h.digest('hex').slice(0, 8)}`;
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
      __FAF_BUILD_HASH__: JSON.stringify(buildHash),
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
