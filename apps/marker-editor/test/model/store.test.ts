import { effect } from '@preact/signals';
import { expandPropFields, FormatError, readRtsMap } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import { defaultField, EditorStore, FIELD_KIND_DEFAULTS } from '../../src/app/store.ts';
import { isSymmetric, MIRROR_SEED_XOR } from '../../src/model/symmetry.ts';
import type { EditorIssue, Validator } from '../../src/model/types.ts';
import { bytesEqual, mapBytes, pointsOf, WU } from './support.ts';

function open(name: 'hollow-ridge' | 'setons' = 'hollow-ridge'): EditorStore {
  const s = new EditorStore();
  s.open(mapBytes(name), `${name}.rtsmap`);
  return s;
}

const MAX = 512 * WU;

describe('EditorStore basics', () => {
  it('open: signals, defaults, byte-identical export', () => {
    const s = new EditorStore();
    expect(s.doc.value).toBeNull();
    expect(s.expandedProps()).toEqual([]);
    expect(() => s.exportBytes()).toThrow();
    s.open(mapBytes('hollow-ridge'), 'hollow-ridge.rtsmap');
    expect(s.fileName.value).toBe('hollow-ridge.rtsmap');
    expect(s.revision.value).toBe(1);
    expect(s.dirty.value).toBe(false);
    expect(s.canUndo.value).toBe(false);
    expect(s.canRedo.value).toBe(false);
    expect(s.tool.value).toBe('select');
    expect(s.snapRaw.value).toBe(2048);
    expect(s.symmetry.value).toBe('none');
    expect(s.liveSymmetry.value).toBe(false);
    expect(s.selection.value).toEqual([]);
    expect(bytesEqual(s.exportBytes(), mapBytes('hollow-ridge'))).toBe(true);
    expect(s.exportMarkersJson()).toContain('"name": "Hollow Ridge"');
  });

  it('open of a broken file throws FormatError and leaves the store unchanged', () => {
    const s = open();
    s.addSpot('mass', 10 * WU, 10 * WU);
    const rev = s.revision.value;
    const bad = mapBytes('tessera').slice(0, 100);
    expect(() => s.open(bad, 'bad.rtsmap')).toThrow(FormatError);
    expect(s.revision.value).toBe(rev);
    expect(s.fileName.value).toBe('hollow-ridge.rtsmap');
    expect(s.canUndo.value).toBe(true);
  });

  it('open clears history, selection and hover', () => {
    const s = open();
    s.addSpot('mass', 10 * WU, 10 * WU);
    s.hover.value = { type: 'spot', index: 0 };
    s.open(mapBytes('setons'), 'setons.rtsmap');
    expect(s.canUndo.value).toBe(false);
    expect(s.selection.value).toEqual([]);
    expect(s.hover.value).toBeNull();
    expect(s.doc.value!.name).toBe('Setons');
  });

  it('snaps to snapRaw and clamps to the map', () => {
    const s = open();
    s.addSpot('mass', 100.3 * WU, 200.2 * WU);
    expect(s.doc.value!.spots.at(-1)).toEqual({ kind: 'mass', x: 100.5 * WU, z: 200 * WU });
    s.addSpot('hydro', -5000, MAX + 99999);
    expect(s.doc.value!.spots.at(-1)).toEqual({ kind: 'hydro', x: 0, z: MAX });
    s.snapRaw.value = 0;
    s.addSpot('mass', 1234.6, 77.2);
    expect(s.doc.value!.spots.at(-1)).toEqual({ kind: 'mass', x: 1235, z: 77 });
    expect(s.selection.value).toEqual([{ type: 'spot', index: s.doc.value!.spots.length - 1 }]);
  });

  it('addStart takes the smallest free army and selects it; 16 starts max', () => {
    const s = open();
    s.addStart(200 * WU, 200 * WU);
    expect(s.doc.value!.starts.map((x) => x.army)).toEqual([0, 1, 2]);
    expect(s.selection.value).toEqual([{ type: 'start', index: 2 }]);
    for (let i = 0; i < 13; i++) s.addStart((10 + i * 20) * WU, 300 * WU);
    expect(s.doc.value!.starts).toHaveLength(16);
    const rev = s.revision.value;
    s.addStart(5 * WU, 5 * WU);
    expect(s.revision.value).toBe(rev);
    expect(s.status.value).toMatch(/16/);
  });

  it('dirty follows the history state (undo back to the saved state is clean)', () => {
    const s = open();
    s.addSpot('mass', 10 * WU, 10 * WU);
    expect(s.dirty.value).toBe(true);
    s.markSaved();
    expect(s.dirty.value).toBe(false);
    s.addSpot('mass', 20 * WU, 10 * WU);
    expect(s.dirty.value).toBe(true);
    s.undo();
    expect(s.dirty.value).toBe(false);
    s.undo();
    expect(s.dirty.value).toBe(true);
    s.redo();
    expect(s.dirty.value).toBe(false);
  });

  it('revision increments per change; validator runs synchronously per revision', () => {
    const s = open();
    const calls: number[] = [];
    const v: Validator = (map) => {
      calls.push(map.meta.spots.length);
      return [{ severity: 'warning', code: 'count', message: `${map.meta.spots.length}`, x: null, z: null, refs: [] }];
    };
    s.setValidator(v);
    expect(calls).toHaveLength(1);
    expect(s.issues.value[0]!.message).toBe('18');
    const seen: (readonly EditorIssue[])[] = [];
    const dispose = effect(() => {
      seen.push(s.issues.value);
    });
    const r0 = s.revision.value;
    s.addSpot('mass', 10 * WU, 10 * WU);
    expect(s.revision.value).toBe(r0 + 1);
    expect(s.issues.value[0]!.message).toBe('19');
    s.undo();
    expect(s.revision.value).toBe(r0 + 2);
    expect(s.issues.value[0]!.message).toBe('18');
    expect(calls).toEqual([18, 19, 18]);
    expect(seen.length).toBe(3);
    dispose();
    s.setValidator(() => {
      throw new Error('boom');
    });
    expect(s.issues.value[0]!.code).toBe('validator-failed');
    s.setValidator(null);
    expect(s.issues.value).toEqual([]);
  });

  it('a rejected command changes nothing and reports in status', () => {
    const s = open();
    s.addField({ kind: 'polygon', points: [{ x: 100 * WU, z: 100 * WU }, { x: 140 * WU, z: 140 * WU }, { x: 140 * WU, z: 100 * WU }, { x: 100 * WU, z: 140 * WU }] });
    expect(s.doc.value!.fields).toHaveLength(0);
    expect(s.canUndo.value).toBe(false);
    expect(s.status.value).toMatch(/^Nicht möglich/);
    s.addField({ kind: 'polygon', points: [{ x: 0, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 0 }] });
    expect(s.status.value).toMatch(/3/);
  });
});

