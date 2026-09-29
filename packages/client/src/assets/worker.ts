/**
 * Asset worker entry (P3, module worker; `@faf/client/asset-worker`, in Vite:
 * `import AssetWorker from '@faf/client/asset-worker?worker'`). Receives `AssetLoadRequest`s and
 * answers with `AssetWorkerMessage`s; payload buffers (asset bytes, mesh arrays) are transferred.
 */
import { createAssetEnv } from './env.ts';
import { loadAssets, type AssetEnv } from './loader.ts';
import { transferablesOf, type AssetLoadRequest, type AssetWorkerMessage } from './messages.ts';

/** The worker scope as far as this entry needs it. */
export interface AssetWorkerScope {
  postMessage(m: AssetWorkerMessage, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', l: (ev: { data: unknown }) => void): void;
}

/** Handles one request (exported for tests): loads and posts, errors become an 'error' message. */
export async function handleAssetRequest(env: AssetEnv, data: unknown, post: (m: AssetWorkerMessage) => void): Promise<void> {
  const req = data as Partial<AssetLoadRequest> | null;
  if (req === null || typeof req !== 'object' || req.t !== 'load' || typeof req.manifestUrl !== 'string') return;
  const requestId = typeof req.requestId === 'number' ? req.requestId : 0;
  try {
    await loadAssets(env, req as AssetLoadRequest, post);
  } catch (e) {
    post({ t: 'error', requestId, id: null, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Installs the message handler on a worker scope. */
export function installAssetWorker(scope: AssetWorkerScope, env: AssetEnv = createAssetEnv()): void {
  const post = (m: AssetWorkerMessage): void => scope.postMessage(m, transferablesOf(m));
  scope.addEventListener('message', (ev) => {
    void handleAssetRequest(env, ev.data, post);
  });
}

const g = globalThis as unknown as { WorkerGlobalScope?: unknown; postMessage?: unknown; addEventListener?: unknown };
if (g.WorkerGlobalScope !== undefined && typeof g.postMessage === 'function') {
  installAssetWorker(globalThis as unknown as AssetWorkerScope);
}
