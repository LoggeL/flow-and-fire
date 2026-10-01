/**
 * EditorController — the tool state machine of the marker editor (TRACK-EDITOR P5). DOM-free:
 * main.ts turns pointer and key events into calls, picking/hit-testing/camera come in through a
 * `ToolEnv` (TerrainPicker, hitTestMarkers and the CameraRig in the app, fakes in tests).
 *
 * - The active tool follows `store.tool` (a switch resets the old tool: drafts are dropped, a
 *   running gesture is ended). Opening another map resets the tool as well.
 * - Only the left button without Alt reaches the tools; right/middle button, Alt+left and the wheel
 *   stay with the CameraRig.
 * - `cursor` is the terrain point under the mouse in WU (null off the map), `draft` the field being
 *   drawn (for the overlay), `cursorStyle` the CSS cursor of the canvas.
 * - Keys go through the keymap (src/app/keymap.ts); host actions (save, open, fit view, grid) are
 *   injected.
 */
import { effect, signal, type ReadonlySignal } from '@preact/signals';
import { MAP_FX_ONE } from '@faf/formats';
import type { EditorDocument } from '../model/document.ts';
import type { MarkerRef, ToolId } from '../model/types.ts';
import type { DraftField } from '../overlay/types.ts';
import { resolveKey, type KeyAction, type KeyInput } from './keymap.ts';
import type { EditorStore } from './store.ts';
import { createTools } from './tools/index.ts';
import type { PointerInput, Tool, ToolContext, ToolEnv } from './tools/types.ts';

/** Actions the controller cannot perform itself (file IO, camera, grid). */
export interface HostActions {
  save(): void;
  open(): void;
  fitView(): void;
  toggleGrid(): void;
}

export class EditorController {
  readonly store: EditorStore;
  readonly tools: Readonly<Record<ToolId, Tool>>;
  private readonly draftSig = signal<DraftField | null>(null);
  private readonly cursorSig = signal<{ readonly x: number; readonly z: number } | null>(null);
  private readonly cursorStyleSig = signal('default');
  /** Field being drawn (circle: centre [+ rim point], polygon: vertices [+ cursor]). */
  readonly draft: ReadonlySignal<DraftField | null> = this.draftSig;
  /** Terrain point under the mouse in WU, null when off the map or outside the canvas. */
  readonly cursor: ReadonlySignal<{ readonly x: number; readonly z: number } | null> = this.cursorSig;
  /** CSS cursor for the canvas. */
  readonly cursorStyle: ReadonlySignal<string> = this.cursorStyleSig;

  private readonly ctx: ToolContext;
  private readonly host: HostActions;
  private active: Tool;
  private lastSource: EditorDocument['source'] | null = null;
  private readonly disposers: (() => void)[] = [];

  constructor(store: EditorStore, env: ToolEnv, host: HostActions) {
    this.store = store;
    this.host = host;
    this.tools = createTools();
    this.active = this.tools[store.tool.peek()];
    this.ctx = {
      store,
      env,
      setDraft: (d) => {
        this.draftSig.value = d;
      },
      setHover: (r) => {
        if (!sameHover(store.hover.peek(), r)) store.hover.value = r;
      },
    };
    this.disposers.push(
      effect(() => {
        const id = store.tool.value;
        if (this.active.id === id) return;
        this.active.reset(this.ctx);
        this.active = this.tools[id];
        this.refreshCursorStyle();
      }),
      effect(() => {
        const doc = store.doc.value;
        const source = doc === null ? null : doc.source;
        if (source === this.lastSource) return;
        this.lastSource = source;
        this.active.reset(this.ctx);
        this.refreshCursorStyle();
      }),
    );
    this.refreshCursorStyle();
  }

  /** The tool that receives the pointer events. */
  get activeTool(): Tool {
    return this.active;
  }

  /** True while a tool holds the pointer (drag, press). */
  get busy(): boolean {
    return this.active.pressed;
  }

  /** Left button pressed (without Alt); true = the controller takes the pointer (capture it). */
  pointerDown(p: PointerInput): boolean {
    this.updateCursor(p);
    const handled = this.active.down(p, this.ctx);
    this.refreshCursorStyle();
    return handled;
  }

  pointerMove(p: PointerInput): void {
    this.updateCursor(p);
    this.active.move(p, this.ctx);
    this.refreshCursorStyle();
  }

  pointerUp(p: PointerInput): void {
    this.updateCursor(p);
    this.active.up(p, this.ctx);
    this.refreshCursorStyle();
  }

  /** Pointer lost without a release (pointercancel, blur): like Escape for the running action. */
  pointerCancel(): void {
    if (this.active.pressed) this.active.cancel(this.ctx);
    this.refreshCursorStyle();
  }

  /** Mouse left the canvas: no cursor position and no hover (unless a drag is running). */
  pointerLeave(): void {
    if (this.active.pressed) return;
    this.cursorSig.value = null;
    this.ctx.setHover(null);
  }

  doubleClick(p: PointerInput): void {
    this.active.doubleClick(p, this.ctx);
    this.refreshCursorStyle();
  }

  /** Handles a key event; true = handled (the caller prevents the browser default). */
  handleKey(e: KeyInput, editable: boolean): boolean {
    const action = resolveKey(e, editable);
    return action === null ? false : this.run(action);
  }

  /** Executes a key action; true if it was consumed. */
  run(action: KeyAction): boolean {
    const store = this.store;
    const busy = this.active.pressed;
    switch (action.type) {
      case 'undo':
        if (!busy) store.undo();
        return true;
      case 'redo':
        if (!busy) store.redo();
        return true;
      case 'save':
        if (!busy) this.host.save();
        return true;
      case 'open':
        if (!busy) this.host.open();
        return true;
      case 'delete':
        if (busy) return true;
        if (!this.active.backspace(this.ctx)) store.deleteSelection();
        return true;
      case 'tool':
        if (!busy) store.tool.value = action.tool;
        return true;
      case 'fitView':
        this.host.fitView();
        return true;
      case 'toggleGrid':
        this.host.toggleGrid();
        return true;
      case 'cancel': {
        const done = this.active.cancel(this.ctx);
        if (!done && store.selection.peek().length > 0) store.select([]);
        this.refreshCursorStyle();
        return true;
      }
      case 'confirm': {
        if (busy) return false;
        const done = this.active.confirm(this.ctx);
        this.refreshCursorStyle();
        return done;
      }
    }
  }

  dispose(): void {
    this.active.reset(this.ctx);
    for (const d of this.disposers.splice(0)) d();
  }

  private updateCursor(p: PointerInput): void {
    const at = this.ctx.env.pick(p.x, p.y);
    const prev = this.cursorSig.peek();
    if (at === null) {
      if (prev !== null) this.cursorSig.value = null;
      return;
    }
    const x = at.x / MAP_FX_ONE;
    const z = at.z / MAP_FX_ONE;
    if (prev === null || prev.x !== x || prev.z !== z) this.cursorSig.value = { x, z };
  }

  private refreshCursorStyle(): void {
    const c = this.active.cursor(this.ctx);
    if (this.cursorStyleSig.peek() !== c) this.cursorStyleSig.value = c;
  }
}

function sameHover(a: MarkerRef | null, b: MarkerRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type || a.index !== b.index) return false;
  return a.type !== 'fieldVertex' || (b.type === 'fieldVertex' && a.vertex === b.vertex);
}
