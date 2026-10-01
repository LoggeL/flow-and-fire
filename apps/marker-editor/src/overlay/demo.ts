/**
 * Overlay demo page (overlay-demo.html, TRACK-EDITOR P4): visual check of MarkerOverlay and the
 * picker on a real map without the editor UI. Loads ?map=<name> (default setons), adds demo prop
 * fields when the map has none, one issue per severity, the symmetry guide ?sym=<mode> (default
 * point) and a draft polygon. Hover/click use hitTestMarkers; the status line shows the picked
 * map point. window.__overlayDemo is the hook for ad-hoc Playwright screenshots.
 */
import { expandPropFields, readRtsMap, type MapPropField, type RtsMap } from '@faf/formats';
import { hitTestMarkers, TerrainPicker } from '../pick/picker.ts';
import { TerrainView } from '../view/terrain-view.ts';
import { MarkerOverlay, type OverlayStats } from './overlay.ts';
import type { MarkerRef, OverlayLayer, SymmetryMode, ViewMarkers } from './types.ts';

export interface OverlayDemoHook {
  ready: boolean;
  error: string | null;
  mapName: string | null;
  /** Whole-map view (TerrainView.fitCamera). */
  overview(): Promise<void>;
  /** Close-up of a map point (WU) at `distance` WU. */
  closeUp(xWu: number, zWu: number, distance: number): Promise<void>;
  /** Map point (Fx raw) under a client pixel. */
  pick(clientX: number, clientY: number): { x: number; z: number } | null;
  hit(clientX: number, clientY: number): MarkerRef | null;
  select(refs: readonly MarkerRef[]): Promise<void>;
  setVisible(layer: OverlayLayer, v: boolean): Promise<void>;
  stats(): OverlayStats;
  markers(): { starts: number; spots: number; fields: number; expanded: number; props: number };
}

declare global {
  interface Window {
    __overlayDemo?: OverlayDemoHook;
  }
}

const MAP_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const SYMMETRIES: readonly SymmetryMode[] = ['none', 'point', 'mirrorX', 'mirrorZ', 'diagonal', 'antiDiagonal'];
const FX = 4096;

/** Demo fields (Fx raw) scaled to the map: a grove, a rock polygon and a wreck field. */
function demoFields(sizeWu: number): MapPropField[] {
  const s = (f: number): number => Math.round(sizeWu * f) * FX;
  const common = { scaleMinPermille: 800, scaleMaxPermille: 1300, maxSlopePermille: 900, dryOnly: true, reclaimEnergyMilli: 0 } as const;
  return [
    {
      name: 'Hain Nord',
      kind: 'tree',
      shape: { kind: 'circle', x: s(0.3), z: s(0.33), r: s(0.07) },
      entries: [
        { id: 'core:tree_01', weight: 3 },
        { id: 'core:tree_02', weight: 1 },
      ],
      densityPerKWu2: 160,
      seed: 11,
      reclaimMassMilli: 0,
      ...common,
      reclaimEnergyMilli: 40_000,
    },
    {
      name: 'Felsband',
      kind: 'rock',
      shape: {
        kind: 'polygon',
        points: [
          { x: s(0.55), z: s(0.2) },
          { x: s(0.74), z: s(0.24) },
          { x: s(0.7), z: s(0.4) },
          { x: s(0.62), z: s(0.33) },
          { x: s(0.52), z: s(0.36) },
        ],
      },
      entries: [{ id: 'core:rock_01', weight: 1 }],
      densityPerKWu2: 48,
      seed: 23,
      reclaimMassMilli: 12_000,
      ...common,
    },
    {
      name: 'Wrackfeld',
      kind: 'wreck',
      shape: { kind: 'circle', x: s(0.62), z: s(0.7), r: s(0.05) },
      entries: [{ id: 'core:wreck_01', weight: 1 }],
      densityPerKWu2: 40,
      seed: 5,
      reclaimMassMilli: 60_000,
      ...common,
    },
  ];
}

function requireElement<T extends Element>(selector: string, ctor: abstract new (...args: never[]) => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof ctor)) throw new Error(`overlay-demo: missing ${selector}`);
  return el;
}

