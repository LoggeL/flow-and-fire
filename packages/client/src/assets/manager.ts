/**
 * AssetManager (P3, main thread): loads the asset manifest and its assets through the asset worker
 * (module worker, transferred results) or — without Worker support — in-thread with the same
 * loader. Exposes progress (bytes loaded/total, per asset, cache or network) for the loading
 * screen and returns raw bytes (map, sim.bin, view.json) and decoded models (MeshData per LOD).
 */
import type { AssetKind, AssetManifest } from '@faf/blueprints/asset-manifest';
import type { MeshData } from '@faf/render';
import { createAssetEnv } from './env.ts';
import type { ModelPartInfo } from './glb.ts';
import { loadAssets, type AssetEnv } from './loader.ts';
import type { AssetLoadRequest, AssetLoadStats, AssetProgressMsg, AssetSource, AssetWorkerMessage } from './messages.ts';

/** Structural Worker (DOM Worker or a test fake). */
export interface AssetWorkerLike {
  postMessage(m: AssetLoadRequest): void;
  addEventListener(type: 'message' | 'error', l: (ev: { data?: unknown }) => void): void;
  removeEventListener(type: 'message' | 'error', l: (ev: { data?: unknown }) => void): void;
  terminate(): void;
}

/** The worker itself failed (script blocked/crashed): the request is retried in-thread. */
class WorkerFailure extends Error {}

export interface AssetManagerOptions {
  /** URL of `manifest.json` (absolute or relative to `baseUrl`). */
  readonly manifestUrl: string;
  /** Base for a relative manifest URL (default `location.href`). */
  readonly baseUrl?: string;
  /** Creates the asset worker; omitted/null/throwing ⇒ in-thread loading. */
  readonly createWorker?: (() => AssetWorkerLike) | null;
  /** Environment for in-thread loading (default: browser globals). */
  readonly env?: AssetEnv;
  /** Force uncompressed models (default: `?assets=raw` in the page URL). */
  readonly raw?: boolean;
  /** Use the Cache API (default true). */
  readonly cache?: boolean;
}

export interface LoadedFile {
  readonly kind: AssetKind;
  readonly bytes: Uint8Array;
  readonly source: AssetSource;
}

export interface LoadedModel {
  readonly id: string;
  readonly lods: MeshData[];
  readonly parts: readonly ModelPartInfo[];
  readonly variant: 'meshopt' | 'raw';
  readonly fallbackReason: string | null;
  readonly source: AssetSource;
}

export interface LoadedAssets {
  readonly manifest: AssetManifest;
  readonly files: ReadonlyMap<string, LoadedFile>;
  readonly models: ReadonlyMap<string, LoadedModel>;
  readonly stats: AssetLoadStats;
  readonly mode: 'worker' | 'inline';
}

/** Progress snapshot for the loading screen. */
export interface AssetProgress extends Omit<AssetProgressMsg, 't' | 'requestId'> {
  /** Assets completed / planned. */
  readonly assetsDone: number;
  readonly assetsTotal: number;
}

/** True if the page URL asks for the uncompressed models (`?assets=raw`). */
export function rawAssetsRequested(search: string): boolean {
  return new URLSearchParams(search).get('assets') === 'raw';
}

function pageSearch(): string {
  return (globalThis as { location?: { search?: string } }).location?.search ?? '';
}

function pageHref(): string | undefined {
  return (globalThis as { location?: { href?: string } }).location?.href;
}

export class AssetManager {
  readonly manifestUrl: string;
  readonly raw: boolean;
  readonly cache: boolean;
  /** Loading path of the last `load()`. */
  mode: 'worker' | 'inline' = 'inline';
  manifest: AssetManifest | null = null;

  private readonly createWorker: (() => AssetWorkerLike) | null;
  private readonly envOverride: AssetEnv | undefined;
  private worker: AssetWorkerLike | null = null;
  private workerFailed = false;
  private nextRequest = 1;
  private readonly progressListeners: ((p: AssetProgress) => void)[] = [];

  constructor(opts: AssetManagerOptions) {
    const base = opts.baseUrl ?? pageHref();
    this.manifestUrl = base === undefined ? opts.manifestUrl : new URL(opts.manifestUrl, base).href;
    this.raw = opts.raw ?? rawAssetsRequested(pageSearch());
    this.cache = opts.cache ?? true;
    this.createWorker = opts.createWorker ?? null;
    this.envOverride = opts.env;
  }

