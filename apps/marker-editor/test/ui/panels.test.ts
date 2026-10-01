// @vitest-environment happy-dom
/**
 * Component tests of the panels (src/ui) with a real EditorStore on hollow-ridge and the real
 * validator: test ids, commits as one undo step, invalid input handling, validation rows, help.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type Signal } from '@preact/signals';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorStore } from '../../src/app/store.ts';
import { mountPanels } from '../../src/ui/index.ts';
import type { PanelIo } from '../../src/ui/types.ts';
import { createValidator } from '../../src/validate/index.ts';

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content/maps');
const WU = 4096;

function mapBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(MAPS_DIR, `${name}.rtsmap`)));
}

interface FakeIo extends PanelIo {
  readonly cursorIn: Signal<{ x: number; z: number } | null>;
  readonly calls: string[];
  readonly focused: { x: number; z: number }[];
}

function fakeIo(): FakeIo {
  const calls: string[] = [];
  const focused: { x: number; z: number }[] = [];
  const cursorIn = signal<{ x: number; z: number } | null>(null);
  return {
    cursorIn,
    calls,
    focused,
    openFile: () => calls.push('openFile'),
    listBundled: () => Promise.resolve(['braidwater', 'hollow-ridge', 'setons', 'tessera']),
    openBundled: (name: string) => {
      calls.push(`openBundled:${name}`);
      return Promise.resolve();
    },
    save: () => calls.push('save'),
    exportMarkersJson: () => calls.push('exportMarkersJson'),
    focus: (x: number, z: number) => {
      focused.push({ x, z });
    },
    fitView: () => calls.push('fitView'),
    cursor: cursorIn,
    gridVisible: signal(false),
  };
}

let root: HTMLElement;
let store: EditorStore;
let io: FakeIo;
let unmount: () => void;

function q<T extends Element = HTMLElement>(testId: string): T {
  const el = root.querySelector(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`missing [data-testid="${testId}"]`);
  return el as unknown as T;
}

function has(testId: string): boolean {
  return root.querySelector(`[data-testid="${testId}"]`) !== null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Types `text` into an input and commits it with Enter (the browser then also fires change). */
