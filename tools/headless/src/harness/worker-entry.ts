/**
 * Module worker of the cross-engine harness (L3/L6): loads sim.bin and the xxh32 WASM, then runs
 * jobs (`hashChain`, `tickBench`, `spk1`, `spk5`) on request and answers with JSON results.
 */
import { engineInfo, runJob, type JobAssets, type JobEnv } from '../jobs.ts';
import type { WorkerRequest, WorkerResponse } from '../series.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const SIM_BIN_URL = new URL('../../../../content/generated/sim.bin', import.meta.url);
const XXH32_WASM_URL = new URL('../spk5/xxh32.wasm', import.meta.url);
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
        assets = { simBin, xxh32Wasm };
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
