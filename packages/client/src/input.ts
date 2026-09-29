/**
 * Input → action mapping (PLAN §3.2 client "Input/Action-Mapping", MS1).
 *
 * Mouse (on the canvas):
 *   left drag → boxSelect, left click (no drag) → clickSelect, right button → moveCommand,
 *   middle drag → pan, wheel → zoom (towards the cursor). The canvas context menu is suppressed.
 * Keyboard (on the window):
 *   WASD / arrow keys → continuous pan (queried per frame via `panAxisX/Y`), Ctrl/Cmd+A → selectAll,
 *   S (tap) → stop, P / Pause → togglePause, N → stepOnce (the client only sends it while paused),
 *   ^ / ` / F1 → toggleConsole.
 *
 * S is both "stop" and "pan back": a tap (released within `holdMs`) issues stop, holding it pans.
 *
 * Focus rule: while a text input (input/textarea/select/contenteditable) has focus, no game
 * action is produced and held pan keys are released. Only toggleConsole passes, so the console
 * key closes the console even while its input line is focused.
 */

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
}

export type Action =
  | { readonly type: 'pan'; readonly dxPx: number; readonly dyPx: number }
  | { readonly type: 'zoom'; readonly steps: number; readonly x: number; readonly y: number }
  | {
      readonly type: 'boxSelect';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly additive: boolean;
    }
  | { readonly type: 'clickSelect'; readonly x: number; readonly y: number; readonly additive: boolean }
  | { readonly type: 'selectAll' }
  | { readonly type: 'moveCommand'; readonly x: number; readonly y: number; readonly queue: boolean; readonly timeStamp: number }
  | { readonly type: 'stop'; readonly timeStamp: number }
  | { readonly type: 'togglePause' }
  | { readonly type: 'toggleConsole' }
  | { readonly type: 'stepOnce' };

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
}

const BTN_LEFT = 0;
const BTN_MIDDLE = 1;
const BTN_RIGHT = 2;

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

/** Pan keys (event.code) and their directions (x = right, y = forward). */
const PAN_CODES: readonly string[] = ['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'];
const PAN_DX: readonly number[] = [0, 0, 0, 0, -1, -1, 1, 1];
const PAN_DY: readonly number[] = [1, 1, -1, -1, 0, 0, 0, 0];
/** Index of the key that is both a tap action (stop) and a pan key. */
const TAP_STOP_INDEX = 2;

function isConsoleKey(ev: KeyboardEvent): boolean {
  return ev.code === 'Backquote' || ev.code === 'F1' || ev.key === '^' || ev.key === '`' || ev.key === 'F1';
}

export class InputController {
  private readonly surface: InputSurface;
  private readonly keyTarget: InputEventTarget;
  private readonly onAction: (a: Action) => void;
  private readonly onDragBox: ((box: DragBox | null) => void) | undefined;
  private readonly focusProbe: () => unknown;
  private readonly dragThreshold: number;
  private readonly holdMs: number;

  /** Keydown timeStamp per pan key (index into PAN_CODES), −1 = not held. */
  private readonly heldAt = new Float64Array(PAN_CODES.length).fill(-1);
  private heldCount = 0;
  private leftDown = false;
  private leftDragging = false;
  private leftPointer = -1;
  private leftAdditive = false;
  private startX = 0;
  private startY = 0;
  private curX = 0;
  private curY = 0;
  private middleDown = false;
  private middlePointer = -1;
  private lastX = 0;
  private lastY = 0;
  private disposed = false;

  private readonly listeners: [InputEventTarget, string, (ev: Event) => void, AddEventListenerOptions | undefined][] = [];

