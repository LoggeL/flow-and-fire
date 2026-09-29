/**
 * DOM-free fakes for client tests: event targets with dispatch, a canvas surface, synthetic
 * pointer/wheel/keyboard events, a manual rAF and a recording renderer.
 */
import type { RenderView, TerrainDecal, TerrainDesc, VisualTable } from '@faf/render';
import type { InputEventTarget, InputSurface } from '../../src/input.ts';
import type { RafLike, RendererLike } from '../../src/client.ts';

type Listener = (ev: Event) => void;

export class FakeTarget implements InputEventTarget {
  private readonly map = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const l = this.map.get(type) ?? [];
    l.push(listener);
    this.map.set(type, l);
  }

  removeEventListener(type: string, listener: Listener): void {
    const l = this.map.get(type);
    if (l === undefined) return;
    const i = l.indexOf(listener);
    if (i >= 0) l.splice(i, 1);
  }

  listenerCount(type?: string): number {
    if (type !== undefined) return this.map.get(type)?.length ?? 0;
    let n = 0;
    for (const l of this.map.values()) n += l.length;
    return n;
  }

  /** Dispatches a synthetic event object; returns it (check `defaultPrevented`). */
  dispatch<T extends FakeEvent>(ev: T): T {
    for (const l of [...(this.map.get(ev.type) ?? [])]) l(ev as unknown as Event);
    return ev;
  }
}

export class FakeCanvas extends FakeTarget implements InputSurface {
  captured = new Set<number>();
  constructor(
    public clientWidth = 1280,
    public clientHeight = 720,
    public left = 0,
    public top = 0,
  ) {
    super();
  }
  getBoundingClientRect(): { left: number; top: number } {
    return { left: this.left, top: this.top };
  }
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
}

export interface FakeEvent {
  type: string;
  timeStamp: number;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
  [k: string]: unknown;
}

function ev(type: string, fields: Record<string, unknown>): FakeEvent {
  const e: FakeEvent = {
    type,
    timeStamp: 0,
    defaultPrevented: false,
    target: null,
    preventDefault() {
      e.defaultPrevented = true;
    },
    ...fields,
  };
  return e;
}

export function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  button = 0,
  extra: Record<string, unknown> = {},
): FakeEvent {
  return ev(type, { clientX: x, clientY: y, button, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });
}

export function wheel(deltaY: number, x: number, y: number, deltaMode = 0): FakeEvent {
  return ev('wheel', { deltaY, deltaMode, clientX: x, clientY: y });
}

export function key(
  type: 'keydown' | 'keyup',
  code: string,
  extra: { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; repeat?: boolean; timeStamp?: number; target?: unknown } = {},
): FakeEvent {
  return ev(type, {
    code,
    key: extra.key ?? code.replace(/^Key/, '').toLowerCase(),
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...extra,
  });
}

export function contextmenu(): FakeEvent {
  return ev('contextmenu', {});
}

/** Manual requestAnimationFrame (allocation-free: fixed callback slots). */
export class ManualRaf implements RafLike {
  private nextId = 1;
  private readonly ids = new Int32Array(16);
  private readonly cbs: (((ts: number) => void) | null)[] = new Array<((ts: number) => void) | null>(16).fill(null);
  private readonly run: (((ts: number) => void) | null)[] = new Array<((ts: number) => void) | null>(16).fill(null);
  private n = 0;

  request(cb: (ts: number) => void): number {
    if (this.n === this.cbs.length) throw new Error('ManualRaf: too many pending callbacks');
    const id = this.nextId++;
    this.ids[this.n] = id;
    this.cbs[this.n] = cb;
    this.n++;
    return id;
  }

  cancel(id: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.ids[i] !== id) continue;
      for (let j = i + 1; j < this.n; j++) {
        this.ids[j - 1] = this.ids[j]!;
        this.cbs[j - 1] = this.cbs[j]!;
      }
      this.n--;
      this.cbs[this.n] = null;
      return;
    }
  }

  /** Pending callbacks. */
  get size(): number {
    return this.n;
  }

  /** Runs all callbacks registered so far with timestamp `ts`. */
  fire(ts: number): number {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.run[i] = this.cbs[i]!;
      this.cbs[i] = null;
    }
    this.n = 0;
    for (let i = 0; i < n; i++) {
      const cb = this.run[i]!;
      this.run[i] = null;
      cb(ts);
    }
    return n;
  }
}

export interface RecordedRender {
  alpha: number;
  count: number;
  version: number | undefined;
  highlightVersion: number | undefined;
  markers: number;
  lines: number;
  timeMs: number;
}

/** Renderer fake: records what it was asked to draw (without allocating when `record` is false). */
export class FakeRenderer implements RendererLike {
  visuals: VisualTable | null = null;
  calls = 0;
  record = true;
  readonly log: RecordedRender[] = [];
  last: RenderView | null = null;
  terrain: TerrainDesc | null = null;
  decals: readonly TerrainDecal[] = [];

  setVisuals(table: VisualTable): void {
    this.visuals = table;
  }

  setTerrain(desc: TerrainDesc | null): void {
    this.terrain = desc;
  }

  setTerrainDecals(decals: readonly TerrainDecal[]): void {
    this.decals = decals;
  }

  render(view: RenderView): void {
    this.calls++;
    this.last = view;
    if (!this.record) return;
    this.log.push({
      alpha: view.alpha,
      count: view.units.count,
      version: view.units.version,
      highlightVersion: view.highlightVersion,
      markers: view.overlays?.markers.length ?? 0,
      lines: view.overlays?.lines.length ?? 0,
      timeMs: view.timeMs,
    });
  }
}

/** Manually advanced clock. */
export class Clock {
  constructor(public t = 1000) {}
  now = (): number => this.t;
  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }
}