function buildMarkers(map: RtsMap, symmetry: SymmetryMode): ViewMarkers {
  const size = map.meta.sizeWu;
  const fields = map.propFields !== undefined && map.propFields.length > 0 ? map.propFields : demoFields(size);
  const expanded = expandPropFields({ ...map, propFields: fields });
  const spot0 = map.meta.spots[0];
  const start1 = map.meta.starts[1] ?? map.meta.starts[0];
  const f = (v: number): number => Math.round(size * v) * FX;
  return {
    sizeWu: size,
    starts: map.meta.starts,
    spots: map.meta.spots,
    fields,
    props: map.props,
    expanded,
    selection: [{ type: 'field', index: 1 }, ...(start1 !== undefined ? [{ type: 'start', index: 1 } as const] : [])],
    hover: spot0 !== undefined ? { type: 'spot', index: 0 } : null,
    issues: [
      ...(spot0 !== undefined
        ? [{ severity: 'error', code: 'spot-slope', message: 'Spot am Hang', x: spot0.x, z: spot0.z, refs: [{ type: 'spot', index: 0 }] } as const]
        : []),
      { severity: 'warning', code: 'field-water', message: 'Feld teilweise unter Wasser', x: null, z: null, refs: [{ type: 'field', index: 2 }] },
      { severity: 'info', code: 'note', message: 'Hinweis', x: f(0.15), z: f(0.85), refs: [] },
    ],
    symmetry,
    draft: {
      kind: 'polygon',
      points: [
        { x: f(0.2), z: f(0.62) },
        { x: f(0.3), z: f(0.6) },
        { x: f(0.33), z: f(0.7) },
        { x: f(0.24), z: f(0.74) },
      ],
    },
  };
}

async function main(): Promise<void> {
  const canvas = requireElement('#terrain', HTMLCanvasElement);
  const status = requireElement('#status', HTMLElement);
  const params = new URLSearchParams(location.search);
  const name = params.get('map') ?? 'setons';
  const symParam = params.get('sym') ?? 'point';
  const symmetry = SYMMETRIES.find((s) => s === symParam) ?? 'point';

  const view = new TerrainView({ canvas });
  const overlay = new MarkerOverlay(view);
  const picker = new TerrainPicker(view);
  let m: ViewMarkers | null = null;

  const frame = (): Promise<void> =>
    new Promise((resolve) => {
      const off = view.onBeforeRender(() => {
        off();
        queueMicrotask(resolve);
      });
      view.requestRender();
    });

  const hook: OverlayDemoHook = {
    ready: false,
    error: null,
    mapName: null,
    async overview() {
      view.fitCamera();
      await frame();
    },
    async closeUp(xWu, zWu, distance) {
      view.rig.setPose({ targetX: xWu, targetZ: zWu, distance });
      await frame();
    },
    pick: (x, y) => picker.pick(x, y),
    hit: (x, y) => (m === null ? null : hitTestMarkers(view, m, x, y)),
    async select(refs) {
      if (m === null) return;
      m = { ...m, selection: refs };
      overlay.update(m);
      await frame();
    },
    async setVisible(layer, v) {
      overlay.setVisible(layer, v);
      await frame();
    },
    stats: () => overlay.stats(),
    markers: () => ({
      starts: m?.starts.length ?? 0,
      spots: m?.spots.length ?? 0,
      fields: m?.fields.length ?? 0,
      expanded: m?.expanded.length ?? 0,
      props: m?.props.length ?? 0,
    }),
  };
  window.__overlayDemo = hook;

  canvas.addEventListener('pointermove', (e) => {
    if (m === null || e.buttons !== 0) return;
    const hover = hitTestMarkers(view, m, e.clientX, e.clientY);
    const p = picker.pick(e.clientX, e.clientY);
    status.textContent = p === null ? 'außerhalb der Karte' : `x ${(p.x / FX).toFixed(3)} · z ${(p.z / FX).toFixed(3)} WU${hover !== null ? ` · ${JSON.stringify(hover)}` : ''}`;
    if (JSON.stringify(hover) !== JSON.stringify(m.hover)) {
      m = { ...m, hover };
      overlay.update(m);
    }
  });
  canvas.addEventListener('click', (e) => {
    if (m === null) return;
    const ref = hitTestMarkers(view, m, e.clientX, e.clientY);
    m = { ...m, selection: ref === null ? [] : [ref] };
    overlay.update(m);
  });

  try {
    if (!MAP_NAME_RE.test(name)) throw new Error(`invalid map name: ${name}`);
    const res = await fetch(`/maps/${name}.rtsmap`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for /maps/${name}.rtsmap`);
    const map = readRtsMap(new Uint8Array(await res.arrayBuffer()));
    view.setMap(map);
    m = buildMarkers(map, symmetry);
    overlay.update(m);
    await frame();
    hook.mapName = name;
    hook.ready = true;
    status.textContent = `${map.meta.name} · ${m.starts.length} Starts · ${m.spots.length} Spots · ${m.fields.length} Felder · ${m.expanded.length} Props (expandiert)`;
  } catch (err) {
    hook.error = err instanceof Error ? err.message : String(err);
    status.textContent = `Fehler: ${hook.error}`;
    throw err;
  }
}

void main();
