import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

const appDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(appDir, 'dist');
/** Output of tools/assets-pipeline (manifest + content-hashed map/sim.bin/view.json/models). */
const assetsSrc = resolve(appDir, '../../content/generated/assets');
/** URL path of the assets below the base (dev: `/assets/`, build: `/b/<hash>/assets/`). */
const ASSETS_DIR = 'assets';

/** MIME types of the pipeline output (mirrors scripts/serve.mjs and deploy/nginx.conf). */
const ASSET_MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.rtsmap': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
};

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

/**
 * Pipeline assets: in the dev server served from content/generated/assets under `/assets/` (with
 * COOP/COEP/CORP, revalidated every time — the pipeline may rebuild them); in the build copied to
 * `dist/b/<buildHash>/assets/` (immutable there like every file of the build).
 */
function pipelineAssetsPlugin(outDir: string): Plugin {
  return {
    name: 'faf-pipeline-assets',
    configureServer(server) {
      // COOP/COEP/CORP on *every* dev response, including Vite's own modules (`/@vite/client`,
      // `/@fs/…/vite/dist/client/env.mjs`) that module workers import: `server.headers` does not
      // reach those, and WebKit then blocks the sim/asset worker under COEP.
      server.middlewares.use((_req, res, next) => {
        for (const [k, v] of Object.entries(COI_HEADERS)) res.setHeader(k, v);
        next();
      });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const prefix = `/${ASSETS_DIR}/`;
        if (!url.pathname.startsWith(prefix)) {
          next();
          return;
        }
        let rel: string;
        try {
          rel = normalize(decodeURIComponent(url.pathname.slice(prefix.length)));
        } catch {
          rel = '';
        }
        const abs = resolve(assetsSrc, rel);
        if (rel === '' || rel.includes('\0') || !abs.startsWith(assetsSrc + sep) || !existsSync(abs) || !statSync(abs).isFile()) {
          res.statusCode = 404;
          for (const [k, v] of Object.entries(COI_HEADERS)) res.setHeader(k, v);
          res.end('404 Not Found\n');
          return;
        }
        res.statusCode = 200;
        for (const [k, v] of Object.entries(COI_HEADERS)) res.setHeader(k, v);
        res.setHeader('Content-Type', ASSET_MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(abs).size));
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(abs).pipe(res);
      });
    },
    writeBundle() {
      if (!existsSync(resolve(assetsSrc, 'manifest.json'))) {
        throw new Error(`missing ${assetsSrc}/manifest.json – run \`pnpm assets\` (tools/assets-pipeline) first`);
      }
      cpSync(assetsSrc, resolve(outDir, ASSETS_DIR), { recursive: true });
    },
  };
}

export default defineConfig(({ command }) => {
  const buildHash = command === 'build' ? resolveBuildHash() : 'dev';
  const outDir = resolve(distDir, 'b', buildHash);
  return {
    root: appDir,
    base: command === 'build' ? `/b/${buildHash}/` : '/',
    plugins: [preact(), pipelineAssetsPlugin(outDir), buildManifestPlugin(buildHash)],
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
      outDir,
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: true,
      assetsInlineLimit: 0,
    },
  };
});
