/**
 * Harness page: exposes `window.fafHarness.series(job, engine)` for the Playwright specs.
 * Every series runs in a fresh module worker (JIT cold), which is terminated afterwards.
 */
import type { Job, JobResult, RunMode } from '../../jobs.ts';
import { runSeries, type SeriesResult, type WorkerRequest, type WorkerResponse } from '../../series.ts';
import type { EngineInfo } from '../../stats.ts';

class WorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (m: WorkerResponse) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../worker-entry.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (p === undefined) return;
      this.pending.delete(ev.data.id);
      p.resolve(ev.data);
    };
    this.worker.onerror = (ev) => {
      const err = new Error(`worker error: ${ev.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private request(msg: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject });
      this.worker.postMessage(msg);
    });
  }

  async init(engine: string): Promise<EngineInfo> {
    const r = await this.request({ id: this.nextId++, t: 'init', engine });
    if (!r.ok) throw new Error(r.error);
    if (r.info === undefined) throw new Error('init: no engine info');
    return r.info;
  }

  async run(job: Job, mode: RunMode): Promise<JobResult> {
    const r = await this.request({ id: this.nextId++, t: 'run', job, mode });
    if (!r.ok) throw new Error(r.error);
    if (r.result === undefined) throw new Error('run: no result');
    return r.result;
  }

  terminate(): void {
    this.worker.terminate();
  }
}

export interface FafHarness {
  series(job: Job, engine: string): Promise<SeriesResult>;
}

const harness: FafHarness = {
  async series(job, engine) {
    const client = new WorkerClient();
    try {
      const info = await client.init(engine);
      return await runSeries(job, info, (j, mode) => client.run(j, mode));
    } finally {
      client.terminate();
    }
  },
};

(window as unknown as { fafHarness: FafHarness }).fafHarness = harness;
const status = document.getElementById('status');
if (status !== null) status.textContent = `FAF-Harness: bereit (crossOriginIsolated=${String(crossOriginIsolated)})`;
