// P3 client side: GLB parser against the pipeline output, asset loader with fakes (cache, integrity,
// progress, meshopt fallback), worker handler, AssetManager (worker + in-thread), env, visuals.
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAssetManifest, type AssetManifest } from '@faf/blueprints/asset-manifest';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { parseViewJson } from '@faf/blueprints/view';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAssetEnv, type AssetGlobals } from '../src/assets/env.ts';
import { GlbError, parseGlb, type MeshoptDecoderLike } from '../src/assets/glb.ts';
import { AssetIntegrityError, base64, defaultLoadOrder, loadAssets, resolveAssetUrl, type AssetCache, type AssetEnv } from '../src/assets/loader.ts';
import { AssetManager, rawAssetsRequested, type AssetProgress, type AssetWorkerLike } from '../src/assets/manager.ts';
import { transferablesOf, type AssetLoadRequest, type AssetProgressMsg, type AssetWorkerMessage } from '../src/assets/messages.ts';
import { sha256 } from '../src/assets/sha256.ts';
import { handleAssetRequest } from '../src/assets/worker.ts';
import { commanderVisuals, visualTableFromView } from '../src/visuals.ts';
import { REPO_ROOT } from './support/map.ts';

const ASSET_DIR = join(REPO_ROOT, 'content/generated/assets');
const BASE = 'https://faf.test/b/abc/assets/';
const MANIFEST_URL = `${BASE}manifest.json`;
const manifestText = readFileSync(join(ASSET_DIR, 'manifest.json'), 'utf8');
const manifest: AssetManifest = parseAssetManifest(manifestText);
/** Assets in the checked-in manifest (content 2, maps hollow-ridge + setons, 1 model). */
const N = Object.keys(manifest.assets).length;
const fileBytes = (rel: string): Uint8Array => new Uint8Array(readFileSync(join(ASSET_DIR, rel)));

beforeAll(async () => {
  await MeshoptDecoder.ready;
});

/** In-memory server + cache + counters. */
class FakeWorld {
  readonly files = new Map<string, Uint8Array>();
  readonly cacheStore = new Map<string, Uint8Array>();
  networkRequests: string[] = [];
  networkBytes = 0;
  cacheAvailable = true;
  decoder: MeshoptDecoderLike | null = MeshoptDecoder;

  constructor() {
    this.files.set(MANIFEST_URL, new TextEncoder().encode(manifestText));
    for (const e of Object.values(manifest.assets)) {
      for (const r of e.fallback === undefined ? [e] : [e, e.fallback]) this.files.set(resolveAssetUrl(MANIFEST_URL, r.url), fileBytes(r.url));
    }
  }

  env(): AssetEnv {
    const cache: AssetCache = {
      get: async (url) => this.cacheStore.get(url)?.slice() ?? null,
      put: async (url, bytes) => {
        this.cacheStore.set(url, bytes.slice());
      },
      delete: async (url) => {
        this.cacheStore.delete(url);
      },
    };
    return {
      fetchBytes: async (url, onBytes) => {
        this.networkRequests.push(url);
        const b = this.files.get(url);
        if (b === undefined) throw new Error(`404 ${url}`);
        // Two chunks for progress.
        const half = b.length >> 1;
        onBytes(half);
        onBytes(b.length);
        this.networkBytes += b.length;
        return b.slice();
      },
      fetchText: async (url) => {
        const b = this.files.get(url);
        if (b === undefined) throw new Error(`404 ${url}`);
        return new TextDecoder().decode(b);
      },
      openCache: async () => (this.cacheAvailable ? cache : null),
      sha256: async (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest()),
      decoder: async () => this.decoder,
      now: () => performance.now(),
    };
  }
}

async function run(world: FakeWorld, req: Partial<AssetLoadRequest> = {}): Promise<AssetWorkerMessage[]> {
  const msgs: AssetWorkerMessage[] = [];
  await loadAssets(world.env(), { t: 'load', requestId: 1, manifestUrl: MANIFEST_URL, ...req }, (m) => msgs.push(m));
  return msgs;
}

