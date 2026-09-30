/**
 * Module worker of the cross-engine harness (L3/L6): loads sim.bin, the xxh32 WASM, the
 * scenario maps (.rtsmap bytes) and the golden replays (.rtsreplay bytes, TRACK-REPLAY p6) — all
 * emitted by Vite as hashed assets — then runs jobs (`hashChain`, `tickBench`, `spk1`, `spk5`,
 * `replayVerify`) on request and answers with JSON results.
 */
import { engineInfo, runJob, type JobAssets, type JobEnv } from '../jobs.ts';
import { GOLDEN_REPLAY_PATHS } from '../replay/xengine-job.ts';
import type { WorkerRequest, WorkerResponse } from '../series.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const SIM_BIN_URL = new URL('../../../../content/generated/sim.bin', import.meta.url);
const XXH32_WASM_URL = new URL('../spk5/xxh32.wasm', import.meta.url);
/** Scenario maps by repo-relative path (must match scripts/lib.ts MAP_PATHS). */
const MAP_URLS: Readonly<Record<string, URL>> = {
  'content/maps/hollow-ridge.rtsmap': new URL('../../../../content/maps/hollow-ridge.rtsmap', import.meta.url),
  'content/maps/setons.rtsmap': new URL('../../../../content/maps/setons.rtsmap', import.meta.url),
};
/**
 * Golden replays by repo-relative path (static list: Vite only emits literal `new URL` assets;
 * must match GOLDEN_REPLAY_PATHS / scripts/lib.ts REPLAY_PATHS — checked at init).
 */
const REPLAY_URLS: Readonly<Record<string, URL>> = {
  'test/golden-replays/cubes-1000-move.rtsreplay': new URL('../../../../test/golden-replays/cubes-1000-move.rtsreplay', import.meta.url),
  'test/golden-replays/cubes-churn.rtsreplay': new URL('../../../../test/golden-replays/cubes-churn.rtsreplay', import.meta.url),
  'test/golden-replays/ridge-1000-move.rtsreplay': new URL('../../../../test/golden-replays/ridge-1000-move.rtsreplay', import.meta.url),
  'test/golden-replays/ridge-water-block.rtsreplay': new URL('../../../../test/golden-replays/ridge-water-block.rtsreplay', import.meta.url),
  'test/golden-replays/setons-bridge-move.rtsreplay': new URL('../../../../test/golden-replays/setons-bridge-move.rtsreplay', import.meta.url),
};
const clock = (): number => performance.now();

let assets: JobAssets | null = null;
let env: JobEnv | null = null;

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url.href}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function reply(msg: WorkerResponse): void {
  scope.postMessage(msg);
}

scope.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const req = ev.data;
  void (async () => {
    try {
      if (req.t === 'init') {
        const [simBin, xxh32Wasm] = await Promise.all([fetchBytes(SIM_BIN_URL), fetchBytes(XXH32_WASM_URL)]);
        const maps: Record<string, Uint8Array> = {};
        for (const [path, url] of Object.entries(MAP_URLS)) maps[path] = await fetchBytes(url);
        const listed = Object.keys(REPLAY_URLS);
        if (listed.length !== GOLDEN_REPLAY_PATHS.length || GOLDEN_REPLAY_PATHS.some((p) => !listed.includes(p))) {
          throw new Error(`REPLAY_URLS (${listed.join(', ')}) do not match GOLDEN_REPLAY_PATHS (${GOLDEN_REPLAY_PATHS.join(', ')})`);
        }
        const replays: Record<string, Uint8Array> = {};
        for (const [path, url] of Object.entries(REPLAY_URLS)) replays[path] = await fetchBytes(url);
        assets = { simBin, xxh32Wasm, maps, replays };
        env = { clock, info: engineInfo(req.engine, clock) };
        reply({ id: req.id, ok: true, info: env.info });
        return;
      }
      if (assets === null || env === null) throw new Error('worker not initialized');
      const result = await runJob(req.job, req.mode, assets, env);
      reply({ id: req.id, ok: true, result });
    } catch (e) {
      reply({ id: req.id, ok: false, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
    }
  })();
};
