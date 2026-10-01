import { describe, expect, it } from 'vitest';
import { buildDragGrid, MAX_BUILD_DRAG_SITES } from '../src/build-grid.ts';
import { ActionMap } from '../src/actions.ts';
import { InputController, type Action, type BuildGesture, type DragBox } from '../src/input.ts';
import { FakeCanvas, FakeTarget, key, pointer, wheel } from './support/fakes.ts';

function fixture() {
  const canvas = new FakeCanvas(), win = new FakeTarget(), actions: Action[] = [], gestures: BuildGesture[] = [], boxes: (DragBox | null)[] = [];
  const focus = { value: null as unknown };
  const input = new InputController(canvas, win, { onAction: a => actions.push(a), onDragBox: b => boxes.push(b), focusProbe: () => focus.value });
  input.setBuildGestureHandler(g => gestures.push(g));
  return { canvas, win, input, actions, gestures, boxes, focus };
}
function start(f: ReturnType<typeof fixture>): void {
  f.canvas.dispatch(pointer('pointerdown', 100, 100, 0, { shiftKey: true }));
  f.canvas.dispatch(pointer('pointermove', 180, 120, 0, { shiftKey: true }));
}

describe('armed Shift build gesture', () => {
  it('previews without commands/selection and commits exactly once on its owning release', () => {
    const f = fixture(); start(f);
    f.canvas.dispatch(pointer('pointermove', 230, 120, 0, { shiftKey: true }));
    expect(f.gestures.map(g => g.phase)).toEqual(['start', 'update', 'update']);
    expect(f.gestures.at(-1)).toMatchObject({ x0: 100, y0: 100, x: 230, y: 120, dragged: true });
    f.canvas.dispatch(pointer('pointerup', 230, 120, 0, { pointerId: 2, shiftKey: true }));
    expect(f.input.buildingDrag).toBe(true);
    f.canvas.dispatch(pointer('pointerup', 230, 120, 0, { shiftKey: false, timeStamp: 123 }));
    f.canvas.dispatch(pointer('pointerup', 230, 120));
    expect(f.gestures.map(g => g.phase)).toEqual(['start', 'update', 'update', 'commit']);
    expect(f.gestures.at(-1)).toMatchObject({ dragged: true, timeStamp: 123 });
    expect(f.actions).toEqual([]); expect(f.boxes).toEqual([]); expect(f.canvas.captured.size).toBe(0);
  });
  it('retains Shift-click as a single additive placement and ordinary clicks unchanged', () => {
    const f = fixture();
    f.canvas.dispatch(pointer('pointerdown', 100, 100, 0, { shiftKey: true }));
    f.canvas.dispatch(pointer('pointerup', 102, 101, 0, { shiftKey: true }));
    expect(f.gestures.at(-1)).toMatchObject({ phase: 'commit', dragged: false, x0: 100, y0: 100 });
    f.canvas.dispatch(pointer('pointerdown', 100, 100)); f.canvas.dispatch(pointer('pointerup', 100, 100));
    expect(f.actions).toEqual([{ type: 'clickSelect', x: 100, y: 100, additive: false }]);
    f.input.setBuildGestureHandler(null); f.actions.length = 0;
    f.canvas.dispatch(pointer('pointerdown', 100, 100, 0, { shiftKey: true }));
    f.canvas.dispatch(pointer('pointermove', 150, 150)); f.canvas.dispatch(pointer('pointerup', 150, 150));
    expect(f.actions).toEqual([{ type: 'boxSelect', x0: 100, y0: 100, x1: 150, y1: 150, additive: true }]);
  });
  it('locks competing camera gestures and held-key/edge pan until release', () => {
    const f = fixture(); f.win.dispatch(key('keydown', 'ArrowRight')); start(f);
    f.canvas.dispatch(pointer('pointerdown', 180, 120, 1)); f.canvas.dispatch(wheel(100, 180, 120));
    f.canvas.dispatch(pointer('pointermove', 1279, 1, 0, { shiftKey: true }));
    f.input.updateEdge(1280, 720);
    expect(f.input.panAxisX(500)).toBe(0); expect(f.input.panAxisY(500)).toBe(0);
    expect([f.input.edgeX, f.input.edgeY]).toEqual([0, 0]);
    expect(f.actions).toEqual([]); expect(f.boxes).toEqual([]);
  });
  it.each(['modal', 'blur', 'pointercancel', 'capture loss', 'Pause', 'text focus', 'mode change', 'dispose'] as const)('cancels %s without a later commit', reason => {
    const f = fixture(); start(f);
    if (reason === 'modal') f.input.setSuspended(true);
    if (reason === 'blur') f.win.dispatch({ ...pointer('pointermove', 0, 0), type: 'blur' });
    if (reason === 'pointercancel') f.canvas.dispatch(pointer('pointercancel', 180, 120));
    if (reason === 'capture loss') f.canvas.dispatch({ ...pointer('pointercancel', 180, 120), type: 'lostpointercapture' });
    if (reason === 'Pause') f.win.dispatch(key('keydown', 'Pause'));
    if (reason === 'text focus') { f.focus.value = { tagName: 'INPUT', type: 'text' }; f.canvas.dispatch(pointer('pointermove', 180, 120)); }
    if (reason === 'mode change') f.input.setBuildGestureHandler(null);
    if (reason === 'dispose') f.input.dispose();
    f.input.setSuspended(false); f.canvas.dispatch(pointer('pointerup', 180, 120));
    expect(f.gestures.filter(g => g.phase === 'cancel')).toHaveLength(1);
    expect(f.gestures.filter(g => g.phase === 'commit')).toHaveLength(0);
    expect(f.input.buildingDrag).toBe(false); expect(f.canvas.captured.size).toBe(0);
    expect(f.actions.every(a => a.type === 'togglePause')).toBe(true);
  });
  it('right click cancels the held drag before routing the existing targeting cancellation', () => {
    const f = fixture(); start(f); f.canvas.dispatch(pointer('pointerdown', 180, 120, 2));
    f.canvas.dispatch(pointer('pointerup', 180, 120));
    expect(f.gestures.at(-1)?.phase).toBe('cancel');
    expect(f.actions.map(a => a.type)).toEqual(['moveCommand']);
    expect(f.gestures.some(g => g.phase === 'commit')).toBe(false);
  });
  it('cancels the real mouse chord when right press is pointermove and only final left release is pointerup', () => {
    const f = fixture(); start(f);
    f.canvas.dispatch(pointer('pointermove', 180, 120, 2, { buttons: 3, shiftKey: true, timeStamp: 20 }));
    // Pointer Events keeps the same pointer active until every mouse button is released.
    f.canvas.dispatch(pointer('pointermove', 180, 120, 2, { buttons: 1, shiftKey: true }));
    f.canvas.dispatch(pointer('pointermove', 190, 120, -1, { buttons: 1, shiftKey: true }));
    f.canvas.dispatch(pointer('pointerup', 190, 120, 0, { buttons: 0, shiftKey: true }));
    expect(f.gestures.filter(g => g.phase === 'cancel')).toHaveLength(1);
    expect(f.gestures.some(g => g.phase === 'commit')).toBe(false);
    expect(f.actions).toEqual([{ type: 'moveCommand', x: 180, y: 120, queue: true, timeStamp: 20 }]);
    expect(f.boxes).toEqual([]); expect(f.canvas.captured.size).toBe(0);
    expect(f.input.buildingDrag).toBe(false);
  });
  it.each(['KeyP', 'Pause'])('accepts held Shift with global %s while dragging and suppresses the later release', code => {
    const f = fixture(); start(f);
    const event = f.win.dispatch(key('keydown', code, { shiftKey: true }));
    f.win.dispatch(key('keydown', code, { shiftKey: true, repeat: true }));
    f.canvas.dispatch(pointer('pointerup', 180, 120, 0, { shiftKey: true }));
    expect(event.defaultPrevented).toBe(true);
    expect(f.actions).toEqual([{ type: 'togglePause' }]);
    expect(f.gestures.filter(g => g.phase === 'cancel')).toHaveLength(1);
    expect(f.gestures.some(g => g.phase === 'commit')).toBe(false);
    expect(f.boxes).toEqual([]); expect(f.canvas.captured.size).toBe(0);
  });
  it('uses the remapped pause chord and keeps its other modifiers exact during Shift drag', () => {
    const f = fixture();
    f.input.actions = new ActionMap({ togglePause: [{ code: 'KeyL', alt: true }] });
    start(f);
    f.win.dispatch(key('keydown', 'KeyP', { shiftKey: true }));
    f.win.dispatch(key('keydown', 'KeyL', { shiftKey: true }));
    f.win.dispatch(key('keydown', 'KeyL', { shiftKey: true, altKey: true, ctrlKey: true }));
    expect(f.input.buildingDrag).toBe(true); expect(f.actions).toEqual([]);
    f.win.dispatch(key('keydown', 'KeyL', { shiftKey: true, altKey: true, repeat: true }));
    expect(f.input.buildingDrag).toBe(true); expect(f.actions).toEqual([]);
    f.win.dispatch(key('keydown', 'KeyL', { shiftKey: true, altKey: true }));
    f.canvas.dispatch(pointer('pointerup', 180, 120, 0, { shiftKey: true }));
    expect(f.actions).toEqual([{ type: 'togglePause' }]);
    expect(f.gestures.filter(g => g.phase === 'cancel')).toHaveLength(1);
    expect(f.gestures.some(g => g.phase === 'commit')).toBe(false);
  });
  it('preserves exact pause modifiers outside a building drag', () => {
    const f = fixture();
    f.input.actions = new ActionMap({ togglePause: [{ code: 'KeyL', alt: true }] });
    f.win.dispatch(key('keydown', 'KeyL', { shiftKey: true, altKey: true }));
    expect(f.actions).toEqual([]);
    f.win.dispatch(key('keydown', 'KeyL', { altKey: true }));
    expect(f.actions).toEqual([{ type: 'togglePause' }]);
  });
  it.each(['text focus', 'suspension'] as const)('does not pause a Shift drag through %s', reason => {
    const f = fixture(); start(f);
    if (reason === 'text focus') f.focus.value = { tagName: 'INPUT', type: 'text' };
    else f.input.setSuspended(true);
    f.win.dispatch(key('keydown', 'KeyP', { shiftKey: true }));
    f.canvas.dispatch(pointer('pointerup', 180, 120, 0, { shiftKey: true }));
    expect(f.actions).toEqual([]);
    expect(f.gestures.filter(g => g.phase === 'cancel')).toHaveLength(1);
    expect(f.gestures.some(g => g.phase === 'commit')).toBe(false);
  });
});

