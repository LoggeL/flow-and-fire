/**
 * Keyboard shortcuts of the editor (DOM-free): maps a key event (KeyboardEvent.code plus modifier
 * flags) to an action. Layout independent through `code` (KeyZ is Z on QWERTY and Y on QWERTZ).
 *
 * | Keys                                    | Action                                   |
 * |-----------------------------------------|------------------------------------------|
 * | Ctrl/Cmd+Z                              | undo                                     |
 * | Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y            | redo                                     |
 * | Ctrl/Cmd+S                              | save (download .rtsmap)                  |
 * | Ctrl/Cmd+O                              | open file                                |
 * | Delete, Backspace                       | delete selection (polygon draft: remove last point) |
 * | Digit1 … Digit7                         | tools in ToolId order                    |
 * | KeyF                                    | fit the view to the map                  |
 * | KeyG                                    | toggle the grid                          |
 * | Escape                                  | cancel the current tool action, else clear the selection |
 * | Enter, NumpadEnter                      | finish the polygon being drawn           |
 *
 * While the focus is in an editable element (input, textarea, select, contenteditable) only
 * Ctrl/Cmd+S and Ctrl/Cmd+O apply (they have no text-editing meaning and would otherwise open the
 * browser's save/open dialogs); everything else belongs to the field.
 */
import type { ToolId } from '../model/types.ts';

/** Tools in Digit1..Digit7 order. */
export const TOOL_ORDER: readonly ToolId[] = ['select', 'start', 'mass', 'hydro', 'fieldCircle', 'fieldPolygon', 'delete'];

export type KeyAction =
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'save' }
  | { readonly type: 'open' }
  | { readonly type: 'delete' }
  | { readonly type: 'tool'; readonly tool: ToolId }
  | { readonly type: 'fitView' }
  | { readonly type: 'toggleGrid' }
  | { readonly type: 'cancel' }
  | { readonly type: 'confirm' };

/** The KeyboardEvent fields the keymap reads. */
export interface KeyInput {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** True for auto-repeat events (only undo/redo repeat). */
  readonly repeat?: boolean;
}

/** Action for a key event, or null if the editor does not handle it. */
export function resolveKey(e: KeyInput, editable: boolean): KeyAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    if (e.altKey) return null;
    switch (e.code) {
      case 'KeyZ':
        if (editable) return null;
        return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
      case 'KeyY':
        return editable || e.shiftKey ? null : { type: 'redo' };
      case 'KeyS':
        return e.shiftKey || e.repeat === true ? null : { type: 'save' };
      case 'KeyO':
        return e.shiftKey || e.repeat === true ? null : { type: 'open' };
      default:
        return null;
    }
  }
  if (editable || e.altKey) return null;
  if (e.repeat === true && e.code !== 'Delete' && e.code !== 'Backspace') return null;
  switch (e.code) {
    case 'Delete':
    case 'Backspace':
      return e.shiftKey ? null : { type: 'delete' };
    case 'Escape':
      return { type: 'cancel' };
    case 'Enter':
    case 'NumpadEnter':
      return { type: 'confirm' };
    case 'KeyF':
      return e.shiftKey ? null : { type: 'fitView' };
    case 'KeyG':
      return e.shiftKey ? null : { type: 'toggleGrid' };
    default:
      break;
  }
  if (!e.shiftKey && e.code.startsWith('Digit')) {
    const n = e.code.charCodeAt(5) - 49;
    if (e.code.length === 6 && n >= 0 && n < TOOL_ORDER.length) return { type: 'tool', tool: TOOL_ORDER[n]! };
  }
  return null;
}

/** True if key events on `target` belong to a text/form field (duck-typed, works without a DOM). */
export function isEditableTarget(target: unknown): boolean {
  if (target === null || typeof target !== 'object') return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  if (t.isContentEditable === true) return true;
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.includes(typeof t.type === 'string' ? t.type.toLowerCase() : 'text');
  return tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Input types without text entry: shortcuts keep working while one of them has the focus. */
const NON_TEXT_INPUTS: readonly string[] = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'];
