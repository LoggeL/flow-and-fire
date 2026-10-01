import type { ReplayGame, ReplayHead, ReplayMeta } from '@faf/formats';
import type { WorkerLike } from '../worker-link.ts';

export interface ReplayAssets { readonly simBin: ArrayBuffer; readonly map: Uint8Array; }
export interface RecordedGame {
  readonly name: string; readonly bytes: number; readonly endTick: number; readonly complete: boolean;
  readonly tainted: boolean; readonly buildHash: string; readonly mapSimHash: number; readonly mapSizeWu: number; readonly error: string | null;
}
export interface ReplayExport {
  readonly bytes: Uint8Array; readonly verified: boolean; readonly truncated: boolean; readonly endTick: number;
  readonly warnings: readonly string[]; readonly mismatches: readonly { tick: number; expected: number; actual: number }[];
}
export interface ReplayInfo { readonly head: ReplayHead; readonly game: ReplayGame; readonly meta: ReplayMeta | null; }
export type ReplayTaskRequest = { readonly t: 'replay-task'; readonly id: number } & (
  { readonly kind: 'list' } |
  { readonly kind: 'inspect'; readonly bytes: ArrayBuffer } |
  { readonly kind: 'export'; readonly name: string; readonly simBin: ArrayBuffer; readonly map: ArrayBuffer } |
  { readonly kind: 'convert'; readonly bytes: ArrayBuffer; readonly simBin: ArrayBuffer; readonly map: ArrayBuffer });
type Task = ReplayTaskRequest extends infer R ? R extends ReplayTaskRequest ? Omit<R, 'id' | 't'> : never : never;

export function newReplayWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'faf-replay' });
}
/** A small RPC client; conversion runs off the UI thread in the actual replay worker. */
export class ReplayLibrary {
  private id = 0;
  private readonly requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listener: (event: object) => void;
  private readonly failed: (event: object) => void;
  private closed = false;
  constructor(private readonly worker: WorkerLike = newReplayWorker()) {
    this.listener = (event) => {
      const m = (event as { data?: { t?: string; id: number; value?: unknown; error?: string } }).data;
      if (m?.t !== 'replay-task-result') return;
      const pending = this.requests.get(m.id); if (pending === undefined) return;
      this.requests.delete(m.id); clearTimeout(pending.timer);
      if (m.error !== undefined) pending.reject(new Error(m.error)); else pending.resolve(m.value);
    };
    this.failed = (event) => this.rejectAll(new Error((event as { message?: string }).message ?? 'Replay worker failed'));
    worker.addEventListener('message', this.listener); worker.addEventListener('error', this.failed); worker.addEventListener('messageerror', this.failed);
  }
  private request<T>(task: Task, transfer: ArrayBuffer[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Replay library is closed'));
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error('Replay worker timed out')); }, 180000);
      this.requests.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try { this.worker.postMessage({ ...task, t: 'replay-task', id }, transfer); }
      catch (error) { clearTimeout(timer); this.requests.delete(id); reject(error); }
    });
  }
  list(): Promise<readonly RecordedGame[]> { return this.request({ kind: 'list' }); }
  inspect(bytes: Uint8Array): Promise<ReplayInfo> {
    const copy = bytes.slice().buffer; return this.request({ kind: 'inspect', bytes: copy }, [copy]);
  }
  export(name: string, assets: ReplayAssets): Promise<ReplayExport> {
    const simBin = assets.simBin.slice(0), map = assets.map.slice().buffer;
    return this.request({ kind: 'export', name, simBin, map }, [simBin, map]);
  }
  convert(bytes: ArrayBuffer, assets: ReplayAssets): Promise<ReplayExport> {
    const copy = bytes.slice(0), simBin = assets.simBin.slice(0), map = assets.map.slice().buffer;
    return this.request({ kind: 'convert', bytes: copy, simBin, map }, [copy, simBin, map]);
  }
  private rejectAll(error: Error): void {
    for (const req of this.requests.values()) { clearTimeout(req.timer); req.reject(error); }
    this.requests.clear();
  }
  dispose(): void {
    if (this.closed) return; this.closed = true;
    this.rejectAll(new Error('Replay library closed'));
    this.worker.removeEventListener('message', this.listener); this.worker.removeEventListener('error', this.failed); this.worker.removeEventListener('messageerror', this.failed);
    this.worker.terminate();
  }
}

export function downloadReplay(bytes: Uint8Array, name = 'game.rtsreplay'): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
