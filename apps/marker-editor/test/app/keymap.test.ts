/** Keyboard shortcuts: keymap table (resolveKey) and their execution by the controller. */
import { describe, expect, it } from 'vitest';
import { MAP_FX_ONE as FX } from '@faf/formats';
import { isEditableTarget, resolveKey, TOOL_ORDER, type KeyInput } from '../../src/app/keymap.ts';
import { at, bytesEqual, click, rig } from './support.ts';

function k(code: string, mods: Partial<Omit<KeyInput, 'code'>> = {}): KeyInput {
  return { code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('resolveKey', () => {
  it('maps the documented shortcuts (Ctrl and Cmd alike)', () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(resolveKey(k('KeyZ', mod), false)).toEqual({ type: 'undo' });
      expect(resolveKey(k('KeyZ', { ...mod, shiftKey: true }), false)).toEqual({ type: 'redo' });
      expect(resolveKey(k('KeyY', mod), false)).toEqual({ type: 'redo' });
      expect(resolveKey(k('KeyS', mod), false)).toEqual({ type: 'save' });
      expect(resolveKey(k('KeyO', mod), false)).toEqual({ type: 'open' });
    }
    expect(resolveKey(k('Delete'), false)).toEqual({ type: 'delete' });
    expect(resolveKey(k('Backspace'), false)).toEqual({ type: 'delete' });
    expect(resolveKey(k('KeyF'), false)).toEqual({ type: 'fitView' });
    expect(resolveKey(k('KeyG'), false)).toEqual({ type: 'toggleGrid' });
    expect(resolveKey(k('Escape'), false)).toEqual({ type: 'cancel' });
    expect(resolveKey(k('Enter'), false)).toEqual({ type: 'confirm' });
    expect(resolveKey(k('NumpadEnter'), false)).toEqual({ type: 'confirm' });
  });

  it('Digit1..Digit7 select the tools in ToolId order', () => {
    expect(TOOL_ORDER).toEqual(['select', 'start', 'mass', 'hydro', 'fieldCircle', 'fieldPolygon', 'delete']);
    for (let i = 0; i < 7; i++) expect(resolveKey(k(`Digit${i + 1}`), false)).toEqual({ type: 'tool', tool: TOOL_ORDER[i] });
    expect(resolveKey(k('Digit8'), false)).toBeNull();
    expect(resolveKey(k('Digit0'), false)).toBeNull();
    expect(resolveKey(k('Digit1', { shiftKey: true }), false)).toBeNull();
    expect(resolveKey(k('Digit1', { ctrlKey: true }), false)).toBeNull();
    expect(resolveKey(k('Numpad1'), false)).toBeNull();
  });

  it('leaves camera keys, Alt combos, repeats and unknown keys alone', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'Space', 'Tab']) expect(resolveKey(k(code), false)).toBeNull();
    expect(resolveKey(k('KeyZ', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(resolveKey(k('KeyF', { altKey: true }), false)).toBeNull();
    expect(resolveKey(k('KeyG', { repeat: true }), false)).toBeNull();
    expect(resolveKey(k('KeyS', { ctrlKey: true, repeat: true }), false)).toBeNull();
    expect(resolveKey(k('KeyZ', { ctrlKey: true, repeat: true }), false)).toEqual({ type: 'undo' });
    expect(resolveKey(k('Delete', { repeat: true }), false)).toEqual({ type: 'delete' });
  });

  it('in editable fields only save/open apply', () => {
    for (const code of ['KeyZ', 'KeyY', 'Delete', 'Backspace', 'Escape', 'Enter', 'KeyF', 'KeyG', 'Digit1']) {
      expect(resolveKey(k(code), true)).toBeNull();
      expect(resolveKey(k(code, { ctrlKey: true }), true)).toBeNull();
    }
    expect(resolveKey(k('KeyS', { ctrlKey: true }), true)).toEqual({ type: 'save' });
    expect(resolveKey(k('KeyO', { metaKey: true }), true)).toEqual({ type: 'open' });
  });

  it('isEditableTarget recognises text fields but not checkboxes or buttons', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window_like())).toBe(false);
  });
});

