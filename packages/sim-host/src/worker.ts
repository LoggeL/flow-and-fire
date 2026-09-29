/**
 * Sim worker entry (package export `@faf/sim-host/worker`, PLAN §3.6). Load as a module worker:
 *
 * ```ts
 * const worker = new Worker(new URL('@faf/sim-host/worker', import.meta.url), { type: 'module' });
 * worker.postMessage(init, [init.simBin]); // InitMessage (frameSab only for transport 'sab')
 * ```
 *
 * Messages from the main thread: `init` (once), `cmd` (batch transferred), `ctl`. Replies:
 * `ready`, `status`, `stats`, `log`, `error`. Frames go through the FrameTransport (SAB triple
 * buffer, or transfer ping-pong on the worker port itself). Every failure becomes an `error`
 * message; the worker never throws into the void.
 */

import { messageData, type HostMessage, type PortLike } from '@faf/protocol';
import { SimHost, type SimHostOptions } from './host.ts';

/** The worker's global scope (or any port standing in for it, e.g. in Node tests). */
export interface WorkerScopeLike extends PortLike {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
}

export type StartSimWorkerOptions = Omit<SimHostOptions, 'post' | 'port'>;

/**
 * Binds a SimHost to `scope`: routes incoming messages to the host and posts its messages back.
 * Returns the host (dispose() detaches everything).
 */
export function startSimWorker(scope: WorkerScopeLike, options: StartSimWorkerOptions = {}): SimHost {
  const post = (msg: HostMessage, transfer: ArrayBuffer[]): void => scope.postMessage(msg, transfer);
  const host = new SimHost({ ...options, post, port: scope });
  const onMessage = (ev: object): void => host.handleMessage(messageData(ev));
  scope.addEventListener('message', onMessage);
  scope.start?.();
  const dispose = host.dispose.bind(host);
  host.dispose = (): void => {
    scope.removeEventListener('message', onMessage);
    dispose();
  };
  const g = globalThis as { addEventListener?: (type: string, cb: (ev: unknown) => void) => void };
  if (typeof g.addEventListener === 'function' && (scope as unknown) === globalThis) {
    // Uncaught errors / rejections inside the worker are reported instead of dying silently.
    g.addEventListener('error', (ev) => {
      const m = (ev as { message?: unknown }).message;
      post({ t: 'error', message: `uncaught: ${typeof m === 'string' ? m : String(ev)}` }, []);
    });
    g.addEventListener('unhandledrejection', (ev) => {
      const r = (ev as { reason?: unknown }).reason;
      post({ t: 'error', message: `unhandled rejection: ${r instanceof Error ? r.message : String(r)}` }, []);
    });
  }
  return host;
}

/** True when this module runs as the top level of a dedicated worker. */
function isDedicatedWorker(): boolean {
  const g = globalThis as { WorkerGlobalScope?: unknown; DedicatedWorkerGlobalScope?: unknown };
  return typeof g.DedicatedWorkerGlobalScope === 'function' && typeof g.WorkerGlobalScope === 'function';
}

if (isDedicatedWorker()) startSimWorker(globalThis as unknown as WorkerScopeLike);
