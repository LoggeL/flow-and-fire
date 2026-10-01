/** view-markers adapter: identities stay stable so MarkerOverlay.update rebuilds only what changed. */
import { describe, expect, it } from 'vitest';
import { MAP_FX_ONE as FX } from '@faf/formats';
import { EditorStore } from '../../src/app/store.ts';
import { createViewMarkersAdapter, sameIssues, type ViewMarkersInput } from '../../src/app/view-markers.ts';
import type { EditorIssue } from '../../src/model/types.ts';
import { createValidator } from '../../src/validate/index.ts';
import { mapBytes } from './support.ts';

function input(store: EditorStore, expandCalls: { n: number }): ViewMarkersInput {
  return {
    doc: store.doc.value,
    selection: store.selection.value,
    hover: store.hover.value,
    issues: store.issues.value,
    symmetry: store.symmetry.value,
    draft: null,
    expand: () => {
      expandCalls.n++;
      return store.expandedProps();
    },
  };
}

describe('createViewMarkersAdapter', () => {
  it('returns null without a document', () => {
    const adapt = createViewMarkersAdapter();
    const store = new EditorStore();
    expect(adapt(input(store, { n: 0 }))).toBeNull();
  });

  it('maps the document and keeps array identities across unrelated changes', () => {
    const store = new EditorStore();
    store.setValidator(createValidator());
    store.open(mapBytes('hollow-ridge'), 'hollow-ridge.rtsmap');
    store.addField({ kind: 'circle', x: 260 * FX, z: 200 * FX, r: 20 * FX });
    const adapt = createViewMarkersAdapter();
    const calls = { n: 0 };
    const a = adapt(input(store, calls))!;
    const doc = store.doc.value!;
    expect(a.sizeWu).toBe(512);
    expect(a.starts).toBe(doc.starts);
    expect(a.spots).toBe(doc.spots);
    expect(a.fields).toBe(doc.fields);
    expect(a.props).toBe(doc.source.props);
    expect(a.expanded.length).toBeGreaterThan(0);
    expect(a.expanded.length).toBe(store.expandedProps().length);
    expect(calls.n).toBe(1);

    // Moving a spot: new spots array, same fields/expanded; the issues keep their identity if unchanged.
    store.select([{ type: 'spot', index: 3 }]);
    store.moveSelectionBy(FX, 0);
    const b = adapt(input(store, calls))!;
    expect(b.spots).not.toBe(a.spots);
    expect(b.starts).toBe(a.starts);
    expect(b.fields).toBe(a.fields);
    expect(b.expanded).toBe(a.expanded);
    expect(calls.n).toBe(1);

    // Selection/hover only.
    store.hover.value = { type: 'start', index: 1 };
    const c = adapt(input(store, calls))!;
    expect(c.issues).toBe(b.issues);
    expect(c.hover).toEqual({ type: 'start', index: 1 });

    // Changing a field re-expands once.
    store.updateField(0, { densityPerKWu2: 200 });
    const d = adapt(input(store, calls))!;
    expect(calls.n).toBe(2);
    expect(d.expanded).not.toBe(c.expanded);
    expect(d.expanded.length).toBeGreaterThan(c.expanded.length);

    // Undo returns to the old field list: expanded is recomputed for it.
    store.undo();
    const e = adapt(input(store, calls))!;
    expect(e.expanded.length).toBe(c.expanded.length);
  });

  it('a new map (new heights) always re-expands; no fields means no expansion call', () => {
    const store = new EditorStore();
    store.open(mapBytes('tessera'), 'tessera.rtsmap');
    const adapt = createViewMarkersAdapter();
    const calls = { n: 0 };
    const a = adapt(input(store, calls))!;
    expect(a.expanded).toEqual([]);
    expect(calls.n).toBe(0);
    store.open(mapBytes('hollow-ridge'), 'hollow-ridge.rtsmap');
    store.addField({ kind: 'circle', x: 260 * FX, z: 200 * FX, r: 10 * FX });
    const b = adapt(input(store, calls))!;
    expect(calls.n).toBe(1);
    expect(b.expanded.length).toBeGreaterThan(0);
    store.open(mapBytes('hollow-ridge'), 'hollow-ridge.rtsmap');
    const c = adapt(input(store, calls))!;
    expect(c.expanded).toEqual([]);
  });

  it('sameIssues compares content', () => {
    const i1: EditorIssue = { severity: 'error', code: 'spot-edge', message: 'm', x: 1, z: 2, refs: [{ type: 'fieldVertex', index: 0, vertex: 1 }] };
    expect(sameIssues([i1], [{ ...i1, refs: [{ type: 'fieldVertex', index: 0, vertex: 1 }] }])).toBe(true);
    expect(sameIssues([i1], [{ ...i1, refs: [{ type: 'fieldVertex', index: 0, vertex: 2 }] }])).toBe(false);
    expect(sameIssues([i1], [{ ...i1, x: 3 }])).toBe(false);
    expect(sameIssues([i1], [])).toBe(false);
    expect(sameIssues([], [])).toBe(true);
  });
});
