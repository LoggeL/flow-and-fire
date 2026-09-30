import { describe, expect, it, vi } from 'vitest';
import { ManifestError, SoundCatalog, parseManifest } from '../../src/catalog/index.ts';
import {
  DecodeError,
  SoundLoader,
  createDecodeChain,
  loadManifest,
  type DecoderLike,
  type FetchLike,
  type FetchResponseLike,
  type LoadProgress,
  type NativeSupport,
} from '../../src/loader/index.ts';
import type { ManifestSound } from '../../src/types.ts';
import { FakeAudioContext, loadRealManifest, realManifestBytes, realWebmBytes } from '../support/index.ts';

const BASE = '/audio/';

function catalog(): SoundCatalog {
  return new SoundCatalog(parseManifest(JSON.parse(JSON.stringify(loadRealManifest()))));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

type Failure = 'network' | number | 'junk' | null;

interface FakeServer {
  fetch: FetchLike;
  log: string[];
  attempts: Map<string, number>;
  active: number;
  peak: number;
}

/** Serves the real .webm bytes below BASE with optional delays and injected failures. */
function fakeServer(opts: { delayMs?: (url: string) => number; fail?: (url: string, attempt: number) => Failure } = {}): FakeServer {
  const server: FakeServer = {
    log: [],
    attempts: new Map(),
    active: 0,
    peak: 0,
    fetch: async (url, init) => {
      server.log.push(url);
      const n = (server.attempts.get(url) ?? 0) + 1;
      server.attempts.set(url, n);
      server.active++;
      server.peak = Math.max(server.peak, server.active);
      try {
        await sleep(opts.delayMs?.(url) ?? 0, init?.signal);
        const f = opts.fail?.(url, n) ?? null;
        if (f === 'network') throw new TypeError('Failed to fetch');
        const rel = url.slice(BASE.length);
        const res: FetchResponseLike = {
          ok: typeof f !== 'number',
          status: typeof f === 'number' ? f : 200,
          arrayBuffer: () => Promise.resolve(f === 'junk' ? new Uint8Array(7).buffer : realWebmBytes(rel)),
          json: () => Promise.reject(new Error('not json')),
        };
        return res;
      } finally {
        server.active--;
      }
    },
  };
  return server;
}

/** Decoder fake: expected-length buffers after an optional delay; 7-byte inputs fail. */
function fakeDecoder(ctx: FakeAudioContext, opts: { delayMs?: number; support?: NativeSupport; onDecode?: () => void } = {}): DecoderLike & { calls: number } {
  const d = {
    calls: 0,
    nativeSupport: opts.support ?? ('yes' as NativeSupport),
    async decode(bytes: ArrayBuffer, expect: { samples: number; channels: number }) {
      d.calls++;
      opts.onDecode?.();
      await sleep(opts.delayMs ?? 0);
      if (bytes.byteLength === 7) throw new DecodeError([{ path: 'native', error: new Error('junk') }]);
      return { buffer: ctx.createBuffer(expect.channels, expect.samples, 48000), path: 'native' as const, suspicious: false };
    },
  };
  return d;
}

function urlOf(s: ManifestSound, v: number): string {
  return BASE + s.variants[v]!.opus;
}

function soundByUrl(cat: SoundCatalog, url: string): { sound: ManifestSound; variant: number } {
  for (const s of cat.manifest.sounds) {
    const v = s.variants.findIndex((x) => BASE + x.opus === url);
    if (v >= 0) return { sound: s, variant: v };
  }
  throw new Error(`unknown url ${url}`);
}

function bytesOf(s: ManifestSound, variants = s.variants.length): number {
  let b = 0;
  for (let v = 0; v < variants; v++) b += s.variants[v]!.samples * s.channels * 4;
  return b;
}

describe('SoundLoader — scheduling', () => {
  it('never runs more than 6 variant jobs at once and reaches the limit', async () => {
    const cat = catalog();
    const ctx = new FakeAudioContext();
    let loader: SoundLoader | null = null;
    const seen: number[] = [];
    const server = fakeServer({ delayMs: (u) => (u.length % 4) + 1 });
    const decoder = fakeDecoder(ctx, { delayMs: 1, onDecode: () => seen.push(loader!.active) });
    loader = new SoundLoader({ catalog: cat, decode: decoder, fetch: server.fetch, baseUrl: BASE });
    const report = await loader.load();
    expect(report.requested).toBe(101);
    expect(report.loaded).toBe(101);
    expect(report.failed).toBe(0);
    expect(server.log.length).toBe(246);
    expect(server.peak).toBeLessThanOrEqual(6);
    expect(Math.max(...seen)).toBeLessThanOrEqual(6);
    expect(loader.peakActive).toBe(6);
    expect(loader.active).toBe(0);
    expect(report.paths).toEqual({ native: 246, webcodecs: 0, wasm: 0 });
  });

  it('loads alert/ack/ui first, then by descending category priority; variant 0 of every sound before the rest', async () => {
    const cat = catalog();
    const ctx = new FakeAudioContext();
    const server = fakeServer();
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(ctx), fetch: server.fetch, baseUrl: BASE, concurrency: 1 });
    await loader.load();
    const order = server.log.map((u) => soundByUrl(cat, u));
    const firstRest = order.findIndex((o) => o.variant > 0);
    expect(firstRest).toBe(101);
    expect(order.slice(101).every((o) => o.variant > 0)).toBe(true);
    const prio = (o: { sound: ManifestSound }): number => cat.manifest.categories[o.sound.category].priority;
    const tier = (o: { sound: ManifestSound }): number => (['alert', 'ack', 'ui'].includes(o.sound.category) ? 0 : 1);
    for (const phase of [order.slice(0, 101), order.slice(101)]) {
      for (let i = 1; i < phase.length; i++) {
        const a = phase[i - 1]!;
        const b = phase[i]!;
        expect(tier(a) < tier(b) || (tier(a) === tier(b) && prio(a) >= prio(b))).toBe(true);
      }
    }
    const firstCats = [...new Set(order.slice(0, 101).map((o) => o.sound.category))];
    expect(firstCats.slice(0, 4)).toEqual(['alert', 'ack', 'ui', 'music']);
  });

  it('fetches the smallest file first while native support is unknown (capability probe)', async () => {
    const cat = catalog();
    const server = fakeServer();
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext(), { support: 'unknown' }), fetch: server.fetch, baseUrl: BASE, concurrency: 1 });
    await loader.load({ tags: ['MS5'] });
    let best = '';
    let bestSize = Infinity;
    for (const s of cat.manifest.sounds.filter((x) => x.tags.includes('MS5'))) {
      for (const v of s.variants) {
        if (v.samples * s.channels < bestSize) {
          bestSize = v.samples * s.channels;
          best = BASE + v.opus;
        }
      }
    }
    expect(server.log[0]).toBe(best);
  });

  it('filters by ids, tags, categories and factions (all criteria must match)', () => {
    const cat = catalog();
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: fakeServer().fetch, baseUrl: BASE });
    expect(loader.select({ tags: ['MS5'] }).length).toBe(17);
    expect(loader.select({ categories: ['alert'] }).length).toBe(11);
    expect(loader.select({ factions: ['common'] }).length).toBe(34);
    expect(loader.select({ factions: ['varkan'], tags: ['MS5'] }).length).toBe(14);
    expect(loader.select({ ids: ['common:ui_click', 'varkan:exp_small', 'nope:x'] }).map((i) => cat.byIndex(i).id)).toEqual(['common:ui_click', 'varkan:exp_small']);
    expect(loader.select({ ids: ['common:ui_click'], categories: ['weapon'] })).toEqual([]);
    expect(loader.select().length).toBe(101);
  });
});