  /** Subscribes to progress events; returns the unsubscribe function. */
  onProgress(cb: (p: AssetProgress) => void): () => void {
    this.progressListeners.push(cb);
    return () => {
      const i = this.progressListeners.indexOf(cb);
      if (i >= 0) this.progressListeners.splice(i, 1);
    };
  }

  /** Loads `ids` (default: everything in the manifest). */
  async load(ids?: readonly string[]): Promise<LoadedAssets> {
    const req: AssetLoadRequest = {
      t: 'load',
      requestId: this.nextRequest++,
      manifestUrl: this.manifestUrl,
      raw: this.raw,
      cache: this.cache,
      ...(ids !== undefined ? { ids: [...ids] } : {}),
    };
    const collector = new Collector(req.requestId, (p) => {
      for (const l of [...this.progressListeners]) l(p);
    });
    const worker = this.ensureWorker();
    if (worker !== null) {
      this.mode = 'worker';
      try {
        const result = await new Promise<LoadedAssets>((resolve, reject) => {
          const cleanup = (): void => {
            worker.removeEventListener('message', onMsg);
            worker.removeEventListener('error', onErr);
          };
          const onMsg = (ev: { data?: unknown }): void => {
            const m = ev.data as AssetWorkerMessage;
            if (typeof m !== 'object' || m === null || m.requestId !== req.requestId) return;
            const r = collector.accept(m, 'worker');
            if (r === null) return;
            cleanup();
            if (r instanceof Error) reject(r);
            else resolve(r);
          };
          // Script load failure (e.g. blocked by COEP) or a crash: no messages will follow.
          const onErr = (): void => {
            cleanup();
            reject(new WorkerFailure('asset worker failed'));
          };
          worker.addEventListener('message', onMsg);
          worker.addEventListener('error', onErr);
          worker.postMessage(req);
        });
        this.manifest = result.manifest;
        return result;
      } catch (e) {
        if (!(e instanceof WorkerFailure)) throw e;
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        collector.reset();
      }
    }
    this.mode = 'inline';
    const env = this.envOverride ?? createAssetEnv();
    let result: LoadedAssets | Error | null = null;
    try {
      await loadAssets(env, req, (m) => {
        const r = collector.accept(m, 'inline');
        if (r !== null) result = r;
      });
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    const done = result as LoadedAssets | Error | null;
    if (done === null) throw new Error('asset loading ended without a result');
    if (done instanceof Error) throw done;
    this.manifest = done.manifest;
    return done;
  }

  /** Terminates the worker. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): AssetWorkerLike | null {
    if (this.worker !== null) return this.worker;
    if (this.createWorker === null || this.workerFailed) return null;
    try {
      this.worker = this.createWorker();
    } catch {
      this.workerFailed = true;
      this.worker = null;
    }
    return this.worker;
  }
}

/** Collects the messages of one request into a result. */
class Collector {
  private manifest: AssetManifest | null = null;
  private readonly files = new Map<string, LoadedFile>();
  private readonly models = new Map<string, LoadedModel>();
  private assetsTotal = 0;
  private readonly doneIds = new Set<string>();

  constructor(
    private readonly requestId: number,
    private readonly progress: (p: AssetProgress) => void,
  ) {}

  /** Forgets partial results (retry after a worker failure). */
  reset(): void {
    this.manifest = null;
    this.files.clear();
    this.models.clear();
    this.doneIds.clear();
  }

  /** Returns the final result/error once the request has finished, else null. */
  accept(m: AssetWorkerMessage, mode: 'worker' | 'inline'): LoadedAssets | Error | null {
    if (m.requestId !== this.requestId) return null;
    switch (m.t) {
      case 'manifest':
        this.manifest = m.manifest;
        this.assetsTotal = m.assets;
        return null;
      case 'progress': {
        if (m.done) this.doneIds.add(m.id);
        const { t: _t, requestId: _r, ...rest } = m;
        this.progress({ ...rest, assetsDone: this.doneIds.size, assetsTotal: this.assetsTotal });
        return null;
      }
      case 'asset':
        this.files.set(m.id, { kind: m.kind, bytes: new Uint8Array(m.bytes), source: m.source });
        return null;
      case 'model':
        this.models.set(m.id, { id: m.id, lods: m.lods, parts: m.parts, variant: m.variant, fallbackReason: m.fallbackReason, source: m.source });
        return null;
      case 'done':
        if (this.manifest === null) return new Error('asset loading finished without a manifest');
        return { manifest: this.manifest, files: this.files, models: this.models, stats: m.stats, mode };
      case 'error':
        return new Error(m.id === null ? m.message : `${m.id}: ${m.message}`);
    }
  }
}