describe('EditorStore fields', () => {
  it('addField uses the default template (tree), rock/wreck defaults, deterministic seed', () => {
    const s = open();
    s.addField({ kind: 'circle', x: 250 * WU, z: 250 * WU, r: 10 * WU });
    const f = s.doc.value!.fields[0]!;
    expect(f).toMatchObject({
      name: 'tree 1',
      kind: 'tree',
      entries: [{ id: 'core:tree_01', weight: 1 }],
      densityPerKWu2: 64,
      scaleMinPermille: 800,
      scaleMaxPermille: 1200,
      maxSlopePermille: 600,
      dryOnly: true,
      reclaimMassMilli: 0,
      reclaimEnergyMilli: 25000,
    });
    const s2 = open();
    s2.addField({ kind: 'circle', x: 250 * WU, z: 250 * WU, r: 10 * WU });
    expect(s2.doc.value!.fields[0]!.seed).toBe(f.seed);
    s.addField({ kind: 'circle', x: 350 * WU, z: 350 * WU, r: 0.2 * WU }, { kind: 'rock', entries: [{ id: 'core:rock_02', weight: 2 }], densityPerKWu2: 8 });
    const r = s.doc.value!.fields[1]!;
    expect(r).toMatchObject({ kind: 'rock', reclaimMassMilli: 10000, reclaimEnergyMilli: 0, densityPerKWu2: 8, entries: [{ id: 'core:rock_02', weight: 2 }] });
    expect(r.shape).toMatchObject({ r: WU });
    expect(r.seed).not.toBe(f.seed);
    expect(defaultField('rock', 'x', 5).entries).toEqual([{ id: FIELD_KIND_DEFAULTS.rock.id, weight: 1 }]);
    expect(defaultField('wreck', 'x', 5)).toMatchObject({ reclaimMassMilli: 30000, reclaimEnergyMilli: 0 });
    expect(readRtsMap(s.exportBytes()).propFields).toHaveLength(2);
  });

  it('expandedProps is cached per revision', () => {
    const s = open();
    s.addField({ kind: 'circle', x: 250 * WU, z: 250 * WU, r: 30 * WU }, { dryOnly: false, maxSlopePermille: 0 });
    const a = s.expandedProps();
    expect(a.length).toBeGreaterThan(50);
    expect(s.expandedProps()).toBe(a);
    expect(a).toEqual(expandPropFields(s.doc.value!.toRtsMap()));
    s.updateField(0, { densityPerKWu2: 128 });
    const b = s.expandedProps();
    expect(b).not.toBe(a);
    expect(b.length).toBeGreaterThan(a.length);
  });

  it('vertex move, insert, radius, update and vertex delete with undo', () => {
    const s = open();
    const orig = s.exportBytes();
    s.addField({ kind: 'polygon', points: [{ x: 100 * WU, z: 300 * WU }, { x: 140 * WU, z: 300 * WU }, { x: 140 * WU, z: 340 * WU }, { x: 100 * WU, z: 340 * WU }] });
    s.addField({ kind: 'circle', x: 300 * WU, z: 300 * WU, r: 10 * WU });
    s.moveVertex(0, 2, 150.2 * WU, 345 * WU);
    expect(s.doc.value!.positionOf({ type: 'fieldVertex', index: 0, vertex: 2 })).toEqual({ x: 150 * WU, z: 345 * WU });
    s.insertVertex(0, 3, 90 * WU, 320 * WU);
    expect(s.selection.value).toEqual([{ type: 'fieldVertex', index: 0, vertex: 4 }]);
    s.setFieldRadius(1, 17.3 * WU);
    expect(s.doc.value!.fields[1]!.shape).toMatchObject({ r: 17.5 * WU });
    s.setFieldRadius(1, MAX * 4);
    expect(s.doc.value!.fields[1]!.shape).toMatchObject({ r: MAX });
    s.updateField(1, { name: 'Hain', seed: 99 });
    expect(s.doc.value!.fields[1]).toMatchObject({ name: 'Hain', seed: 99 });
    s.select([{ type: 'fieldVertex', index: 0, vertex: 0 }, { type: 'fieldVertex', index: 0, vertex: 1 }]);
    s.deleteSelection();
    expect(pointsOf(s.doc.value!.fields[0]!.shape)).toHaveLength(3);
    s.select([{ type: 'fieldVertex', index: 0, vertex: 0 }]);
    s.deleteSelection();
    expect(s.status.value).toMatch(/3 Eckpunkte/);
    while (s.canUndo.value) s.undo();
    expect(bytesEqual(s.exportBytes(), orig)).toBe(true);
  });
});

