/**
 * Keyboard shortcuts of the editor (DOM-free): maps a key event to an action.
 *
 * Letter shortcuts (Z, Y, S, O, F, G) follow the printed character (`KeyboardEvent.key`), not the
 * physical key position: on QWERTZ the key labelled Z reports code 'KeyY', and Ctrl/Cmd+Z must
 * still undo there. `code` is only the fallback when `key` is not a Latin letter (non-Latin
 * layouts, or synthetic events without `key`). Non-letter keys (Delete, Escape, Enter, digits)
 * use `code`, which is layout independent for them (Digit1 is also AZERTY's '&' key).
 *
 * | Keys                                    | Action                                   |
 * |-----------------------------------------|------------------------------------------|
 * | Ctrl/Cmd+Z                              | undo                                     |
 * | Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y            | redo                                     |
 * | Ctrl/Cmd+S                              | save (download .rtsmap)                  |
 * | Ctrl/Cmd+O                              | open file                                |
 * | Delete, Backspace                       | delete selection (polygon draft: remove last point) |
 * | Digit1 … Digit7                         | tools in ToolId order                    |
 * | F                                       | fit the view to the map                  |
 * | G                                       | toggle the grid                          |
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
  /** The produced character (KeyboardEvent.key); drives letter shortcuts. Optional: code fallback. */
  readonly key?: string;
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
  const letter = letterOf(e);
  if (mod) {
    if (e.altKey) return null;
    switch (letter) {
      case 'z':
        if (editable) return null;
        return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
      case 'y':
        return editable || e.shiftKey ? null : { type: 'redo' };
      case 's':
        return e.shiftKey || e.repeat === true ? null : { type: 'save' };
      case 'o':
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
    default:
      break;
  }
  switch (letter) {
    case 'f':
      return e.shiftKey ? null : { type: 'fitView' };
    case 'g':
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

/**
 * Lower-case Latin letter of a key event: from `key` when it is one, else from a `KeyA`..`KeyZ`
 * code (non-Latin layouts, where `key` is e.g. a Cyrillic letter), else null.
 */
export function letterOf(e: KeyInput): string | null {
  const key = e.key;
  if (key !== undefined && key.length === 1) {
    const lower = key.toLowerCase();
    if (lower >= 'a' && lower <= 'z') return lower;
  }
  if (e.code.length === 4 && e.code.startsWith('Key')) {
    const c = e.code.charAt(3).toLowerCase();
    if (c >= 'a' && c <= 'z') return c;
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