/** Minimal GLB container around a JSON object (no BIN chunk). */
function makeGlb(json: unknown): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const j = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + j.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, j.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  return out;
}

describe('GLB parser vs pipeline output', () => {
  const bot = manifest.assets['units/cube_bot']!;

  it('meshopt GLB decodes to the raw fallback within quantization tolerance; parts/pivots from extras', () => {
    const packed = parseGlb(fileBytes(bot.url), MeshoptDecoder);
    const raw = parseGlb(fileBytes(bot.fallback!.url), null);
    expect(packed.meshopt).toBe(true);
    expect(raw.meshopt).toBe(false);
    expect(packed.id).toBe('units/cube_bot');
    expect(packed.parts.map((p) => [p.name, p.parent])).toEqual([
      ['hull', 0],
      ['turret', 0],
      ['barrel', 1],
    ]);
    expect(packed.lods).toHaveLength(3);
    for (let l = 0; l < 3; l++) {
      const a = packed.lods[l]!;
      const b = raw.lods[l]!;
      expect(a.vertexCount).toBe(b.vertexCount);
      expect(a.indexCount).toBe(b.indexCount);
      expect(a.partIds).toEqual(b.partIds);
      let dp = 0;
      let dn = 0;
      for (let i = 0; i < a.positions.length; i++) {
        dp = Math.max(dp, Math.abs(a.positions[i]! - b.positions[i]!));
        dn = Math.max(dn, Math.abs(a.normals[i]! - b.normals[i]!));
      }
      expect(dp).toBeLessThan(1e-4);
      expect(dn).toBeLessThan(0.02);
      // Same triangles up to rotation (meshopt index codec).
      const tris = (m: typeof a) => {
        const out: string[] = [];
        for (let t = 0; t < m.indexCount; t += 3) {
          const tri = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
          const k = tri.indexOf(Math.min(...tri));
          out.push([tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]].join(','));
        }
        return out;
      };
      expect(tris(a)).toEqual(tris(b));
      expect(a.partPivots).toEqual(new Float32Array([0, 0, 0, -0.03, 0.3, 0, 0.06, 0.36, 0]));
      expect(a.partParents).toEqual(new Uint8Array([0, 0, 1]));
      expect(b.bounds[1]).toBe(0); // on the ground
      expect(b.bounds[4]).toBeCloseTo(0.42, 3);
    }
    expect(packed.lods[0]!.indexCount).toBeGreaterThan(packed.lods[2]!.indexCount);
  });

  it('rejects meshopt without decoder, broken files and unknown required extensions', () => {
    expect(() => parseGlb(fileBytes(bot.url), null)).toThrow(GlbError);
    try {
      parseGlb(fileBytes(bot.url), null);
    } catch (e) {
      expect((e as GlbError).code).toBe('meshopt-unavailable');
    }
    const failing: MeshoptDecoderLike = {
      supported: true,
      decodeGltfBuffer: () => {
        throw new Error('boom');
      },
    };
    expect(() => parseGlb(fileBytes(bot.url), failing)).toThrow(/meshopt|boom/);
    expect(() => parseGlb(new Uint8Array(40), null)).toThrow(/bad magic/);
    const raw = fileBytes(bot.fallback!.url);
    expect(() => parseGlb(raw.subarray(0, 100), null)).toThrow(GlbError);
    // Hand-made GLBs: unknown required extension, missing scene.
    expect(() => parseGlb(makeGlb({ asset: { version: '2.0' }, extensionsRequired: ['EXT_unknown'] }), null)).toThrow(/required extension EXT_unknown/);
    expect(() => parseGlb(makeGlb({ asset: { version: '2.0' } }), null)).toThrow(/no scene/);
    expect(() => parseGlb(makeGlb({ asset: { version: '2.0' }, buffers: [{ uri: 'x.bin', byteLength: 4 }] }), null)).toThrow(/external buffer/);
  });
});

