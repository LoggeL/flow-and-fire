import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';

const appDir = dirname(fileURLToPath(import.meta.url));
/** Output of `pnpm models` (GLBs, metadata, manifest.json). */
const modelsDist = resolve(appDir, '../../content/models/dist');
/** Icon grammar output (icons.json + svg/). */
const iconsDir = resolve(appDir, '../../content/icons');
const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml',
};
const MOUNTS: readonly (readonly [string, string])[] = [
  ['/models/', modelsDist],
  ['/icons/', iconsDir],
];

/** Serves content/models/dist under /models/ and content/icons under /icons/ (dev + preview), copies models into the build. */
function modelsPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    const mount = MOUNTS.find(([prefix]) => url.startsWith(prefix));
    if (mount === undefined) return next();
    const [prefix, dir] = mount;
    const file = normalize(join(dir, decodeURIComponent(url.slice(prefix.length))));
    if (!file.startsWith(dir + sep) || !MIME[extname(file)] || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end(`not found (run "pnpm models"): ${url}`);
      return;
    }
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'faf-models-dist',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    generateBundle() {
      if (!existsSync(modelsDist)) return;
      for (const name of readdirSync(modelsDist).sort()) {
        this.emitFile({ type: 'asset', fileName: `models/${name}`, source: readFileSync(join(modelsDist, name)) });
      }
      const index = join(iconsDir, 'icons.json');
      if (existsSync(index)) this.emitFile({ type: 'asset', fileName: 'icons/icons.json', source: readFileSync(index) });
    },
  };
}

export default defineConfig({
  root: appDir,
  // Port 5199 belongs to the user; the viewer defaults to 5210 and moves on if taken.
  server: { port: 5210, strictPort: false, fs: { allow: [resolve(appDir, '../..')] } },
  preview: { port: 5211, strictPort: false },
  plugins: [modelsPlugin()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
