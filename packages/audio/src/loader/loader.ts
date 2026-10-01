/**
 * SoundLoader: fetches and decodes the Opus/WebM variants listed in the catalog, with priorities,
 * bounded parallelism, de-duplication, one retry on network errors, abort support and lazy
 * on-demand loading (catalog.requestLoad → loader.ensure).
 *
 * Errors are isolated per variant: a sound whose variants all fail stays silent (`failed`), all
 * other sounds load normally. Decoded buffers go straight into the catalog.
 */

import type { SoundCatalog } from '../catalog/index.ts';
import { parseManifest } from '../catalog/index.ts';
import type { AudioManifest, DecodePath, LoadFilter, LoadReport, SoundCategory } from '../types.ts';
import type { DecodeExpect, DecodeResult, NativeSupport } from './decode-chain.ts';

/** The part of a fetch Response the loader uses. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

/** The part of `fetch` the loader uses (`globalThis.fetch` satisfies it). */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

/** The part of a {@link DecodeChain} the loader uses. */
export interface DecoderLike {
  decode(bytes: ArrayBuffer, expect: DecodeExpect): Promise<DecodeResult>;
  /** Used to schedule the capability probe with the smallest file first. */
  readonly nativeSupport?: NativeSupport;
}

/** Per-variant progress of one `load()` call. */
export interface LoadProgress {
  /** Variants finished (ok or failed) in this call. */
  readonly done: number;
  /** Variants this call has to load. */
  readonly total: number;
  readonly soundId: string;
  readonly variant: number;
  readonly ok: boolean;
  /** Decode path, null on failure. */
  readonly path: DecodePath | null;
}

/** One variant that could not be loaded (the sound stays silent if all its variants fail). */
export interface LoadFailure {
  readonly soundId: string;
  readonly variant: number;
  readonly url: string;
  readonly error: unknown;
}

/** {@link LoadReport} plus per-variant details. */
export interface SoundLoadReport extends LoadReport {
  /** Variants that failed (sounds with at least one good variant still count as loaded). */
  variantsFailed: number;
  /** Variants decoded with a length/channel mismatch (accepted). */
  suspicious: number;
  failures: LoadFailure[];
}

export interface SoundLoaderOptions {
  catalog: SoundCatalog;
  decode: DecoderLike;
  /** Default: `globalThis.fetch` (bound). */
  fetch?: FetchLike | undefined;
  /** Base URL of the .webm files, e.g. '/audio/' (manifest paths are relative to it). */
  baseUrl: string;
  /** Maximum variants fetched/decoded at the same time (default 6). */
  concurrency?: number | undefined;
  /** Delay before the single retry after a network error (default 250 ms). */
  retryDelayMs?: number | undefined;
  onProgress?: ((p: LoadProgress) => void) | undefined;
  /** Called for every failed variant (the loader never logs by itself). */
  onError?: ((f: LoadFailure) => void) | undefined;
  /** Register `ensure` as the catalog's load hook (default true). */
  attach?: boolean | undefined;
}

/** Per-sound loader state. */
export type SoundLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/** Options of one `load()` call. */
export interface LoadOptions {
  signal?: AbortSignal | undefined;
}

/** Categories loaded before everything else (instant feedback: alerts, acknowledgements, UI). */
export const FIRST_CATEGORIES: readonly SoundCategory[] = ['alert', 'ack', 'ui'];

/** Fetches and validates the manifest ({@link parseManifest}). */
export async function loadManifest(url: string, fetchFn: FetchLike = defaultFetch()): Promise<AudioManifest> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`loadManifest: HTTP ${res.status} for ${url}`);
  return parseManifest(await res.json());
}

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: FetchLike }).fetch;
  if (typeof f !== 'function') throw new Error('SoundLoader: no global fetch available; pass options.fetch');
  return f.bind(globalThis);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason !== undefined ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
}