describe('asset loader (fakes)', () => {
  it('cold: everything from the network, verified, cached; progress reaches the total', async () => {
    const w = new FakeWorld();
    const msgs = await run(w);
    const m = msgs.find((x) => x.t === 'manifest')!;
    expect(m.t === 'manifest' && m.assets).toBe(N);
    const done = msgs.find((x) => x.t === 'done')!;
    if (done.t !== 'done') throw new Error();
    expect(done.stats).toMatchObject({ assets: N, fromNetwork: N, fromCache: 0, bytesCache: 0, cache: true });
    const expectedBytes = Object.values(manifest.assets).reduce((n, e) => n + e.bytes, 0);
    expect(done.stats.bytesNetwork).toBe(expectedBytes);
    expect(w.cacheStore.size).toBe(N);
    const prog = msgs.filter((x): x is AssetProgressMsg => x.t === 'progress');
    expect(prog.length).toBeGreaterThanOrEqual(8);
    let last = 0;
    for (const p of prog) {
      expect(p.bytesLoaded).toBeLessThanOrEqual(p.bytesTotal);
      expect(p.loaded).toBeLessThanOrEqual(p.total);
      if (p.done) last = Math.max(last, p.bytesLoaded);
    }
    expect(last).toBe(expectedBytes);
    const model = msgs.find((x) => x.t === 'model')!;
    expect(model.t === 'model' && model.variant).toBe('meshopt');
    expect(model.t === 'model' && model.lods.length).toBe(3);
    const map = msgs.find((x) => x.t === 'asset' && x.kind === 'map')!;
    expect(map.t === 'asset' && map.bytes.byteLength).toBe(manifest.assets['maps/braidwater']!.bytes);
    // Order: content, maps, models.
    const view = parseViewJson(new TextDecoder().decode(fileBytes(manifest.assets['content/view.json']!.url)));
    const expectedModels = [...new Set(['units/cube_bot', ...view.visuals.flatMap(v => v.mesh === undefined ? [] : [v.mesh])])].sort();
    const order = defaultLoadOrder(manifest);
    expect(order).toEqual(['content/sim.bin', 'content/view.json', 'maps/braidwater', 'maps/hollow-ridge', 'maps/setons', 'maps/tessera', ...expectedModels, 'icons/atlas', 'icons/atlas-metrics']);
    const commanderMesh = 'units/varkan/cmd_commander';
    expect(['core:cmd_commander', 'core:cmd_commander_armored', 'core:cmd_commander_engineering']
      .map(id => view.visuals.find(visual => visual.id === id)?.mesh)).toEqual([commanderMesh, commanderMesh, commanderMesh]);
    expect(order.filter(id => id === commanderMesh)).toHaveLength(1);
    expect(msgs.filter(message => message.t === 'model' && message.id === commanderMesh)).toHaveLength(1);
    expect(w.networkRequests.filter(url => url === resolveAssetUrl(MANIFEST_URL, manifest.assets[commanderMesh]!.url))).toHaveLength(1);
  });

  it('warm: a cache hit needs no network (no asset bytes), only the manifest', async () => {
    const w = new FakeWorld();
    await run(w);
    w.networkRequests = [];
    w.networkBytes = 0;
    const msgs = await run(w);
    const done = msgs.find((x) => x.t === 'done')!;
    if (done.t !== 'done') throw new Error();
    expect(done.stats).toMatchObject({ fromCache: N, fromNetwork: 0, bytesNetwork: 0 });
    expect(w.networkRequests).toEqual([]);
    expect(msgs.filter((x) => x.t === 'progress').every((x) => x.t === 'progress' && x.source === 'cache')).toBe(true);
  });

  it('integrity: a corrupt download is an error; a corrupt cache entry is evicted and re-fetched', async () => {
    const w = new FakeWorld();
    const url = resolveAssetUrl(MANIFEST_URL, manifest.assets['content/sim.bin']!.url);
    const good = w.files.get(url)!;
    const bad = good.slice();
    bad[0] = bad[0]! ^ 1;
    w.files.set(url, bad);
    await expect(run(w, { ids: ['content/sim.bin'] })).rejects.toThrow(AssetIntegrityError);
    expect(w.cacheStore.has(url)).toBe(false);
    w.files.set(url, good);
    w.cacheStore.set(url, bad);
    const msgs = await run(w, { ids: ['content/sim.bin'] });
    const a = msgs.find((x) => x.t === 'asset')!;
    expect(a.t === 'asset' && a.source).toBe('network');
    expect(w.cacheStore.get(url)).toEqual(good);
  });

  it('no Cache API → plain fetch every time', async () => {
    const w = new FakeWorld();
    w.cacheAvailable = false;
    await run(w);
    const msgs = await run(w);
    const done = msgs.find((x) => x.t === 'done')!;
    expect(done.t === 'done' && done.stats).toMatchObject({ cache: false, fromNetwork: N, fromCache: 0 });
    expect(w.cacheStore.size).toBe(0);
  });

  it('model fallback: no decoder / decoder failure / ?assets=raw → .raw.glb', async () => {
    for (const mode of ['none', 'broken', 'raw'] as const) {
      const w = new FakeWorld();
      if (mode === 'none') w.decoder = null;
      if (mode === 'broken') w.decoder = { supported: true, decodeGltfBuffer: () => { throw new Error('bad'); } };
      const msgs = await run(w, { ids: ['units/cube_bot'], raw: mode === 'raw' });
      const model = msgs.find((x) => x.t === 'model');
      if (model?.t !== 'model') throw new Error('no model');
      expect(model.variant).toBe('raw');
      expect(model.fallbackReason).toMatch(mode === 'none' ? /unavailable/ : mode === 'broken' ? /bad/ : /raw requested/);
      expect(model.lods).toHaveLength(3);
      const fb = resolveAssetUrl(MANIFEST_URL, manifest.assets['units/cube_bot']!.fallback!.url);
      const primary = resolveAssetUrl(MANIFEST_URL, manifest.assets['units/cube_bot']!.url);
      expect(w.networkRequests).toContain(fb);
      expect(w.networkRequests.includes(primary)).toBe(mode === 'broken');
    }
  });

  it('worker handler posts an error message; transferables cover all payload buffers', async () => {
    const w = new FakeWorld();
    const posted: AssetWorkerMessage[] = [];
    await handleAssetRequest(w.env(), { t: 'load', requestId: 9, manifestUrl: `${BASE}missing.json` }, (m) => posted.push(m));
    expect(posted).toEqual([{ t: 'error', requestId: 9, id: null, message: expect.stringMatching(/404/) }]);
    await handleAssetRequest(w.env(), { t: 'nope' }, (m) => posted.push(m));
    expect(posted).toHaveLength(1);
    const msgs = await run(w, { ids: ['units/cube_bot', 'maps/hollow-ridge'] });
    const model = msgs.find((x) => x.t === 'model')!;
    expect(transferablesOf(model).length).toBeGreaterThanOrEqual(3 * 4);
    const asset = msgs.find((x) => x.t === 'asset')!;
    expect(transferablesOf(asset)).toHaveLength(1);
  });
});

