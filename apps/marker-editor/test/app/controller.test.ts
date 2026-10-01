/**
 * Tool state machines of the EditorController with a fake picker/camera (no DOM, no WebGL):
 * every tool, gestures as one undo step, polygon finishing/aborting, panning, tool switches.
 * Map: hollow-ridge (512 WU; starts at (96,96)/(416,416), spot 0 at (116,100)); 2 px per WU.
 */
import { describe, expect, it } from 'vitest';
import { MAP_FX_ONE as FX } from '@faf/formats';
import { at, bytesEqual, click, drag, mapBytes, ptr, rig, wu, type Rig } from './support.ts';

function addPolygon(r: Rig, pts: readonly (readonly [number, number])[]): number {
  r.store.addField({ kind: 'polygon', points: pts.map(([x, z]) => ({ x: x * FX, z: z * FX })) });
  return r.store.doc.value!.fields.length - 1;
}

function addCircle(r: Rig, x: number, z: number, radius: number): number {
  r.store.addField({ kind: 'circle', x: x * FX, z: z * FX, r: radius * FX });
  return r.store.doc.value!.fields.length - 1;
}

describe('select tool', () => {
  it('clicks select, Shift adds and removes, a click into empty space clears', () => {
    const r = rig();
    click(r, at(r, 96, 96));
    expect(r.store.selection.value).toEqual([{ type: 'start', index: 0 }]);
    click(r, at(r, 116, 100, { shift: true }));
    expect(r.store.selection.value).toEqual([
      { type: 'start', index: 0 },
      { type: 'spot', index: 0 },
    ]);
    click(r, at(r, 96, 96, { shift: true }));
    expect(r.store.selection.value).toEqual([{ type: 'spot', index: 0 }]);
    click(r, at(r, 260, 200, { shift: true }));
    expect(r.store.selection.value).toHaveLength(1);
    click(r, at(r, 260, 200));
    expect(r.store.selection.value).toEqual([]);
    expect(r.store.undoDepth.value).toBe(0);
  });

  it('clicking a selected marker of a multi-selection selects only it (on release)', () => {
    const r = rig();
    r.store.select([
      { type: 'start', index: 0 },
      { type: 'spot', index: 1 },
    ]);
    const p = at(r, 96, 96);
    r.ctl.pointerDown(p);
    expect(r.store.selection.value).toHaveLength(2);
    r.ctl.pointerUp(p);
    expect(r.store.selection.value).toEqual([{ type: 'start', index: 0 }]);
  });

  it('dragging a marker moves it as one undo step; undo restores the file', () => {
    const r = rig();
    drag(r, at(r, 96, 96), at(r, 130, 150), 20);
    const s = r.store.doc.value!.starts[0]!;
    expect([wu(s.x), wu(s.z)]).toEqual([130, 150]);
    expect(r.store.undoDepth.value).toBe(1);
    expect(r.store.selection.value).toEqual([{ type: 'start', index: 0 }]);
    r.store.undo();
    expect(bytesEqual(r.store.exportBytes(), r.original)).toBe(true);
  });

  it('dragging an unselected marker selects and moves only it', () => {
    const r = rig();
    r.store.select([{ type: 'start', index: 1 }]);
    drag(r, at(r, 116, 100), at(r, 120, 110));
    const d = r.store.doc.value!;
    expect([wu(d.spots[0]!.x), wu(d.spots[0]!.z)]).toEqual([120, 110]);
    expect([wu(d.starts[1]!.x), wu(d.starts[1]!.z)]).toEqual([416, 416]);
    expect(r.store.selection.value).toEqual([{ type: 'spot', index: 0 }]);
  });

  it('dragging one marker of a selection moves the whole selection', () => {
    const r = rig();
    r.store.select([
      { type: 'start', index: 0 },
      { type: 'spot', index: 4 },
    ]);
    drag(r, at(r, 96, 96), at(r, 106, 91));
    const d = r.store.doc.value!;
    expect([wu(d.starts[0]!.x), wu(d.starts[0]!.z)]).toEqual([106, 91]);
    expect([wu(d.spots[4]!.x), wu(d.spots[4]!.z)]).toEqual([122, 239]);
    expect(r.store.undoDepth.value).toBe(1);
  });

  it('Shift-drag on an unselected marker adds it and moves the group', () => {
    const r = rig();
    click(r, at(r, 96, 96));
    drag(r, at(r, 116, 100, { shift: true }), at(r, 118, 104, { shift: true }));
    const d = r.store.doc.value!;
    expect([wu(d.starts[0]!.x), wu(d.starts[0]!.z)]).toEqual([98, 100]);
    expect([wu(d.spots[0]!.x), wu(d.spots[0]!.z)]).toEqual([118, 104]);
  });

  it('dragging a whole field moves all its vertices', () => {
    const r = rig();
    const f = addPolygon(r, [
      [240, 180],
      [290, 180],
      [290, 230],
      [240, 230],
    ]);
    r.store.select([]);
    const depth = r.store.undoDepth.value;
    drag(r, at(r, 260, 200), at(r, 270, 195));
    const sh = r.store.doc.value!.fields[f]!.shape;
    expect(sh.kind === 'polygon' && sh.points.map((p) => [wu(p.x), wu(p.z)])).toEqual([
      [250, 175],
      [300, 175],
      [300, 225],
      [250, 225],
    ]);
    expect(r.store.undoDepth.value).toBe(depth + 1);
  });

  it('dragging a vertex handle moves the vertex (one undo step)', () => {
    const r = rig();
    const f = addPolygon(r, [
      [240, 180],
      [290, 180],
      [290, 230],
      [240, 230],
    ]);
    expect(r.store.selection.value).toEqual([{ type: 'field', index: f }]);
    const depth = r.store.undoDepth.value;
    drag(r, at(r, 290, 230), at(r, 300, 250), 12);
    const sh = r.store.doc.value!.fields[f]!.shape;
    expect(sh.kind === 'polygon' && [wu(sh.points[2]!.x), wu(sh.points[2]!.z)]).toEqual([300, 250]);
    expect(sh.kind === 'polygon' && [wu(sh.points[0]!.x), wu(sh.points[0]!.z)]).toEqual([240, 180]);
    expect(r.store.undoDepth.value).toBe(depth + 1);
    expect(r.store.selection.value).toEqual([{ type: 'fieldVertex', index: f, vertex: 2 }]);
  });

  it('dragging the radius handle changes the radius', () => {
    const r = rig();
    const f = addCircle(r, 260, 200, 20);
    const depth = r.store.undoDepth.value;
    drag(r, at(r, 280, 200), at(r, 290, 200));
    const sh = r.store.doc.value!.fields[f]!.shape;
    expect(sh.kind === 'circle' && [wu(sh.x), wu(sh.z), wu(sh.r)]).toEqual([260, 200, 30]);
    expect(r.store.undoDepth.value).toBe(depth + 1);
    r.store.undo();
    const back = r.store.doc.value!.fields[f]!.shape;
    expect(back.kind === 'circle' && wu(back.r)).toBe(20);
  });

  it('double click on a polygon edge inserts a vertex, on a vertex it does not', () => {
    const r = rig();
    const f = addPolygon(r, [
      [240, 180],
      [290, 180],
      [290, 230],
      [240, 230],
    ]);
    r.ctl.doubleClick(at(r, 240, 180));
    expect(r.store.doc.value!.fields[f]!.shape).toMatchObject({ kind: 'polygon', points: { length: 4 } });
    r.ctl.doubleClick(at(r, 265, 180.5));
    const sh = r.store.doc.value!.fields[f]!.shape;
    expect(sh.kind === 'polygon' && sh.points.map((p) => [wu(p.x), wu(p.z)])).toEqual([
      [240, 180],
      [265, 180],
      [290, 180],
      [290, 230],
      [240, 230],
    ]);
    expect(r.store.selection.value).toEqual([{ type: 'fieldVertex', index: f, vertex: 1 }]);
    // Closing edge (last → first vertex).
    r.ctl.doubleClick(at(r, 240, 200));
    const sh2 = r.store.doc.value!.fields[f]!.shape;
    expect(sh2.kind === 'polygon' && sh2.points.map((p) => [wu(p.x), wu(p.z)])[5]).toEqual([240, 200]);
  });

  it('left-drag into empty space pans the camera and keeps the grabbed point under the cursor', () => {
    const r = rig();
    const bytes = r.store.exportBytes();
    const a = at(r, 260, 200);
    const grabbed = r.env.groundAt(a.x, a.y);
    drag(r, a, ptr(a.x + 60, a.y - 40));
    expect(r.env.pans).toBeGreaterThan(0);
    const now = r.env.groundAt(a.x + 60, a.y - 40);
    expect(now.x).toBeCloseTo(grabbed.x, 9);
    expect(now.z).toBeCloseTo(grabbed.z, 9);
    expect(bytesEqual(r.store.exportBytes(), bytes)).toBe(true);
    expect(r.store.undoDepth.value).toBe(0);
  });

  it('Escape during a drag reverts the move', () => {
    const r = rig();
    const p = at(r, 96, 96);
    r.ctl.pointerDown(p);
    for (let i = 1; i <= 5; i++) r.ctl.pointerMove(ptr(p.x + i * 6, p.y));
    expect(wu(r.store.doc.value!.starts[0]!.x)).toBe(111);
    expect(r.ctl.handleKey({ code: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, false)).toBe(true);
    r.ctl.pointerUp(ptr(p.x + 30, p.y));
    expect(bytesEqual(r.store.exportBytes(), r.original)).toBe(true);
    expect(r.store.undoDepth.value).toBe(0);
    expect(r.ctl.busy).toBe(false);
  });

  it('hover follows the pointer, the cursor signal reports WU and clears on leave', () => {
    const r = rig();
    r.ctl.pointerMove(at(r, 116, 100));
    expect(r.store.hover.value).toEqual({ type: 'spot', index: 0 });
    expect(r.ctl.cursor.value).toEqual({ x: 116, z: 100 });
    expect(r.ctl.cursorStyle.value).toBe('move');
    r.ctl.pointerMove(at(r, 260, 200));
    expect(r.store.hover.value).toBeNull();
    r.ctl.pointerMove(ptr(-10, -10));
    expect(r.ctl.cursor.value).toBeNull();
    r.ctl.pointerMove(at(r, 96, 96));
    r.ctl.pointerLeave();
    expect(r.ctl.cursor.value).toBeNull();
    expect(r.store.hover.value).toBeNull();
  });
});

describe('placement tools', () => {
  it('start / mass / hydro: a click places the marker at the picked point', () => {
    const r = rig();
    r.store.tool.value = 'start';
    click(r, at(r, 256, 200));
    let d = r.store.doc.value!;
    expect(d.starts).toHaveLength(3);
    expect(d.starts.find((s) => s.army === 2)).toMatchObject({ x: 256 * FX, z: 200 * FX });
    r.store.tool.value = 'mass';
    click(r, at(r, 250, 210.5));
    r.store.tool.value = 'hydro';
    click(r, at(r, 262, 190));
    d = r.store.doc.value!;
    expect(d.spots.slice(-2)).toEqual([
      { kind: 'mass', x: 250 * FX, z: 210.5 * FX },
      { kind: 'hydro', x: 262 * FX, z: 190 * FX },
    ]);
    expect(r.store.undoDepth.value).toBe(3);
    expect(r.ctl.cursorStyle.value).toBe('crosshair');
  });

  it('a drag pans instead of placing; a click off the map reports it', () => {
    const r = rig();
    r.store.tool.value = 'mass';
    const n = r.store.doc.value!.spots.length;
    drag(r, at(r, 250, 200), at(r, 280, 230));
    expect(r.store.doc.value!.spots).toHaveLength(n);
    expect(r.env.pans).toBeGreaterThan(0);
    click(r, ptr(-20, 40));
    expect(r.store.doc.value!.spots).toHaveLength(n);
    expect(r.store.status.value).toBe('Außerhalb der Karte');
  });

  it('live symmetry adds the mirror twin in the same undo step', () => {
    const r = rig();
    r.store.symmetry.value = 'point';
    r.store.liveSymmetry.value = true;
    r.store.tool.value = 'mass';
    click(r, at(r, 250, 200));
    const d = r.store.doc.value!;
    expect(d.spots.slice(-2)).toEqual([
      { kind: 'mass', x: 250 * FX, z: 200 * FX },
      { kind: 'mass', x: 262 * FX, z: 312 * FX },
    ]);
    expect(r.store.undoDepth.value).toBe(1);
  });
});

describe('field tools', () => {
  it('fieldCircle: drag from the centre sets the radius, shows a draft and adds one field', () => {
    const r = rig();
    r.store.tool.value = 'fieldCircle';
    const a = at(r, 260, 200);
    r.ctl.pointerDown(a);
    expect(r.ctl.draft.value).toEqual({ kind: 'circle', points: [{ x: 260 * FX, z: 200 * FX }] });
    const b = at(r, 272, 216);
    r.ctl.pointerMove(b);
    expect(r.ctl.draft.value).toEqual({
      kind: 'circle',
      points: [
        { x: 260 * FX, z: 200 * FX },
        { x: 272 * FX, z: 216 * FX },
      ],
    });
    r.ctl.pointerUp(b);
    expect(r.ctl.draft.value).toBeNull();
    const f = r.store.doc.value!.fields;
    expect(f).toHaveLength(1);
    expect(f[0]!.shape).toEqual({ kind: 'circle', x: 260 * FX, z: 200 * FX, r: 20 * FX });
    expect(r.store.undoDepth.value).toBe(1);
    expect(r.store.selection.value).toEqual([{ type: 'field', index: 0 }]);
  });

  it('fieldCircle: a plain click gives a hint, a tiny drag gets the minimum radius, Escape aborts', () => {
    const r = rig();
    r.store.tool.value = 'fieldCircle';
    click(r, at(r, 260, 200));
    expect(r.store.doc.value!.fields).toHaveLength(0);
    expect(r.store.status.value).toContain('ziehen');
    // 3 px = 1.5 WU on screen but the start threshold is 4 px: drag 5 px (2.5 WU) → r 2.5 WU.
    drag(r, at(r, 260, 200), ptr(at(r, 260, 200).x + 5, at(r, 260, 200).y), 1);
    expect(r.store.doc.value!.fields[0]!.shape).toMatchObject({ kind: 'circle', r: 2.5 * FX });
    r.store.undo();
    r.env.scale = 16; // zoomed in: 5 px = 0.3125 WU → clamped to 1 WU
    drag(r, at(r, 260, 200), ptr(at(r, 260, 200).x + 5, at(r, 260, 200).y), 1);
    expect(r.store.doc.value!.fields[0]!.shape).toMatchObject({ kind: 'circle', r: FX });
    r.store.undo();
    const a = at(r, 260, 200);
    r.ctl.pointerDown(a);
    r.ctl.pointerMove(ptr(a.x + 80, a.y));
    expect(r.ctl.draft.value).not.toBeNull();
    r.ctl.handleKey({ code: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, false);
    expect(r.ctl.draft.value).toBeNull();
    r.ctl.pointerUp(ptr(a.x + 80, a.y));
    expect(r.store.doc.value!.fields).toHaveLength(0);
  });

  it('fieldPolygon: clicks add vertices, double click finishes (5 vertices, one undo step)', () => {
    const r = rig();
    r.store.tool.value = 'fieldPolygon';
    const pts: [number, number][] = [
      [240, 180],
      [290, 175],
      [300, 220],
      [265, 245],
      [235, 225],
    ];
    for (const [x, z] of pts) click(r, at(r, x, z));
    r.ctl.pointerMove(at(r, 250, 250));
    expect(r.ctl.draft.value?.points).toHaveLength(6);
    // The double click's second click lands on the last point: ignored; dblclick finishes.
    click(r, at(r, 235, 225));
    r.ctl.doubleClick(at(r, 235, 225));
    const f = r.store.doc.value!.fields;
    expect(f).toHaveLength(1);
    expect(f[0]!.shape.kind === 'polygon' && f[0]!.shape.points.map((p) => [wu(p.x), wu(p.z)])).toEqual(pts);
    expect(r.store.undoDepth.value).toBe(1);
    expect(r.ctl.draft.value).toBeNull();
  });

  it('fieldPolygon: Enter finishes, Backspace removes the last vertex, Escape discards', () => {
    const r = rig();
    const key = (code: string): boolean => r.ctl.handleKey({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, false);
    r.store.tool.value = 'fieldPolygon';
    click(r, at(r, 240, 180));
    click(r, at(r, 280, 180));
    expect(key('Enter')).toBe(true);
    expect(r.store.status.value).toContain('mindestens 3');
    click(r, at(r, 999, 180)); // off the map
    click(r, at(r, 280, 220));
    click(r, at(r, 300, 300));
    expect(key('Backspace')).toBe(true);
    expect(r.ctl.draft.value?.points.length).toBeGreaterThanOrEqual(3);
    expect(key('Enter')).toBe(true);
    const sh = r.store.doc.value!.fields[0]!.shape;
    expect(sh.kind === 'polygon' && sh.points.map((p) => [wu(p.x), wu(p.z)])).toEqual([
      [240, 180],
      [280, 180],
      [280, 220],
    ]);
    click(r, at(r, 200, 150));
    click(r, at(r, 210, 150));
    expect(key('Escape')).toBe(true);
    expect(r.ctl.draft.value).toBeNull();
    expect(r.store.status.value).toBe('Polygon verworfen');
    // Nothing left to abort: Escape clears the selection.
    expect(r.store.selection.value).toHaveLength(1);
    key('Escape');
    expect(r.store.selection.value).toEqual([]);
    expect(r.store.doc.value!.fields).toHaveLength(1);
  });

  it('fieldPolygon: a click on the first vertex closes; a self-intersecting polygon stays a draft', () => {
    const r = rig();
    r.store.tool.value = 'fieldPolygon';
    click(r, at(r, 240, 180));
    click(r, at(r, 280, 180));
    click(r, at(r, 280, 220));
    click(r, at(r, 241, 181)); // within 8 px of the first vertex
    expect(r.store.doc.value!.fields).toHaveLength(1);
    // Bow tie: rejected by the store, the draft remains.
    for (const [x, z] of [
      [300, 300],
      [340, 340],
      [340, 300],
      [300, 340],
    ] as const)
      click(r, at(r, x, z));
    r.ctl.doubleClick(at(r, 300, 340));
    expect(r.store.doc.value!.fields).toHaveLength(1);
    expect(r.store.status.value).toMatch(/^Nicht möglich/);
    expect(r.ctl.draft.value?.points.length).toBeGreaterThanOrEqual(4);
  });

  it('left-drag pans while drawing a polygon without adding a vertex', () => {
    const r = rig();
    r.store.tool.value = 'fieldPolygon';
    click(r, at(r, 240, 180));
    drag(r, at(r, 260, 200), at(r, 300, 260));
    expect(r.env.pans).toBeGreaterThan(0);
    expect(r.ctl.draft.value?.points[0]).toEqual({ x: 240 * FX, z: 180 * FX });
    r.ctl.handleKey({ code: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, false);
  });

  it('switching the tool or opening a map drops the draft', () => {
    const r = rig();
    r.store.tool.value = 'fieldPolygon';
    click(r, at(r, 240, 180));
    click(r, at(r, 280, 180));
    expect(r.ctl.draft.value).not.toBeNull();
    r.store.tool.value = 'select';
    expect(r.ctl.draft.value).toBeNull();
    r.store.tool.value = 'fieldPolygon';
    click(r, at(r, 240, 180));
    expect(r.ctl.draft.value).not.toBeNull();
    r.store.open(mapBytes('tessera'), 'tessera.rtsmap');
    expect(r.ctl.draft.value).toBeNull();
    // The polygon tool starts from scratch on the new map.
    click(r, at(r, 100, 100));
    expect(r.ctl.draft.value?.points).toHaveLength(1);
  });
});

describe('delete tool', () => {
  it('deletes markers, polygon vertices and whole fields with one undo step each', () => {
    const r = rig();
    const f = addPolygon(r, [
      [240, 180],
      [290, 180],
      [290, 230],
      [265, 245],
      [240, 230],
    ]);
    r.store.select([]);
    r.store.tool.value = 'delete';
    const spots = r.store.doc.value!.spots.length;
    click(r, at(r, 116, 100));
    expect(r.store.doc.value!.spots).toHaveLength(spots - 1);
    // Vertex of an unselected field.
    r.ctl.pointerMove(at(r, 265, 245));
    expect(r.store.hover.value).toEqual({ type: 'fieldVertex', index: f, vertex: 3 });
    expect(r.ctl.cursorStyle.value).toBe('pointer');
    click(r, at(r, 265, 245));
    const sh = r.store.doc.value!.fields[f]!.shape;
    expect(sh.kind === 'polygon' && sh.points).toHaveLength(4);
    click(r, at(r, 265, 205));
    expect(r.store.doc.value!.fields).toHaveLength(0);
    const depth = r.store.undoDepth.value;
    click(r, at(r, 30, 30));
    expect(r.store.undoDepth.value).toBe(depth);
    for (let i = 0; i < 4; i++) r.store.undo();
    expect(bytesEqual(r.store.exportBytes(), r.original)).toBe(true);
  });

  it('keeps the last start and the minimum of 3 vertices (status explains)', () => {
    const r = rig();
    const f = addPolygon(r, [
      [240, 180],
      [290, 180],
      [265, 230],
    ]);
    r.store.tool.value = 'delete';
    click(r, at(r, 290, 180));
    expect(r.store.doc.value!.fields[f]!.shape).toMatchObject({ points: { length: 3 } });
    expect(r.store.status.value).toMatch(/mindestens 3/);
    click(r, at(r, 96, 96));
    click(r, at(r, 416, 416));
    expect(r.store.doc.value!.starts).toHaveLength(1);
    expect(r.store.status.value).toMatch(/letzte Startposition/);
  });
});
