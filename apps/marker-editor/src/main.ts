/**
 * Marker editor app (TRACK-EDITOR P5): wires the terrain view (P1), the EditorStore (P2), the
 * validator (P3), overlay and picking (P4), the panels (P6), the tool controller and the file IO.
 *
 * Start map: ?map=<name>, else the last opened bundled map (localStorage), else hollow-ridge.
 * Hooks: window.__editor (E2E contract, src/app/hooks.ts) and window.__editorView (P1).
 */
import { effect, signal } from '@preact/signals';
import { MAP_FX_ONE } from '@faf/formats';
import { EditorController, type HostActions } from './app/controller.ts';
import { createEditorHooks, createViewHook, type HookDeps } from './app/hooks.ts';
import { isEditableTarget } from './app/keymap.ts';
import { EditorStore } from './app/store.ts';
import { STRINGS } from './app/strings.ts';
import type { PointerInput, ToolEnv } from './app/tools/types.ts';
import { createViewMarkersAdapter } from './app/view-markers.ts';
import { downloadData, FilePicker, installDropTarget } from './io/files.ts';
import { EditorSession, LoadCancelled } from './io/session.ts';
import { isMapName, readLastMap } from './io/storage.ts';
import { MarkerOverlay } from './overlay/overlay.ts';
import type { ViewMarkers } from './overlay/types.ts';
import { hitTestMarkers, TerrainPicker, worldToClient } from './pick/index.ts';
import { mountPanels } from './ui/index.ts';
import type { PanelIo } from './ui/types.ts';
import { createValidator } from './validate/index.ts';
import { TerrainView } from './view/terrain-view.ts';

const DEFAULT_MAP = 'hollow-ridge';

function requireElement<T extends Element>(selector: string, ctor: abstract new (...args: never[]) => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof ctor)) throw new Error(`marker-editor: missing ${selector}`);
  return el;
}

const appEl = requireElement('#app', HTMLElement);
const viewport = requireElement('#viewport', HTMLElement);
const canvas = requireElement('#terrain', HTMLCanvasElement);
const ui = requireElement('#ui', HTMLElement);

// Map summary (live region for screen readers; E2E view.spec reads it).
const label = document.createElement('div');
label.className = 'sr-only';
label.dataset['testid'] = 'map-label';
label.setAttribute('aria-live', 'polite');
viewport.append(label);

const store = new EditorStore();
store.setValidator(createValidator());
const view = new TerrainView({ canvas });
const overlay = new MarkerOverlay(view);
const picker = new TerrainPicker(view);
const adapter = createViewMarkersAdapter();
let markers: ViewMarkers | null = null;

/** Requests one render and resolves once it has happened. */
function waitForRender(): Promise<void> {
  return new Promise((resolve) => {
    const off = view.onBeforeRender(() => {
      off();
      // onBeforeRender runs right before the render call of the same frame: resolve after it.
      queueMicrotask(resolve);
    });
    view.requestRender();
  });
}

/** Commits a pending edit of a focused form field (panels commit on change/blur). */
function blurActiveField(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && isEditableTarget(el)) el.blur();
}

const session = new EditorSession({
  store,
  afterOpen: waitForRender,
  download: downloadData,
  confirm: (msg) => window.confirm(msg),
  now: () => performance.now(),
});

function reportLoadError(e: unknown): void {
  if (e instanceof LoadCancelled) return;
  // The status line already shows the German message.
  console.warn('marker-editor: load failed', e);
}

const filePicker = new FilePicker(appEl, (file) => {
  session.loadFile(file, { confirmDiscard: true }).catch(reportLoadError);
});
installDropTarget(appEl, (file) => {
  session.loadFile(file, { confirmDiscard: true }).catch(reportLoadError);
});

const gridVisible = signal(view.gridIsVisible);
effect(() => {
  view.setGridVisible(gridVisible.value);
});

const env: ToolEnv = {
  pick: (x, y) => picker.pick(x, y),
  hitTest(x, y, selection) {
    const m = markers;
    if (m === null) return null;
    return hitTestMarkers(view, selection === undefined ? m : { ...m, selection }, x, y);
  },
  project: (xRaw, zRaw) => worldToClient(view, xRaw, zRaw),
  groundAt(x, y) {
    const g = view.rig.groundAt(x, y);
    return g === null ? null : { x: g.x, z: g.z };
  },
  panBy: (dx, dz) => view.rig.panBy(dx, dz),
};

const host: HostActions = {
  save() {
    blurActiveField();
    session.save();
  },
  open: () => filePicker.open(),
  fitView: () => view.fitCamera(),
  toggleGrid() {
    gridVisible.value = !gridVisible.peek();
    store.status.value = gridVisible.peek() ? STRINGS.gridOn : STRINGS.gridOff;
  },
};

const controller = new EditorController(store, env, host);

// Scene: new map → terrain; every store/draft change → overlay (incremental) + one render.
let shownSource: object | null = null;
effect(() => {
  const doc = store.doc.value;
  const input = {
    doc,
    selection: store.selection.value,
    hover: store.hover.value,
    issues: store.issues.value,
    symmetry: store.symmetry.value,
    draft: controller.draft.value,
    expand: () => store.expandedProps(),
  };
  if (doc !== null && doc.source !== shownSource) {
    shownSource = doc.source;
    view.setMap(doc.toRtsMap());
  }
  markers = adapter(input);
  if (markers !== null) overlay.update(markers);
  view.requestRender();
});

