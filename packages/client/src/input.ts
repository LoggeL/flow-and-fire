/**
 * Input → actions (PLAN §3.2 client "Input/Action-Mapping"; MS1 + MS2: G16, C1, C11).
 *
 * Mouse (on the canvas), routed through the CursorFsm:
 *   left drag → boxSelect, left click (no drag) → clickSelect (a second click within
 *   `doubleClickMs` and `doubleClickPx` has `double: true`), right button → moveCommand,
 *   middle drag → grabStart / pan (the camera grabs the terrain) / grabEnd,
 *   Ctrl + middle drag → rotate, wheel → zoom (towards the cursor).
 *   The canvas context menu and middle-click autoscroll are suppressed; a press focuses the canvas.
 * Keyboard (on the window), via ActionMap (`KeyboardEvent.code` only, never `key`):
 *   WASD / arrows → continuous pan (queried per frame via `panAxisX/Y`), Ctrl/⌘+A → selectAll,
 *   S tapped → stop, P / Pause → togglePause, N → stepOnce, ^ / ` / F1 → toggleConsole,
 *   H → jumpToCommander, Home → resetCamera, Alt+Enter → toggleFullscreen, Esc → deselect,
 *   digits → controlGroup (store Ctrl/Alt+digit, add Shift+Ctrl/Alt+digit, recall digit,
 *   recall-add Shift+digit; the group number comes from the key code).
 *   A key bound to a pan direction and to another action (S) is "tap vs. hold": released within
 *   `holdMs` ⇒ the action, held longer ⇒ pan (from `holdMs` on).
 * Edge pan (per frame via `updateEdge`): pointer within `edgeMarginPx` of the canvas edge, only
 *   while the window is focused and the pointer is inside it (or confined by pointer lock); off on
 *   blur. With PointerConfinement (fullscreen + pointer lock) the virtual cursor replaces the
 *   client coordinates for every pointer action.
 *
 * Focus rule: while a text input (input/textarea/select/contenteditable) has focus, no game action
 * is produced and held keys are released. Only toggleConsole passes, so the console key closes the
 * console even while its input line is focused.
 */
import { ActionMap, CONTROL_GROUP_ACTIONS, PAN_ACTIONS, type KeyAction } from './actions.ts';
import { controlGroupOfCode, type ControlGroupOp } from './control-groups.ts';
import { CursorFsm, cursorCss, type CursorEvent } from './cursor-fsm.ts';
import type { PointerConfinement } from './fullscreen.ts';

/** Minimal event target (canvas element, window, document, or a test fake). */
export interface InputEventTarget {
  addEventListener(type: string, listener: (ev: Event) => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: (ev: Event) => void, options?: EventListenerOptions | boolean): void;
}

/** The surface receiving mouse input (the game canvas). */
export interface InputSurface extends InputEventTarget {
  getBoundingClientRect(): { readonly left: number; readonly top: number };
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  focus?(options?: { preventScroll?: boolean }): void;
  readonly clientWidth?: number;
  readonly clientHeight?: number;
  /** CSS cursor (DOM canvas). */
  readonly style?: { cursor: string } | CSSStyleDeclaration;
}

export type Action =
  | { readonly type: 'pan'; readonly dxPx: number; readonly dyPx: number; readonly x: number; readonly y: number }
  | { readonly type: 'grabStart'; readonly x: number; readonly y: number }
  | { readonly type: 'grabEnd' }
  | { readonly type: 'rotate'; readonly dxPx: number; readonly dyPx: number }
  | { readonly type: 'zoom'; readonly steps: number; readonly x: number; readonly y: number }
  | {
      readonly type: 'boxSelect';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly additive: boolean;
    }
  | {
      readonly type: 'clickSelect';
      readonly x: number;
      readonly y: number;
      /** Shift held: toggle (single click) / add (double click). */
      readonly additive: boolean;
      /** Second click of a double click (same button, close in time and space). */
      readonly double: boolean;
    }
  | { readonly type: 'selectAll' }
  | { readonly type: 'moveCommand'; readonly x: number; readonly y: number; readonly queue: boolean; readonly timeStamp: number }
  | { readonly type: 'stop'; readonly timeStamp: number }
  | { readonly type: 'togglePause' }
  | { readonly type: 'toggleConsole' }
  | { readonly type: 'stepOnce' }
  | { readonly type: 'jumpToCommander' }
  | { readonly type: 'resetCamera' }
  | { readonly type: 'toggleFullscreen' }
  | { readonly type: 'deselect' }
  | { readonly type: 'controlGroup'; readonly op: ControlGroupOp; readonly group: number; readonly timeStamp: number };