  constructor(surface: InputSurface, keyTarget: InputEventTarget, opts: InputOptions) {
    this.surface = surface;
    this.keyTarget = keyTarget;
    this.onAction = opts.onAction;
    this.onDragBox = opts.onDragBox;
    this.focusProbe = opts.focusProbe ?? defaultFocusProbe;
    this.dragThreshold = opts.dragThresholdPx ?? 4;
    this.holdMs = opts.holdMs ?? 180;

    this.listen(surface, 'pointerdown', (ev) => this.onPointerDown(ev as PointerEvent));
    this.listen(surface, 'pointermove', (ev) => this.onPointerMove(ev as PointerEvent));
    this.listen(surface, 'pointerup', (ev) => this.onPointerUp(ev as PointerEvent));
    this.listen(surface, 'pointercancel', (ev) => this.onPointerCancel(ev as PointerEvent));
    this.listen(surface, 'wheel', (ev) => this.onWheel(ev as WheelEvent), { passive: false });
    this.listen(surface, 'contextmenu', (ev) => ev.preventDefault());
    // Middle-click autoscroll / paste on some platforms.
    this.listen(surface, 'auxclick', (ev) => ev.preventDefault());
    this.listen(keyTarget, 'keydown', (ev) => this.onKeyDown(ev as KeyboardEvent));
    this.listen(keyTarget, 'keyup', (ev) => this.onKeyUp(ev as KeyboardEvent));
    this.listen(keyTarget, 'blur', () => this.releaseAll());
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
    return this.leftDragging;
  }

  /** Releases all held keys and buttons (e.g. when focus moves into a text field). */
  releaseAll(): void {
    this.clearHeld();
    if (this.leftDragging) this.onDragBox?.(null);
    this.leftDown = false;
    this.leftDragging = false;
    this.middleDown = false;
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
    this.heldAt.fill(-1);
    this.heldCount = 0;
  }

  private axis(nowMs: number, c: 0 | 1): number {
    if (this.heldCount === 0) return 0;
    if (this.typingFocused()) {
      this.clearHeld();
      return 0;
    }
    const dir = c === 0 ? PAN_DX : PAN_DY;
    const held = this.heldAt;
    let v = 0;
    for (let i = 0; i < held.length; i++) {
      const downAt = held[i]!;
      if (downAt < 0) continue;
      if (i === TAP_STOP_INDEX && nowMs - downAt < this.holdMs) continue;
      v += dir[i]!;
    }
    return v < -1 ? -1 : v > 1 ? 1 : v;
  }

  private local(ev: { clientX: number; clientY: number }): void {
    const r = this.surface.getBoundingClientRect();
    this.curX = ev.clientX - r.left;
    this.curY = ev.clientY - r.top;
  }

  private onPointerDown(ev: PointerEvent): void {
    this.local(ev);
    if (ev.button === BTN_MIDDLE) {
      ev.preventDefault();
      this.middleDown = true;
      this.middlePointer = ev.pointerId;
      this.lastX = this.curX;
      this.lastY = this.curY;
      this.surface.setPointerCapture?.(ev.pointerId);
      return;
    }
    if (this.typingFocused()) return;
    if (ev.button === BTN_LEFT) {
      this.leftDown = true;
      this.leftDragging = false;
      this.leftPointer = ev.pointerId;
      this.leftAdditive = ev.shiftKey;
      this.startX = this.curX;
      this.startY = this.curY;
      this.surface.setPointerCapture?.(ev.pointerId);
    } else if (ev.button === BTN_RIGHT) {
      ev.preventDefault();
      this.onAction({ type: 'moveCommand', x: this.curX, y: this.curY, queue: ev.shiftKey, timeStamp: ev.timeStamp });
    }
  }

  private onPointerMove(ev: PointerEvent): void {
    this.local(ev);
    if (this.middleDown && ev.pointerId === this.middlePointer) {
      const dx = this.curX - this.lastX;
      const dy = this.curY - this.lastY;
      this.lastX = this.curX;
      this.lastY = this.curY;
      if (dx !== 0 || dy !== 0) this.onAction({ type: 'pan', dxPx: dx, dyPx: dy });
    }
    if (this.leftDown && ev.pointerId === this.leftPointer) {
      if (!this.leftDragging) {
        const d = Math.hypot(this.curX - this.startX, this.curY - this.startY);
        if (d < this.dragThreshold) return;
        this.leftDragging = true;
      }
      this.onDragBox?.({ x0: this.startX, y0: this.startY, x1: this.curX, y1: this.curY });
    }
  }

