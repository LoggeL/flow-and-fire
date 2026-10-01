import type { Mods } from './mods.ts';

export type SelectionFilterKind = 'land' | 'air' | 'factories' | 'engineers';

/** Strip commands: filters, idle buttons, control groups (ui.md §5.9, §5.10). */
export interface StripCommands {
  /** F2/F3/F4/F6; with Shift the current selection is filtered. */
  filter(kind: SelectionFilterKind, shift: boolean): void;
  /** "." next idle engineer (all = Shift+".": all idle engineers). */
  selectIdleEngineer(all: boolean): void;
  /** "," next idle factory. */
  selectIdleFactory(): void;
  /** Recall group i (0 = key 1 … 9 = key 0); Shift adds to the selection. */
  recallGroup(index: number, mods: Mods): void;
  /** Save the selection into group i (right click; add = Shift+right click / Shift+Alt+digit). */
  saveGroup(index: number, add: boolean): void;
}

export const STRIP_COMMAND_NAMES = [
  'filter',
  'selectIdleEngineer',
  'selectIdleFactory',
  'recallGroup',
  'saveGroup',
] as const satisfies readonly (keyof StripCommands)[];
