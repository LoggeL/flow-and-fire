import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Connect, type Plugin } from 'vite';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, '../..');
/** Source maps of the game (the editor reads and writes these files). */
const mapsDir = resolve(repoRoot, 'content/maps');
/** URL prefix of the maps in dev, preview and the build. */
const MAPS_PREFIX = '/maps/';
/** Map file names are plain (no path separators, no dot-files). */
const MAP_FILE_RE = /^[a-z0-9][a-z0-9_-]*\.rtsmap$/;

export interface MapIndexEntry {
  readonly name: string;
  readonly file: string;
  readonly bytes: number;
}

/** content/maps/*.rtsmap as index entries, sorted by name (code-unit order, deterministic). */
export function listMaps(dir: string = mapsDir): MapIndexEntry[] {
  if (!existsSync(dir)) return [];
  const out: MapIndexEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!MAP_FILE_RE.test(file)) continue;
    const st = statSync(join(dir, file));
    if (!st.isFile()) continue;
    out.push({ name: file.slice(0, -'.rtsmap'.length), file, bytes: st.size });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Serves content/maps as /maps/<name>.rtsmap plus /maps/index.json in dev AND preview, and copies
 * both into dist/maps/ on build (pattern: modelsPlugin of apps/model-viewer).
 */
function mapsPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    if (!url.startsWith(MAPS_PREFIX)) return next();
    const rest = decodeURIComponent(url.slice(MAPS_PREFIX.length));
    res.setHeader('Cache-Control', 'no-store');
    if (rest === 'index.json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(listMaps()));
      return;
    }
    const file = join(mapsDir, rest);
    if (!MAP_FILE_RE.test(rest) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end(`map not found: ${url}`);
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(statSync(file).size));
    createReadStream(file).pipe(res);
  };
  return {
    name: 'faf-editor-maps',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      // Runs before the static dist handler: preview always serves the current content/maps.
      server.middlewares.use(middleware);
    },
    generateBundle() {
      const maps = listMaps();
      for (const m of maps) {
        this.emitFile({ type: 'asset', fileName: `maps/${m.file}`, source: readFileSync(join(mapsDir, m.file)) });
      }
      this.emitFile({ type: 'asset', fileName: 'maps/index.json', source: JSON.stringify(maps) });
    },
  };
}

export default defineConfig({
  root: appDir,
  // 5199 belongs to the user, 5210 to the model viewer; the editor defaults to 5220 and moves on if taken.
  server: { port: 5220, strictPort: false, fs: { allow: [repoRoot] } },
  preview: { port: 5221, strictPort: false },
  plugins: [preact(), mapsPlugin()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rollupOptions: { input: { main: resolve(appDir, 'index.html') } } },
});
