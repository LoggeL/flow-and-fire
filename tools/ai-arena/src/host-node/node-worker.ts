/**
 * Node worker_threads host of one AI (arena analogue of the browser AI worker, MS9): spawns a
 * thread running `worker-entry.ts` through tsx and exposes its port as `MessagePortLike` for
 * `AsyncAiSource`. A crash or unexpected exit of the thread is delivered as a protocol `error`
 * message, so the waiting sim fails instead of hanging.
 */
import type { AiErrorMessage, MessagePortLike } from '@faf/ai/host';
import { Worker, type Transferable } from 'node:worker_threads';
import type { HostClockKind } from '../bench/clock.ts';
import { errorText, tsxExecArgv } from '../stats/pool.ts';

export const AI_WORKER_ENTRY = new URL('./worker-entry.ts', import.meta.url);

export interface NodeAiWorkerOptions {
  /** Worker module (default: worker-entry.ts). */
  readonly entry?: URL;
  readonly execArgv?: readonly string[];
  /** Emergency-stop clock inside the thread (default 'wall'). */
  readonly clock?: HostClockKind;
}

export class NodeAiWorker {
  readonly worker: Worker;
  readonly port: MessagePortLike;
  private handler: ((data: unknown) => void) | null = null;
  private readonly backlog: unknown[] = [];
  private exitedFlag = false;
  private terminating = false;
  private readonly exitPromise: Promise<number>;

  constructor(o: NodeAiWorkerOptions = {}) {
    this.worker = new Worker(o.entry ?? AI_WORKER_ENTRY, {
      execArgv: [...(o.execArgv ?? tsxExecArgv())],
      workerData: { clock: o.clock ?? 'wall' },
    });
    let lastError: string | null = null;
    this.worker.on('message', (m: unknown) => this.dispatch(m));
    this.worker.on('error', (e: unknown) => {
      lastError = errorText(e);
      const msg: AiErrorMessage = { type: 'error', tick: -1, message: `AI worker thread error: ${lastError}` };
      this.dispatch(msg);
    });
    this.exitPromise = new Promise<number>((resolve) => {
      this.worker.on('exit', (code: number) => {
        this.exitedFlag = true;
        if (!this.terminating) {
          const msg: AiErrorMessage = {
            type: 'error',
            tick: -1,
            message: `AI worker thread exited unexpectedly (code ${code})${lastError !== null ? ': ' + lastError : ''}`,
          };
          this.dispatch(msg);
        }
        resolve(code);
      });
    });
    const w = this.worker;
    this.port = {
      postMessage: (m, transfer) => {
        if (this.exitedFlag) return;
        if (transfer === undefined) w.postMessage(m);
        else w.postMessage(m, transfer as unknown as readonly Transferable[]);
      },
      onMessage: (h) => {
        this.handler = h;
        for (const m of this.backlog.splice(0)) h(m);
      },
    };
  }

  get exited(): boolean {
    return this.exitedFlag;
  }

  private dispatch(m: unknown): void {
    if (this.handler === null) this.backlog.push(m);
    else this.handler(m);
  }

  /** Terminates the thread (idempotent); resolves with the exit code. */
  async terminate(): Promise<number> {
    this.terminating = true;
    if (!this.exitedFlag) await this.worker.terminate();
    return await this.exitPromise;
  }
}