  private onPointerUp(ev: PointerEvent): void {
    this.local(ev);
    if (ev.button === BTN_MIDDLE && this.middleDown) {
      this.middleDown = false;
      this.surface.releasePointerCapture?.(ev.pointerId);
      return;
    }
    if (ev.button !== BTN_LEFT || !this.leftDown) return;
    this.leftDown = false;
    this.surface.releasePointerCapture?.(ev.pointerId);
    const additive = this.leftAdditive || ev.shiftKey;
    if (this.leftDragging) {
      this.leftDragging = false;
      this.onDragBox?.(null);
      if (this.typingFocused()) return;
      this.onAction({
        type: 'boxSelect',
        x0: Math.min(this.startX, this.curX),
        y0: Math.min(this.startY, this.curY),
        x1: Math.max(this.startX, this.curX),
        y1: Math.max(this.startY, this.curY),
        additive,
      });
    } else {
      if (this.typingFocused()) return;
      this.onAction({ type: 'clickSelect', x: this.startX, y: this.startY, additive });
    }
  }

  private onPointerCancel(ev: PointerEvent): void {
    if (ev.pointerId === this.middlePointer) this.middleDown = false;
    if (ev.pointerId === this.leftPointer) {
      if (this.leftDragging) this.onDragBox?.(null);
      this.leftDown = false;
      this.leftDragging = false;
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    if (this.typingFocused()) return;
    this.local(ev);
    // deltaMode: 0 = pixels (≈ 100 per notch), 1 = lines (≈ 3 per notch), 2 = pages.
    const raw = ev.deltaMode === 1 ? ev.deltaY / 3 : ev.deltaMode === 2 ? ev.deltaY : ev.deltaY / 100;
    const steps = raw < -5 ? -5 : raw > 5 ? 5 : raw;
    if (steps !== 0) this.onAction({ type: 'zoom', steps, x: this.curX, y: this.curY });
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (isConsoleKey(ev)) {
      ev.preventDefault();
      if (!ev.repeat) this.onAction({ type: 'toggleConsole' });
      return;
    }
    if (this.typingFocused() || isTextInputElement(ev.target)) {
      if (this.heldCount > 0) this.clearHeld();
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod) {
      if (ev.code === 'KeyA') {
        ev.preventDefault();
        if (!ev.repeat) this.onAction({ type: 'selectAll' });
      }
      return;
    }
    if (ev.altKey) return;
    const code = ev.code;
    const pi = PAN_CODES.indexOf(code);
    if (pi >= 0) {
      ev.preventDefault();
      if (this.heldAt[pi]! < 0) {
        this.heldAt[pi] = Math.max(0, ev.timeStamp);
        this.heldCount++;
      }
      return;
    }
    if (ev.repeat) return;
    if (code === 'KeyP' || code === 'Pause') {
      ev.preventDefault();
      this.onAction({ type: 'togglePause' });
    } else if (code === 'KeyN') {
      ev.preventDefault();
      this.onAction({ type: 'stepOnce' });
    }
  }

  private onKeyUp(ev: KeyboardEvent): void {
    const pi = PAN_CODES.indexOf(ev.code);
    if (pi < 0) return;
    const downAt = this.heldAt[pi]!;
    if (downAt < 0) return;
    this.heldAt[pi] = -1;
    this.heldCount--;
    if (pi === TAP_STOP_INDEX && ev.timeStamp - downAt < this.holdMs && !this.typingFocused()) {
      this.onAction({ type: 'stop', timeStamp: ev.timeStamp });
    }
  }
}
