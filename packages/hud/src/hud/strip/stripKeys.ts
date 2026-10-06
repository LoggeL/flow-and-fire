/**
 * Global keys of the strip (ui.md §7.2 „Globale Tasten“, §5.9, §5.10): selection filters F2/F3/F4/F6,
 * idle engineer „.“ / Shift+„.“, idle factory „,“ and control groups 1–0 (recall, Shift = add to
 * selection, Alt = save, Shift+Alt = add). Pure; bound by physical key code like the grid.
 */
import type { SelectionFilterKind } from '../../commands/strip.ts';
import type { Mods } from '../../commands/mods.ts';
import { SELECTION_FILTERS, groupIndexOfCode } from '../../model/strip.ts';
import type { KeyInput } from '../card/gridKeys.ts';

export type StripKeyAction =
  | { readonly kind: 'filter'; readonly filter: SelectionFilterKind; readonly shift: boolean }
  | { readonly kind: 'idleEngineer'; readonly all: boolean }
  | { readonly kind: 'idleFactory' }
  | { readonly kind: 'recallGroup'; readonly index: number; readonly mods: Mods }
  | { readonly kind: 'saveGroup'; readonly index: number; readonly add: boolean }
  | { readonly kind: 'none' };

const NONE: StripKeyAction = { kind: 'none' };

/**
 * Resolves a strip key. Text fields and modals own the keyboard (layers 1–2). Ctrl/⌘ + digit stays with
 * the browser (tab switching) unless the game holds a keyboard lock – that path is the game's (ui.md §5.10).
 */
export function resolveStripKey(input: KeyInput, ctx: { readonly textFocus: boolean; readonly modal: boolean }): StripKeyAction {
  if (ctx.textFocus || ctx.modal || input.type === 'keyup') return NONE;
  const ctrl = input.ctrl || input.meta;
  const filter = SELECTION_FILTERS.find((f) => f.code === input.code);
  if (filter !== undefined) return ctrl || input.alt ? NONE : { kind: 'filter', filter: filter.kind, shift: input.shift };
  if (input.code === 'Period' && !ctrl && !input.alt) return { kind: 'idleEngineer', all: input.shift };
  if (input.code === 'Comma' && !ctrl && !input.alt && !input.shift) return { kind: 'idleFactory' };
  const index = groupIndexOfCode(input.code);
  if (index === null || ctrl) return NONE;
  if (input.repeat === true) return NONE;
  if (input.alt) return { kind: 'saveGroup', index, add: input.shift };
  return { kind: 'recallGroup', index, mods: { shift: input.shift, ctrl: false, alt: false } };
}

/** Alt+digit must not reach the browser (Linux tab switching, ui.md §5.10); filters and „.“/„,“ are consumed. */
export function stripShouldPreventDefault(action: StripKeyAction): boolean {
  return action.kind !== 'none';
}