describe('EditorStore selection, move and gestures', () => {
  it('select replaces / adds and drops unknown refs', () => {
    const s = open();
    s.select([{ type: 'start', index: 0 }, { type: 'spot', index: 99 }, { type: 'start', index: 0 }]);
    expect(s.selection.value).toEqual([{ type: 'start', index: 0 }]);
    s.select([{ type: 'spot', index: 1 }], true);
    expect(s.selection.value).toEqual([{ type: 'start', index: 0 }, { type: 'spot', index: 1 }]);
    s.select([{ type: 'spot', index: 2 }]);
    expect(s.selection.value).toEqual([{ type: 'spot', index: 2 }]);
  });

  it('moveSelectionBy: small steps accumulate inside a gesture (snap), one undo step', () => {
    const s = open();
    const st0 = s.doc.value!.starts[0]!;
    s.select([{ type: 'start', index: 0 }, { type: 'spot', index: 0 }]);
    const sp0 = s.doc.value!.spots[0]!;
    s.beginGesture();
    for (let i = 0; i < 10; i++) s.moveSelectionBy(300, -100);
    s.endGesture();
    // 3000 raw → anchor snapped to 96 WU + 2048; the spot moves by the same delta.
    expect(s.doc.value!.starts[0]).toEqual({ army: 0, x: st0.x + 2048, z: st0.z });
    expect(s.doc.value!.spots[0]).toEqual({ kind: sp0.kind, x: sp0.x + 2048, z: sp0.z });
    expect(s.undoDepth.value).toBe(1);
    s.undo();
    expect(s.doc.value!.starts[0]).toEqual(st0);
    // Outside a gesture each call is its own step, and tiny deltas snap to nothing.
    s.moveSelectionBy(300, 0);
    expect(s.canUndo.value).toBe(false);
    s.moveSelectionBy(4096, 0);
    s.moveSelectionBy(4096, 0);
    expect(s.undoDepth.value).toBe(2);
  });

  it('moveSelectionBy clamps the whole selection to the map', () => {
    const s = open();
    s.addField({ kind: 'polygon', points: [{ x: 10 * WU, z: 10 * WU }, { x: 30 * WU, z: 10 * WU }, { x: 20 * WU, z: 30 * WU }] });
    s.select([{ type: 'field', index: 0 }]);
    s.moveSelectionBy(-100 * WU, -100 * WU);
    expect(s.doc.value!.positionOf({ type: 'field', index: 0 })).toEqual({ x: 0, z: 0 });
    s.moveSelectionBy(10000 * WU, 0);
    expect(s.doc.value!.positionOf({ type: 'fieldVertex', index: 0, vertex: 1 })).toEqual({ x: MAX, z: 0 });
  });

  it('setStartArmy keeps the start selected at its new index', () => {
    const s = open();
    s.select([{ type: 'start', index: 0 }]);
    s.setStartArmy(0, 7);
    expect(s.doc.value!.starts.map((x) => x.army)).toEqual([1, 7]);
    expect(s.selection.value).toEqual([{ type: 'start', index: 1 }]);
  });

  it('deleteSelection keeps the last start', () => {
    const s = open();
    s.select([{ type: 'start', index: 0 }, { type: 'start', index: 1 }, { type: 'spot', index: 0 }]);
    s.deleteSelection();
    expect(s.doc.value!.starts).toHaveLength(1);
    expect(s.status.value).toMatch(/letzte Startposition/);
    expect(s.selection.value).toEqual([]);
  });

  it('undo/redo drops selections that no longer exist', () => {
    const s = open();
    s.addSpot('mass', 10 * WU, 10 * WU);
    expect(s.selection.value).toHaveLength(1);
    s.undo();
    expect(s.selection.value).toEqual([]);
  });
});

