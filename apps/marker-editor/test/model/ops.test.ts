import { FormatError, readRtsMap } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '../../src/model/document.ts';
import { History } from '../../src/model/history.ts';
import { applyOp, EditorOpError, type EditorOp } from '../../src/model/ops.ts';
import { bytesEqual, circle, field, openDoc, rect, WU } from './support.ts';

/** Applies op, checks inverse restores the bytes exactly, and that redo (re-apply) gives the same bytes. */
function checkRoundtrip(doc: EditorDocument, op: EditorOp): EditorDocument {
  const before = doc.toBytes();
  const h = new History();
  const after = h.apply(doc, op);
  const afterBytes = after.toBytes();
  expect(bytesEqual(afterBytes, before)).toBe(false);
  const undone = h.undo(after);
  expect(bytesEqual(undone.toBytes(), before)).toBe(true);
  const redone = h.redo(undone);
  expect(bytesEqual(redone.toBytes(), afterBytes)).toBe(true);
  return after;
}

/** hollow-ridge plus a circle field (0) and a rectangle field (1). */
function withFields(): EditorDocument {
  return applyOp(openDoc('hollow-ridge'), {
    kind: 'batch',
    ops: [
      { kind: 'addField', field: field(circle(250, 250, 12)) },
      { kind: 'addField', field: field(rect(200, 300, 240, 330), { name: 'rocks', kind: 'rock', entries: [{ id: 'core:rock_01', weight: 3 }, { id: 'core:rock_02', weight: 1 }] }) },
    ],
  }).doc;
}

