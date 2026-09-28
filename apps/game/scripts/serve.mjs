#!/usr/bin/env node
// Minimal static server for apps/game/dist (no dependencies).
// Usage: node scripts/serve.mjs [--port N] [--coi] [--host H]
//   --coi  send COOP same-origin + COEP require-corp + CORP same-origin (crossOriginIsolated === true)
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/ogg',
};

function parseArgs(argv) {
  const opts = { port: 4173, host: null, coi: false, root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--coi') opts.coi = true;
    else if (a === '--port') opts.port = Number.parseInt(argv[++i] ?? '', 10);
    else if (a.startsWith('--port=')) opts.port = Number.parseInt(a.slice(7), 10);
    else if (a === '--host') opts.host = argv[++i] ?? opts.host;
    else if (a === '--root') opts.root = argv[++i] ?? null;
    else {
      console.error(`serve: unknown argument ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0 || opts.port > 65535) {
    console.error('serve: invalid --port');
    process.exit(2);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(opts.root ?? join(appDir, 'dist'));

function fileFor(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  let abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  try {
    let st = statSync(abs);
    if (st.isDirectory()) {
      abs = join(abs, 'index.html');
      st = statSync(abs);
    }
    return st.isFile() ? { abs, size: st.size } : null;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  const headers = { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  if (opts.coi) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    headers['Cross-Origin-Resource-Policy'] = 'same-origin';
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = fileFor(pathname);
  if (file === null) {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found\n');
    return;
  }
  const type = MIME[extname(file.abs).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': String(file.size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file.abs).pipe(res);
});

const onListening = () => {
  console.log(`faf serve: http://localhost:${opts.port}/ root=${root} coi=${opts.coi}`);
};
// Without --host, listen on all interfaces (dual-stack) so both 127.0.0.1 and ::1 ("localhost") work.
if (opts.host === null) server.listen(opts.port, onListening);
else server.listen(opts.port, opts.host, onListening);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