export type ActionType = Action['type'];

/** Rectangle of an active left-drag in CSS pixels (for the UI's selection box). */
export interface DragBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface InputOptions {
  /** Called for every produced action. */
  readonly onAction: (a: Action) => void;
  /** Selection-box feedback for the UI: the current rectangle while dragging, null when done. */
  readonly onDragBox?: (box: DragBox | null) => void;
  /** Returns the currently focused element (default: `document.activeElement`). */
  readonly focusProbe?: () => unknown;
  /** Pixels the pointer must travel before a left press becomes a box drag (default 4). */
  readonly dragThresholdPx?: number;
  /** Tap/hold threshold for keys that are both an action and a pan key (S), in ms (default 180). */
  readonly holdMs?: number;
  /** Key bindings (default: DEFAULT_ACTION_MAP). */
  readonly actionMap?: ActionMap;
  /** Fullscreen pointer confinement (virtual cursor). */
  readonly confinement?: PointerConfinement | null;
  /** Edge-pan band in CSS px (default 8). */
  readonly edgeMarginPx?: number;
  /** Edge pan on/off (default true). */
  readonly edgePan?: boolean;
  /** Initial window focus (default `document.hasFocus()`, else true). */
  readonly hasFocus?: () => boolean;
  /** Max time between the two clicks of a double click in ms (default 400). */
  readonly doubleClickMs?: number;
  /** Max pointer travel between the two clicks of a double click in CSS px (default 6). */
  readonly doubleClickPx?: number;
}

const BTN_LEFT = 0;
const BTN_MIDDLE = 1;
const BTN_RIGHT = 2;
const MAX_HELD = 16;

const NON_TEXT_INPUT_TYPES = ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'];

/** True if `el` is an element that takes text input (focus rule). */
export function isTextInputElement(el: unknown): boolean {
  if (el === null || typeof el !== 'object') return false;
  const e = el as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (e.isContentEditable === true) return true;
  if (typeof e.tagName !== 'string') return false;
  const tag = e.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = typeof e.type === 'string' ? e.type.toLowerCase() : 'text';
  return !NON_TEXT_INPUT_TYPES.includes(type);
}

function defaultFocusProbe(): unknown {
  const d = (globalThis as { document?: { activeElement?: unknown } }).document;
  return d?.activeElement ?? null;
}

function defaultHasFocus(): boolean {
  const d = (globalThis as { document?: { hasFocus?: () => boolean } }).document;
  return typeof d?.hasFocus === 'function' ? d.hasFocus() : true;
}

/** Actions fired on keydown (non-pan), mapped to Action objects (allocated once). */
const INSTANT: Partial<Record<KeyAction, Action>> = {
  selectAll: { type: 'selectAll' },
  togglePause: { type: 'togglePause' },
  stepOnce: { type: 'stepOnce' },
  toggleConsole: { type: 'toggleConsole' },
  jumpToCommander: { type: 'jumpToCommander' },
  resetCamera: { type: 'resetCamera' },
  toggleFullscreen: { type: 'toggleFullscreen' },
  deselect: { type: 'deselect' },
};

const GROUP_OPS: Partial<Record<KeyAction, ControlGroupOp>> = {
  groupStore: 'store',
  groupAdd: 'add',
  groupRecall: 'recall',
  groupRecallAdd: 'recallAdd',
};

export class InputController {
  readonly actions: ActionMap;
  readonly cursor: CursorFsm;
  /** Pointer position relative to the canvas in CSS px (virtual cursor while confined). */
  pointerX = 0;
  pointerY = 0;
  /** True once the pointer position is known and it is inside the window (or confined). */
  pointerInside = false;
  /** Window focus (edge pan only while focused). */
  windowFocused: boolean;
  edgePanEnabled: boolean;
  readonly edgeMarginPx: number;
  /** Edge-pan direction of the last `updateEdge` (x right, y forward). */
  edgeX = 0;
  edgeY = 0;