function window_like(): unknown {
  return { addEventListener: () => undefined };
}

describe('controller key handling', () => {
  it('undo / redo / delete / tools / escape act on the store; host actions are forwarded', () => {
    const r = rig();
    const key = (code: string, mods: Partial<Omit<KeyInput, 'code'>> = {}, editable = false): boolean => r.ctl.handleKey(k(code, mods), editable);
    click(r, at(r, 116, 100));
    expect(key('Delete')).toBe(true);
    expect(r.store.undoDepth.value).toBe(1);
    expect(key('KeyZ', { ctrlKey: true })).toBe(true);
    expect(bytesEqual(r.store.exportBytes(), r.original)).toBe(true);
    expect(key('KeyZ', { metaKey: true, shiftKey: true })).toBe(true);
    expect(r.store.undoDepth.value).toBe(1);
    key('KeyZ', { ctrlKey: true });
    expect(key('KeyY', { ctrlKey: true })).toBe(true);
    expect(r.store.redoDepth.value).toBe(0);

    expect(key('Digit3')).toBe(true);
    expect(r.store.tool.value).toBe('mass');
    expect(key('Digit7')).toBe(true);
    expect(r.store.tool.value).toBe('delete');
    key('Digit1');

    key('KeyF');
    key('KeyG');
    key('KeyS', { ctrlKey: true });
    key('KeyO', { metaKey: true });
    key('KeyS', { ctrlKey: true }, true);
    expect(r.host.calls).toEqual(['fitView', 'toggleGrid', 'save', 'open', 'save']);

    // Typing in a field: no undo, no delete.
    click(r, at(r, 96, 96));
    expect(key('Backspace', {}, true)).toBe(false);
    expect(key('KeyZ', { ctrlKey: true }, true)).toBe(false);
    expect(r.store.doc.value!.starts).toHaveLength(2);
    expect(key('Escape')).toBe(true);
    expect(r.store.selection.value).toEqual([]);
    expect(key('Enter')).toBe(false);
  });

  it('Backspace in the polygon tool removes the last vertex instead of deleting the selection', () => {
    const r = rig();
    r.store.select([{ type: 'spot', index: 0 }]);
    r.store.tool.value = 'fieldPolygon';
    click(r, at(r, 240, 180));
    click(r, at(r, 260, 180));
    expect(r.ctl.handleKey(k('Backspace'), false)).toBe(true);
    expect(r.ctl.draft.value?.points[0]).toEqual({ x: 240 * FX, z: 180 * FX });
    expect(r.store.doc.value!.spots).toHaveLength(18);
    r.ctl.handleKey(k('Backspace'), false);
    expect(r.ctl.draft.value).toBeNull();
    // Draft empty: now Delete removes the selection.
    r.ctl.handleKey(k('Delete'), false);
    expect(r.store.doc.value!.spots).toHaveLength(17);
  });

  it('ignores undo, tool switches and saving while a drag is running', () => {
    const r = rig();
    click(r, at(r, 116, 100));
    r.ctl.handleKey(k('Delete'), false);
    const p = at(r, 96, 96);
    r.ctl.pointerDown(p);
    r.ctl.pointerMove({ ...p, x: p.x + 20 });
    expect(r.ctl.busy).toBe(true);
    expect(r.ctl.handleKey(k('KeyZ', { ctrlKey: true }), false)).toBe(true);
    expect(r.ctl.handleKey(k('Digit2'), false)).toBe(true);
    expect(r.ctl.handleKey(k('KeyS', { ctrlKey: true }), false)).toBe(true);
    expect(r.store.tool.value).toBe('select');
    expect(r.host.calls).toEqual([]);
    r.ctl.pointerUp({ ...p, x: p.x + 20 });
    expect(r.store.undoDepth.value).toBe(2);
  });
});
