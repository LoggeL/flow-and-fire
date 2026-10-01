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
  { readonly kind: 'delete'; readonly name: string } |
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
  /** Removes one stored recording; a log still being written by a running match is refused. */
  delete(name: string): Promise<void> { return this.request({ kind: 'delete', name }); }
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

/** Player labels for stored recordings. File names stay untouched: rotation and recovery rely on them. */
export const REPLAY_LABELS_KEY = 'faf.replayLabels.v1';
export function loadReplayLabels(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Readonly<Record<string, string>> {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(REPLAY_LABELS_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''));
  } catch { return {}; }
}
export function saveReplayLabel(name: string, label: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): Readonly<Record<string, string>> {
  const labels: Record<string, string> = { ...loadReplayLabels(storage) }, clean = label.trim().slice(0, 80);
  if (clean === '') delete labels[name]; else labels[name] = clean;
  try { storage?.setItem(REPLAY_LABELS_KEY, JSON.stringify(labels)); } catch { /* Labels stay session-only. */ }
  return labels;
}
/** Recording start time from `log-YYYYMMDDTHHMMSSmmm-…`, or null for foreign names. */
export function recordingDate(name: string): Date | null {
  const m = /^log-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})-/.exec(name);
  return m === null ? null : new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, +m[7]!));
}

export function downloadReplay(bytes: Uint8Array, name = 'game.rtsreplay'): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