effect(() => {
  canvas.style.cursor = controller.cursorStyle.value;
});

effect(() => {
  const doc = store.doc.value;
  label.textContent = doc === null ? STRINGS.noDocument : STRINGS.mapLabel(doc.name, doc.sizeWu, doc.starts.length, doc.spots.length, doc.fields.length);
});

effect(() => {
  const file = store.fileName.value;
  const dirty = store.dirty.value;
  document.title = file === null ? STRINGS.appTitle : `${dirty ? '● ' : ''}${file} – ${STRINGS.appTitle}`;
});

// Pointer input: the left button (without Alt) goes to the tools; right/middle/Alt/wheel to the CameraRig.
function pointerInput(e: MouseEvent): PointerInput {
  return { x: e.clientX, y: e.clientY, shift: e.shiftKey, mod: e.ctrlKey || e.metaKey };
}

let activePointer: number | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.altKey || !e.isPrimary || activePointer !== null) return;
  canvas.focus({ preventScroll: true });
  blurActiveField();
  if (!controller.pointerDown(pointerInput(e))) return;
  e.preventDefault();
  activePointer = e.pointerId;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // synthetic events may carry an inactive pointer id
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (activePointer !== null && e.pointerId !== activePointer) return;
  controller.pointerMove(pointerInput(e));
});
const endPointer = (e: PointerEvent, cancelled: boolean): void => {
  if (activePointer === null || e.pointerId !== activePointer) return;
  activePointer = null;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    // capture was not taken
  }
  if (cancelled) controller.pointerCancel();
  else controller.pointerUp(pointerInput(e));
};
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('pointerleave', () => controller.pointerLeave());
canvas.addEventListener('dblclick', (e) => {
  if (e.button !== 0 || e.altKey) return;
  e.preventDefault();
  controller.doubleClick(pointerInput(e));
});
window.addEventListener('blur', () => {
  if (activePointer !== null) {
    activePointer = null;
    controller.pointerCancel();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  if (controller.handleKey(e, isEditableTarget(e.target))) e.preventDefault();
});

window.addEventListener('beforeunload', (e) => {
  if (!store.dirty.peek()) return;
  e.preventDefault();
  // Legacy browsers show the dialog only with a returnValue.
  e.returnValue = STRINGS.beforeUnload;
});

const io: PanelIo = {
  openFile: () => filePicker.open(),
  async listBundled(): Promise<readonly string[]> {
    try {
      return await session.listBundled();
    } catch (e) {
      store.status.value = STRINGS.loadFailed('maps/index.json', e instanceof Error ? e.message : String(e));
      return [];
    }
  },
  openBundled: (name) => session.loadBundled(name, { confirmDiscard: true }).catch(reportLoadError),
  save: () => host.save(),
  exportMarkersJson() {
    session.exportMarkersJson();
  },
  exportEditorOverlay() {
    session.exportEditorOverlay();
  },
  focus: (xRaw, zRaw) => view.focus(xRaw / MAP_FX_ONE, zRaw / MAP_FX_ONE),
  fitView: () => view.fitCamera(),
  cursor: controller.cursor,
  gridVisible,
};

mountPanels(ui, store, io);

/**
 * The panels cover the canvas margins: tell the view, so the fitted map and focused markers sit in
 * the free middle area (measured from the panel columns and bars, updated on every layout change).
 */
function updateViewInsets(): void {
  const c = canvas.getBoundingClientRect();
  const edge = (sel: string, side: 'left' | 'right' | 'top' | 'bottom'): number => {
    const el = ui.querySelector(sel);
    if (!(el instanceof HTMLElement) || el.offsetParent === null) return 0;
    const r = el.getBoundingClientRect();
    if (side === 'left') return Math.max(0, r.right - c.left);
    if (side === 'right') return Math.max(0, c.right - r.left);
    if (side === 'top') return Math.max(0, r.bottom - c.top);
    return Math.max(0, c.bottom - r.top);
  };
  view.setViewInsets({
    left: edge('.me-col-left', 'left'),
    right: edge('.me-col-right', 'right'),
    top: edge('.me-topbar', 'top'),
    bottom: edge('.me-statusbar', 'bottom'),
  });
}
if (typeof ResizeObserver !== 'undefined') {
  const insetObserver = new ResizeObserver(() => updateViewInsets());
  insetObserver.observe(canvas);
  for (const sel of ['.me-col-left', '.me-col-right', '.me-topbar', '.me-statusbar']) {
    const el = ui.querySelector(sel);
    if (el !== null) insetObserver.observe(el);
  }
}
window.addEventListener('resize', updateViewInsets);
updateViewInsets();

const hookDeps: HookDeps = { store, session, view, picker, waitForRender };
window.__editor = createEditorHooks(hookDeps);
window.__editorView = createViewHook(hookDeps);

async function start(): Promise<void> {
  const requested = new URLSearchParams(location.search).get('map');
  const first = requested !== null && isMapName(requested) ? requested : (readLastMap() ?? DEFAULT_MAP);
  try {
    await session.loadBundled(first);
  } catch (e) {
    reportLoadError(e);
    if (first === DEFAULT_MAP || store.doc.peek() !== null) return;
    const reason = session.lastError ?? '';
    await session.loadBundled(DEFAULT_MAP);
    store.status.value = `${STRINGS.loadFailed(first, reason)} – ${DEFAULT_MAP} geladen`;
  }
}

start().catch(reportLoadError);
canvas.focus();
