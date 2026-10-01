/**
 * UI preview page (ui-preview.html, TRACK-EDITOR P6): the panels over a real terrain view and the
 * marker overlay, driven by a real EditorStore and a PanelIo stand-in (no file IO, no tools), for
 * visual checks independent of the app controller. Query: ?map=<name> (default hollow-ridge),
 * ?demo=field|start|multi|issues|help|none (default field). window.__uiPreview is the hook for
 * ad-hoc Playwright screenshots.
 */
import { effect, signal } from '@preact/signals';
import { EditorStore } from '../app/store.ts';
import { MarkerOverlay } from '../overlay/overlay.ts';
import { TerrainPicker } from '../pick/picker.ts';
import { createValidator } from '../validate/index.ts';
import { TerrainView } from '../view/terrain-view.ts';
import { mountPanels } from './index.ts';
import type { PanelIo } from './types.ts';

export interface UiPreviewHook {
  ready: boolean;
  error: string | null;
  store: EditorStore;
  /** Applies a demo state (see the module comment) and waits for the next frame. */
  demo(name: string): Promise<void>;
}

declare global {
  interface Window {
    __uiPreview?: UiPreviewHook;
  }
}

const FX = 4096;
const MAP_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

function requireElement<T extends Element>(selector: string, ctor: abstract new (...args: never[]) => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof ctor)) throw new Error(`ui-preview: missing ${selector}`);
  return el;
}

const canvas = requireElement('#terrain', HTMLCanvasElement);
const uiRoot = requireElement('#ui', HTMLElement);
const view = new TerrainView({ canvas });
const overlay = new MarkerOverlay(view);
const picker = new TerrainPicker(view);
const store = new EditorStore();
store.setValidator(createValidator());

const cursor = signal<{ x: number; z: number } | null>(null);
const gridVisible = signal(view.gridIsVisible);

async function fetchMap(name: string): Promise<Uint8Array> {
  if (!MAP_NAME_RE.test(name)) throw new Error(`invalid map name: ${name}`);
  const res = await fetch(`/maps/${name}.rtsmap`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for /maps/${name}.rtsmap`);
  return new Uint8Array(await res.arrayBuffer());
}

const io: PanelIo = {
  openFile() {
    store.status.value = 'Vorschau: Datei öffnen ist hier nicht verdrahtet';
  },
  async listBundled() {
    const res = await fetch('/maps/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as readonly { readonly name: string }[];
    return list.map((m) => m.name);
  },
  async openBundled(name) {
    store.open(await fetchMap(name), `${name}.rtsmap`);
    view.fitCamera();
  },
  save() {
    store.markSaved();
    store.status.value = 'Vorschau: gespeichert (kein Download)';
  },
  exportMarkersJson() {
    store.status.value = `Vorschau: markers.json mit ${store.exportMarkersJson().length} Zeichen`;
  },
  focus(x, z) {
    view.focus(x / FX, z / FX);
  },
  fitView() {
    view.fitCamera();
  },
  cursor,
  gridVisible,
};

effect(() => view.setGridVisible(gridVisible.value));

let lastMap: unknown = null;
effect(() => {
  const doc = store.doc.value;
  const _revision = store.revision.value;
  if (doc === null) return;
  const map = doc.toRtsMap();
  if (lastMap === null || (lastMap as { heights: unknown }).heights !== map.heights) view.setMap(map);
  lastMap = map;
  overlay.update({
    sizeWu: doc.sizeWu,
    starts: doc.starts,
    spots: doc.spots,
    fields: doc.fields,
    props: map.props,
    expanded: store.expandedProps(),
    selection: store.selection.value,
    hover: store.hover.value,
    issues: store.issues.value,
    symmetry: store.symmetry.value,
    draft: null,
  });
  view.requestRender();
});

canvas.addEventListener('pointermove', (e) => {
  const p = picker.pickWu(e.clientX, e.clientY);
  cursor.value = p === null ? null : { x: p.x, z: p.z };
});
canvas.addEventListener('pointerleave', () => {
  cursor.value = null;
});

function frame(): Promise<void> {
  return new Promise((resolve) => {
    const off = view.onBeforeRender(() => {
      off();
      queueMicrotask(resolve);
    });
    view.requestRender();
  });
}

function demoFields(): void {
  const doc = store.doc.peek();
  if (doc === null || doc.fields.length > 0) return;
  const s = (f: number): number => Math.round(doc.sizeWu * f) * FX;
  store.addField({ kind: 'circle', x: s(0.3), z: s(0.33), r: s(0.06) }, { name: 'Hain Nord', densityPerKWu2: 160 });
  store.updateField(0, { entries: [{ id: 'core:tree_01', weight: 3 }, { id: 'core:tree_02', weight: 1 }] });
  store.addField(
    {
      kind: 'polygon',
      points: [
        { x: s(0.55), z: s(0.2) },
        { x: s(0.72), z: s(0.24) },
        { x: s(0.68), z: s(0.38) },
        { x: s(0.52), z: s(0.34) },
      ],
    },
    { name: 'Felsband', kind: 'rock', entries: [{ id: 'core:rock_01', weight: 1 }], reclaimMassMilli: 12000, reclaimEnergyMilli: 0 },
  );
}

const hook: UiPreviewHook = {
  ready: false,
  error: null,
  store,
  async demo(name) {
    const doc = store.doc.peek();
    if (doc === null) return;
    const help = document.querySelector('[data-testid="help-overlay"]') !== null;
    if (help !== (name === 'help')) window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    switch (name) {
      case 'field':
        demoFields();
        store.select([{ type: 'field', index: 0 }]);
        store.tool.value = 'select';
        break;
      case 'start':
        store.select([{ type: 'start', index: 0 }]);
        store.tool.value = 'start';
        break;
      case 'multi':
        demoFields();
        store.select([
          { type: 'start', index: 0 },
          { type: 'spot', index: 0 },
          { type: 'field', index: 1 },
        ]);
        break;
      case 'issues': {
        const size = doc.maxRaw;
        store.addSpot('mass', 0, 0);
        store.addSpot('mass', size >> 1, size >> 1);
        store.addSpot('hydro', size - 4096, 8192);
        store.symmetry.value = 'point';
        break;
      }
      default:
        store.select([]);
    }
    cursor.value = { x: 212.4, z: 187.9 };
    await frame();
  },
};
window.__uiPreview = hook;

mountPanels(uiRoot, store, io);

const params = new URLSearchParams(location.search);
const mapName = params.get('map') ?? 'hollow-ridge';
io.openBundled(mapName)
  .then(async () => {
    await hook.demo(params.get('demo') ?? 'field');
    hook.ready = true;
  })
  .catch((err: unknown) => {
    hook.error = err instanceof Error ? err.message : String(err);
    store.status.value = `Vorschau: ${hook.error}`;
  });