  private readonly surface: InputSurface;
  private readonly keyTarget: InputEventTarget;
  private readonly onAction: (a: Action) => void;
  private readonly onDragBox: ((box: DragBox | null) => void) | undefined;
  private readonly focusProbe: () => unknown;
  private readonly holdMs: number;
  private readonly confinement: PointerConfinement | null;

  /** Held keys: code, keydown time, pan direction, tap action (fired on a quick release). */
  private readonly heldCode: (string | null)[] = new Array<string | null>(MAX_HELD).fill(null);
  private readonly heldAt = new Float64Array(MAX_HELD);
  private readonly heldDx = new Float64Array(MAX_HELD);
  private readonly heldDy = new Float64Array(MAX_HELD);
  private readonly heldTap: (KeyAction | null)[] = new Array<KeyAction | null>(MAX_HELD).fill(null);
  private heldCount = 0;
  private leftPointer = -1;
  private leftAdditive = false;
  private startX = 0;
  private startY = 0;
  private middlePointer = -1;
  private lastX = 0;
  private lastY = 0;
  private lastCss = '';
  private disposed = false;
  private readonly doubleClickMs: number;
  private readonly doubleClickPx: number;
  private lastClickMs = Number.NEGATIVE_INFINITY;
  private lastClickX = 0;
  private lastClickY = 0;

  private readonly listeners: [InputEventTarget, string, (ev: Event) => void, AddEventListenerOptions | undefined][] = [];

  constructor(surface: InputSurface, keyTarget: InputEventTarget, opts: InputOptions) {
    this.surface = surface;
    this.keyTarget = keyTarget;
    this.onAction = opts.onAction;
    this.onDragBox = opts.onDragBox;
    this.focusProbe = opts.focusProbe ?? defaultFocusProbe;
    this.holdMs = opts.holdMs ?? 180;
    this.actions = opts.actionMap ?? new ActionMap();
    this.cursor = new CursorFsm(opts.dragThresholdPx ?? 4);
    this.confinement = opts.confinement ?? null;
    this.edgeMarginPx = opts.edgeMarginPx ?? 8;
    this.edgePanEnabled = opts.edgePan ?? true;
    this.windowFocused = (opts.hasFocus ?? defaultHasFocus)();
    this.doubleClickMs = opts.doubleClickMs ?? 400;
    this.doubleClickPx = opts.doubleClickPx ?? 6;

    this.listen(surface, 'pointerdown', (ev) => this.onPointerDown(ev as PointerEvent));
    this.listen(surface, 'pointermove', (ev) => this.onPointerMove(ev as PointerEvent));
    this.listen(surface, 'pointerup', (ev) => this.onPointerUp(ev as PointerEvent));
    this.listen(surface, 'pointercancel', (ev) => this.onPointerCancel(ev as PointerEvent));
    this.listen(surface, 'wheel', (ev) => this.onWheel(ev as WheelEvent), { passive: false });
    this.listen(surface, 'contextmenu', (ev) => ev.preventDefault());
    // Middle-click autoscroll starts on mousedown (not pointerdown) in Chromium/Windows; paste on auxclick (X11).
    this.listen(surface, 'mousedown', (ev) => {
      if ((ev as MouseEvent).button === BTN_MIDDLE) ev.preventDefault();
    });
    this.listen(surface, 'auxclick', (ev) => ev.preventDefault());
    this.listen(keyTarget, 'keydown', (ev) => this.onKeyDown(ev as KeyboardEvent));
    this.listen(keyTarget, 'keyup', (ev) => this.onKeyUp(ev as KeyboardEvent));
    this.listen(keyTarget, 'blur', () => {
      this.windowFocused = false;
      this.releaseAll();
    });
    this.listen(keyTarget, 'focus', () => {
      this.windowFocused = true;
    });
    // Pointer anywhere in the window (edge pan) and leaving it.
    this.listen(keyTarget, 'pointermove', (ev) => {
      if (this.confinement?.locked === true) return;
      this.local(ev as PointerEvent);
      this.pointerInside = true;
    });
    this.listen(keyTarget, 'pointerout', (ev) => {
      const rel = (ev as PointerEvent).relatedTarget;
      if (rel === null || rel === undefined) this.pointerInside = false;
    });
  }

  /** True while a text input has focus (focus rule). */
  typingFocused(): boolean {
    return isTextInputElement(this.focusProbe());
  }

