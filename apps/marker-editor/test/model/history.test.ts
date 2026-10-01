import { describe, expect, it } from 'vitest';
import { History, HISTORY_LIMIT } from '../../src/model/history.ts';
import { EditorOpError } from '../../src/model/ops.ts';
import { bytesEqual, mapBytes, openDoc, WU } from './support.ts';

describe('History', () => {
  it('do / undo / redo and the redo stack is dropped by a new op', () => {
    const h = new History();
    let d = openDoc('hollow-ridge');
    const orig = d.toBytes();
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: WU, z: WU } });
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'hydro', x: 2 * WU, z: WU } });
    expect(h.undoDepth).toBe(2);
    d = h.undo(d);
    expect(h.canRedo).toBe(true);
    expect(h.redoDepth).toBe(1);
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: 3 * WU, z: WU } });
    expect(h.redoDepth).toBe(0);
    expect(h.canRedo).toBe(false);
    expect(d.spots[d.spots.length - 1]).toEqual({ kind: 'mass', x: 3 * WU, z: WU });
    d = h.undo(h.undo(d));
    expect(bytesEqual(d.toBytes(), orig)).toBe(true);
    expect(h.canUndo).toBe(false);
    // Undo with nothing left is a no-op.
    expect(h.undo(d)).toBe(d);
  });

  it('a rejected op records nothing and keeps the redo stack', () => {
    const h = new History();
    let d = openDoc('hollow-ridge');
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: WU, z: WU } });
    d = h.undo(d);
    expect(() => h.apply(d, { kind: 'addStart', start: { army: 0, x: 0, z: 0 } })).toThrow(EditorOpError);
    expect(h.undoDepth).toBe(0);
    expect(h.redoDepth).toBe(1);
  });

  it('gesture coalescing: many moves = one undo step, deltas merged', () => {
    const h = new History();
    let d = openDoc('hollow-ridge');
    const orig = d.toBytes();
    const refs = [{ type: 'start', index: 0 } as const, { type: 'spot', index: 1 } as const];
    h.beginGesture();
    for (let i = 0; i < 100; i++) d = h.apply(d, { kind: 'moveMarkers', refs, dx: 1024, dz: -512 });
    d = h.apply(d, { kind: 'batch', ops: [{ kind: 'moveMarkers', refs, dx: 1, dz: 1 }] });
    d = h.apply(d, { kind: 'batch', ops: [{ kind: 'moveMarkers', refs, dx: 1, dz: 1 }] });
    h.endGesture();
    expect(h.undoDepth).toBe(1);
    const moved = d.toBytes();
    expect(d.starts[0]!.x).toBe(openDoc('hollow-ridge').starts[0]!.x + 100 * 1024 + 2);
    d = h.undo(d);
    expect(bytesEqual(d.toBytes(), orig)).toBe(true);
    d = h.redo(d);
    expect(bytesEqual(d.toBytes(), moved)).toBe(true);
    // A new op after the gesture is a new step.
    expect(h.apply(d, { kind: 'moveMarkers', refs, dx: 4096, dz: 0 }).starts[0]!.x).toBe(d.starts[0]!.x + 4096);
    expect(h.undoDepth).toBe(2);
  });

  it('gesture with vertex drags and radius changes keeps first inverse / last value', () => {
    const h = new History();
    let d = openDoc('hollow-ridge');
    d = h.apply(d, {
      kind: 'batch',
      ops: [
        { kind: 'addField', field: { name: 'c', kind: 'tree', shape: { kind: 'circle', x: 250 * WU, z: 250 * WU, r: 10 * WU }, entries: [{ id: 'core:tree_01', weight: 1 }], densityPerKWu2: 8, seed: 1, scaleMinPermille: 1000, scaleMaxPermille: 1000, maxSlopePermille: 0, dryOnly: false, reclaimMassMilli: 0, reclaimEnergyMilli: 0 } },
        { kind: 'addField', field: { name: 'p', kind: 'rock', shape: { kind: 'polygon', points: [{ x: 100 * WU, z: 300 * WU }, { x: 140 * WU, z: 300 * WU }, { x: 120 * WU, z: 340 * WU }] }, entries: [{ id: 'core:rock_01', weight: 1 }], densityPerKWu2: 8, seed: 2, scaleMinPermille: 1000, scaleMaxPermille: 1000, maxSlopePermille: 0, dryOnly: false, reclaimMassMilli: 0, reclaimEnergyMilli: 0 } },
      ],
    });
    const base = d.toBytes();
    h.beginGesture();
    for (let i = 1; i <= 20; i++) {
      d = h.apply(d, { kind: 'setFieldRadius', field: 0, r: (10 + i) * WU });
      d = h.apply(d, { kind: 'moveFieldVertex', field: 1, vertex: 2, x: (120 + i) * WU, z: 340 * WU });
    }
    h.endGesture();
    // Alternating ops cannot merge with their predecessor, but they still form ONE undo step.
    expect(h.undoDepth).toBe(2);
    const after = d.toBytes();
    d = h.undo(d);
    expect(bytesEqual(d.toBytes(), base)).toBe(true);
    d = h.redo(d);
    expect(bytesEqual(d.toBytes(), after)).toBe(true);
    // Pure radius drag merges to a single forward/inverse pair.
    h.beginGesture();
    for (let i = 0; i < 50; i++) d = h.apply(d, { kind: 'setFieldRadius', field: 0, r: (5 + i) * WU });
    h.endGesture();
    expect(h.undoDepth).toBe(3);
    d = h.undo(d);
    expect(bytesEqual(d.toBytes(), after)).toBe(true);
  });

  it('nested gestures only close on the outermost endGesture; undo inside a gesture ends it', () => {
    const h = new History();
    let d = openDoc('hollow-ridge');
    h.beginGesture();
    h.beginGesture();
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: WU, z: WU } });
    h.endGesture();
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: 2 * WU, z: WU } });
    h.endGesture();
    expect(h.undoDepth).toBe(1);
    h.beginGesture();
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: 3 * WU, z: WU } });
    d = h.undo(d);
    expect(h.inGesture).toBe(false);
    expect(h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: 4 * WU, z: WU } }).spots).toHaveLength(d.spots.length + 1);
    expect(h.undoDepth).toBe(2);
  });

  it(`history limit ${HISTORY_LIMIT}: oldest entries are dropped`, () => {
    const h = new History();
    let d = openDoc('hollow-ridge');
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) d = h.apply(d, { kind: 'moveMarkers', refs: [{ type: 'spot', index: 0 }], dx: i % 2 === 0 ? 1 : -1, dz: 0 });
    expect(h.undoDepth).toBe(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i++) d = h.undo(d);
    expect(h.canUndo).toBe(false);
    expect(h.redoDepth).toBe(HISTORY_LIMIT);
    // 20 steps (net 0 in pairs) were dropped: the state is the one after step 20 = the original.
    expect(bytesEqual(d.toBytes(), mapBytes('hollow-ridge'))).toBe(true);
    const small = new History(3);
    let e = openDoc('hollow-ridge');
    for (let i = 0; i < 5; i++) e = small.apply(e, { kind: 'addSpot', spot: { kind: 'mass', x: i * WU, z: 0 } });
    expect(small.undoDepth).toBe(3);
    for (let i = 0; i < 3; i++) e = small.undo(e);
    expect(e.spots.length).toBe(openDoc('hollow-ridge').spots.length + 2);
  });

  it('stateId identifies the state (undo back to a saved state gives the saved id)', () => {
    const h = new History();
    let d = openDoc('hollow-ridge');
    expect(h.stateId).toBe(0);
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: WU, z: WU } });
    const saved = h.stateId;
    d = h.apply(d, { kind: 'addSpot', spot: { kind: 'mass', x: 2 * WU, z: WU } });
    expect(h.stateId).not.toBe(saved);
    d = h.undo(d);
    expect(h.stateId).toBe(saved);
    d = h.undo(d);
    expect(h.stateId).toBe(0);
    h.redo(d);
    expect(h.stateId).toBe(saved);
  });
});