describe('operations: apply + undo + redo', () => {
  it('addStart inserts at the sorted army position', () => {
    const d = checkRoundtrip(openDoc('hollow-ridge'), { kind: 'addStart', start: { army: 5, x: 100 * WU, z: 400 * WU } });
    expect(d.starts.map((s) => s.army)).toEqual([0, 1, 5]);
    const d2 = checkRoundtrip(applyOp(openDoc('hollow-ridge'), { kind: 'setStartArmy', index: 0, army: 3 }).doc, {
      kind: 'addStart',
      start: { army: 2, x: 10 * WU, z: 10 * WU },
    });
    expect(d2.starts.map((s) => s.army)).toEqual([1, 2, 3]);
  });

  it('addSpot appends (or inserts at index)', () => {
    const doc = openDoc('hollow-ridge');
    const d = checkRoundtrip(doc, { kind: 'addSpot', spot: { kind: 'hydro', x: 300 * WU, z: 200 * WU } });
    expect(d.spots[d.spots.length - 1]).toEqual({ kind: 'hydro', x: 300 * WU, z: 200 * WU });
    const d2 = checkRoundtrip(doc, { kind: 'addSpot', spot: { kind: 'mass', x: 1, z: 2 }, index: 3 });
    expect(d2.spots[3]).toEqual({ kind: 'mass', x: 1, z: 2 });
    expect(d2.spots[4]).toEqual(doc.spots[3]);
  });

  it('addField appends and creates PFLD', () => {
    const d = checkRoundtrip(openDoc('hollow-ridge'), { kind: 'addField', field: field(circle(250, 250, 12)) });
    expect(readRtsMap(d.toBytes()).propFields).toHaveLength(1);
  });

  it('moveMarkers moves starts, spots, whole fields and vertices (index kept)', () => {
    const doc = withFields();
    const d = checkRoundtrip(doc, {
      kind: 'moveMarkers',
      refs: [
        { type: 'start', index: 1 },
        { type: 'spot', index: 2 },
        { type: 'field', index: 0 },
        { type: 'fieldVertex', index: 1, vertex: 2 },
      ],
      dx: -3 * WU,
      dz: 2048,
    });
    expect(d.starts[1]).toEqual({ army: 1, x: doc.starts[1]!.x - 3 * WU, z: doc.starts[1]!.z + 2048 });
    expect(d.spots[2]!.x).toBe(doc.spots[2]!.x - 3 * WU);
    expect(d.fields[0]!.shape).toEqual({ kind: 'circle', x: 247 * WU, z: 250 * WU + 2048, r: 12 * WU });
    const p = d.fields[1]!.shape.kind === 'polygon' ? d.fields[1]!.shape.points : [];
    expect(p[2]).toEqual({ x: 237 * WU, z: 330 * WU + 2048 });
    expect(p[0]).toEqual({ x: 200 * WU, z: 300 * WU });
  });

  it('moveMarkers of a field and its own vertex moves the field once; radius handle counts as field', () => {
    const doc = withFields();
    const d = applyOp(doc, {
      kind: 'moveMarkers',
      refs: [{ type: 'field', index: 1 }, { type: 'fieldVertex', index: 1, vertex: 0 }, { type: 'fieldRadius', index: 0 }],
      dx: WU,
      dz: 0,
    }).doc;
    const p = d.fields[1]!.shape.kind === 'polygon' ? d.fields[1]!.shape.points : [];
    expect(p[0]).toEqual({ x: 201 * WU, z: 300 * WU });
    expect(d.fields[0]!.shape).toMatchObject({ x: 251 * WU });
  });

  it('moveFieldVertex / insertFieldVertex / deleteFieldVertex', () => {
    const doc = withFields();
    const a = checkRoundtrip(doc, { kind: 'moveFieldVertex', field: 1, vertex: 1, x: 250 * WU, z: 295 * WU });
    expect(a.positionOf({ type: 'fieldVertex', index: 1, vertex: 1 })).toEqual({ x: 250 * WU, z: 295 * WU });
    expect(a.positionOf({ type: 'fieldVertex', index: 1, vertex: 0 })).toEqual({ x: 200 * WU, z: 300 * WU });
    const b = checkRoundtrip(doc, { kind: 'insertFieldVertex', field: 1, after: 1, x: 250 * WU, z: 315 * WU });
    expect(b.fields[1]!.shape.kind === 'polygon' && b.fields[1]!.shape.points.length).toBe(5);
    expect(b.positionOf({ type: 'fieldVertex', index: 1, vertex: 2 })).toEqual({ x: 250 * WU, z: 315 * WU });
    const c = checkRoundtrip(doc, { kind: 'insertFieldVertex', field: 1, after: -1, x: 195 * WU, z: 315 * WU });
    expect(c.positionOf({ type: 'fieldVertex', index: 1, vertex: 0 })).toEqual({ x: 195 * WU, z: 315 * WU });
    const d = checkRoundtrip(b, { kind: 'deleteFieldVertex', field: 1, vertex: 0 });
    expect(d.fields[1]!.shape.kind === 'polygon' && d.fields[1]!.shape.points.length).toBe(4);
    checkRoundtrip(b, { kind: 'deleteFieldVertex', field: 1, vertex: 4 });
  });

  it('setFieldRadius / updateField / setStartArmy', () => {
    const doc = withFields();
    const a = checkRoundtrip(doc, { kind: 'setFieldRadius', field: 0, r: 20 * WU });
    expect(a.fields[0]!.shape).toMatchObject({ r: 20 * WU });
    const b = checkRoundtrip(doc, {
      kind: 'updateField',
      index: 1,
      patch: { name: 'boulders', densityPerKWu2: 16, seed: 0xffffffff, dryOnly: false, entries: [{ id: 'core:rock_02', weight: 7 }] },
    });
    expect(b.fields[1]).toMatchObject({ name: 'boulders', densityPerKWu2: 16, seed: 0xffffffff, dryOnly: false, kind: 'rock' });
    expect(b.fields[1]!.entries).toEqual([{ id: 'core:rock_02', weight: 7 }]);
    // Swap: army 0 -> 1 swaps the two starts' armies (list re-sorted).
    const c = checkRoundtrip(doc, { kind: 'setStartArmy', index: 0, army: 1 });
    expect(c.starts).toEqual([
      { army: 0, x: doc.starts[1]!.x, z: doc.starts[1]!.z },
      { army: 1, x: doc.starts[0]!.x, z: doc.starts[0]!.z },
    ]);
    const e = checkRoundtrip(doc, { kind: 'setStartArmy', index: 0, army: 9 });
    expect(e.starts.map((s) => s.army)).toEqual([1, 9]);
    // Same army = no-op.
    const h = new History();
    expect(h.apply(doc, { kind: 'setStartArmy', index: 0, army: 0 })).toBe(doc);
    expect(h.undoDepth).toBe(0);
  });

  it('deleteMarkers removes several kinds at once and restores exact order on undo', () => {
    const doc = withFields();
    const d = checkRoundtrip(doc, {
      kind: 'deleteMarkers',
      refs: [
        { type: 'spot', index: 7 },
        { type: 'spot', index: 0 },
        { type: 'spot', index: 3 },
        { type: 'start', index: 0 },
        { type: 'fieldVertex', index: 0, vertex: 0 },
        { type: 'spot', index: 3 },
      ],
    });
    expect(d.spots.length).toBe(doc.spots.length - 3);
    expect(d.starts.map((s) => s.army)).toEqual([1]);
    expect(d.fields.length).toBe(1);
    expect(d.fields[0]!.name).toBe('rocks');
  });

  it('batch applies in order and inverts in reverse order', () => {
    const doc = withFields();
    const d = checkRoundtrip(doc, {
      kind: 'batch',
      ops: [
        { kind: 'addSpot', spot: { kind: 'mass', x: WU, z: WU } },
        { kind: 'moveMarkers', refs: [{ type: 'spot', index: doc.spots.length }], dx: WU, dz: WU },
        { kind: 'deleteMarkers', refs: [{ type: 'spot', index: 0 }] },
        { kind: 'addStart', start: { army: 2, x: 5 * WU, z: 5 * WU } },
        { kind: 'setStartArmy', index: 2, army: 0 },
      ],
    });
    expect(d.spots[d.spots.length - 1]).toEqual({ kind: 'mass', x: 2 * WU, z: 2 * WU });
    expect(d.starts[0]).toEqual({ army: 0, x: 5 * WU, z: 5 * WU });
  });
});