  /** Horizontal pan axis of the held keys at time `nowMs` (−1 … 1, + = right). */
  panAxisX(nowMs: number): number {
    return this.axis(nowMs, 0);
  }

  /** Forward pan axis of the held keys at time `nowMs` (−1 … 1, + = forward/up). */
  panAxisY(nowMs: number): number {
    return this.axis(nowMs, 1);
  }

  /** True while a left-drag selection box is active. */
  get dragging(): boolean {
    return this.cursor.state === 'boxSelect';
  }

  /** True while the pointer is confined (fullscreen pointer lock, virtual cursor). */
  get confined(): boolean {
    return this.confinement?.locked === true;
  }

  /**
   * Per-frame edge scan: sets `edgeX/edgeY` (−1/0/1; y + = forward = top edge) from the pointer
   * position and updates the cursor FSM. Edge pan only with a focused window, the pointer inside
   * the window (or confined), no text field focused and no button interaction running.
   */
  updateEdge(viewWidth: number, viewHeight: number): void {
    const confined = this.confined;
    const allowed = this.edgePanEnabled && this.windowFocused && (this.pointerInside || confined) && !this.typingFocused();
    let ex = 0;
    let ey = 0;
    if (allowed) {
      const x = this.pointerX;
      const y = this.pointerY;
      const m = this.edgeMarginPx;
      if (x >= 0 && y >= 0 && x < viewWidth && y < viewHeight) {
        if (x < m) ex = -1;
        else if (x >= viewWidth - m) ex = 1;
        if (y < m) ey = 1;
        else if (y >= viewHeight - m) ey = -1;
      }
    }
    const c = this.cursor;
    c.edge(ex, ey, confined, allowed);
    this.edgeX = c.edgeX;
    this.edgeY = c.edgeY;
    this.syncCursorStyle();
  }