describe('world footprint build grid', () => {
  it('keeps a footprint-spaced line and does not add an incomplete final cell', () => {
    expect(buildDragGrid({ x: 4096, z: 4096 }, { x: 7 * 4096, z: 4096 }, 2 * 4096, 3 * 4096))
      .toEqual([1, 3, 5, 7].map(x => ({ x: x * 4096, z: 4096 })));
    expect(buildDragGrid({ x: 4096, z: 4096 }, { x: 2.9 * 4096, z: 4096 }, 2 * 4096, 3 * 4096)).toHaveLength(1);
  });
  it('fills both axes in deterministic serpentine order, including reverse and rotated footprints', () => {
    expect(buildDragGrid({ x: 10, z: 12 }, { x: 4, z: 8 }, 3, 2)).toEqual([
      { x: 10, z: 12 }, { x: 7, z: 12 }, { x: 4, z: 12 },
      { x: 4, z: 10 }, { x: 7, z: 10 }, { x: 10, z: 10 },
      { x: 10, z: 8 }, { x: 7, z: 8 }, { x: 4, z: 8 },
    ]);
  });
  it('bounds a huge drag to the simulation queue limit and rejects invalid geometry', () => {
    expect(buildDragGrid({ x: 0, z: 0 }, { x: 1e9, z: 1e9 }, 4096, 4096)).toHaveLength(MAX_BUILD_DRAG_SITES);
    expect(buildDragGrid({ x: 0, z: 0 }, { x: NaN, z: 0 }, 4096, 4096)).toEqual([]);
    expect(buildDragGrid({ x: 0, z: 0 }, { x: 2, z: 2 }, 0, 4096)).toEqual([]);
  });
});