describe('AssetManager', () => {
  it('worker mode: requests go through the worker, results and progress are collected', async () => {
    const w = new FakeWorld();
    const listeners: ((ev: { data: unknown }) => void)[] = [];
    let terminated = false;
    const worker: AssetWorkerLike = {
      postMessage: (req) => {
        void handleAssetRequest(w.env(), structuredClone(req), (m) => {
          const copy = structuredClone(m, { transfer: transferablesOf(m) });
          for (const l of [...listeners]) l({ data: copy });
        });
      },
      addEventListener: (t, l) => {
        if (t === 'message') listeners.push(l);
      },
      removeEventListener: (t, l) => {
        if (t === 'message' && listeners.includes(l)) listeners.splice(listeners.indexOf(l), 1);
      },
      terminate: () => {
        terminated = true;
      },
    };
    const mgr = new AssetManager({ manifestUrl: 'manifest.json', baseUrl: BASE, createWorker: () => worker, raw: false });
    const progress: AssetProgress[] = [];
    mgr.onProgress((p) => progress.push(p));
    const res = await mgr.load();
    expect(mgr.mode).toBe('worker');
    expect(res.mode).toBe('worker');
    expect([...res.files.keys()].sort()).toEqual(['content/sim.bin', 'content/view.json', 'icons/atlas', 'icons/atlas-metrics', 'maps/braidwater', 'maps/hollow-ridge', 'maps/setons', 'maps/tessera']);
    expect(res.files.get('content/sim.bin')!.bytes).toEqual(fileBytes(manifest.assets['content/sim.bin']!.url));
    expect(decodeSimBin(res.files.get('content/sim.bin')!.bytes).ids).toEqual(expect.arrayContaining(['core:cube', 'core:cmd_commander', 'core:fac_land_t1', 'core:str_t1_mex']));
    expect(res.models.get('units/cube_bot')!.variant).toBe('meshopt');
    expect(progress.at(-1)!.assetsDone).toBe(N);
    expect(progress.at(-1)!.assetsTotal).toBe(N);
    // Second load: from the cache.
    const again = await mgr.load(['maps/hollow-ridge']);
    expect(again.files.get('maps/hollow-ridge')!.source).toBe('cache');
    expect(again.stats.bytesNetwork).toBe(0);
    mgr.dispose();
    expect(terminated).toBe(true);
  });

  it('without a worker (or when creating it fails): in-thread loading with the same results', async () => {
    const w = new FakeWorld();
    const inline = new AssetManager({ manifestUrl: MANIFEST_URL, env: w.env(), raw: false });
    const r1 = await inline.load(['content/view.json']);
    expect(r1.mode).toBe('inline');
    expect(parseViewJson(new TextDecoder().decode(r1.files.get('content/view.json')!.bytes)).visuals.find((v) => v.id === 'core:cube')!.mesh).toBe('units/cube_bot');
    const failing = new AssetManager({
      manifestUrl: MANIFEST_URL,
      env: w.env(),
      createWorker: () => {
        throw new Error('no workers');
      },
    });
    const r2 = await failing.load(['units/cube_bot']);
    expect(r2.mode).toBe('inline');
    // A worker whose script fails to load (error event, e.g. blocked by COEP) → in-thread retry.
    const errListeners: (() => void)[] = [];
    let terminated = false;
    const broken = new AssetManager({
      manifestUrl: MANIFEST_URL,
      env: w.env(),
      createWorker: () => ({
        postMessage: () => queueMicrotask(() => errListeners.forEach((l) => l())),
        addEventListener: (t: string, l: (ev: { data?: unknown }) => void) => {
          if (t === 'error') errListeners.push(() => l({}));
        },
        removeEventListener: () => undefined,
        terminate: () => {
          terminated = true;
        },
      }),
    });
    const r3 = await broken.load(['maps/hollow-ridge']);
    expect(r3.mode).toBe('inline');
    expect(broken.mode).toBe('inline');
    expect(terminated).toBe(true);
    expect(r3.files.get('maps/hollow-ridge')!.bytes.length).toBe(manifest.assets['maps/hollow-ridge']!.bytes);
    await expect(new AssetManager({ manifestUrl: MANIFEST_URL, env: w.env() }).load(['nope/x'])).rejects.toThrow(/no 'nope\/x'/);
    expect(rawAssetsRequested('?assets=raw&map=x')).toBe(true);
    expect(rawAssetsRequested('?assets=meshopt')).toBe(false);
  });
});

