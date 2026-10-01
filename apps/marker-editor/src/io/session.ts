/**
 * EditorSession — loading and saving of the edited map (DOM-free; browser specifics are injected).
 *
 * - Every load (bundled map, file, raw bytes) runs through one sequence: status "Lade …", read the
 *   bytes, `store.open` (FormatError → German status, the previous map stays), wait for the first
 *   rendered frame, then `ready`. A newer load supersedes an older one still in flight.
 * - `ready` is true while a map is open and has been rendered at least once.
 * - Loads started from the UI ask before discarding unsaved changes; programmatic loads (test
 *   hooks) do not.
 * - Saving downloads '<name>.rtsmap' and marks the state saved; markers.json is a separate export.
 * - The last opened bundled map is remembered (localStorage, see storage.ts).
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type { EditorStore } from '../app/store.ts';
import { STRINGS } from '../app/strings.ts';
import { fetchMapBytes, fetchMapIndex } from './bundled.ts';
import { describeError } from './errors.ts';
import { writeLastMap } from './storage.ts';

export interface SessionDeps {
  readonly store: EditorStore;
  /** Resolves after the next rendered frame (the new map is on screen). */
  afterOpen(): Promise<void>;
  /** Offers bytes/text as a download. */
  download(data: Uint8Array | string, fileName: string, type: string): void;
  /** Asks the user (window.confirm in the app). */
  confirm(message: string): boolean;
  /** Clock for load timings (performance.now in the app). */
  now(): number;
  readonly fetch?: typeof fetch;
  /** Remember the last bundled map (default: localStorage). */
  rememberMap?(name: string): void;
}

export interface LoadOptions {
  /** Ask before discarding unsaved changes (UI paths). Default false. */
  readonly confirmDiscard?: boolean;
}

/** Thrown (rejected) when the user keeps the unsaved map. */
export class LoadCancelled extends Error {
  constructor() {
    super('Laden abgebrochen');
    this.name = 'LoadCancelled';
  }
}

/** Map name from a file name: 'maps/hollow-ridge.rtsmap' → 'hollow-ridge'. */
export function baseName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  const f = fileName.slice(slash + 1);
  return f.toLowerCase().endsWith('.rtsmap') ? f.slice(0, -'.rtsmap'.length) : f;
}

/** Download name of the edited map: '<name>.rtsmap'. */
export function rtsmapFileName(fileName: string | null): string {
  const base = fileName === null || fileName === '' ? 'map' : baseName(fileName);
  return `${base === '' ? 'map' : base}.rtsmap`;
}

export class EditorSession {
  readonly store: EditorStore;
  private readonly deps: SessionDeps;
  private readonly readySig = signal(false);
  private readonly mapNameSig = signal<string | null>(null);
  private readonly loadingSig = signal(false);
  private seq = 0;
  /** True while a map is open and has been rendered at least once. */
  readonly ready: ReadonlySignal<boolean> = this.readySig;
  /** Name of the open map (bundled name or file name without .rtsmap). */
  readonly mapName: ReadonlySignal<string | null> = this.mapNameSig;
  readonly loading: ReadonlySignal<boolean> = this.loadingSig;
  /** Message of the last failed load, null after a successful one. */
  lastError: string | null = null;
  /** Milliseconds from load start to the first rendered frame of the last successful load. */
  loadMs = 0;
  private indexCache: readonly string[] | null = null;

  constructor(deps: SessionDeps) {
    this.deps = deps;
    this.store = deps.store;
  }

  /** Names of the bundled maps (cached after the first successful fetch). */
  async listBundled(): Promise<readonly string[]> {
    if (this.indexCache !== null) return this.indexCache;
    const idx = await fetchMapIndex(this.deps.fetch);
    this.indexCache = idx.map((e) => e.name);
    return this.indexCache;
  }

  /** Loads maps/<name>.rtsmap (rejects on HTTP/format errors; the status line names the reason). */
  loadBundled(name: string, opts: LoadOptions = {}): Promise<void> {
    return this.load(name, `${name}.rtsmap`, () => fetchMapBytes(name, this.deps.fetch), opts, true);
  }

  /** Opens .rtsmap bytes under `fileName` (e.g. a chosen or dropped file). */
  loadBytes(bytes: Uint8Array, fileName: string, opts: LoadOptions = {}): Promise<void> {
    return this.load(baseName(fileName), fileName, () => Promise.resolve(bytes), opts, false);
  }

  /** Opens a File/Blob with a name (file dialog, drag & drop). */
  loadFile(file: { readonly name: string; arrayBuffer(): Promise<ArrayBuffer> }, opts: LoadOptions = {}): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.rtsmap')) {
      this.store.status.value = STRINGS.notAMapFile(file.name);
      return Promise.reject(new Error(STRINGS.notAMapFile(file.name)));
    }
    return this.load(baseName(file.name), file.name, async () => new Uint8Array(await file.arrayBuffer()), opts, false);
  }

  /** Downloads the map as '<name>.rtsmap' and marks it saved; false (status) if it cannot be written. */
  save(): boolean {
    const store = this.store;
    if (store.doc.peek() === null) {
      store.status.value = STRINGS.noDocument;
      return false;
    }
    let bytes: Uint8Array;
    try {
      bytes = store.exportBytes();
    } catch (e) {
      store.status.value = STRINGS.saveFailed(describeError(e));
      return false;
    }
    const name = rtsmapFileName(store.fileName.peek());
    this.deps.download(bytes, name, 'application/octet-stream');
    store.markSaved();
    store.status.value = STRINGS.saved(name, bytes.length);
    return true;
  }

  /** Downloads markers.json (mapc source format). */
  exportMarkersJson(): boolean {
    const store = this.store;
    if (store.doc.peek() === null) {
      store.status.value = STRINGS.noDocument;
      return false;
    }
    let text: string;
    try {
      text = store.exportMarkersJson();
    } catch (e) {
      store.status.value = STRINGS.markersFailed(describeError(e));
      return false;
    }
    this.deps.download(text, 'markers.json', 'application/json');
    store.status.value = STRINGS.markersExported;
    return true;
  }

  private async load(name: string, fileName: string, getBytes: () => Promise<Uint8Array>, opts: LoadOptions, bundled: boolean): Promise<void> {
    const store = this.store;
    if (opts.confirmDiscard === true && store.dirty.peek() && !this.deps.confirm(STRINGS.discardChanges(store.fileName.peek() ?? ''))) {
      throw new LoadCancelled();
    }
    const seq = ++this.seq;
    const t0 = this.deps.now();
    this.readySig.value = false;
    this.loadingSig.value = true;
    store.status.value = STRINGS.loading(name);
    try {
      const bytes = await getBytes();
      if (seq !== this.seq) return;
      store.open(bytes, fileName);
      this.mapNameSig.value = name;
      await this.deps.afterOpen();
      if (seq !== this.seq) return;
      this.loadMs = this.deps.now() - t0;
      this.lastError = null;
      if (bundled) (this.deps.rememberMap ?? writeLastMap)(name);
      this.loadingSig.value = false;
      this.readySig.value = true;
    } catch (e) {
      if (seq !== this.seq) return;
      const msg = describeError(e);
      this.lastError = msg;
      store.status.value = STRINGS.loadFailed(name, msg);
      this.loadingSig.value = false;
      // The previous map (if any) stays open and on screen.
      this.readySig.value = store.doc.peek() !== null && this.mapNameSig.peek() !== null;
      throw e;
    }
  }
}
