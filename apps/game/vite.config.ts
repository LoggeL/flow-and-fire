import { cpSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blueprintHmr } from './blueprint-hmr.ts';
import { resolveBuildHash } from './scripts/build-hash.ts';
import { fafAudioAssets } from '../audio-demo/audio-assets.ts';
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
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webm': 'audio/webm',
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
        `<link rel="icon" type="image/png" sizes="32x32" href="${target}favicon.png">`,
        `<meta http-equiv="refresh" content="0; url=${target}">`,
        `<script>location.replace(${JSON.stringify(target)} + location.search + location.hash);</script>`,
        '</head>',
        `<body><a href="${target}">Flow &amp; Fire</a></body>`,
        '</html>',
        '',
      ].join('\n');
      writeFileSync(resolve(distDir, 'index.html'), html);
      writeFileSync(resolve(distDir, 'build.json'), JSON.stringify({ buildHash }, null, 2) + '\n');
      writeFileSync(resolve(distDir, 'b', buildHash, 'replay-capabilities.json'), JSON.stringify({ buildHash, replayPlayer: 1, sessionTransfer: 1 }) + '\n');
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
      // Retained builds use their own bundled code/assets. Missing historical routes are real
      // 404s, never the current development SPA falsely claiming compatibility.
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/b/')) { next(); return; }
        const route = /^\/b\/([A-Za-z0-9_-]{1,64})\/(.*)$/.exec(url.pathname);
        let relative = '';
        try { relative = decodeURIComponent(route?.[2] ?? ''); } catch { /* rejected below */ }
        const directory = resolve(distDir, 'b', route?.[1] ?? '__invalid__');
        const absolute = resolve(directory, relative || 'index.html');
        if (route === null || relative.includes('\0') || !absolute.startsWith(directory + sep)
          || !existsSync(absolute) || !statSync(absolute).isFile()) {
          res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('404 Not Found\n'); return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
        res.statusCode = 200;
        res.setHeader('Content-Type', ASSET_MIME[extname(absolute).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(absolute).size));
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(absolute).pipe(res);
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
  const buildHash = command === 'build' ? resolveBuildHash(appDir) : 'dev';
  const outDir = resolve(distDir, 'b', buildHash);
  return {
    root: appDir,
    base: command === 'build' ? `/b/${buildHash}/` : '/',
    plugins: [preact(), blueprintHmr(resolve(appDir, '../..')), pipelineAssetsPlugin(outDir), fafAudioAssets({ distDir: resolve(appDir, '../../content/audio/dist') }), buildManifestPlugin(buildHash)],
    define: {
      __FAF_BUILD_HASH__: JSON.stringify(buildHash),
    },
    server: {
      port: 5173,
      strictPort: false,
      headers: COI_HEADERS,
      fs: { allow: [resolve(appDir, '../..'), ...(process.env['FAF_BLUEPRINT_DIR'] ? [resolve(process.env['FAF_BLUEPRINT_DIR'])] : []), ...(process.env['FAF_LOCALES_DIR'] ? [resolve(process.env['FAF_LOCALES_DIR'])] : [])] },
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