describe('browser asset environment (fake globals)', () => {
  it('streams fetch progress, uses the Cache API, crypto.subtle and the meshopt decoder', async () => {
    const store = new Map<string, Response>();
    const cacheCalls: string[] = [];
    const payload = new Uint8Array(100_000).map((_, i) => i & 255);
    const g: AssetGlobals = {
      fetch: async (url: string) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(payload.subarray(0, 40_000));
              c.enqueue(payload.subarray(40_000));
              c.close();
            },
          }),
          { status: url.includes('404') ? 404 : 200 },
        ) as never,
      caches: {
        open: async (name: string) => {
          cacheCalls.push(`open ${name}`);
          return {
            match: async (url: string) => store.get(url)?.clone() as never,
            put: async (url: string, res: unknown) => {
              store.set(url, res as Response);
            },
            delete: async (url: string) => store.delete(url),
          };
        },
      },
      crypto: webcrypto as never,
      Response: Response as never,
      performance,
    };
    const env = createAssetEnv(g);
    const seen: number[] = [];
    const bytes = await env.fetchBytes('https://x.test/a.bin', (n) => seen.push(n));
    expect(bytes).toEqual(payload);
    expect(seen).toEqual([40_000, 100_000]);
    await expect(env.fetchBytes('https://x.test/404', () => undefined)).rejects.toThrow(/HTTP 404/);
    const cache = (await env.openCache())!;
    expect(cacheCalls).toEqual(['open faf-assets-v1']);
    expect(await cache.get('https://x.test/a.bin')).toBeNull();
    await cache.put('https://x.test/a.bin', payload, 'application/octet-stream');
    expect(await cache.get('https://x.test/a.bin')).toEqual(payload);
    await cache.delete('https://x.test/a.bin');
    expect(await cache.get('https://x.test/a.bin')).toBeNull();
    expect(base64(await env.sha256(payload))).toBe(createHash('sha256').update(payload).digest('base64'));
    const dec = await env.decoder();
    expect(dec?.supported).toBe(true);
    // Without caches / subtle: null cache, JS SHA-256.
    const bare = createAssetEnv({ fetch: g.fetch! }, null);
    expect(await bare.openCache()).toBeNull();
    expect(base64(await bare.sha256(payload))).toBe(createHash('sha256').update(payload).digest('base64'));
    expect(await bare.decoder()).toBeNull();
  });

  it('JS SHA-256 and base64 match node:crypto / Buffer', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 4097]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + n) & 255);
      expect(Buffer.from(sha256(b)).toString('hex')).toBe(createHash('sha256').update(b).digest('hex'));
      expect(base64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });
});

