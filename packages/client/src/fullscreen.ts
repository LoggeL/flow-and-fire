/**
 * Fullscreen toggle and pointer confinement (C11, MS2).
 *
 * - FullscreenController: `requestFullscreen()` on the game root (keeps the DOM UI overlay in
 *   fullscreen), toggled by the `toggleFullscreen` action (Alt+Enter) or a UI button.
 * - PointerConfinement: while in fullscreen, the first pointer press (a user gesture, required by
 *   the Pointer Lock API) locks the pointer to the canvas. The system cursor is hidden; a virtual
 *   cursor integrates `movementX/Y`, is clamped to the viewport and drawn as the DOM element
 *   `#faf-virtual-cursor`. Its position feeds picking, box select and edge pan, so the camera can
 *   edge-pan on multi-monitor setups without the cursor leaving the game. Esc (the browser
 *   releases the lock and/or exits fullscreen) or leaving fullscreen frees the pointer; without
 *   the Pointer Lock API the normal edge pan applies.
 *
 * DOM access goes through small structural interfaces so the logic runs in Node with fakes.
 */
/** Minimal event target (structurally the same as input.ts InputEventTarget). */
interface EventTargetLike {
  addEventListener(type: string, listener: (ev: Event) => void): void;
  removeEventListener(type: string, listener: (ev: Event) => void): void;
}

/** The document (fullscreen + pointer lock state and events). */
export interface FullscreenDocument extends EventTargetLike {
  readonly fullscreenElement?: unknown;
  exitFullscreen?(): Promise<void>;
  readonly pointerLockElement?: unknown;
  exitPointerLock?(): void;
  createElement?(tag: string): VirtualCursorElement;
}

/** The element that goes fullscreen (game root). */
export interface FullscreenRoot {
  requestFullscreen?(options?: { navigationUI?: 'hide' | 'show' | 'auto' }): Promise<void>;
  /** Parent of the virtual cursor (`never`: any DOM element's `appendChild` fits structurally). */
  appendChild?(child: never): unknown;
}

/** The canvas that captures the pointer. */
export interface LockableCanvas {
  requestPointerLock?(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
  getBoundingClientRect(): { readonly left: number; readonly top: number };
}

/** Minimal element used for the virtual cursor. */
export interface VirtualCursorElement {
  id: string;
  className: string;
  innerHTML?: string;
  readonly style: { [k: string]: string } | CSSStyleDeclaration;
  remove?(): void;
}

export const VIRTUAL_CURSOR_ID = 'faf-virtual-cursor';

const ARROW_SVG =
  '<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>';

export class FullscreenController {
  private readonly root: FullscreenRoot;
  private readonly doc: FullscreenDocument;
  private readonly listeners: ((active: boolean) => void)[] = [];
  private readonly onChangeEv = (): void => {
    const a = this.active;
    for (const l of [...this.listeners]) l(a);
  };
  private disposed = false;

  constructor(root: FullscreenRoot, doc: FullscreenDocument) {
    this.root = root;
    this.doc = doc;
    doc.addEventListener('fullscreenchange', this.onChangeEv);
  }

  /** Fullscreen API available on the root. */
  get supported(): boolean {
    return typeof this.root.requestFullscreen === 'function';
  }

  /** True while the game root (or anything) is fullscreen. */
  get active(): boolean {
    const el = this.doc.fullscreenElement;
    return el !== undefined && el !== null;
  }

  /** Enters fullscreen (must run inside a user gesture). Resolves false if unsupported/denied. */
  async enter(): Promise<boolean> {
    if (this.active) return true;
    if (!this.supported) return false;
    try {
      await this.root.requestFullscreen!({ navigationUI: 'hide' });
      return true;
    } catch {
      return false;
    }
  }

  async exit(): Promise<void> {
    if (!this.active || typeof this.doc.exitFullscreen !== 'function') return;
    try {
      await this.doc.exitFullscreen();
    } catch {
      // already left (e.g. Esc raced us)
    }
  }

  /** Toggles fullscreen; resolves with the requested state (true = entered). */
  async toggle(): Promise<boolean> {
    if (this.active) {
      await this.exit();
      return false;
    }
    return this.enter();
  }

  /** Subscribes to fullscreen changes; returns the unsubscribe function. */
  onChange(cb: (active: boolean) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.doc.removeEventListener('fullscreenchange', this.onChangeEv);
    this.listeners.length = 0;
  }
}

export interface PointerConfinementOptions {
  readonly canvas: LockableCanvas;
  readonly doc: FullscreenDocument;
  readonly fullscreen: FullscreenController;
  /** Viewport size in CSS px (the canvas client size). */
  readonly viewport: () => { readonly width: number; readonly height: number };
  /** Parent of the virtual cursor element (inside the fullscreen root); default: the root. */
  readonly container?: FullscreenRoot;
  /** false disables confinement entirely (normal pointer, normal edge pan). Default true. */
  readonly enabled?: boolean;
}

export class PointerConfinement {
  /** Virtual cursor in CSS px relative to the canvas (valid while `locked`). */
  x = 0;
  y = 0;
  /** True while the pointer is locked to the canvas. */
  locked = false;
  enabled: boolean;
  /** Lock requests / lock errors so far (diagnostics). */
  requests = 0;
  errors = 0;

