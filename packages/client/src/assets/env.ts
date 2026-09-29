/**
 * Browser/worker implementation of the asset environment (P3): `fetch` with streamed progress,
 * the Cache API (`caches.open('faf-assets-v1')`, key = content-hashed URL), SHA-256 via
 * `crypto.subtle` (pure-JS fallback on insecure origins) and the meshopt decoder. Every piece is
 * optional: no Cache API ⇒ plain fetch, no WebAssembly ⇒ no decoder (raw GLB fallback).
 */
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import type { MeshoptDecoderLike } from './glb.ts';
import { ASSET_CACHE_NAME, type AssetCache, type AssetEnv } from './loader.ts';
import { sha256 } from './sha256.ts';

interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

interface CacheLike {
  match(url: string): Promise<ResponseLike | undefined>;
  put(url: string, res: unknown): Promise<void>;
  delete(url: string): Promise<boolean>;
}

/** The globals the environment uses (default: `globalThis`). */
export interface AssetGlobals {
  readonly fetch?: (url: string, init?: { cache?: string }) => Promise<ResponseLike>;
  readonly caches?: { open(name: string): Promise<CacheLike> };
  readonly crypto?: { readonly subtle?: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } };
  readonly Response?: new (body: Uint8Array, init?: { headers?: Record<string, string> }) => unknown;
  readonly performance?: { now(): number };
}

async function readAll(res: ResponseLike, onBytes: (loaded: number) => void): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (reader === undefined) {
    const b = new Uint8Array(await res.arrayBuffer());
    onBytes(b.length);
    return b;
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined || value.length === 0) continue;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded);
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Creates the environment over `g` (default `globalThis`). `decoder`: the meshopt decoder to use
 * (default: meshoptimizer's, if WebAssembly is available); null disables compressed models.
 */
export function createAssetEnv(g: AssetGlobals = globalThis as unknown as AssetGlobals, decoder?: MeshoptDecoderLike | null): AssetEnv {
  const fetchFn = g.fetch;
  if (fetchFn === undefined) throw new Error('asset loading needs fetch()');
  const doFetch = fetchFn.bind(globalThis);
  return {
    async fetchBytes(url, onBytes) {
      const res = await doFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return readAll(res, onBytes);
    },
    async fetchText(url) {
      const res = await doFetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.text();
    },
    async openCache(): Promise<AssetCache | null> {
      const cs = g.caches;
      const Resp = g.Response;
      if (cs === undefined || Resp === undefined) return null;
      let cache: CacheLike;
      try {
        cache = await cs.open(ASSET_CACHE_NAME);
      } catch {
        return null; // e.g. insecure context, private mode, quota
      }
      return {
        async get(url) {
          const r = await cache.match(url);
          return r === undefined ? null : new Uint8Array(await r.arrayBuffer());
        },
        async put(url, bytes, contentType) {
          await cache.put(url, new Resp(bytes, { headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.length) } }));
        },
        async delete(url) {
          await cache.delete(url);
        },
      };
    },
    async sha256(bytes) {
      const subtle = g.crypto?.subtle;
      if (subtle !== undefined) {
        try {
          return new Uint8Array(await subtle.digest('SHA-256', bytes));
        } catch {
          // fall through to the JS implementation
        }
      }
      return sha256(bytes);
    },
    async decoder() {
      if (decoder !== undefined) return decoder;
      try {
        await MeshoptDecoder.ready;
        return MeshoptDecoder.supported ? MeshoptDecoder : null;
      } catch {
        return null;
      }
    },
    now() {
      return g.performance?.now() ?? Date.now();
    },
  };
}
