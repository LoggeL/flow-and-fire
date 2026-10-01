/**
 * Vite plugin: ships the Opus/WebM sound bank of content/audio/dist under `audio/`.
 *
 * dev + preview: a middleware answers ONLY `/audio/manifest.json` and
 * `/audio/<scope>/<name>.v<n>.webm` (whitelist regex, resolved path must stay inside `distDir`,
 * no WAVs, no directory listing); everything else below `/audio/` is a 404.
 * build: emits the same files as assets under `audio/` (manifest.json + every .webm).
 *
 * MS5 reuses this for apps/game (or the assets pipeline takes over the same URL layout).
 */

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';

export interface FafAudioAssetsOptions {
  /** Absolute path of content/audio/dist. */
  distDir: string;
  /** URL prefix (default '/audio/'). */
  urlPrefix?: string;
}

/** Relative asset paths the plugin serves (below the dist dir / URL prefix). */
export const AUDIO_ASSET_RE = /^(?:manifest\.json|[a-z][a-z0-9_]*\/[a-z0-9_]+\.v\d{1,3}\.webm)$/;

function contentType(rel: string): string {
  return rel.endsWith('.json') ? 'application/json; charset=utf-8' : 'audio/webm';
}

/** Resolves a relative asset path to a file inside `distDir`, or null (not whitelisted / missing). */
export function resolveAudioAsset(distDir: string, rel: string): string | null {
  if (!AUDIO_ASSET_RE.test(rel)) return null;
  const root = resolve(distDir);
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep)) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/** All whitelisted files of `distDir` (relative, '/'-separated, sorted). */
export function listAudioAssets(distDir: string): string[] {
  const root = resolve(distDir);
  const out: string[] = [];
  if (!existsSync(root)) return out;
  if (resolveAudioAsset(root, 'manifest.json') !== null) out.push('manifest.json');
  for (const scope of readdirSync(root).sort()) {
    const dir = resolve(root, scope);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).sort()) {
      const rel = `${scope}/${name}`;
      if (resolveAudioAsset(root, rel) !== null) out.push(rel);
    }
  }
  return out;
}

export function fafAudioAssets(opts: FafAudioAssetsOptions): Plugin {
  const distDir = resolve(opts.distDir);
  const prefix = opts.urlPrefix ?? '/audio/';

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (!path.startsWith(prefix)) {
      next();
      return;
    }
    const rel = path.slice(prefix.length);
    // Encoded characters are never needed for whitelisted names; refuse them instead of decoding.
    const file = rel.includes('%') ? null : resolveAudioAsset(distDir, rel);
    if (file === null || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.statusCode = file === null ? 404 : 405;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(file === null ? `not an audio asset: ${path}` : 'method not allowed');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType(rel));
    res.setHeader('Content-Length', String(statSync(file).size));
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };

  return {
    name: 'faf-audio-assets',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    generateBundle() {
      const files = listAudioAssets(distDir);
      if (!files.includes('manifest.json')) this.error(`faf-audio-assets: ${distDir}/manifest.json missing (run "pnpm sfx")`);
      const base = prefix.replace(/^\/+/, '');
      for (const rel of files) {
        this.emitFile({ type: 'asset', fileName: `${base}${rel}`, source: readFileSync(resolve(distDir, rel)) });
      }
    },
  };
}
