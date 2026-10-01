import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.rtsmap': 'application/octet-stream',
  '.wasm': 'application/wasm',
};
const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const REQUEST_LIMIT = 4096;

interface FrozenFile { readonly bytes: Buffer; readonly sha256: string; readonly contentType: string; }
interface RequestReceipt { readonly method: string; readonly path: string; readonly status: number; readonly sha256: string | null; }
export interface FrozenServer {
  readonly origin: string;
  receipt(): {
    readonly origin: string;
    readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
    readonly requests: readonly RequestReceipt[];
    readonly droppedRequests: number;
  };
  close(): Promise<void>;
}

/** Reads the built directory once. Every GET/HEAD then serves exactly those frozen bytes. */
export async function startFrozenServer(dist: string): Promise<FrozenServer> {
  const root = realpathSync(dist), files = new Map<string, FrozenFile>();
  function inventory(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const path = resolve(dir, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Frozen build contains a symlink: ${path}`);
      if (stat.isDirectory()) inventory(path);
      else if (stat.isFile()) {
        const bytes = readFileSync(path);
        files.set('/' + relative(root, path).split(sep).join('/'), {
          bytes, sha256: createHash('sha256').update(bytes).digest('hex'),
          contentType: MIME[extname(path)] ?? 'application/octet-stream',
        });
      } else throw new Error(`Unsupported frozen artifact: ${path}`);
    }
  }
  inventory(root);
  if (!files.has('/index.html') || !files.has('/qualification-build.json')) throw new Error('Missing frozen qualification build');
  const fileReceipt = [...files].map(([path, file]) => ({ path, bytes: file.bytes.length, sha256: file.sha256 }));
  const requests: RequestReceipt[] = [];
  let droppedRequests = 0, origin = '';
  const server = createServer((request, response) => {
    const method = request.method ?? '', raw = request.url ?? '';
    let path = raw, status = 200, file: FrozenFile | undefined;
    try {
      // Lookup is confined to the startup inventory, never a request-derived filesystem path.
      path = decodeURIComponent(raw.split('?', 1)[0]!);
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0')
        || path.split('/').some(part => part === '..' || part === '.')) status = 400;
      else if (request.headers.host !== origin.slice('http://'.length)) status = 403;
      else if (method !== 'GET' && method !== 'HEAD') status = 405;
      else {
        file = files.get(path === '/' ? '/index.html' : path);
        if (file === undefined) status = 404;
      }
    } catch { status = 400; }
    if (requests.length < REQUEST_LIMIT) requests.push({ method, path, status, sha256: status === 200 ? file!.sha256 : null });
    else droppedRequests++;
    const bytes = status === 200 ? file!.bytes : Buffer.from(`Frozen qualification request failed: ${status}`);
    response.writeHead(status, { ...HEADERS, 'Content-Type': status === 200 ? file!.contentType : 'text/plain; charset=utf-8',
      'Content-Length': bytes.length, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) });
    response.end(method === 'HEAD' ? undefined : bytes);
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') { server.close(); throw new Error('Missing loopback server address'); }
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    receipt: () => ({ origin, files: fileReceipt, requests: requests.slice(), droppedRequests }),
    close: () => new Promise<void>((done, reject) => {
      server.close(error => error === undefined ? done() : reject(error));
      server.closeAllConnections();
    }),
  };
}
