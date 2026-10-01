import type { ClickMods } from './mods.ts';

/** Selection panel commands (ui.md §5.5, §7.3). */
export interface SelectionCommands {
  /** Type tile click: keep only this type. */
  selectType(typeId: string): void;
  /** Shift+click on a type tile: remove the type. */
  deselectType(typeId: string): void;
  /** Ctrl+click on a type tile: only damaged units of this type. */
  selectDamagedOfType(typeId: string): void;
  /** Tab: set the focus type of a multi selection. */
  focusType(typeId: string): void;
  /**
   * Click on a single unit in the multi view (ui.md §7.3): plain = only this unit, Shift = remove it from the
   * selection, Ctrl = all of its type in the selection; `button: 2` is a right click (the game may ignore it).
   */
  selectUnit(handle: number, mods: ClickMods): void;
  /** Order chain: click centres the camera on the waypoint of order `index` (0 = running order). */
  jumpToOrder(index: number): void;
  /** Order chain: right click removes order `index` from the chain (C5; C19 drag reorder is post-MVP). */
  removeOrder(index: number): void;
}

export const SELECTION_COMMAND_NAMES = [
  'selectType',
  'deselectType',
  'selectDamagedOfType',
  'focusType',
  'selectUnit',
  'jumpToOrder',
  'removeOrder',
] as const satisfies readonly (keyof SelectionCommands)[];
