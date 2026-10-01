import { signal } from '@preact/signals';
import type { BrowserReplayState } from '@faf/sim-host';
import type { WorkerLike } from '../worker-link.ts';
import { newReplayWorker } from './library.ts';

export interface ReplayFailure { readonly message: string; readonly buildHash: string | null; readonly route: string | null; }
/** Supply the returned worker to Game.createWorker, then observe it with this controller. */
export function createReplayWorker(bytes: Uint8Array): WorkerLike {
  const worker = newReplayWorker(), copy = bytes.slice().buffer;
  worker.postMessage({ t: 'replay-load', bytes: copy }, [copy]); return worker;
}
export class ReplayController {
  readonly state = signal<BrowserReplayState | null>(null);
  readonly failure = signal<ReplayFailure | null>(null);
  readonly seeking = signal(false);
  private readonly listener: (event: object) => void;
  private readonly failed: (event: object) => void;
  constructor(readonly worker: WorkerLike, readonly bytes: Uint8Array) {
    this.listener = (event) => {
      const m = (event as { data?: { t?: string; message?: string; replayBuild?: string; replayRoute?: string } }).data;
      if (m?.t === 'replay-state') { this.state.value = m as unknown as BrowserReplayState; this.seeking.value = false; }
      else if (m?.t === 'error') { this.failure.value = { message: m.message ?? 'Replay error', buildHash: m.replayBuild ?? null, route: m.replayRoute ?? null }; this.seeking.value = false; }
    };
    this.failed = (event) => { this.failure.value = { message: (event as { message?: string }).message ?? 'Replay worker failed', buildHash: null, route: null }; this.seeking.value = false; };
    worker.addEventListener('message', this.listener); worker.addEventListener('error', this.failed); worker.addEventListener('messageerror', this.failed);
    worker.postMessage({ t: 'replay-inspect' });
  }
  play(): void { this.worker.postMessage({ t: 'resume' }); }
  pause(): void { this.worker.postMessage({ t: 'pause' }); }
  speed(speed: number): void { this.worker.postMessage({ t: 'speed', speed }); }
  seek(tick: number): void { this.seeking.value = true; this.worker.postMessage({ t: 'replay-seek', tick }); }
  step(): void { this.worker.postMessage({ t: 'step', ticks: 1 }); }
  viewer(army: number): void { this.worker.postMessage({ t: 'viewer', army }); }
  /** Game/WorkerSimLink owns worker termination; controller only owns its subscriptions. */
  dispose(): void {
    this.worker.removeEventListener('message', this.listener); this.worker.removeEventListener('error', this.failed); this.worker.removeEventListener('messageerror', this.failed);
  }
}
