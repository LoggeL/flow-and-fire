/**
 * Test rig of the engine integration tests: a FakeAudioContext, the real manifest, a gesture
 * target, an in-memory settings store and helpers to preload fake buffers or serve fake files.
 */

import { createAudioEngine, type AudioEngineOptions, type FafAudioEngine } from '../../src/engine/index.ts';
import type { FetchLike, FetchResponseLike } from '../../src/loader/index.ts';
import { memorySettingsStore } from '../../src/settings/index.ts';
import type { AudioManifest } from '../../src/types.ts';
import {
  FakeAudioContext,
  fakeBuffersFor,
  loadRealManifest,
  type FakeAudioContextOptions,
  type FakeBaseAudioContext,
} from '../support/index.ts';

/** Minimal `document` stand-in for the visibility mute. */
export class FakeVisibilityDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
  listeners = 0;

  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: AddEventListenerOptions | boolean): void {
    this.listeners++;
    super.addEventListener(type, cb, opts);
  }

  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: EventListenerOptions | boolean): void {
    this.listeners--;
    super.removeEventListener(type, cb, opts);
  }

  setHidden(hidden: boolean): void {
    this.visibilityState = hidden ? 'hidden' : 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

/** Gesture target that counts its listeners. */
export class CountingTarget extends EventTarget {
  listeners = 0;

  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: AddEventListenerOptions | boolean): void {
    this.listeners++;
    super.addEventListener(type, cb, opts);
  }

  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: EventListenerOptions | boolean): void {
    this.listeners--;
    super.removeEventListener(type, cb, opts);
  }

  gesture(type = 'pointerdown'): void {
    this.dispatchEvent(new Event(type));
  }
}

export interface Rig {
  ctx: FakeAudioContext;
  engine: FafAudioEngine;
  target: CountingTarget;
  doc: FakeVisibilityDocument;
  store: ReturnType<typeof memorySettingsStore>;
  manifest: AudioManifest;
  jumps: { x: number; z: number }[];
}

export interface RigOptions {
  manifest?: AudioManifest;
  context?: FakeAudioContextOptions;
  /** Preload fake buffers for every variant (default true). */
  preload?: boolean;
  engine?: Partial<AudioEngineOptions>;
}

/** Seeded PRNG for deterministic variant/jitter choices. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeEngineRig(opts: RigOptions = {}): Rig {
  const manifest = opts.manifest ?? loadRealManifest();
  const ctx = new FakeAudioContext(opts.context ?? {});
  const target = new CountingTarget();
  const doc = new FakeVisibilityDocument();
  const store = memorySettingsStore();
  const jumps: { x: number; z: number }[] = [];
  const engine = createAudioEngine({
    context: ctx,
    manifest,
    baseUrl: '/audio/',
    settingsStore: store,
    unlockTarget: target,
    visibilityDocument: doc,
    clock: () => ctx.nowMs,
    random: seeded(3),
    fetch: rejectingFetch,
    onJumpTo: (x, z) => jumps.push({ x, z }),
    ...opts.engine,
  });
  if (opts.preload ?? true) preloadAll(engine, ctx);
  return { ctx, engine, target, doc, store, manifest, jumps };
}

/** Puts a fake buffer into the catalog for every variant (lazy FakeAudioBuffers, no PCM). */
export function preloadAll(engine: FafAudioEngine, ctx: FakeAudioContext): void {
  const catalog = engine.catalog!;
  const bufs = fakeBuffersFor(catalog.manifest, ctx);
  for (let i = 0; i < catalog.size; i++) {
    const list = bufs.get(catalog.byIndex(i).id)!;
    for (let v = 0; v < list.length; v++) catalog.setBuffer(i, v, list[v]!);
  }
}

/** Gesture → running (resume resolves on the next microtask). */
export async function unlockByGesture(rig: Rig): Promise<void> {
  rig.target.gesture();
  await Promise.resolve();
  await Promise.resolve();
}

const rejectingFetch: typeof fetch = (url) => Promise.reject(new Error(`unexpected fetch ${url}`));

/**
 * Fake file server: every .webm URL returns 8 bytes (samples u32, channels u32) of the variant
 * from the manifest; the paired decoder turns them into a FakeAudioBuffer of that length.
 */
export function fakeAudioServer(manifest: AudioManifest): { fetch: FetchLike; requests: string[] } {
  const byPath = new Map<string, { samples: number; channels: number }>();
  for (const s of manifest.sounds) for (const v of s.variants) byPath.set(v.opus, { samples: v.samples, channels: s.channels });
  const requests: string[] = [];
  const fetch: FetchLike = (url) => {
    requests.push(url);
    if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(manifest));
    const rel = url.replace(/^\/audio\//, '');
    const f = byPath.get(rel);
    if (f === undefined) return Promise.resolve(errorResponse(404));
    const bytes = new ArrayBuffer(8);
    const dv = new DataView(bytes);
    dv.setUint32(0, f.samples, true);
    dv.setUint32(4, f.channels, true);
    return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes), json: () => Promise.reject(new Error('not json')) });
  };
  return { fetch, requests };
}

/** Decoder for {@link fakeAudioServer} bytes (install with `ctx.setDecoder`). */
export function fakeHeaderDecoder(data: ArrayBuffer, ctx: FakeBaseAudioContext): ReturnType<FakeBaseAudioContext['createBuffer']> {
  const dv = new DataView(data);
  return ctx.createBuffer(dv.getUint32(4, true), dv.getUint32(0, true), ctx.sampleRate);
}

function jsonResponse(v: unknown): FetchResponseLike {
  return { ok: true, status: 200, arrayBuffer: () => Promise.reject(new Error('json only')), json: () => Promise.resolve(structuredClone(v)) };
}

function errorResponse(status: number): FetchResponseLike {
  return { ok: false, status, arrayBuffer: () => Promise.reject(new Error(String(status))), json: () => Promise.reject(new Error(String(status))) };
}