describe('SoundLoader — dedupe, retry, errors, abort', () => {
  it('de-duplicates concurrent and repeated loads', async () => {
    const cat = catalog();
    const server = fakeServer({ delayMs: () => 1 });
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: server.fetch, baseUrl: BASE });
    const [a, b] = await Promise.all([loader.load({ tags: ['MS5'] }), loader.load({ tags: ['MS5'] })]);
    expect(server.log.length).toBe(55);
    expect(a.loaded).toBe(17);
    expect(a.skipped).toBe(0);
    expect(b.loaded).toBe(0);
    expect(b.skipped).toBe(17);
    for (const i of loader.select({ tags: ['MS5'] })) expect(cat.isLoaded(i)).toBe(true); // b waited for a
    const c = await loader.load({ tags: ['MS5'] });
    expect(c.skipped).toBe(17);
    expect(server.log.length).toBe(55);
  });

  it('retries once after a network error or a transient HTTP status, never after 404', async () => {
    const cat = catalog();
    const click = cat.manifestSound(cat.indexOf('common:ui_click'));
    const small = cat.manifestSound(cat.indexOf('varkan:exp_small'));
    const cannon = cat.manifestSound(cat.indexOf('varkan:wpn_cannon_t1_fire'));
    const server = fakeServer({
      fail: (url, n) => {
        if (url === urlOf(click, 0) && n === 1) return 'network';
        if (url === urlOf(click, 1) && n === 1) return 503;
        if (url === urlOf(small, 0)) return 503; // both attempts
        if (url === urlOf(cannon, 2)) return 404;
        return null;
      },
    });
    const onError = vi.fn();
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: server.fetch, baseUrl: BASE, retryDelayMs: 0, onError });
    const r = await loader.load({ ids: [click.id, small.id, cannon.id] });
    expect(server.attempts.get(urlOf(click, 0))).toBe(2);
    expect(server.attempts.get(urlOf(click, 1))).toBe(2);
    expect(server.attempts.get(urlOf(small, 0))).toBe(2);
    expect(server.attempts.get(urlOf(cannon, 2))).toBe(1);
    expect(cat.loadedVariantCount(cat.indexOf(click.id))).toBe(3);
    expect(r.loaded).toBe(3); // exp_small and the cannon keep other variants
    expect(r.failed).toBe(0);
    expect(r.variantsFailed).toBe(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(r.failures.map((f) => `${f.soundId}#${f.variant}`).sort()).toEqual(['varkan:exp_small#0', 'varkan:wpn_cannon_t1_fire#2']);
  });

  it('isolates failures: a sound without any decodable variant stays silent, the rest loads', async () => {
    const cat = catalog();
    const bad = cat.manifestSound(cat.indexOf('varkan:wpn_mg_t1_fire'));
    const junk = cat.manifestSound(cat.indexOf('varkan:exp_commander'));
    const server = fakeServer({
      fail: (url) => (bad.variants.some((v) => BASE + v.opus === url) ? 404 : url === urlOf(junk, 0) ? 'junk' : null),
    });
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: server.fetch, baseUrl: BASE });
    const r = await loader.load({ tags: ['MS5'] });
    expect(r.requested).toBe(17);
    expect(r.loaded).toBe(15);
    expect(r.failed).toBe(2);
    expect(r.variantsFailed).toBe(bad.variants.length + 1);
    expect(cat.isLoaded(cat.indexOf(bad.id))).toBe(false);
    expect(cat.isLoaded(cat.indexOf(junk.id))).toBe(false);
    expect(loader.state(cat.indexOf(bad.id))).toBe('failed');
    expect(r.failures.find((f) => f.soundId === junk.id)!.error).toBeInstanceOf(DecodeError);
    // ensure() does not hammer a failed sound; an explicit load() retries it.
    const fetched = server.log.length;
    expect(await loader.ensure(cat.indexOf(bad.id))).toBe(false);
    expect(server.log.length).toBe(fetched);
    const again = await loader.load({ ids: [bad.id] });
    expect(again.failed).toBe(1);
    expect(server.log.length).toBe(fetched + bad.variants.length);
  });

  it('accounts decodedBytes = Σ length × channels × 4 and reports progress', async () => {
    const cat = catalog();
    const progress: LoadProgress[] = [];
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: fakeServer().fetch, baseUrl: BASE, onProgress: (p) => progress.push(p) });
    const r = await loader.load({ tags: ['MS5'] });
    const expected = cat.manifest.sounds.filter((s) => s.tags.includes('MS5')).reduce((n, s) => n + bytesOf(s), 0);
    expect(r.decodedBytes).toBe(expected);
    expect(loader.decodedBytes).toBe(expected);
    expect(cat.decodedBytes).toBe(expected);
    expect(progress.length).toBe(55);
    expect(progress.map((p) => p.done)).toEqual([...Array(55).keys()].map((i) => i + 1));
    expect(progress.every((p) => p.total === 55 && p.ok && p.path === 'native')).toBe(true);
  });

  it('aborts: the call rejects, no new jobs start, nothing stays "loading", a later load finishes', async () => {
    const cat = catalog();
    const server = fakeServer({ delayMs: () => 3 });
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: server.fetch, baseUrl: BASE, concurrency: 2 });
    const ac = new AbortController();
    const p = loader.load({}, { signal: ac.signal });
    await sleep(8);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const fetched = server.log.length;
    expect(fetched).toBeLessThan(20);
    await sleep(20);
    expect(server.log.length).toBe(fetched);
    expect(loader.active).toBe(0);
    for (let i = 0; i < cat.size; i++) expect(loader.state(i)).not.toBe('loading');
    const loadedBefore = cat.loadedSounds;
    const r = await loader.load();
    expect(r.skipped).toBe(loadedBefore);
    expect(r.loaded + r.skipped).toBe(101);
    expect(cat.loadedSounds).toBe(101);
  });

  it('rejects immediately with an already aborted signal', async () => {
    const loader = new SoundLoader({ catalog: catalog(), decode: fakeDecoder(new FakeAudioContext()), fetch: fakeServer().fetch, baseUrl: BASE });
    const ac = new AbortController();
    ac.abort();
    await expect(loader.load({}, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('SoundLoader — lazy loading', () => {
  it('catalog.requestLoad → ensure loads one sound once', async () => {
    const cat = catalog();
    const server = fakeServer({ delayMs: () => 1 });
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: server.fetch, baseUrl: BASE });
    const i = cat.indexOf('varkan:wpn_cannon_t1_fire');
    cat.requestLoad(i);
    cat.requestLoad(i);
    expect(loader.state(i)).toBe('loading');
    const p1 = loader.ensure(i);
    expect(loader.ensure(i)).toBe(p1); // no new promise while loading
    expect(await p1).toBe(true);
    expect(server.log.length).toBe(4);
    expect(cat.isFullyLoaded(i)).toBe(true);
    const done = loader.ensure(i);
    expect(loader.ensure(i)).toBe(done);
    expect(await done).toBe(true);
    cat.requestLoad(i);
    expect(server.log.length).toBe(4);
    loader.dispose();
    const j = cat.indexOf('common:ui_click');
    cat.requestLoad(j); // hook removed by dispose
    expect(server.log.length).toBe(4);
  });

  it('lazy requests jump ahead of queued bulk work', async () => {
    const cat = catalog();
    const server = fakeServer({ delayMs: () => 1 });
    const loader = new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: server.fetch, baseUrl: BASE, concurrency: 1 });
    const bulk = loader.load();
    await sleep(0);
    const eco = cat.indexOf('varkan:eco_mex_loop'); // lowest category priority → last in bulk order
    const lazy = loader.ensure(eco);
    await lazy;
    const pos = server.log.indexOf(BASE + cat.manifestSound(eco).variants[0]!.opus);
    expect(pos).toBeLessThanOrEqual(2);
    const r = await bulk;
    expect(r.skipped).toBe(0);
    expect(cat.loadedSounds).toBe(101);
    expect(server.log.length).toBe(246);
  });

  it('with attach: false the catalog hook stays untouched', () => {
    const cat = catalog();
    const hook = vi.fn();
    cat.setLoadHook(hook);
    new SoundLoader({ catalog: cat, decode: fakeDecoder(new FakeAudioContext()), fetch: fakeServer().fetch, baseUrl: BASE, attach: false });
    cat.requestLoad(0);
    expect(hook).toHaveBeenCalledWith(0);
  });
});