  /** Releases all held keys and buttons (e.g. when focus moves into a text field). */
  releaseAll(): void {
    this.clearHeld();
    this.finish(this.cursor.cancel());
    this.leftPointer = -1;
    this.middlePointer = -1;
    this.edgeX = 0;
    this.edgeY = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [t, type, l, o] of this.listeners) t.removeEventListener(type, l, o);
    this.listeners.length = 0;
    this.releaseAll();
  }

  // ---- internals ------------------------------------------------------------------------------

  private listen(t: InputEventTarget, type: string, l: (ev: Event) => void, o?: AddEventListenerOptions): void {
    t.addEventListener(type, l, o);
    this.listeners.push([t, type, l, o]);
  }

  private clearHeld(): void {
    for (let i = 0; i < MAX_HELD; i++) {
      this.heldCode[i] = null;
      this.heldTap[i] = null;
    }
    this.heldCount = 0;
  }

  private axis(nowMs: number, c: 0 | 1): number {
    if (this.heldCount === 0) return 0;
    if (this.typingFocused()) {
      this.clearHeld();
      return 0;
    }
    const dir = c === 0 ? this.heldDx : this.heldDy;
    let v = 0;
    for (let i = 0; i < MAX_HELD; i++) {
      if (this.heldCode[i] === null) continue;
      if (this.heldTap[i] !== null && nowMs - this.heldAt[i]! < this.holdMs) continue;
      v += dir[i]!;
    }
    return v < -1 ? -1 : v > 1 ? 1 : v;
  }

  /** Updates the pointer position from an event (virtual cursor while confined). */
  private local(ev: { clientX: number; clientY: number; movementX?: number; movementY?: number }, applyMovement = false): void {
    const conf = this.confinement;
    if (conf !== null && conf.locked) {
      if (applyMovement) conf.onMovement(ev.movementX ?? 0, ev.movementY ?? 0);
      this.pointerX = conf.x;
      this.pointerY = conf.y;
      return;
    }
    const r = this.surface.getBoundingClientRect();
    this.pointerX = ev.clientX - r.left;
    this.pointerY = ev.clientY - r.top;
  }

  private emit(a: Action): void {
    this.onAction(a);
  }

  private finish(e: CursorEvent): void {
    if (e === 'boxEnd') this.onDragBox?.(null);
    else if (e === 'grabEnd') this.emit({ type: 'grabEnd' });
  }

  private onPointerDown(ev: PointerEvent): void {
    // Canvas takes the keyboard focus (hotkeys work again after clicking out of a text field).
    this.surface.focus?.({ preventScroll: true });
    // A press in fullscreen is the user gesture that may lock the pointer.
    this.confinement?.onPointerDown(ev.clientX, ev.clientY);
    this.local(ev);
    this.pointerInside = true;
    const x = this.pointerX;
    const y = this.pointerY;
    if (ev.button === BTN_MIDDLE) {
      ev.preventDefault();
      const e = this.cursor.middleDown(ev.ctrlKey || ev.metaKey);
      if (e === 'none') return;
      this.middlePointer = ev.pointerId;
      this.lastX = x;
      this.lastY = y;
      if (!this.confined) this.surface.setPointerCapture?.(ev.pointerId);
      if (e === 'grabStart') this.emit({ type: 'grabStart', x, y });
      this.syncCursorStyle();
      return;
    }
    if (this.typingFocused()) return;
    if (ev.button === BTN_LEFT) {
      this.cursor.leftDown(x, y);
      this.leftPointer = ev.pointerId;
      this.leftAdditive = ev.shiftKey;
      this.startX = x;
      this.startY = y;
      if (!this.confined) this.surface.setPointerCapture?.(ev.pointerId);
    } else if (ev.button === BTN_RIGHT) {
      ev.preventDefault();
      this.emit({ type: 'moveCommand', x, y, queue: ev.shiftKey, timeStamp: ev.timeStamp });
    }
  }

  private onPointerMove(ev: PointerEvent): void {
    this.local(ev, true);
    this.pointerInside = true;
    const x = this.pointerX;
    const y = this.pointerY;
    const st = this.cursor.state;
    if ((st === 'grabPan' || st === 'rotate') && ev.pointerId === this.middlePointer) {
      const dx = x - this.lastX;
      const dy = y - this.lastY;
      // Confined rotation: the virtual cursor clamps at the edge, the raw movement does not.
      const rdx = this.confined ? (ev.movementX ?? dx) : dx;
      const rdy = this.confined ? (ev.movementY ?? dy) : dy;
      this.lastX = x;
      this.lastY = y;
      if (st === 'grabPan' && (dx !== 0 || dy !== 0)) this.emit({ type: 'pan', dxPx: dx, dyPx: dy, x, y });
      else if (st === 'rotate' && (rdx !== 0 || rdy !== 0)) this.emit({ type: 'rotate', dxPx: rdx, dyPx: rdy });
    }
    if (this.cursor.leftPressed && ev.pointerId === this.leftPointer) {
      this.cursor.move(x, y);
      if (this.cursor.state === 'boxSelect') this.onDragBox?.({ x0: this.startX, y0: this.startY, x1: x, y1: y });
    }
    this.syncCursorStyle();
  }

  private onPointerUp(ev: PointerEvent): void {
    this.local(ev);
    if (ev.button === BTN_MIDDLE) {
      const e = this.cursor.middleUp();
      if (e !== 'none') {
        this.surface.releasePointerCapture?.(ev.pointerId);
        this.middlePointer = -1;
        this.finish(e);
      }
      this.syncCursorStyle();
      return;
    }
    if (ev.button !== BTN_LEFT || !this.cursor.leftPressed) return;
    this.surface.releasePointerCapture?.(ev.pointerId);
    this.leftPointer = -1;
    const additive = this.leftAdditive || ev.shiftKey;
    const e = this.cursor.leftUp();
    this.syncCursorStyle();
    if (e === 'boxEnd') {
      this.onDragBox?.(null);
      if (this.typingFocused()) return;
      const x = this.pointerX;
      const y = this.pointerY;
      this.emit({
        type: 'boxSelect',
        x0: Math.min(this.startX, x),
        y0: Math.min(this.startY, y),
        x1: Math.max(this.startX, x),
        y1: Math.max(this.startY, y),
        additive,
      });
    } else if (e === 'click') {
      if (this.typingFocused()) return;
      const t = ev.timeStamp;
      const dx = this.startX - this.lastClickX;
      const dy = this.startY - this.lastClickY;
      const double = t - this.lastClickMs <= this.doubleClickMs && t >= this.lastClickMs && dx * dx + dy * dy <= this.doubleClickPx * this.doubleClickPx;
      // A double click consumes both clicks (a third click starts a new pair).
      this.lastClickMs = double ? Number.NEGATIVE_INFINITY : t;
      this.lastClickX = this.startX;
      this.lastClickY = this.startY;
      this.emit({ type: 'clickSelect', x: this.startX, y: this.startY, additive, double });
    }
  }

  private onPointerCancel(ev: PointerEvent): void {
    if (ev.pointerId === this.middlePointer || ev.pointerId === this.leftPointer) {
      this.finish(this.cursor.cancel());
      this.middlePointer = -1;
      this.leftPointer = -1;
      this.syncCursorStyle();
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    if (this.typingFocused()) return;
    this.local(ev);
    // deltaMode: 0 = pixels (≈ 100 per notch), 1 = lines (≈ 3 per notch), 2 = pages.
    const raw = ev.deltaMode === 1 ? ev.deltaY / 3 : ev.deltaMode === 2 ? ev.deltaY : ev.deltaY / 100;
    const steps = raw < -5 ? -5 : raw > 5 ? 5 : raw;
    if (steps !== 0) this.emit({ type: 'zoom', steps, x: this.pointerX, y: this.pointerY });
  }

  private onKeyDown(ev: KeyboardEvent): void {
    const map = this.actions;
    if (map.is('toggleConsole', ev)) {
      ev.preventDefault();
      if (!ev.repeat) this.emit(INSTANT.toggleConsole!);
      return;
    }
    if (this.typingFocused() || isTextInputElement(ev.target)) {
      if (this.heldCount > 0) this.clearHeld();
      return;
    }
    const matched = map.match(ev);
    if (matched.length === 0) return;
    const dir = map.panDirection(ev.code);
    // Chords with a required modifier (Ctrl/⌘+A, Alt+Enter) fire instantly and never pan.
    if (dir === null || map.matchesWithModifier(ev)) {
      ev.preventDefault();
      if (ev.repeat) return;
      for (const a of matched) {
        if (PAN_ACTIONS.includes(a)) continue;
        const act = INSTANT[a];
        if (act !== undefined) this.emit(act);
        else if (a === 'stop') this.emit({ type: 'stop', timeStamp: ev.timeStamp });
        else if (CONTROL_GROUP_ACTIONS.includes(a)) {
          const group = controlGroupOfCode(ev.code);
          const op = GROUP_OPS[a];
          if (group >= 0 && op !== undefined) this.emit({ type: 'controlGroup', op, group, timeStamp: ev.timeStamp });
        }
      }
      return;
    }
    ev.preventDefault();
    if (this.findHeld(ev.code) >= 0) return; // auto-repeat
    // Pan key; another action on the same key becomes its tap action (S: stop).
    let tap: KeyAction | null = null;
    for (const a of matched) if (!PAN_ACTIONS.includes(a)) tap = a;
    for (let i = 0; i < MAX_HELD; i++) {
      if (this.heldCode[i] !== null) continue;
      this.heldCode[i] = ev.code;
      this.heldAt[i] = Math.max(0, ev.timeStamp);
      this.heldDx[i] = dir[0];
      this.heldDy[i] = dir[1];
      this.heldTap[i] = tap;
      this.heldCount++;
      return;
    }
  }

  private onKeyUp(ev: KeyboardEvent): void {
    const i = this.findHeld(ev.code);
    if (i < 0) return;
    const downAt = this.heldAt[i]!;
    const tap = this.heldTap[i]!;
    this.heldCode[i] = null;
    this.heldTap[i] = null;
    this.heldCount--;
    if (tap !== null && ev.timeStamp - downAt < this.holdMs && !this.typingFocused()) {
      if (tap === 'stop') this.emit({ type: 'stop', timeStamp: ev.timeStamp });
      else {
        const act = INSTANT[tap];
        if (act !== undefined) this.emit(act);
      }
    }
  }

  private findHeld(code: string): number {
    for (let i = 0; i < MAX_HELD; i++) if (this.heldCode[i] === code) return i;
    return -1;
  }

  private syncCursorStyle(): void {
    const c = this.cursor;
    const css = cursorCss(c.state, c.edgeX, c.edgeY);
    const key = this.confined ? 'none' : css;
    if (key === this.lastCss) return;
    this.lastCss = key;
    const st = this.surface.style as { cursor: string } | undefined;
    if (st !== undefined) st.cursor = key;
    this.confinement?.setCursorStyle(css);
  }
}
