/**
 * CLI: pnpm sfx:preview [--port 5190]
 * Serves the preview page (tools/sfx/preview) and the build output (content/audio/dist) from the repo
 * root on localhost. Only these two folders are reachable.
 */
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from '../src/pipeline.ts';

const { values } = parseArgs({ options: { port: { type: 'string', default: '5190' } } });
const port = Number(values.port);
const ALLOWED = ['tools/sfx/preview/', 'content/audio/dist/'];
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.png': 'image/png',
};

createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '') {
      res.writeHead(302, { location: '/tools/sfx/preview/' });
      res.end();
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const abs = path.resolve(REPO_ROOT, rel);
    const inside = ALLOWED.some((a) => abs.startsWith(path.join(REPO_ROOT, a)));
    if (!inside || !existsSync(abs) || !statSync(abs).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(abs));
  })().catch((e: unknown) => {
    res.writeHead(500);
    res.end(String(e));
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`[sfx:preview] http://localhost:${port}/tools/sfx/preview/  (Strg+C beendet)`);
});
