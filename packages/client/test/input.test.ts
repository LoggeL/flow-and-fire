import { describe, expect, it } from 'vitest';
import { InputController, isTextInputElement, type Action, type DragBox } from '../src/input.ts';
import { FakeCanvas, FakeTarget, contextmenu, key, pointer, wheel } from './support/fakes.ts';

function setup(focused: { el: unknown } = { el: null }) {
  const canvas = new FakeCanvas(1280, 720, 10, 20);
  const win = new FakeTarget();
  const actions: Action[] = [];
  const boxes: (DragBox | null)[] = [];
  const input = new InputController(canvas, win, {
    onAction: (a) => actions.push(a),
    onDragBox: (b) => boxes.push(b),
    focusProbe: () => focused.el,
  });
  return { canvas, win, actions, boxes, input, focused };
}

const textInput = { tagName: 'INPUT', type: 'text' };

describe('InputController action mapping', () => {
  it('right click → moveCommand at canvas-local coordinates with the event timestamp', () => {
    const { canvas, actions } = setup();
    const e = canvas.dispatch(pointer('pointerdown', 110, 220, 2, { timeStamp: 1234.5, shiftKey: true }));
    expect(e.defaultPrevented).toBe(true);
    expect(actions).toEqual([{ type: 'moveCommand', x: 100, y: 200, queue: true, timeStamp: 1234.5 }]);
  });

  it('suppresses the context menu on the canvas', () => {
    const { canvas } = setup();
    expect(canvas.dispatch(contextmenu()).defaultPrevented).toBe(true);
  });

  it('left click without drag → clickSelect; left drag → boxSelect with normalised rect and drag feedback', () => {
    const { canvas, actions, boxes } = setup();
    canvas.dispatch(pointer('pointerdown', 110, 120));
    canvas.dispatch(pointer('pointermove', 112, 121)); // below threshold
    canvas.dispatch(pointer('pointerup', 112, 121));
    expect(actions).toEqual([{ type: 'clickSelect', x: 100, y: 100, additive: false }]);
    expect(boxes).toEqual([]);

    actions.length = 0;
    canvas.dispatch(pointer('pointerdown', 310, 320, 0, { shiftKey: true }));
    expect(canvas.captured.has(1)).toBe(true);
    canvas.dispatch(pointer('pointermove', 250, 400));
    canvas.dispatch(pointer('pointermove', 210, 420));
    canvas.dispatch(pointer('pointerup', 210, 420));
    expect(canvas.captured.has(1)).toBe(false);
    expect(actions).toEqual([{ type: 'boxSelect', x0: 200, y0: 300, x1: 300, y1: 400, additive: true }]);
    expect(boxes).toEqual([
      { x0: 300, y0: 300, x1: 240, y1: 380 },
      { x0: 300, y0: 300, x1: 200, y1: 400 },
      null,
    ]);
  });

  it('middle drag → grabStart, pan deltas (with cursor position), grabEnd; wheel → zoom steps at the cursor', () => {
    const { canvas, actions } = setup();
    const d = canvas.dispatch(pointer('pointerdown', 100, 100, 1));
    expect(d.defaultPrevented).toBe(true);
    canvas.dispatch(pointer('pointermove', 130, 90, 1));
    canvas.dispatch(pointer('pointermove', 130, 95, 1));
    canvas.dispatch(pointer('pointerup', 130, 95, 1));
    canvas.dispatch(pointer('pointermove', 200, 200, 1));
    expect(actions).toEqual([
      { type: 'grabStart', x: 90, y: 80 },
      { type: 'pan', dxPx: 30, dyPx: -10, x: 120, y: 70 },
      { type: 'pan', dxPx: 0, dyPx: 5, x: 120, y: 75 },
      { type: 'grabEnd' },
    ]);
    actions.length = 0;
    const w = canvas.dispatch(wheel(200, 50, 60));
    expect(w.defaultPrevented).toBe(true);
    canvas.dispatch(wheel(-3, 50, 60, 1));
    canvas.dispatch(wheel(9999, 50, 60));
    expect(actions).toEqual([
      { type: 'zoom', steps: 2, x: 40, y: 40 },
      { type: 'zoom', steps: -1, x: 40, y: 40 },
      { type: 'zoom', steps: 5, x: 40, y: 40 },
    ]);
  });

  it('opening a modal ends a held middle grab once before physical release and blocks new pointer actions', () => {
    const { canvas, win, actions, input } = setup();
    canvas.dispatch(pointer('pointerdown', 100, 100, 1));
    canvas.dispatch(pointer('pointermove', 130, 90, 1));
    expect(input.cursor.state).toBe('grabPan');
    input.setSuspended(true);
    expect(input.cursor.state).toBe('idle');
    expect(actions.map((a) => a.type)).toEqual(['grabStart', 'pan', 'grabEnd']);
    input.setSuspended(true);
    const ended = actions.slice();
    canvas.dispatch(pointer('pointermove', 150, 120, 1));
    canvas.dispatch(pointer('pointerdown', 150, 120, 1));
    canvas.dispatch(pointer('pointerdown', 150, 120, 2));
    canvas.dispatch(pointer('pointerdown', 150, 120));
    canvas.dispatch(pointer('pointerup', 150, 120));
    canvas.dispatch({ ...pointer('pointerup', 150, 120), type: 'dblclick' });
    canvas.dispatch(wheel(100, 150, 120));
    win.dispatch(key('keydown', 'KeyP'));
    expect(actions).toEqual(ended);
    expect(input.cursor.state).toBe('idle');
    // Closing the modal does not revive the old grab when its button finally releases.
    input.setSuspended(false);
    canvas.dispatch(pointer('pointerup', 150, 120, 1));
    canvas.dispatch(pointer('pointermove', 160, 130, 1));
    expect(actions).toEqual(ended);
    canvas.dispatch(pointer('pointerdown', 160, 130, 1));
    expect(input.cursor.state).toBe('grabPan');
    expect(actions.at(-1)?.type).toBe('grabStart');
  });

  it('opening a modal clears an active selection box without committing selection', () => {
    const { canvas, actions, boxes, input } = setup();
    canvas.dispatch(pointer('pointerdown', 100, 100));
    canvas.dispatch(pointer('pointermove', 150, 150));
    expect(input.dragging).toBe(true);
    input.setSuspended(true);
    expect(input.dragging).toBe(false);
    expect(input.cursor.leftPressed).toBe(false);
    expect(boxes).toEqual([{ x0: 90, y0: 80, x1: 140, y1: 130 }, null]);
    input.setSuspended(true);
    input.setSuspended(false);
    canvas.dispatch(pointer('pointerup', 150, 150));
    expect(actions).toEqual([]);
    expect(boxes).toHaveLength(2);
  });

  it('keyboard actions: Ctrl/Cmd+A, P, Pause, N, console keys', () => {
    const { win, actions } = setup();
    const a = win.dispatch(key('keydown', 'KeyA', { ctrlKey: true }));
    expect(a.defaultPrevented).toBe(true);
    win.dispatch(key('keydown', 'KeyA', { metaKey: true }));
    win.dispatch(key('keydown', 'KeyP'));
    win.dispatch(key('keydown', 'KeyP', { repeat: true }));
    win.dispatch(key('keydown', 'Pause'));
    win.dispatch(key('keydown', 'KeyN'));
    win.dispatch(key('keydown', 'Backquote', { key: '^' }));
    win.dispatch(key('keydown', 'IntlBackslash', { key: '`' }));
    const f1 = win.dispatch(key('keydown', 'F1', { key: 'F1' }));
    expect(f1.defaultPrevented).toBe(true);
    expect(actions.map((x) => x.type)).toEqual([
      'selectAll',
      'selectAll',
      'togglePause',
      'togglePause',
      'stepOnce',
      'toggleConsole',
      'toggleConsole',
      'toggleConsole',
    ]);
  });

  it('WASD/arrows are pan axes; Ctrl+A does not pan left', () => {
    const { win, input } = setup();
    expect(input.panAxisX(0)).toBe(0);
    win.dispatch(key('keydown', 'KeyW', { timeStamp: 0 }));
    win.dispatch(key('keydown', 'ArrowRight', { timeStamp: 0 }));
    expect(input.panAxisY(10)).toBe(1);
    expect(input.panAxisX(10)).toBe(1);
    win.dispatch(key('keydown', 'KeyD', { timeStamp: 0 }));
    expect(input.panAxisX(10)).toBe(1); // clamped
    win.dispatch(key('keyup', 'KeyW'));
    win.dispatch(key('keyup', 'ArrowRight'));
    win.dispatch(key('keyup', 'KeyD'));
    expect(input.panAxisX(10)).toBe(0);
    expect(input.panAxisY(10)).toBe(0);
    win.dispatch(key('keydown', 'KeyA', { ctrlKey: true }));
    expect(input.panAxisX(10)).toBe(0);
    win.dispatch(key('keydown', 'ArrowLeft', { timeStamp: 0 }));
    win.dispatch({ type: 'blur', timeStamp: 0, defaultPrevented: false, target: null, preventDefault() {} });
    expect(input.panAxisX(10)).toBe(0);
  });

  it('S: tap → stop, hold → pan back without stop', () => {
    const { win, input, actions } = setup();
    win.dispatch(key('keydown', 'KeyS', { timeStamp: 1000 }));
    expect(input.panAxisY(1050)).toBe(0); // not yet a hold
    win.dispatch(key('keyup', 'KeyS', { timeStamp: 1080 }));
    expect(actions).toEqual([{ type: 'stop', timeStamp: 1080 }]);
    actions.length = 0;
    win.dispatch(key('keydown', 'KeyS', { timeStamp: 2000 }));
    expect(input.panAxisY(2300)).toBe(-1);
    win.dispatch(key('keyup', 'KeyS', { timeStamp: 2400 }));
    expect(actions).toEqual([]);
    expect(input.panAxisY(2500)).toBe(0);
  });

  it('focus rule: no game actions while a text field is focused, except toggleConsole', () => {
    const f = { el: null as unknown };
    const { canvas, win, actions, input } = setup(f);
    win.dispatch(key('keydown', 'KeyW', { timeStamp: 0 }));
    expect(input.panAxisY(1)).toBe(1);
    f.el = textInput;
    // Held keys are released as soon as focus moves into the field.
    expect(input.panAxisY(2)).toBe(0);
    win.dispatch(key('keydown', 'KeyP'));
    win.dispatch(key('keydown', 'KeyN'));
    win.dispatch(key('keydown', 'KeyA', { ctrlKey: true }));
    win.dispatch(key('keydown', 'KeyD', { timeStamp: 3 }));
    expect(input.panAxisX(4)).toBe(0);
    canvas.dispatch(pointer('pointerdown', 50, 50, 2));
    canvas.dispatch(wheel(100, 50, 50));
    canvas.dispatch(pointer('pointerdown', 50, 50, 0));
    canvas.dispatch(pointer('pointerup', 50, 50, 0));
    expect(actions).toEqual([]);
    const c = win.dispatch(key('keydown', 'Backquote', { key: '^' }));
    expect(c.defaultPrevented).toBe(true);
    expect(actions).toEqual([{ type: 'toggleConsole' }]);
    // Events whose target is a text field are ignored even if the probe disagrees.
    f.el = null;
    actions.length = 0;
    win.dispatch(key('keydown', 'KeyP', { target: { tagName: 'TEXTAREA' } }));
    win.dispatch(key('keydown', 'KeyP', { target: { tagName: 'INPUT', type: 'checkbox' } }));
    expect(actions).toEqual([{ type: 'togglePause' }]);
  });

  it('isTextInputElement', () => {
    expect(isTextInputElement(null)).toBe(false);
    expect(isTextInputElement({ tagName: 'input' })).toBe(true);
    expect(isTextInputElement({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTextInputElement({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTextInputElement({ tagName: 'SELECT' })).toBe(true);
    expect(isTextInputElement({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextInputElement({ tagName: 'CANVAS' })).toBe(false);
  });

  it('dispose removes all listeners', () => {
    const { canvas, win, input } = setup();
    expect(canvas.listenerCount()).toBeGreaterThan(0);
    expect(win.listenerCount()).toBeGreaterThan(0);
    input.dispose();
    expect(canvas.listenerCount()).toBe(0);
    expect(win.listenerCount()).toBe(0);
  });
});
