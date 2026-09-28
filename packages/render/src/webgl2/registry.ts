/**
 * Context-loss registry (P10 groundwork, PLAN §3.7): every GPU resource is registered with its
 * descriptor. On `webglcontextlost` all backend objects are dropped; on `webglcontextrestored`
 * every live resource is re-created in registration order and afterwards its upload callback runs
 * so contents are rewritten. The simulation keeps running meanwhile (it lives in a worker).
 */

export interface RegisteredResource {
  /** Creates the backend object(s) from the descriptor. */
  realize(): void;
  /** Forgets backend objects. `deleteObjects` = also delete them (explicit destroy, context alive). */
  release(deleteObjects: boolean): void;
  /** Rewrites contents after a restore (optional). */
  readonly restore: (() => void) | undefined;
}

/** Minimal event target (HTMLCanvasElement, OffscreenCanvas or a test fake). */
export interface ContextEventTarget {
  addEventListener(type: string, listener: (ev: Event) => void): void;
  removeEventListener(type: string, listener: (ev: Event) => void): void;
}

export interface RegistryHooks {
  /** Runs after the context came back, before resources are re-created (reset caches, extensions). */
  beforeRealize(): void;
}

export class ContextLossRegistry {
  private readonly entries: (RegisteredResource | null)[] = [];
  private lost = false;
  private readonly lostListeners: (() => void)[] = [];
  private readonly restoredListeners: (() => void)[] = [];
  private readonly onLostEvent: (ev: Event) => void;
  private readonly onRestoredEvent: (ev: Event) => void;
  /** Number of completed restores (diagnostics). */
  restoreCount = 0;

  constructor(
    private readonly target: ContextEventTarget,
    private readonly hooks: RegistryHooks,
    initiallyLost: boolean,
  ) {
    this.lost = initiallyLost;
    this.onLostEvent = (ev) => {
      // Without preventDefault the browser never fires webglcontextrestored.
      ev.preventDefault();
      this.handleLost();
    };
    this.onRestoredEvent = () => this.handleRestored();
    target.addEventListener('webglcontextlost', this.onLostEvent);
    target.addEventListener('webglcontextrestored', this.onRestoredEvent);
  }

  isLost(): boolean {
    return this.lost;
  }

  /** Registers a resource and realizes it immediately unless the context is lost. Returns its id (≥ 1). */
  register(res: RegisteredResource): number {
    this.entries.push(res);
    if (!this.lost) res.realize();
    return this.entries.length;
  }

  get(id: number): RegisteredResource | null {
    return this.entries[id - 1] ?? null;
  }

  unregister(id: number): void {
    const res = this.entries[id - 1];
    if (res === undefined || res === null) return;
    res.release(!this.lost);
    this.entries[id - 1] = null;
  }

  /** Number of live registered resources. */
  liveCount(): number {
    let n = 0;
    for (const e of this.entries) if (e !== null) n++;
    return n;
  }

  onLost(cb: () => void): () => void {
    this.lostListeners.push(cb);
    return () => removeItem(this.lostListeners, cb);
  }

  onRestored(cb: () => void): () => void {
    this.restoredListeners.push(cb);
    return () => removeItem(this.restoredListeners, cb);
  }

  /** Visible for tests; normally driven by canvas events. */
  handleLost(): void {
    if (this.lost) return;
    this.lost = true;
    for (const e of this.entries) if (e !== null) e.release(false);
    for (const cb of this.lostListeners.slice()) cb();
  }

  /** Visible for tests; normally driven by canvas events. */
  handleRestored(): void {
    this.lost = false;
    this.hooks.beforeRealize();
    // Two phases: first every object exists again, then contents are uploaded (callbacks may
    // touch other resources, e.g. a mesh restore writing into a shared buffer).
    for (const e of this.entries) if (e !== null) e.realize();
    for (const e of this.entries) if (e !== null && e.restore !== undefined) e.restore();
    this.restoreCount++;
    for (const cb of this.restoredListeners.slice()) cb();
  }

  dispose(): void {
    this.target.removeEventListener('webglcontextlost', this.onLostEvent);
    this.target.removeEventListener('webglcontextrestored', this.onRestoredEvent);
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e !== null && e !== undefined) e.release(!this.lost);
      this.entries[i] = null;
    }
    this.lostListeners.length = 0;
    this.restoredListeners.length = 0;
  }
}

function removeItem<T>(arr: T[], item: T): void {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
}