  private readonly canvas: LockableCanvas;
  private readonly doc: FullscreenDocument;
  private readonly fullscreen: FullscreenController;
  private readonly viewport: () => { readonly width: number; readonly height: number };
  private readonly container: FullscreenRoot | undefined;
  private cursorEl: VirtualCursorElement | null = null;
  private cursorClass = 'default';
  private readonly unsubscribeFs: () => void;
  private readonly onLockChange = (): void => this.syncLock();
  private readonly onLockError = (): void => {
    this.errors++;
    this.syncLock();
  };
  private disposed = false;

  constructor(opts: PointerConfinementOptions) {
    this.canvas = opts.canvas;
    this.doc = opts.doc;
    this.fullscreen = opts.fullscreen;
    this.viewport = opts.viewport;
    this.container = opts.container;
    this.enabled = opts.enabled ?? true;
    this.doc.addEventListener('pointerlockchange', this.onLockChange);
    this.doc.addEventListener('pointerlockerror', this.onLockError);
    this.unsubscribeFs = this.fullscreen.onChange((active) => {
      if (!active) this.release();
    });
  }

  /** Pointer Lock API available. */
  get supported(): boolean {
    return typeof this.canvas.requestPointerLock === 'function';
  }

  /**
   * Pointer pressed on the canvas (user gesture): in fullscreen without a lock, request one and
   * start the virtual cursor at the press position. Returns true if a lock was requested.
   */
  onPointerDown(clientX: number, clientY: number): boolean {
    if (!this.enabled || this.locked || !this.fullscreen.active || !this.supported) return false;
    const r = this.canvas.getBoundingClientRect();
    this.setPos(clientX - r.left, clientY - r.top);
    this.requests++;
    try {
      const p = this.canvas.requestPointerLock!();
      if (p !== undefined && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          this.errors++;
          this.syncLock();
        });
      }
    } catch {
      this.errors++;
      return false;
    }
    return true;
  }

  /** Relative mouse movement while locked: moves the virtual cursor (clamped to the viewport). */
  onMovement(dx: number, dy: number): void {
    if (!this.locked) return;
    this.setPos(this.x + dx, this.y + dy);
  }

  /** Mirrors the cursor state (CSS cursor name) onto the virtual cursor element as a class. */
  setCursorStyle(css: string): void {
    if (css === this.cursorClass) return;
    this.cursorClass = css;
    if (this.cursorEl !== null) this.cursorEl.className = `faf-cursor-${css}`;
  }

  /** Releases the lock (Esc is handled by the browser; this is for leaving fullscreen / dispose). */
  release(): void {
    if (this.doc.pointerLockElement === this.canvas && typeof this.doc.exitPointerLock === 'function') this.doc.exitPointerLock();
    this.locked = false;
    this.showCursor(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.unsubscribeFs();
    this.doc.removeEventListener('pointerlockchange', this.onLockChange);
    this.doc.removeEventListener('pointerlockerror', this.onLockError);
    this.cursorEl?.remove?.();
    this.cursorEl = null;
  }

  // ---- internals ------------------------------------------------------------------------------

  private syncLock(): void {
    const locked = this.doc.pointerLockElement === this.canvas && this.doc.pointerLockElement !== undefined;
    this.locked = locked;
    this.showCursor(locked);
  }

  private setPos(x: number, y: number): void {
    const v = this.viewport();
    const w = Math.max(1, v.width);
    const h = Math.max(1, v.height);
    this.x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
    this.y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
    const el = this.cursorEl;
    if (el !== null && this.locked) {
      const r = this.canvas.getBoundingClientRect();
      (el.style as Record<string, string>)['transform'] = `translate(${r.left + this.x}px, ${r.top + this.y}px)`;
    }
  }

  private showCursor(on: boolean): void {
    if (on && this.cursorEl === null) this.cursorEl = this.createCursor();
    const el = this.cursorEl;
    if (el === null) return;
    const st = el.style as Record<string, string>;
    st['display'] = on ? 'block' : 'none';
    if (on) this.setPos(this.x, this.y);
  }

  private createCursor(): VirtualCursorElement | null {
    const parent = this.container;
    if (typeof this.doc.createElement !== 'function' || parent === undefined || typeof parent.appendChild !== 'function') return null;
    const el = this.doc.createElement('div');
    el.id = VIRTUAL_CURSOR_ID;
    el.className = `faf-cursor-${this.cursorClass}`;
    el.innerHTML = ARROW_SVG;
    const st = el.style as Record<string, string>;
    st['position'] = 'fixed';
    st['left'] = '0';
    st['top'] = '0';
    st['width'] = '20px';
    st['height'] = '20px';
    st['pointerEvents'] = 'none';
    st['zIndex'] = '2147483647';
    st['willChange'] = 'transform';
    parent.appendChild(el as never);
    return el;
  }
}