async function typeAndEnter(testId: string, text: string): Promise<void> {
  await act(() => {
    const el = q<HTMLInputElement>(testId);
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(() => {
    const el = q<HTMLInputElement>(testId);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(testId: string): Promise<void> {
  await act(() => {
    q(testId).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  });
}

async function choose(testId: string, value: string): Promise<void> {
  await act(() => {
    const el = q<HTMLSelectElement>(testId);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function run(fn: () => void): Promise<void> {
  await act(() => {
    fn();
  });
}

beforeEach(async () => {
  root = document.createElement('div');
  document.body.append(root);
  store = new EditorStore();
  store.setValidator(createValidator());
  store.open(mapBytes('hollow-ridge'), 'hollow-ridge.rtsmap');
  io = fakeIo();
  await act(() => {
    unmount = mountPanels(root, store, io);
  });
  await flush();
});

afterEach(() => {
  unmount();
  root.remove();
});

describe('panels', () => {
  it('renders every contract test id', async () => {
    const always = [
      'tool-select',
      'tool-start',
      'tool-mass',
      'tool-hydro',
      'tool-field-circle',
      'tool-field-polygon',
      'tool-delete',
      'btn-open',
      'select-map',
      'btn-save',
      'btn-export-markers',
      'btn-undo',
      'btn-redo',
      'select-symmetry',
      'select-keep-half',
      'btn-symmetrize',
      'chk-live-symmetry',
      'chk-grid',
      'panel-properties',
      'panel-validation',
      'status-bar',
      'status-dirty',
    ];
    for (const id of always) expect(has(id), id).toBe(true);

    await run(() => store.select([{ type: 'start', index: 0 }]));
    for (const id of ['start-army', 'marker-x', 'marker-z']) expect(has(id), id).toBe(true);

    await run(() => store.addField({ kind: 'circle', x: 200 * WU, z: 200 * WU, r: 20 * WU }));
    const fieldIds = [
      'field-name',
      'field-kind',
      'field-ids',
      'field-density',
      'field-seed',
      'btn-field-reseed',
      'field-scale-min',
      'field-scale-max',
      'field-max-slope',
      'field-dry-only',
      'field-reclaim-mass',
      'field-reclaim-energy',
      'field-count',
    ];
    for (const id of fieldIds) expect(has(id), id).toBe(true);
  });

  it('lists the bundled maps and opens the chosen one', async () => {
    const sel = q<HTMLSelectElement>('select-map');
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'braidwater', 'hollow-ridge', 'setons', 'tessera']);
    expect(sel.value).toBe('hollow-ridge');
    await choose('select-map', 'setons');
    expect(io.calls).toContain('openBundled:setons');
    await click('btn-open');
    await click('btn-save');
    await click('btn-export-markers');
    await click('btn-fit');
    expect(io.calls).toEqual(['openBundled:setons', 'openFile', 'save', 'exportMarkersJson', 'fitView']);
  });

  it('switches tools and highlights the active one', async () => {
    await click('tool-mass');
    expect(store.tool.value).toBe('mass');
    expect(q('tool-mass').classList.contains('me-active')).toBe(true);
    expect(q('tool-select').getAttribute('aria-pressed')).toBe('false');
    await run(() => (store.tool.value = 'fieldPolygon'));
    expect(q('tool-field-polygon').classList.contains('me-active')).toBe(true);
    expect(q('tool-mass').classList.contains('me-active')).toBe(false);
  });

  it('moves a start through x/z as one undo step and rejects invalid input', async () => {
    const before = store.doc.value!.starts[0]!;
    await run(() => store.select([{ type: 'start', index: 0 }]));
    expect(q<HTMLInputElement>('marker-x').value).toBe(String(before.x / WU));
    const depth = store.undoDepth.value;

    await typeAndEnter('marker-x', '100');
    let s = store.doc.value!.starts[0]!;
    expect(s.x).toBe(100 * WU);
    expect(s.z).toBe(before.z);
    expect(store.undoDepth.value).toBe(depth + 1);
    expect(q<HTMLInputElement>('marker-x').value).toBe('100');
    expect(q('status-dirty').dataset['dirty']).toBe('true');

    await typeAndEnter('marker-z', '120,5');
    s = store.doc.value!.starts[0]!;
    expect(s.z).toBe(120.5 * WU);
    expect(store.undoDepth.value).toBe(depth + 2);

    await typeAndEnter('marker-x', 'abc');
    expect(q('marker-x').classList.contains('me-invalid')).toBe(true);
    expect(q('marker-x').getAttribute('aria-invalid')).toBe('true');
    await typeAndEnter('marker-x', '99999');
    expect(q('marker-x').classList.contains('me-invalid')).toBe(true);
    expect(store.doc.value!.starts[0]!.x).toBe(100 * WU);
    expect(store.undoDepth.value).toBe(depth + 2);

    // Esc discards the draft.
    await act(() => {
      q('marker-x').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q<HTMLInputElement>('marker-x').value).toBe('100');
    expect(q('marker-x').classList.contains('me-invalid')).toBe(false);

    await click('btn-undo');
    await click('btn-undo');
    expect(store.doc.value!.starts[0]).toEqual(before);
    expect(q('status-dirty').dataset['dirty']).toBe('false');
    expect(q('btn-redo').textContent).toContain('2');
  });

  it('changes the army of a start', async () => {
    const doc = store.doc.value!;
    const armies = doc.starts.map((s) => s.army);
    await run(() => store.select([{ type: 'start', index: 0 }]));
    const target = armies[1]!;
    await choose('start-army', String(target));
    const after = store.doc.value!.starts.map((s) => s.army);
    expect(after).toEqual(armies);
    expect(store.undoDepth.value).toBe(1);
    // The selection follows the start, the select shows the new army.
    expect(q<HTMLSelectElement>('start-army').value).toBe(String(target));
  });

  it('edits every prop field property with validation', async () => {
    await run(() => store.addField({ kind: 'circle', x: 256 * WU, z: 256 * WU, r: 24 * WU }));
    const index = store.doc.value!.fields.length - 1;
    const d0 = store.undoDepth.value;
    const f = () => store.doc.value!.fields[index]!;

    await typeAndEnter('field-name', 'Wald Mitte');
    await choose('field-kind', 'rock');
    await typeAndEnter('field-ids', 'core:rock_01:3, core:rock_02');
    await typeAndEnter('field-density', '128');
    await typeAndEnter('field-seed', '0xBEEF');
    await typeAndEnter('field-scale-min', '50');
    await typeAndEnter('field-scale-max', '150.5');
    await typeAndEnter('field-max-slope', '450');
    await act(() => {
      const el = q<HTMLInputElement>('field-dry-only');
      el.checked = false;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await typeAndEnter('field-reclaim-mass', '12.345');
    await typeAndEnter('field-reclaim-energy', '0,5');

    expect(f()).toMatchObject({
      name: 'Wald Mitte',
      kind: 'rock',
      entries: [
        { id: 'core:rock_01', weight: 3 },
        { id: 'core:rock_02', weight: 1 },
      ],
      densityPerKWu2: 128,
      seed: 0xbeef,
      scaleMinPermille: 500,
      scaleMaxPermille: 1505,
      maxSlopePermille: 450,
      dryOnly: false,
      reclaimMassMilli: 12345,
      reclaimEnergyMilli: 500,
    });
    // One undo step per committed value.
    expect(store.undoDepth.value).toBe(d0 + 11);
    expect(q<HTMLInputElement>('field-reclaim-mass').value).toBe('12.345');
    expect(q<HTMLInputElement>('field-scale-max').value).toBe('150.5');

    // Re-committing the same value is no step.
    await typeAndEnter('field-density', '128');
    expect(store.undoDepth.value).toBe(d0 + 11);

    // Invalid values stay red and are not taken over.
    const cases: [string, string][] = [
      ['field-ids', 'core:rock_01:0'],
      ['field-ids', 'Rock'],
      ['field-density', '0'],
      ['field-density', '5000'],
      ['field-seed', '-3'],
      ['field-scale-min', '160'],
      ['field-scale-max', '40'],
      ['field-max-slope', '1.5'],
      ['field-reclaim-mass', '1.0001'],
      ['field-name', ''],
    ];
    const snapshot = f();
    for (const [id, text] of cases) {
      await typeAndEnter(id, text);
      expect(q(id).classList.contains('me-invalid'), `${id} = ${text}`).toBe(true);
    }
    expect(f()).toBe(snapshot);
    expect(store.undoDepth.value).toBe(d0 + 11);

    // Expanded count and reclaim sum match the store's expansion.
    const expanded = store.expandedProps().filter((p) => p.field === index);
    expect(q('field-count').textContent!.replace(/\s/g, '')).toBe(String(expanded.length));
    const massMilli = expanded.length * 12345;
    expect(q('field-reclaim-total').textContent).toContain(`${Math.floor(massMilli / 1000)}.${String(massMilli % 1000).padStart(3, '0')} M`);

    // Reseed: new deterministic seed, one step.
    await click('btn-field-reseed');
    expect(f().seed).not.toBe(0xbeef);
    expect(store.undoDepth.value).toBe(d0 + 12);
    expect(q<HTMLInputElement>('field-seed').value).toBe(String(f().seed));
  });

  it('edits circle radius/centre and polygon vertices', async () => {
    await run(() => store.addField({ kind: 'circle', x: 256 * WU, z: 256 * WU, r: 24 * WU }));
    const i = store.doc.value!.fields.length - 1;
    await typeAndEnter('field-radius', '30');
    expect(store.doc.value!.fields[i]!.shape).toEqual({ kind: 'circle', x: 256 * WU, z: 256 * WU, r: 30 * WU });
    await typeAndEnter('marker-x', '250');
    expect(store.doc.value!.fields[i]!.shape).toEqual({ kind: 'circle', x: 250 * WU, z: 256 * WU, r: 30 * WU });
    await typeAndEnter('field-radius', '0.5');
    expect(q('field-radius').classList.contains('me-invalid')).toBe(true);

    const pts = [
      { x: 100 * WU, z: 100 * WU },
      { x: 140 * WU, z: 100 * WU },
      { x: 120 * WU, z: 140 * WU },
    ];
    await run(() => store.addField({ kind: 'polygon', points: pts }));
    const j = store.doc.value!.fields.length - 1;
    await run(() => store.select([{ type: 'fieldVertex', index: j, vertex: 2 }]));
    expect(q<HTMLInputElement>('marker-z').value).toBe('140');
    await typeAndEnter('marker-z', '150');
    const sh = store.doc.value!.fields[j]!.shape;
    expect(sh.kind === 'polygon' ? sh.points[2] : null).toEqual({ x: 120 * WU, z: 150 * WU });
  });

  it('summarizes a multi-selection', async () => {
    await run(() =>
      store.select([
        { type: 'start', index: 0 },
        { type: 'start', index: 1 },
        { type: 'spot', index: 0 },
      ]),
    );
    const summary = q('selection-summary');
    expect(summary.textContent).toContain('3 Objekte ausgewählt');
    expect(summary.textContent).toContain('2 Startpositionen');
    expect(has('marker-x')).toBe(false);
  });

  it('lists issues and selects/focuses on click', async () => {
    const errorsBefore = store.issues.value.filter((i) => i.severity === 'error').length;
    expect(errorsBefore).toBe(0);
    expect(q('issue-count-error').dataset['count']).toBe('0');
    // A mass spot in the map corner (edge rule).
    await run(() => store.addSpot('mass', 0, 0));
    const rows = [...root.querySelectorAll<HTMLElement>('[data-testid="issue-row"]')];
    const edge = rows.find((r) => r.dataset['code'] === 'spot-edge');
    expect(edge).toBeDefined();
    expect(['error', 'warning', 'info']).toContain(edge!.dataset['severity']);
    const spotIndex = store.doc.value!.spots.length - 1;
    await run(() => store.select([]));
    await act(() => {
      edge!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(store.selection.value).toEqual([{ type: 'spot', index: spotIndex }]);
    expect(io.focused.length).toBe(1);
    // Rows are sorted by severity.
    const sev = [...root.querySelectorAll<HTMLElement>('[data-testid="issue-row"]')].map((r) => r.dataset['severity']);
    const rank = (s: string | undefined): number => ['error', 'warning', 'info'].indexOf(s ?? '');
    for (let k = 1; k < sev.length; k++) expect(rank(sev[k])).toBeGreaterThanOrEqual(rank(sev[k - 1]));
    // Undo removes the issue again.
    await click('btn-undo');
    expect(root.querySelector('[data-testid="issue-row"][data-code="spot-edge"]')).toBeNull();
  });

  it('drives symmetry, live symmetry, grid and snap', async () => {
    await choose('select-symmetry', 'mirrorX');
    expect(store.symmetry.value).toBe('mirrorX');
    expect(q<HTMLSelectElement>('select-keep-half').disabled).toBe(false);
    await choose('select-keep-half', 'b');
    await act(() => {
      const el = q<HTMLInputElement>('chk-live-symmetry');
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(store.liveSymmetry.value).toBe(true);
    await act(() => {
      const el = q<HTMLInputElement>('chk-grid');
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(io.gridVisible.value).toBe(true);
    await choose('select-snap', '4096');
    expect(store.snapRaw.value).toBe(4096);

    const depth = store.undoDepth.value;
    await click('btn-symmetrize');
    // hollow-ridge is point- but not mirrorX-symmetric: one step (or the "already symmetric" status).
    expect(store.undoDepth.value === depth + 1 || store.status.value === 'Karte ist bereits symmetrisch').toBe(true);
    await choose('select-symmetry', 'none');
    expect(q<HTMLButtonElement>('btn-symmetrize').disabled).toBe(true);
  });

  it('shows cursor, counts, status and dirty state in the status bar', async () => {
    await run(() => (io.cursorIn.value = { x: 12.345, z: 400 }));
    expect(q('status-cursor').textContent).toBe('x 12.3 · z 400.0');
    const doc = store.doc.value!;
    expect(q('status-size').textContent).toBe(`Größe ${doc.sizeWu}×${doc.sizeWu} WU`);
    expect(q('status-counts').textContent).toContain(`Starts ${doc.starts.length}`);
    await run(() => (store.status.value = 'Hallo'));
    expect(q('status-message').textContent).toBe('Hallo');
    expect(q('status-dirty').dataset['dirty']).toBe('false');
    await run(() => store.addSpot('hydro', 300 * WU, 300 * WU));
    expect(q('status-dirty').dataset['dirty']).toBe('true');
    expect(q('file-name').textContent).toBe('hollow-ridge.rtsmap*');
  });

  it('toggles the help overlay with ? and closes it with Esc', async () => {
    expect(has('help-overlay')).toBe(false);
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    expect(has('help-overlay')).toBe(true);
    expect(q('help-overlay').textContent).toContain('Strg/⌘ + Z');
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(has('help-overlay')).toBe(false);
    await click('btn-help');
    expect(has('help-overlay')).toBe(true);
    await click('btn-help-close');
    expect(has('help-overlay')).toBe(false);
  });

  it('unmounts cleanly', async () => {
    unmount();
    expect(root.childElementCount).toBe(0);
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    expect(root.childElementCount).toBe(0);
    unmount();
  });
});
