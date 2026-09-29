/**
 * Asset loading logic (P3) as plain functions over an injected environment, so the same code runs
 * in the asset worker, in-thread (no Worker) and in Node tests with fakes.
 *
 * Per asset: Cache API lookup (key = the content-hashed absolute URL; a hit needs no network) →
 * otherwise network fetch (streamed, progress per chunk) → SHA-256 integrity check against the
 * manifest (`sha256-<base64>`; a mismatching cache entry is evicted and re-fetched once, a
 * mismatching download is an error) → cache put → models: GLB parse + meshopt decode. A model
 * falls back to its uncompressed `.raw.glb` when the decoder is missing or fails, or when `raw`
 * is requested. Without the Cache API everything is fetched normally.
 */
import {
  ASSET_KINDS,
  parseAssetManifest,
  type AssetEntry,
  type AssetFileRef,
  type AssetManifest,
} from '@faf/blueprints/asset-manifest';
import { GlbError, parseGlb, type MeshoptDecoderLike } from './glb.ts';
import type { AssetLoadRequest, AssetLoadStats, AssetSource, AssetWorkerMessage } from './messages.ts';

/** Name of the Cache API cache (bump the suffix to drop all cached assets). */
export const ASSET_CACHE_NAME = 'faf-assets-v1';

/** Byte store keyed by URL (Cache API wrapper). */
export interface AssetCache {
  get(url: string): Promise<Uint8Array | null>;
  put(url: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(url: string): Promise<void>;
}

export interface AssetEnv {
  /** Network download; `onBytes(loadedSoFar)` is called for each received chunk. */
  fetchBytes(url: string, onBytes: (loaded: number) => void): Promise<Uint8Array>;
  /** Manifest download (always from the network, no cache). */
  fetchText(url: string): Promise<string>;
  /** Cache API store, or null if unavailable. */
  openCache(): Promise<AssetCache | null>;
  /** SHA-256 digest (crypto.subtle). */
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  /** meshopt decoder (ready), or null if unavailable. */
  decoder(): Promise<MeshoptDecoderLike | null>;
  /** Clock in ms. */
  now(): number;
}

export class AssetIntegrityError extends Error {
  constructor(
    readonly url: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`asset integrity check failed for ${url}: expected ${expected}, got ${actual}`);
    this.name = 'AssetIntegrityError';
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (with padding). */
export function base64(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    s += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    s += B64[n >> 18]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    s += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return s;
}

/** Resolves a manifest-relative URL against the manifest URL. */
export function resolveAssetUrl(manifestUrl: string, rel: string): string {
  return new URL(rel, manifestUrl).href;
}

const KIND_ORDER: Record<string, number> = { simbin: 0, viewjson: 1, map: 2, model: 3 };

/** Logical ids in load order: content, maps, models (each sorted). */
export function defaultLoadOrder(m: AssetManifest): string[] {
  return Object.keys(m.assets).sort((a, b) => {
    const ka = KIND_ORDER[m.assets[a]!.kind] ?? ASSET_KINDS.length;
    const kb = KIND_ORDER[m.assets[b]!.kind] ?? ASSET_KINDS.length;
    return ka - kb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

function contentType(url: string): string {
  if (url.endsWith('.glb')) return 'model/gltf-binary';
  if (url.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/** An owned ArrayBuffer with exactly the bytes of `v` (no copy if it already is one). */
export function ownedBuffer(v: Uint8Array): ArrayBuffer {
  if (v.byteOffset === 0 && v.byteLength === v.buffer.byteLength && v.buffer instanceof ArrayBuffer) return v.buffer;
  return v.slice().buffer as ArrayBuffer;
}

interface Totals {
  bytesTotal: number;
  bytesLoaded: number;
  bytesNetwork: number;
  bytesCache: number;
  fromCache: number;
  fromNetwork: number;
}

/**
 * Loads the assets of `req` and reports through `emit` (manifest, progress, asset/model, done).
 * Rejects on the first error (the caller reports it). At most `concurrency` downloads run at once.
 */
export async function loadAssets(env: AssetEnv, req: AssetLoadRequest, emit: (m: AssetWorkerMessage) => void, concurrency = 4): Promise<AssetLoadStats> {
  const t0 = env.now();
  const rid = req.requestId;
  const manifest = parseAssetManifest(await env.fetchText(req.manifestUrl));
  const ids = req.ids === undefined ? defaultLoadOrder(manifest) : [...req.ids];
  for (const id of ids) if (manifest.assets[id] === undefined) throw new Error(`asset manifest has no '${id}'`);
  const raw = req.raw === true;
  const cache = req.cache === false ? null : await env.openCache();
  const primary = (e: AssetEntry): AssetFileRef => (raw && e.kind === 'model' && e.fallback !== undefined ? e.fallback : e);
  const totals: Totals = { bytesTotal: 0, bytesLoaded: 0, bytesNetwork: 0, bytesCache: 0, fromCache: 0, fromNetwork: 0 };
  for (const id of ids) totals.bytesTotal += primary(manifest.assets[id]!).bytes;
  emit({ t: 'manifest', requestId: rid, manifest, bytesTotal: totals.bytesTotal, assets: ids.length });
  const decoder = ids.some((id) => manifest.assets[id]!.kind === 'model') && !raw ? await env.decoder() : null;

  const one = async (id: string): Promise<void> => {
    const e = manifest.assets[id]!;
    if (e.kind !== 'model') {
      const got = await fetchVerified(env, cache, req.manifestUrl, id, e, totals, emit, rid);
      emit({ t: 'asset', requestId: rid, id, kind: e.kind, source: got.source, bytes: ownedBuffer(got.bytes) });
      return;
    }
    let reason: string | null = raw ? 'raw requested (?assets=raw)' : null;
    if (!raw) {
      if (decoder === null || !decoder.supported) reason = 'meshopt decoder unavailable';
      else {
        const got = await fetchVerified(env, cache, req.manifestUrl, id, e, totals, emit, rid);
        try {
          const model = parseGlb(got.bytes, decoder);
          emit({ t: 'model', requestId: rid, id, source: got.source, variant: 'meshopt', fallbackReason: null, lods: model.lods, parts: model.parts });
          return;
        } catch (err) {
          if (!(err instanceof GlbError) || (err.code !== 'meshopt-failed' && err.code !== 'meshopt-unavailable')) throw err;
          reason = err.message;
        }
      }
    }
    const fb = e.fallback;
    if (fb === undefined) throw new Error(`model '${id}' cannot be decoded (${reason ?? 'no decoder'}) and has no fallback`);
    if (!raw) totals.bytesTotal += fb.bytes;
    const got = await fetchVerified(env, cache, req.manifestUrl, id, fb, totals, emit, rid);
    const model = parseGlb(got.bytes, null);
    emit({ t: 'model', requestId: rid, id, source: got.source, variant: 'raw', fallbackReason: reason, lods: model.lods, parts: model.parts });
  };

  let next = 0;
  const workers: Promise<void>[] = [];
  const n = Math.max(1, Math.min(concurrency, ids.length));
  for (let w = 0; w < n; w++) {
    workers.push(
      (async () => {
        while (next < ids.length) await one(ids[next++]!);
      })(),
    );
  }
  await Promise.all(workers);
  const stats: AssetLoadStats = {
    assets: ids.length,
    bytesNetwork: totals.bytesNetwork,
    bytesCache: totals.bytesCache,
    fromCache: totals.fromCache,
    fromNetwork: totals.fromNetwork,
    ms: env.now() - t0,
    cache: cache !== null,
  };
  emit({ t: 'done', requestId: rid, stats });
  return stats;
}

async function fetchVerified(
  env: AssetEnv,
  cache: AssetCache | null,
  manifestUrl: string,
  id: string,
  ref: AssetFileRef,
  totals: Totals,
  emit: (m: AssetWorkerMessage) => void,
  rid: number,
): Promise<{ bytes: Uint8Array; source: AssetSource }> {
  const url = resolveAssetUrl(manifestUrl, ref.url);
  const progress = (source: AssetSource, loaded: number, done: boolean): void => {
    emit({
      t: 'progress',
      requestId: rid,
      id,
      url,
      source,
      loaded,
      total: ref.bytes,
      bytesLoaded: totals.bytesLoaded + loaded,
      bytesTotal: totals.bytesTotal,
      done,
    });
  };
  if (cache !== null) {
    let hit: Uint8Array | null;
    try {
      hit = await cache.get(url);
    } catch {
      hit = null;
    }
    if (hit !== null) {
      const actual = await digest(env, hit);
      if (actual === ref.hash) {
        progress('cache', hit.length, true);
        totals.bytesLoaded += hit.length;
        totals.bytesCache += hit.length;
        totals.fromCache++;
        return { bytes: hit, source: 'cache' };
      }
      // Corrupt cache entry: evict and download again.
      await cache.delete(url).catch(() => undefined);
    }
  }
  const bytes = await env.fetchBytes(url, (loaded) => progress('network', loaded, false));
  const actual = await digest(env, bytes);
  if (actual !== ref.hash) throw new AssetIntegrityError(url, ref.hash, actual);
  if (bytes.length !== ref.bytes) throw new AssetIntegrityError(url, `${ref.bytes} B`, `${bytes.length} B`);
  totals.bytesLoaded += bytes.length;
  totals.bytesNetwork += bytes.length;
  totals.fromNetwork++;
  emit({
    t: 'progress',
    requestId: rid,
    id,
    url,
    source: 'network',
    loaded: bytes.length,
    total: ref.bytes,
    bytesLoaded: totals.bytesLoaded,
    bytesTotal: totals.bytesTotal,
    done: true,
  });
  if (cache !== null) await cache.put(url, bytes, contentType(url)).catch(() => undefined);
  return { bytes, source: 'network' };
}

async function digest(env: AssetEnv, bytes: Uint8Array): Promise<string> {
  return `sha256-${base64(await env.sha256(bytes))}`;
}