describe('SoundLoader — real bytes through the real decode chain (WASM in Node)', () => {
  it('loads the 17 MS5 sounds sample-exact with ≤ 6 parallel jobs', async () => {
    const cat = catalog();
    const ctx = new FakeAudioContext();
    const chain = createDecodeChain(ctx);
    const server = fakeServer({ delayMs: (u) => u.length % 3 });
    const loader = new SoundLoader({ catalog: cat, decode: chain, fetch: server.fetch, baseUrl: BASE });
    const r = await loader.load({ tags: ['MS5'] });
    expect(r.loaded).toBe(17);
    expect(r.failed).toBe(0);
    expect(r.paths).toEqual({ native: 0, webcodecs: 0, wasm: 55 });
    expect(server.peak).toBeLessThanOrEqual(6);
    expect(ctx.decodeCalls).toBe(1); // capability probe only
    for (const i of loader.select({ tags: ['MS5'] })) {
      const s = cat.manifestSound(i);
      for (let v = 0; v < s.variants.length; v++) expect(cat.buffer(i, v)!.length).toBe(s.variants[v]!.samples);
    }
    const expected = cat.manifest.sounds.filter((s) => s.tags.includes('MS5')).reduce((n, s) => n + bytesOf(s), 0);
    expect(r.decodedBytes).toBe(expected);
    chain.dispose();
  });
});

describe('loadManifest', () => {
  const json = (body: unknown, status = 200): FetchLike => async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.reject(new Error('unused')),
    json: () => Promise.resolve(body),
  });

  it('fetches and validates the manifest', async () => {
    const raw: unknown = JSON.parse(new TextDecoder().decode(realManifestBytes()));
    const m = await loadManifest('/audio/manifest.json', json(raw));
    expect(m.sounds.length).toBe(101);
  });

  it('throws on HTTP errors and invalid manifests', async () => {
    await expect(loadManifest('/audio/manifest.json', json({}, 404))).rejects.toThrow(/HTTP 404/);
    await expect(loadManifest('/audio/manifest.json', json({ version: 7 }))).rejects.toBeInstanceOf(ManifestError);
  });
});