describe('EditorStore live symmetry', () => {
  function live(mode: 'point' | 'mirrorX' = 'point'): EditorStore {
    const s = open();
    s.symmetry.value = mode;
    s.liveSymmetry.value = true;
    return s;
  }

  it('add / move / delete carry the twin along in one undo step', () => {
    const s = live();
    const orig = s.exportBytes();
    s.addSpot('hydro', 40 * WU, 200 * WU);
    expect(s.doc.value!.spots.at(-1)).toEqual({ kind: 'hydro', x: 472 * WU, z: 312 * WU });
    s.addStart(60 * WU, 450 * WU);
    expect(s.doc.value!.starts.map((x) => [x.army, x.x / WU, x.z / WU])).toEqual([
      [0, 96, 96],
      [1, 416, 416],
      [2, 60, 450],
      [3, 452, 62],
    ]);
    s.addField({ kind: 'polygon', points: [{ x: 50 * WU, z: 300 * WU }, { x: 90 * WU, z: 300 * WU }, { x: 70 * WU, z: 340 * WU }] });
    const fs = s.doc.value!.fields;
    expect(fs).toHaveLength(2);
    expect(fs[1]!.seed).toBe((fs[0]!.seed ^ MIRROR_SEED_XOR) >>> 0);
    expect(s.undoDepth.value).toBe(3);
    expect(isSymmetric(s.doc.value!, 'point')).toBe(true);

    s.select([{ type: 'spot', index: s.doc.value!.spots.length - 2 }, { type: 'field', index: 0 }]);
    s.beginGesture();
    s.moveSelectionBy(3 * WU, 1 * WU);
    s.moveSelectionBy(2 * WU, 0);
    s.endGesture();
    expect(isSymmetric(s.doc.value!, 'point')).toBe(true);
    expect(s.undoDepth.value).toBe(4);

    s.moveVertex(0, 1, 95 * WU, 290 * WU);
    s.insertVertex(0, 1, 90 * WU, 330 * WU);
    expect(pointsOf(s.doc.value!.fields[1]!.shape)).toHaveLength(4);
    s.updateField(0, { seed: 5, densityPerKWu2: 32 });
    expect(s.doc.value!.fields[1]).toMatchObject({ seed: (5 ^ MIRROR_SEED_XOR) >>> 0, densityPerKWu2: 32 });
    expect(isSymmetric(s.doc.value!, 'point')).toBe(true);

    s.select([{ type: 'fieldVertex', index: 0, vertex: 3 }]);
    s.deleteSelection();
    expect(pointsOf(s.doc.value!.fields[1]!.shape)).toHaveLength(3);
    expect(isSymmetric(s.doc.value!, 'point')).toBe(true);

    s.select([{ type: 'field', index: 1 }, { type: 'start', index: 3 }]);
    s.deleteSelection();
    expect(s.doc.value!.fields).toHaveLength(0);
    expect(s.doc.value!.starts).toHaveLength(2);
    expect(isSymmetric(s.doc.value!, 'point')).toBe(true);

    while (s.canUndo.value) s.undo();
    expect(bytesEqual(s.exportBytes(), orig)).toBe(true);
  });

  it('circle radius follows the twin; markers on the axis are not duplicated', () => {
    const s = live('mirrorX');
    s.addField({ kind: 'circle', x: 100 * WU, z: 100 * WU, r: 10 * WU });
    s.setFieldRadius(0, 20 * WU);
    expect(s.doc.value!.fields.map((f) => f.shape)).toEqual([
      { kind: 'circle', x: 100 * WU, z: 100 * WU, r: 20 * WU },
      { kind: 'circle', x: 412 * WU, z: 100 * WU, r: 20 * WU },
    ]);
    const n = s.doc.value!.spots.length;
    s.addSpot('mass', 256 * WU, 30 * WU);
    expect(s.doc.value!.spots).toHaveLength(n + 1);
  });

  it('symmetrize command: one undo step, message when already symmetric', () => {
    const s = open('setons');
    s.symmetrize('point', 'a');
    expect(s.status.value).toMatch(/bereits symmetrisch/);
    expect(s.canUndo.value).toBe(false);
    s.addSpot('mass', 100 * WU, 500 * WU);
    s.symmetrize('point', 'a');
    expect(s.undoDepth.value).toBe(2);
    expect(isSymmetric(s.doc.value!, 'point')).toBe(true);
  });
});