function isAbort(e: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (e instanceof DOMException && e.name === 'AbortError');
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return signal.aborted ? Promise.reject(abortError(signal)) : Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** HTTP statuses worth one retry (transient). */
function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const IDLE = 0;
const LOADING = 1;
const LOADED = 2;
const FAILED = 3;
const STATE_NAMES: readonly SoundLoadState[] = ['idle', 'loading', 'loaded', 'failed'];

/** Job keys: probe < lazy (LAZY_BASE .. LAZY_BASE + LAZY_SPAN) < bulk (≥ 0). */
const PROBE_KEY = -2e12;
const LAZY_BASE = -1e12;
const LAZY_SPAN = 5e11;

const RESOLVED_TRUE: Promise<boolean> = Promise.resolve(true);
const RESOLVED_FALSE: Promise<boolean> = Promise.resolve(false);

/** Accumulator shared by the variant jobs of one call. */
interface CallStats {
  total: number;
  done: number;
  loadedSounds: number;
  failedSounds: number;
  variantsFailed: number;
  suspicious: number;
  decodedBytes: number;
  paths: Record<DecodePath, number>;
  failures: LoadFailure[];
  onProgress: ((p: LoadProgress) => void) | undefined;
}

/** One queued variant fetch+decode. */
interface Job {
  /** Sort key: lower runs first (lowered once by a lazy request, see `boost`). */
  key: number;
  readonly seq: number;
  readonly sound: number;
  readonly variant: number;
  readonly controller: AbortController;
  readonly stats: CallStats;
  /** Resolves with true if the variant was stored in the catalog. */
  resolve(ok: boolean): void;
}

export class SoundLoader {
  readonly catalog: SoundCatalog;
  readonly baseUrl: string;
  readonly concurrency: number;
  /** Variants decoded per path (lifetime of the loader). */
  readonly paths: Record<DecodePath, number> = { native: 0, webcodecs: 0, wasm: 0 };

  private readonly decoder: DecoderLike;
  private readonly fetchFn: FetchLike;
  private readonly retryDelayMs: number;
  private readonly onProgress: ((p: LoadProgress) => void) | undefined;
  private readonly onError: ((f: LoadFailure) => void) | undefined;
  private readonly states: Uint8Array;
  /** 1 once a sound's jobs run with lazy priority (reset when its task ends). */
  private readonly boosted: Uint8Array;
  private readonly inflight: (Promise<boolean> | undefined)[];
  /** Controllers of every running sound task (for abortAll/dispose). */
  private readonly controllers = new Set<AbortController>();
  private readonly queue: Job[] = [];
  private seq = 0;
  private running = 0;
  private peak = 0;
  private bytes = 0;
  private disposed = false;
  private readonly hook: ((index: number) => void) | null;

  constructor(opts: SoundLoaderOptions) {
    this.catalog = opts.catalog;
    this.decoder = opts.decode;
    this.fetchFn = opts.fetch ?? defaultFetch();
    this.baseUrl = opts.baseUrl;
    const c = opts.concurrency ?? 6;
    if (!Number.isInteger(c) || c < 1) throw new RangeError(`SoundLoader: concurrency must be an integer ≥ 1, got ${c}`);
    this.concurrency = c;
    this.retryDelayMs = opts.retryDelayMs ?? 250;
    this.onProgress = opts.onProgress;
    this.onError = opts.onError;
    this.states = new Uint8Array(this.catalog.size);
    this.boosted = new Uint8Array(this.catalog.size);
    this.inflight = new Array<Promise<boolean> | undefined>(this.catalog.size);
    if (opts.attach ?? true) {
      this.hook = (index: number) => void this.ensure(index);
      this.catalog.setLoadHook(this.hook);
    } else {
      this.hook = null;
    }
  }

  /** Variant jobs currently fetching/decoding. */
  get active(): number {
    return this.running;
  }

  /** Highest number of simultaneous variant jobs seen. */
  get peakActive(): number {
    return this.peak;
  }

  /** Σ length × channels × 4 of every buffer this loader stored. */
  get decodedBytes(): number {
    return this.bytes;
  }

  state(index: number): SoundLoadState {
    this.catalog.byIndex(index);
    return STATE_NAMES[this.states[index]!]!;
  }

  /** Indices matching `filter`, in load order (see {@link SoundLoader.load}). */
  select(filter: LoadFilter = {}): number[] {
    const cat = this.catalog;
    const ids = filter.ids === undefined ? null : new Set(filter.ids);
    const tags = filter.tags === undefined ? null : new Set(filter.tags);
    const cats = filter.categories === undefined ? null : new Set<string>(filter.categories);
    const scopes = filter.factions === undefined ? null : new Set(filter.factions);
    const out: number[] = [];
    for (let i = 0; i < cat.size; i++) {
      const s = cat.manifestSound(i);
      if (ids !== null && !ids.has(s.id)) continue;
      if (cats !== null && !cats.has(s.category)) continue;
      if (scopes !== null && !scopes.has(s.scope)) continue;
      if (tags !== null && !s.tags.some((t) => tags.has(t))) continue;
      out.push(i);
    }
    out.sort((a, b) => this.soundKey(a) - this.soundKey(b));
    return out;
  }

  /**
   * Loads every sound matching `filter` (all criteria must match). Order: variant 0 of all sounds
   * first (every sound becomes playable as early as possible), alert/ack/ui before everything else,
   * then by descending category priority; the remaining variants follow in the same order. While
   * the decode chain's native support is unknown, the smallest file goes first (capability probe).
   *
   * Sounds already loaded or being loaded count as `skipped` (the call still waits for running
   * ones). Previously failed sounds are retried. Rejects with the abort reason if `signal` aborts
   * (buffers decoded until then stay in the catalog, running jobs of this call are cancelled).
   */
  async load(filter: LoadFilter = {}, options: LoadOptions = {}): Promise<SoundLoadReport> {
    if (this.disposed) throw new Error('SoundLoader: disposed');
    const signal = options.signal;
    if (signal?.aborted) throw abortError(signal);
    const t0 = performance.now();
    const indices = this.select(filter);
    const stats: CallStats = {
      total: 0,
      done: 0,
      loadedSounds: 0,
      failedSounds: 0,
      variantsFailed: 0,
      suspicious: 0,
      decodedBytes: 0,
      paths: { native: 0, webcodecs: 0, wasm: 0 },
      failures: [],
      onProgress: this.onProgress,
    };
    let skipped = 0;
    const waits: Promise<boolean>[] = [];
    const own: number[] = [];
    for (const i of indices) {
      const st = this.states[i]!;
      if (st === LOADED || st === LOADING) {
        skipped++;
        if (st === LOADING) waits.push(this.inflight[i]!);
        continue;
      }
      own.push(i);
      for (let v = 0; v < this.catalog.byIndex(i).variantCount; v++) stats.total++;
    }
    const probeFirst = this.decoder.nativeSupport === 'unknown' ? this.smallestVariant(own) : null;
    const controllers: AbortController[] = [];
    for (const i of own) {
      const c = new AbortController();
      controllers.push(c);
      waits.push(this.startSound(i, c, stats, false, probeFirst));
    }
    // Start only after everything is queued, so the order (and the probe) is global.
    this.pump();
    let onAbort: (() => void) | null = null;
    const aborted =
      signal === undefined
        ? null
        : new Promise<never>((_, reject) => {
            onAbort = () => {
              for (const c of controllers) c.abort(abortError(signal));
              this.purgeAborted();
              reject(abortError(signal));
            };
            signal.addEventListener('abort', onAbort, { once: true });
          });
    try {
      const all = Promise.all(waits);
      if (aborted === null) await all;
      else await Promise.race([all, aborted]);
    } finally {
      if (signal !== undefined && onAbort !== null) signal.removeEventListener('abort', onAbort);
    }
    return {
      requested: indices.length,
      loaded: stats.loadedSounds,
      failed: stats.failedSounds,
      skipped,
      decodedBytes: stats.decodedBytes,
      ms: performance.now() - t0,
      paths: stats.paths,
      variantsFailed: stats.variantsFailed,
      suspicious: stats.suspicious,
      failures: stats.failures,
    };
  }

  /**
   * Lazy loading (catalog.requestLoad): starts loading one sound ahead of queued bulk work.
   * Returns whether the sound is loaded afterwards. Cheap and allocation-free while the sound is
   * loading, loaded or failed (a failed sound is only retried by an explicit `load()`).
   */
  ensure(index: number): Promise<boolean> {
    const st = this.states[index];
    if (st === undefined) throw new RangeError(`SoundLoader.ensure: sound index ${index} outside 0..${this.catalog.size - 1}`);
    if (st === LOADED) return RESOLVED_TRUE;
    if (st === FAILED || this.disposed) return RESOLVED_FALSE;
    if (st === LOADING) {
      this.boost(index);
      return this.inflight[index]!;
    }
    const stats: CallStats = {
      total: this.catalog.byIndex(index).variantCount,
      done: 0,
      loadedSounds: 0,
      failedSounds: 0,
      variantsFailed: 0,
      suspicious: 0,
      decodedBytes: 0,
      paths: { native: 0, webcodecs: 0, wasm: 0 },
      failures: [],
      onProgress: undefined,
    };
    const p = this.startSound(index, new AbortController(), stats, true, null);
    this.boosted[index] = 1;
    this.pump();
    return p;
  }

  /** Cancels every queued and running job (loads reject with their own signals only). */
  abortAll(): void {
    for (const c of this.controllers) c.abort(new DOMException('SoundLoader.abortAll', 'AbortError'));
    this.purgeAborted();
  }

  /** Aborts everything and detaches from the catalog (decoded buffers stay in the catalog). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortAll();
    if (this.hook !== null) this.catalog.setLoadHook(null);
  }

  // -------------------------------------------------------------------------------------------

  /** Sound order key: first categories, then descending category priority, then index. */
  private soundKey(index: number): number {
    const s = this.catalog.byIndex(index);
    const tier = FIRST_CATEGORIES.includes(s.category) ? 0 : 1;
    const catPriority = this.catalog.manifest.categories[s.category].priority;
    return tier * 1e9 + (1000 - catPriority) * 1e5 + index;
  }

  private jobKey(index: number, variant: number, lazy: boolean, probe: boolean): number {
    if (probe) return PROBE_KEY;
    return (lazy ? LAZY_BASE : 0) + (variant === 0 ? 0 : 1e11) + this.soundKey(index) * 64 + Math.min(variant, 63);
  }

  private smallestVariant(indices: readonly number[]): { sound: number; variant: number } | null {
    let best: { sound: number; variant: number } | null = null;
    let bestSize = Number.POSITIVE_INFINITY;
    for (const i of indices) {
      const s = this.catalog.manifestSound(i);
      for (const v of s.variants) {
        const size = v.samples * s.channels;
        if (size < bestSize) {
          bestSize = size;
          best = { sound: i, variant: v.index };
        }
      }
    }
    return best;
  }

  private startSound(
    index: number,
    controller: AbortController,
    stats: CallStats,
    lazy: boolean,
    probe: { sound: number; variant: number } | null,
  ): Promise<boolean> {
    this.states[index] = LOADING;
    this.controllers.add(controller);
    const count = this.catalog.byIndex(index).variantCount;
    const variants: Promise<boolean>[] = [];
    for (let v = 0; v < count; v++) {
      const isProbe = probe !== null && probe.sound === index && probe.variant === v;
      variants.push(
        new Promise<boolean>((resolve) => {
          this.enqueue({ key: this.jobKey(index, v, lazy, isProbe), seq: this.seq++, sound: index, variant: v, controller, stats, resolve });
        }),
      );
    }
    const done = Promise.all(variants).then((results) => {
      this.controllers.delete(controller);
      const anyOk = results.includes(true) || this.catalog.isLoaded(index);
      if (anyOk) {
        this.states[index] = LOADED;
        stats.loadedSounds++;
      } else if (controller.signal.aborted) {
        this.states[index] = IDLE;
      } else {
        this.states[index] = FAILED;
        stats.failedSounds++;
      }
      this.inflight[index] = undefined;
      this.boosted[index] = 0;
      return anyOk;
    });
    this.inflight[index] = done;
    return done;
  }

  private enqueue(job: Job): void {
    // Sorted insert (queue sizes are a few hundred at most).
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = this.queue[mid]!;
      if (m.key < job.key || (m.key === job.key && m.seq < job.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.queue.splice(lo, 0, job);
  }

  /** Moves the queued jobs of a sound that is part of a bulk load ahead of the bulk work. */
  private boost(index: number): void {
    if (this.boosted[index] === 1) return;
    this.boosted[index] = 1;
    const moved: Job[] = [];
    let w = 0;
    for (let r = 0; r < this.queue.length; r++) {
      const job = this.queue[r]!;
      if (job.sound === index && job.key >= LAZY_BASE + LAZY_SPAN) moved.push(job);
      else this.queue[w++] = job;
    }
    this.queue.length = w;
    for (const job of moved) {
      job.key = this.jobKey(job.sound, job.variant, true, false);
      this.enqueue(job);
    }
  }

  /** Drops queued jobs whose sound task was aborted (they never start). */
  private purgeAborted(): void {
    let w = 0;
    const dropped: Job[] = [];
    for (let r = 0; r < this.queue.length; r++) {
      const job = this.queue[r]!;
      if (job.controller.signal.aborted) dropped.push(job);
      else this.queue[w++] = job;
    }
    this.queue.length = w;
    for (const job of dropped) job.resolve(false);
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      if (job.controller.signal.aborted) {
        job.resolve(false);
        continue;
      }
      this.running++;
      if (this.running > this.peak) this.peak = this.running;
      void this.runJob(job).then(
        (ok) => this.finishJob(job, ok),
        () => this.finishJob(job, false),
      );
    }
  }

  private finishJob(job: Job, ok: boolean): void {
    this.running--;
    job.resolve(ok);
    this.pump();
  }

  private async runJob(job: Job): Promise<boolean> {
    const s = this.catalog.manifestSound(job.sound);
    const v = s.variants[job.variant]!;
    const url = this.catalog.urlFor(job.sound, job.variant, this.baseUrl);
    const signal = job.controller.signal;
    const stats = job.stats;
    let path: DecodePath | null = null;
    try {
      const bytes = await this.fetchBytes(url, signal);
      if (signal.aborted) throw abortError(signal);
      const r = await this.decoder.decode(bytes, { samples: v.samples, channels: s.channels });
      if (signal.aborted) throw abortError(signal);
      this.catalog.setBuffer(job.sound, job.variant, r.buffer);
      const b = r.buffer.length * r.buffer.numberOfChannels * 4;
      this.bytes += b;
      stats.decodedBytes += b;
      stats.paths[r.path]++;
      this.paths[r.path]++;
      if (r.suspicious) stats.suspicious++;
      path = r.path;
      return true;
    } catch (e) {
      if (!signal.aborted) {
        const f: LoadFailure = { soundId: s.id, variant: job.variant, url, error: e };
        stats.variantsFailed++;
        stats.failures.push(f);
        this.onError?.(f);
      }
      return false;
    } finally {
      if (!signal.aborted) {
        stats.done++;
        stats.onProgress?.({ done: stats.done, total: stats.total, soundId: s.id, variant: job.variant, ok: path !== null, path });
      }
    }
  }

  /** GET with one retry on network errors and transient HTTP statuses. */
  private async fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    for (let attempt = 0; ; attempt++) {
      let retryable: boolean;
      let error: unknown;
      try {
        const res = await this.fetchFn(url, { signal });
        if (res.ok) return await res.arrayBuffer();
        error = new Error(`HTTP ${res.status} for ${url}`);
        retryable = retryableStatus(res.status);
      } catch (e) {
        if (isAbort(e, signal)) throw e;
        error = e;
        retryable = true;
      }
      if (!retryable || attempt >= 1) throw error;
      await delay(this.retryDelayMs, signal);
    }
  }
}