describe('visual table from view.json + models', () => {
  it('uses loaded model LODs and view.lod; placeholder otherwise; commander flags', () => {
    const view = parseViewJson(readFileSync(join(REPO_ROOT, 'content/generated/view.json'), 'utf8'));
    const cube = view.visuals.findIndex((v) => v.id === 'core:cube');
    expect(cube).toBeGreaterThanOrEqual(0);
    const bot = parseGlb(fileBytes(manifest.assets['units/cube_bot']!.fallback!.url), null);
    const t1 = visualTableFromView(view, new Map([['units/cube_bot', bot]]));
    expect(t1[cube]!.meshes).toHaveLength(3);
    expect(t1[cube]!.lodDistancesWU).toEqual([60, 180]);
    expect(t1[cube]!.spec).toEqual({ hull: 'box', size: [0.5, 0.5, 0.5], color: [0.62, 0.66, 0.72] });
    const t2 = visualTableFromView(view);
    expect(t2[cube]!.meshes).toBeUndefined();
    expect(t2[cube]!.lodDistancesWU).toEqual([60, 180]);
    const t3 = visualTableFromView(view, (id) => (id === 'units/cube_bot' ? bot.lods.slice(0, 1) : undefined));
    expect(t3[cube]!.meshes).toHaveLength(1);
    const bp = decodeSimBin(new Uint8Array(readFileSync(join(REPO_ROOT, 'content/generated/sim.bin'))));
    const flags = [...commanderVisuals(bp)];
    const commanderIds = ['core:cmd_commander', 'core:cmd_commander_armored', 'core:cmd_commander_engineering'];
    expect(bp.ids.filter((_id, index) => flags[index] !== 0)).toEqual(commanderIds);
    for (const id of commanderIds) expect(flags[bp.indexOf(id)]).toBe(1);
    expect(flags[bp.indexOf('core:cube')]).toBe(0);
  });
});
