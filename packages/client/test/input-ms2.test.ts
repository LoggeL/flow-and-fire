// G16/C11 (MS2): ActionMap by code (DE/US layouts), CursorFsm transitions, edge pan rules, rotation,
// fullscreen + pointer confinement with fakes.
import { describe, expect, it } from 'vitest';
import { ActionMap, DEFAULT_ACTION_MAP, KEY_ACTIONS, formatBinding, type KeyChord } from '../src/actions.ts';
import { CursorFsm, cursorCss } from '../src/cursor-fsm.ts';
import { FullscreenController, PointerConfinement, VIRTUAL_CURSOR_ID, type VirtualCursorElement } from '../src/fullscreen.ts';
import { InputController, type Action } from '../src/input.ts';
import { FakeCanvas, FakeTarget, key, pointer, type FakeEvent } from './support/fakes.ts';

const chord = (code: string, mods: Partial<KeyChord> = {}): KeyChord & { key?: string } => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

function plainEvent(type: string, fields: Record<string, unknown> = {}): FakeEvent {
  const e: FakeEvent = {
    type,
    timeStamp: 0,
    defaultPrevented: false,
    target: null,
    preventDefault() {
      e.defaultPrevented = true;
    },
    ...fields,
  };
  return e;
}

describe('ActionMap (lookup by KeyboardEvent.code only)', () => {
  it('DE-QWERTZ: the key labelled Y (code KeyZ, key "y") triggers the KeyZ action; US identical', () => {
    const map = new ActionMap({ resetCamera: [{ code: 'KeyZ' }] });
    // Physical key at the US "Z" position: US reports key "z", DE reports key "y" – same code.
    const us: KeyChord & { key: string } = { ...chord('KeyZ'), key: 'z' };
    const de: KeyChord & { key: string } = { ...chord('KeyZ'), key: 'y' };
    expect(map.lookup(us)).toBe('resetCamera');
    expect(map.lookup(de)).toBe('resetCamera');
    // The DE key labelled Z reports code KeyY: not the KeyZ action even though key === 'z'.
    const deZ: KeyChord & { key: string } = { ...chord('KeyY'), key: 'z' };
    expect(map.lookup(deZ)).toBeNull();
    // Defaults: WASD, H, P are positional on both layouts; DE "^" is code Backquote.
    const d = new ActionMap();
    const h: KeyChord & { key: string } = { ...chord('KeyH'), key: 'h' };
    expect(d.lookup(h)).toBe('jumpToCommander');
    const dead: KeyChord & { key: string } = { ...chord('Backquote'), key: 'Dead' };
    expect(d.lookup(dead)).toBe('toggleConsole');
    expect(d.panDirection('KeyW')).toEqual([0, 1]);
    expect(d.panDirection('KeyS')).toEqual([0, -1]);
    expect(d.panDirection('KeyQ')).toBeNull();
  });

  it('modifier rules: primary = Ctrl or ⌘, exact otherwise, anyModifiers for held keys', () => {
    const m = new ActionMap();
    expect(m.lookup(chord('KeyA', { ctrlKey: true }))).toBe('selectAll');
    expect(m.lookup(chord('KeyA', { metaKey: true }))).toBe('selectAll');
    expect(m.lookup(chord('KeyA', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(m.lookup(chord('KeyA'))).toBeNull();
    expect(m.match(chord('KeyA'))).toEqual(['panLeft']);
    expect(m.match(chord('KeyA', { shiftKey: true }))).toEqual(['panLeft']);
    expect(m.lookup(chord('Enter', { altKey: true }))).toBe('toggleFullscreen');
    expect(m.lookup(chord('Enter'))).toBeNull();
    expect(m.lookup(chord('KeyP', { ctrlKey: true }))).toBeNull();
    expect(m.match(chord('KeyS'))).toEqual(['panBack', 'stop']);
    expect(m.matchesWithModifier(chord('KeyA', { ctrlKey: true }))).toBe(true);
    expect(m.matchesWithModifier(chord('KeyS'))).toBe(false);
    expect(formatBinding(DEFAULT_ACTION_MAP.toggleFullscreen[0]!)).toBe('Alt+Enter');
    expect(KEY_ACTIONS.every((a) => DEFAULT_ACTION_MAP[a].length > 0)).toBe(true);
  });
});

describe('CursorFsm', () => {
  it('idle → boxSelect (threshold) → idle; click without drag', () => {
    const f = new CursorFsm(4);
    expect(f.leftDown(10, 10)).toBe('none');
    expect(f.move(12, 11)).toBe('none');
    expect(f.state).toBe('idle');
    expect(f.leftUp()).toBe('click');
    f.leftDown(10, 10);
    expect(f.move(20, 10)).toBe('boxStart');
    expect(f.state).toBe('boxSelect');
    expect(f.leftUp()).toBe('boxEnd');
    expect(f.state).toBe('idle');
  });

  it('middle → grabPan, Ctrl+middle → rotate; buttons beat edge pan; cancel', () => {
    const f = new CursorFsm();
    expect(f.middleDown(false)).toBe('grabStart');
    expect(f.state).toBe('grabPan');
    f.edge(1, 0, false, true);
    expect(f.state).toBe('grabPan');
    expect(f.edgeX).toBe(0);
    expect(f.middleUp()).toBe('grabEnd');
    expect(f.middleDown(true)).toBe('rotateStart');
    expect(f.state).toBe('rotate');
    expect(f.leftDown(0, 0)).toBe('none'); // left press ignored while rotating
    expect(f.middleUp()).toBe('rotateEnd');
    f.leftDown(0, 0);
    f.move(50, 50);
    expect(f.middleDown(false)).toBe('none'); // no grab during a box drag
    expect(f.cancel()).toBe('boxEnd');
    expect(f.state).toBe('idle');
  });

  it('edgePan / confinedEdgePan only while allowed; leaving the band returns to idle', () => {
    const f = new CursorFsm();
    f.edge(-1, 1, false, true);
    expect(f.state).toBe('edgePan');
    expect([f.edgeX, f.edgeY]).toEqual([-1, 1]);
    expect(cursorCss(f.state, f.edgeX, f.edgeY)).toBe('nw-resize');
    f.edge(0, 0, false, true);
    expect(f.state).toBe('idle');
    f.edge(1, 0, true, true);
    expect(f.state).toBe('confinedEdgePan');
    f.edge(1, 0, true, false);
    expect(f.state).toBe('idle');
    expect(f.edgeX).toBe(0);
    f.edge(0, -1, false, true);
    expect(f.middleDown(false)).toBe('grabStart'); // a press leaves edge panning
    expect(cursorCss('boxSelect', 0, 0)).toBe('crosshair');
    expect(cursorCss('grabPan', 0, 0)).toBe('grabbing');
    expect(f.transitions).toBeGreaterThan(4);
  });
});

function inputSetup(opts: { confinement?: PointerConfinement; focus?: { el: unknown } } = {}) {
  const canvas = new FakeCanvas(800, 600, 0, 0) as FakeCanvas & { focused: number; focus(): void; style: { cursor: string } };
  canvas.focused = 0;
  canvas.focus = () => {
    canvas.focused++;
  };
  canvas.style = { cursor: '' };
  const win = new FakeTarget();
  const actions: Action[] = [];
  const focus = opts.focus ?? { el: null };
  const input = new InputController(canvas, win, {
    onAction: (a) => actions.push(a),
    focusProbe: () => focus.el,
    hasFocus: () => true,
    ...(opts.confinement !== undefined ? { confinement: opts.confinement } : {}),
  });
  return { canvas, win, actions, input, focus };
}

describe('InputController (MS2)', () => {
  it('new hotkeys: H → jumpToCommander, Home → resetCamera, Alt+Enter → toggleFullscreen (not Enter)', () => {
    const { win, actions } = inputSetup();
    win.dispatch(key('keydown', 'KeyH'));
    win.dispatch(key('keydown', 'Home'));
    win.dispatch(key('keydown', 'Enter'));
    const f = win.dispatch(key('keydown', 'Enter', { altKey: true }));
    expect(f.defaultPrevented).toBe(true);
    // DE layout: "z"-labelled key has code KeyY → nothing; H is positional.
    win.dispatch(key('keydown', 'KeyY', { key: 'z' }));
    expect(actions.map((a) => a.type)).toEqual(['jumpToCommander', 'resetCamera', 'toggleFullscreen']);
  });

  it('pointerdown focuses the canvas; middle mousedown default (autoscroll) is prevented', () => {
    const { canvas } = inputSetup();
    canvas.dispatch(pointer('pointerdown', 10, 10, 0));
    expect(canvas.focused).toBe(1);
    expect(canvas.dispatch(plainEvent('mousedown', { button: 1 })).defaultPrevented).toBe(true);
    expect(canvas.dispatch(plainEvent('mousedown', { button: 0 })).defaultPrevented).toBe(false);
    expect(canvas.dispatch(plainEvent('auxclick', { button: 1 })).defaultPrevented).toBe(true);
  });

  it('Ctrl+middle drag → rotate deltas; cursor style follows the FSM', () => {
    const { canvas, actions, input } = inputSetup();
    canvas.dispatch(pointer('pointerdown', 100, 100, 1, { ctrlKey: true }));
    expect(input.cursor.state).toBe('rotate');
    expect(canvas.style.cursor).toBe('move');
    canvas.dispatch(pointer('pointermove', 120, 95, 1));
    canvas.dispatch(pointer('pointerup', 120, 95, 1));
    expect(actions).toEqual([{ type: 'rotate', dxPx: 20, dyPx: -5 }]);
    expect(input.cursor.state).toBe('idle');
    expect(canvas.style.cursor).toBe('default');
  });

  it('edge pan: 8 px band, only with a focused window and the pointer inside; off on blur/pointerout/typing', () => {
    const f = { el: null as unknown };
    const { win, input } = inputSetup({ focus: f });
    input.updateEdge(800, 600);
    expect([input.edgeX, input.edgeY]).toEqual([0, 0]); // pointer position unknown
    win.dispatch(pointer('pointermove', 3, 300));
    input.updateEdge(800, 600);
    expect([input.edgeX, input.edgeY]).toEqual([-1, 0]);
    expect(input.cursor.state).toBe('edgePan');
    win.dispatch(pointer('pointermove', 795, 2));
    input.updateEdge(800, 600);
    expect([input.edgeX, input.edgeY]).toEqual([1, 1]);
    win.dispatch(pointer('pointermove', 400, 593));
    input.updateEdge(800, 600);
    expect([input.edgeX, input.edgeY]).toEqual([0, -1]);
    win.dispatch(pointer('pointermove', 400, 591)); // 9 px from the bottom: outside the band
    input.updateEdge(800, 600);
    expect([input.edgeX, input.edgeY]).toEqual([0, 0]);
    win.dispatch(pointer('pointermove', 2, 2));
    win.dispatch(plainEvent('blur'));
    input.updateEdge(800, 600);
    expect([input.edgeX, input.edgeY]).toEqual([0, 0]);
    win.dispatch(plainEvent('focus'));
    input.updateEdge(800, 600);
    expect([input.edgeX, input.edgeY]).toEqual([-1, 1]);
    win.dispatch(plainEvent('pointerout', { relatedTarget: null }));
    input.updateEdge(800, 600);
    expect([input.edgeX, input.edgeY]).toEqual([0, 0]);
    win.dispatch(pointer('pointermove', 2, 300));
    f.el = { tagName: 'INPUT' };
    input.updateEdge(800, 600);
    expect(input.edgeX).toBe(0);
    f.el = null;
    input.edgePanEnabled = false;
    input.updateEdge(800, 600);
    expect(input.edgeX).toBe(0);
  });
});

// ---- fullscreen / pointer lock fakes -----------------------------------------------------------

class FakeElement implements VirtualCursorElement {
  id = '';
  className = '';
  innerHTML = '';
  readonly style: Record<string, string> = {};
  removed = false;
  remove(): void {
    this.removed = true;
  }
}

class FakeDoc extends FakeTarget {
  fullscreenElement: unknown = null;
  pointerLockElement: unknown = null;
  readonly created: FakeElement[] = [];
  exitFullscreen = async (): Promise<void> => {
    this.fullscreenElement = null;
    this.dispatch(plainEvent('fullscreenchange'));
    if (this.pointerLockElement !== null) this.exitPointerLock();
  };
  exitPointerLock = (): void => {
    this.pointerLockElement = null;
    this.dispatch(plainEvent('pointerlockchange'));
  };
  createElement(): FakeElement {
    const e = new FakeElement();
    this.created.push(e);
    return e;
  }
}

function fsSetup(opts: { lockApi?: boolean; fsApi?: boolean } = {}) {
  const doc = new FakeDoc();
  const children: VirtualCursorElement[] = [];
  const root: { requestFullscreen?: () => Promise<void>; appendChild(c: VirtualCursorElement): void } = {
    appendChild: (c) => children.push(c),
  };
  if (opts.fsApi !== false) {
    root.requestFullscreen = async () => {
      doc.fullscreenElement = root;
      doc.dispatch(plainEvent('fullscreenchange'));
    };
  }
  const canvas = new FakeCanvas(800, 600, 0, 0) as FakeCanvas & { requestPointerLock?: () => void; style: { cursor: string } };
  canvas.style = { cursor: '' };
  if (opts.lockApi !== false) {
    canvas.requestPointerLock = () => {
      doc.pointerLockElement = canvas;
      doc.dispatch(plainEvent('pointerlockchange'));
    };
  }
  const fullscreen = new FullscreenController(root, doc);
  const confinement = new PointerConfinement({ canvas, doc, fullscreen, viewport: () => ({ width: 800, height: 600 }), container: root });
  const win = new FakeTarget();
  const actions: Action[] = [];
  const input = new InputController(canvas, win, { onAction: (a) => actions.push(a), confinement, hasFocus: () => true, focusProbe: () => null });
  return { doc, root, children, canvas, fullscreen, confinement, win, input, actions };
}

describe('Fullscreen + pointer confinement (fakes)', () => {
  it('toggle enters/leaves fullscreen on the game root and reports changes', async () => {
    const { fullscreen, doc, root } = fsSetup();
    const seen: boolean[] = [];
    fullscreen.onChange((a) => seen.push(a));
    expect(fullscreen.supported).toBe(true);
    expect(await fullscreen.toggle()).toBe(true);
    expect(doc.fullscreenElement).toBe(root);
    expect(await fullscreen.toggle()).toBe(false);
    expect(fullscreen.active).toBe(false);
    expect(seen).toEqual([true, false]);
    const nofs = fsSetup({ fsApi: false });
    expect(nofs.fullscreen.supported).toBe(false);
    expect(await nofs.fullscreen.enter()).toBe(false);
  });

  it('in fullscreen a press locks the pointer; the virtual cursor integrates movement, is clamped and drawn', async () => {
    const { fullscreen, confinement, canvas, children, input, win, doc } = fsSetup();
    // Outside fullscreen: no lock on press.
    canvas.dispatch(pointer('pointerdown', 100, 100, 0));
    canvas.dispatch(pointer('pointerup', 100, 100, 0));
    expect(confinement.locked).toBe(false);
    await fullscreen.enter();
    canvas.dispatch(pointer('pointerdown', 400, 300, 0));
    canvas.dispatch(pointer('pointerup', 400, 300, 0));
    expect(confinement.locked).toBe(true);
    expect(input.confined).toBe(true);
    expect(canvas.style.cursor).toBe('none');
    const el = children[0] as FakeElement;
    expect(el.id).toBe(VIRTUAL_CURSOR_ID);
    expect(el.style['display']).toBe('block');
    // Movement deltas move the virtual cursor (client coordinates are frozen under pointer lock).
    canvas.dispatch(pointer('pointermove', 400, 300, 0, { movementX: -150, movementY: 20 }));
    expect([input.pointerX, input.pointerY]).toEqual([250, 320]);
    expect(el.style['transform']).toBe('translate(250px, 320px)');
    // Window-level moves do not double-apply under lock.
    win.dispatch(pointer('pointermove', 400, 300, 0, { movementX: -150, movementY: 20 }));
    expect([input.pointerX, input.pointerY]).toEqual([250, 320]);
    // Clamped to the viewport → confined edge pan.
    canvas.dispatch(pointer('pointermove', 400, 300, 0, { movementX: -5000, movementY: 0 }));
    expect(input.pointerX).toBe(0);
    input.updateEdge(800, 600);
    expect(input.cursor.state).toBe('confinedEdgePan');
    expect(input.edgeX).toBe(-1);
    canvas.dispatch(pointer('pointermove', 400, 300, 0, { movementX: 10_000, movementY: 10_000 }));
    expect([input.pointerX, input.pointerY]).toEqual([799, 599]);
    // Picking/right click use the virtual cursor.
    canvas.dispatch(pointer('pointerdown', 1, 1, 2));
    // Esc: the browser releases the lock first (fullscreen may stay) → normal pointer again.
    doc.exitPointerLock();
    expect(confinement.locked).toBe(false);
    expect(el.style['display']).toBe('none');
    // Next press re-locks (user gesture); leaving fullscreen releases.
    canvas.dispatch(pointer('pointerdown', 50, 60, 0));
    expect(confinement.locked).toBe(true);
    await fullscreen.exit();
    expect(confinement.locked).toBe(false);
    confinement.dispose();
    expect(el.removed).toBe(true);
  });

  it('right click while confined targets the virtual cursor position', async () => {
    const { fullscreen, canvas, actions } = fsSetup();
    await fullscreen.enter();
    canvas.dispatch(pointer('pointerdown', 200, 200, 0));
    canvas.dispatch(pointer('pointerup', 200, 200, 0));
    canvas.dispatch(pointer('pointermove', 200, 200, 0, { movementX: 30, movementY: -40 }));
    actions.length = 0;
    canvas.dispatch(pointer('pointerdown', 5, 5, 2, { timeStamp: 7 }));
    expect(actions).toEqual([{ type: 'moveCommand', x: 230, y: 160, queue: false, timeStamp: 7 }]);
  });

  it('without the Pointer Lock API: no lock, normal pointer and edge pan', async () => {
    const { fullscreen, confinement, canvas, input, win } = fsSetup({ lockApi: false });
    await fullscreen.enter();
    expect(confinement.supported).toBe(false);
    canvas.dispatch(pointer('pointerdown', 10, 10, 0));
    canvas.dispatch(pointer('pointerup', 10, 10, 0));
    expect(confinement.locked).toBe(false);
    win.dispatch(pointer('pointermove', 799, 300));
    input.updateEdge(800, 600);
    expect(input.cursor.state).toBe('edgePan');
    expect(input.edgeX).toBe(1);
  });
});