describe('operations: invariants', () => {
  const doc = withFields();
  const max = doc.maxRaw;
  const bad: [string, EditorOp][] = [
    ['start outside', { kind: 'addStart', start: { army: 3, x: max + 1, z: 0 } }],
    ['non-integer coordinate', { kind: 'addSpot', spot: { kind: 'mass', x: 0.5, z: 0 } }],
    ['duplicate army', { kind: 'addStart', start: { army: 1, x: 0, z: 0 } }],
    ['army 16', { kind: 'addStart', start: { army: 16, x: 0, z: 0 } }],
    ['move outside', { kind: 'moveMarkers', refs: [{ type: 'start', index: 0 }], dx: -max, dz: 0 }],
    ['delete all starts', { kind: 'deleteMarkers', refs: [{ type: 'start', index: 0 }, { type: 'start', index: 1 }] }],
    ['polygon below 3 vertices', { kind: 'batch', ops: [{ kind: 'deleteFieldVertex', field: 1, vertex: 0 }, { kind: 'deleteFieldVertex', field: 1, vertex: 0 }] }],
    ['vertex on a circle', { kind: 'moveFieldVertex', field: 0, vertex: 0, x: 0, z: 0 }],
    ['radius on a polygon', { kind: 'setFieldRadius', field: 1, r: WU }],
    ['bad index', { kind: 'moveMarkers', refs: [{ type: 'spot', index: 999 }], dx: 1, dz: 0 }],
    ['patch shape', { kind: 'updateField', index: 0, patch: { shape: circle(1, 1, 1) } as never }],
  ];
  for (const [what, op] of bad) {
    it(`rejects: ${what}`, () => {
      expect(() => applyOp(doc, op)).toThrow(EditorOpError);
    });
  }
  const badFields: [string, EditorOp][] = [
    ['self-intersecting polygon', { kind: 'moveFieldVertex', field: 1, vertex: 0, x: 250 * WU, z: 320 * WU }],
    ['radius below 1 WU', { kind: 'setFieldRadius', field: 0, r: 100 }],
    ['density 0', { kind: 'updateField', index: 0, patch: { densityPerKWu2: 0 } }],
    ['bad entry id', { kind: 'updateField', index: 0, patch: { entries: [{ id: 'Tree', weight: 1 }] } }],
    ['scale min > max', { kind: 'updateField', index: 0, patch: { scaleMinPermille: 2000 } }],
  ];
  for (const [what, op] of badFields) {
    it(`rejects field: ${what} (FormatError, document unchanged)`, () => {
      const before = doc.toBytes();
      expect(() => applyOp(doc, op)).toThrow(FormatError);
      expect(bytesEqual(doc.toBytes(), before)).toBe(true);
    });
  }
});
