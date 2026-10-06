/**
 * Test/debug hooks of the editor app:
 * - window.__editor (TRACK-EDITOR P5, the contract of the E2E specs of P7);
 * - window.__editorView (P1's terrain-view hook, kept working for test/e2e/view.spec.ts).
 * Both load maps through the same EditorSession as the UI.
 */
import { xxHash32 } from '@faf/fixed';
import { mapSimHash, MAP_FX_ONE } from '@faf/formats';
import type { EditorViewHook } from '../env.d.ts';
import type { EditorSession } from '../io/session.ts';
import { worldToClient, type TerrainPicker } from '../pick/index.ts';
import type { TerrainView } from '../view/terrain-view.ts';
import type { EditorStore } from './store.ts';

export interface EditorCounts {
  readonly starts: number;
  readonly mass: number;
  readonly hydro: number;
  readonly fields: number;
  /** Explicit PROP entries of the map. */
  readonly props: number;
  /** Props expanded from the prop fields. */
  readonly expandedProps: number;
}

export interface EditorRenderStats {
  readonly frames: number;
  readonly lastFrameMs: number;
  readonly triangles: number;
  readonly drawCalls: number;
}

/** window.__editor */
export interface EditorHooks {
  /** True once the current map has been rendered at least once (false while a load runs). */
  readonly ready: boolean;
  /** Name of the open map (bundled name or file name without .rtsmap). */
  readonly mapName: string | null;
  /** Loads the bundled map maps/<name>.rtsmap; resolves after its first rendered frame. */
  load(name: string): Promise<void>;
  /** Opens .rtsmap bytes as `name`; resolves after the first rendered frame. */
  loadBytes(bytes: Uint8Array | number[], name: string): Promise<void>;
  /** Current map bytes (writeRtsMap), exactly what "Speichern" downloads. */
  exportBytes(): Uint8Array;
  /** xxHash32 (seed 0, unsigned) of exportBytes(): cheap identity check for the E2E specs. */
  exportHash(): number;
  counts(): EditorCounts;
  issues(): readonly { readonly severity: string; readonly code: string }[];
  /** Client pixel of a terrain point given in WU (null if not visible). */
  worldToClient(xWu: number, zWu: number): { x: number; y: number } | null;
  /** Terrain point (WU) under a client pixel (null off the map). */
  clientToWorld(x: number, y: number): { x: number; z: number } | null;
  undoDepth(): number;
  redoDepth(): number;
  /** mapSimHash of the current map (unsigned). */
  mapSimHash(): number;
  renderStats(): EditorRenderStats;
  /** Requests a render and resolves after it happened. */
  waitForRender(): Promise<void>;
  readonly store: EditorStore;
}

declare global {
  interface Window {
    __editor?: EditorHooks;
  }
}

export interface HookDeps {
  readonly store: EditorStore;
  readonly session: EditorSession;
  readonly view: TerrainView;
  readonly picker: TerrainPicker;
  /** Requests one render and resolves after it happened. */
  waitForRender(): Promise<void>;
}

const NO_COUNTS: EditorCounts = { starts: 0, mass: 0, hydro: 0, fields: 0, props: 0, expandedProps: 0 };

export function createEditorHooks(d: HookDeps): EditorHooks {
  const { store, session, view, picker } = d;
  return {
    get ready(): boolean {
      return session.ready.peek();
    },
    get mapName(): string | null {
      return session.mapName.peek();
    },
    load: (name) => session.loadBundled(name),
    loadBytes: (bytes, name) => session.loadBytes(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes), name),
    exportBytes: () => store.exportBytes(),
    exportHash: () => {
      const b = store.exportBytes();
      return xxHash32(b, 0, b.length, 0) >>> 0;
    },
    counts(): EditorCounts {
      const doc = store.doc.peek();
      if (doc === null) return NO_COUNTS;
      let mass = 0;
      for (const s of doc.spots) if (s.kind === 'mass') mass++;
      return {
        starts: doc.starts.length,
        mass,
        hydro: doc.spots.length - mass,
        fields: doc.fields.length,
        props: doc.source.props.length,
        expandedProps: store.expandedProps().length,
      };
    },
    issues: () => store.issues.peek(),
    worldToClient: (xWu, zWu) => worldToClient(view, Math.round(xWu * MAP_FX_ONE), Math.round(zWu * MAP_FX_ONE)),
    clientToWorld(x, y) {
      const p = picker.pickWu(x, y);
      return p === null ? null : { x: p.x, z: p.z };
    },
    undoDepth: () => store.undoDepth.peek(),
    redoDepth: () => store.redoDepth.peek(),
    mapSimHash(): number {
      const doc = store.doc.peek();
      return doc === null ? 0 : mapSimHash(doc.toRtsMap()) >>> 0;
    },
    renderStats: () => view.stats(),
    waitForRender: () => d.waitForRender(),
    store,
  };
}

/** P1's window.__editorView on top of the app (same loads as the UI and window.__editor). */
export function createViewHook(d: HookDeps): EditorViewHook {
  const { session, view } = d;
  return {
    get ready(): boolean {
      return session.ready.peek();
    },
    set ready(_v: boolean) {
      // read-only in the app; the setter exists because EditorViewHook declares a plain field
    },
    get mapName(): string | null {
      return session.mapName.peek();
    },
    set mapName(_v: string | null) {
      // read-only in the app
    },
    get error(): string | null {
      return session.lastError;
    },
    set error(_v: string | null) {
      // read-only in the app
    },
    get loadMs(): number {
      return session.loadMs;
    },
    set loadMs(_v: number) {
      // read-only in the app
    },
    stats: () => view.stats(),
    load: (name) => session.loadBundled(name),
    frame: () => d.waitForRender(),
    benchFrames(n: number) {
      const gl = view.renderer.getContext();
      const px = new Uint8Array(4);
      const times: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        view.renderNow();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const sum = times.reduce((a, b) => a + b, 0);
      return {
        frames: n,
        avgMs: n > 0 ? sum / n : 0,
        p95Ms: times[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0,
        maxMs: times[n - 1] ?? 0,
      };
    },
  };
}
