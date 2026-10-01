/** Pure selection/issue helpers of the panels (src/ui/selection.ts, ValidationPanel helpers). */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EditorStore } from '../../src/app/store.ts';
import type { EditorIssue } from '../../src/model/types.ts';
import { countIssues, sortIssues } from '../../src/ui/components/ValidationPanel.tsx';
import { mapNameOf } from '../../src/ui/components/TopBar.tsx';
import { formatCursor } from '../../src/ui/components/StatusBar.tsx';
import { fieldStats, panelFocus, refsIntersect } from '../../src/ui/selection.ts';

const WU = 4096;
const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content/maps');

function storeWithFields(): EditorStore {
  const store = new EditorStore();
  store.open(new Uint8Array(readFileSync(resolve(MAPS_DIR, 'hollow-ridge.rtsmap'))), 'hollow-ridge.rtsmap');
  store.addField({ kind: 'circle', x: 200 * WU, z: 200 * WU, r: 20 * WU });
  store.addField({
    kind: 'polygon',
    points: [
      { x: 100 * WU, z: 100 * WU },
      { x: 140 * WU, z: 100 * WU },
      { x: 120 * WU, z: 140 * WU },
    ],
  });
  store.updateField(1, { reclaimMassMilli: 7, reclaimEnergyMilli: 11 });
  return store;
}

describe('panelFocus', () => {
  const store = storeWithFields();
  const doc = store.doc.value!;

  it('maps selections to the edited object', () => {
    expect(panelFocus(null, [{ type: 'start', index: 0 }])).toEqual({ kind: 'none' });
    expect(panelFocus(doc, [])).toEqual({ kind: 'none' });
    expect(panelFocus(doc, [{ type: 'start', index: 99 }])).toEqual({ kind: 'none' });
    expect(panelFocus(doc, [{ type: 'start', index: 1 }])).toEqual({ kind: 'start', index: 1 });
    expect(panelFocus(doc, [{ type: 'spot', index: 2 }])).toEqual({ kind: 'spot', index: 2 });
    expect(panelFocus(doc, [{ type: 'field', index: 0 }])).toEqual({ kind: 'field', index: 0, vertex: null });
    expect(panelFocus(doc, [{ type: 'fieldRadius', index: 0 }])).toEqual({ kind: 'field', index: 0, vertex: null });
    expect(panelFocus(doc, [{ type: 'fieldVertex', index: 1, vertex: 2 }])).toEqual({ kind: 'field', index: 1, vertex: 2 });
    expect(
      panelFocus(doc, [
        { type: 'field', index: 1 },
        { type: 'fieldVertex', index: 1, vertex: 2 },
      ]),
    ).toEqual({ kind: 'field', index: 1, vertex: null });
  });

  it('summarizes multi-selections', () => {
    const massIndex = doc.spots.findIndex((s) => s.kind === 'mass');
    const hydroIndex = doc.spots.findIndex((s) => s.kind === 'hydro');
    const refs = [
      { type: 'start', index: 0 },
      { type: 'start', index: 0 },
      { type: 'spot', index: massIndex },
      ...(hydroIndex >= 0 ? [{ type: 'spot', index: hydroIndex } as const] : []),
      { type: 'field', index: 1 },
      { type: 'fieldVertex', index: 1, vertex: 0 },
      { type: 'fieldVertex', index: 0, vertex: 0 },
    ] as const;
    const f = panelFocus(doc, refs);
    expect(f.kind).toBe('multi');
    if (f.kind !== 'multi') return;
    expect(f.summary).toMatchObject({ starts: 1, mass: 1, hydro: hydroIndex >= 0 ? 1 : 0, fields: 1, fieldIndices: [1] });
    // fieldVertex of field 0 does not exist (circle) and is ignored; the vertex of field 1 is part of the field.
    expect(f.summary.vertices).toBe(0);
    expect(f.summary.objects).toBe(3 + (hydroIndex >= 0 ? 1 : 0));
  });

  it('counts expanded props and reclaim per field', () => {
    const all = store.expandedProps();
    const s1 = fieldStats(all, [1]);
    const n1 = all.filter((p) => p.field === 1).length;
    expect(n1).toBeGreaterThan(0);
    expect(s1).toEqual({ count: n1, massMilli: n1 * 7, energyMilli: n1 * 11 });
    const both = fieldStats(all, [0, 1]);
    expect(both.count).toBe(all.filter((p) => p.field <= 1).length);
    expect(fieldStats(all, [])).toEqual({ count: 0, massMilli: 0, energyMilli: 0 });
  });

  it('intersects refs per object', () => {
    expect(refsIntersect([{ type: 'fieldVertex', index: 1, vertex: 2 }], [{ type: 'field', index: 1 }])).toBe(true);
    expect(refsIntersect([{ type: 'spot', index: 1 }], [{ type: 'start', index: 1 }])).toBe(false);
    expect(refsIntersect([], [{ type: 'start', index: 1 }])).toBe(false);
  });
});

describe('issue helpers', () => {
  const issue = (severity: EditorIssue['severity'], code: string): EditorIssue => ({ severity, code, message: code, x: null, z: null, refs: [] });

  it('sorts by severity, stable within a severity, and counts', () => {
    const list = [issue('info', 'a'), issue('error', 'b'), issue('warning', 'c'), issue('error', 'd'), issue('info', 'e')];
    expect(sortIssues(list).map((i) => i.code)).toEqual(['b', 'd', 'c', 'a', 'e']);
    expect(countIssues(list)).toEqual({ error: 2, warning: 1, info: 2 });
    expect(countIssues([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe('small formatters', () => {
  it('derives the map name of a file name', () => {
    expect(mapNameOf('hollow-ridge.rtsmap')).toBe('hollow-ridge');
    expect(mapNameOf('C:\\maps\\Setons.RTSMAP')).toBe('Setons');
    expect(mapNameOf('/x/y/tessera')).toBe('tessera');
    expect(mapNameOf(null)).toBe('');
  });

  it('formats the cursor', () => {
    expect(formatCursor(null)).toBe('–');
    expect(formatCursor({ x: 0, z: 511.96 })).toBe('x 0.0 · z 512.0');
  });
});
