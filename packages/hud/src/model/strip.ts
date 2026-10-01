import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Strip above the dock: selection filters, idle buttons, control groups (ui.md §5.9, §5.10; C7, C14). */

export interface ControlGroupData {
  readonly count: number;
  /** Icon of the most frequent type, null when empty. */
  readonly iconTypeId: string | null;
}

export const CONTROL_GROUP_COUNT = 10;

/** Physical keys of the groups: index 0 = Digit1 … index 9 = Digit0. */
export const CONTROL_GROUP_CODES: readonly string[] = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
];

/** Group index of a digit key code (Digit1 → 0 … Digit0 → 9), or null. */
export function groupIndexOfCode(code: string): number | null {
  const i = CONTROL_GROUP_CODES.indexOf(code);
  return i < 0 ? null : i;
}

/** Selection filters (ui.md §5.9) with their function keys, in display order. */
export const SELECTION_FILTERS = [
  { kind: 'land', code: 'F2' },
  { kind: 'air', code: 'F3' },
  { kind: 'factories', code: 'F4' },
  { kind: 'engineers', code: 'F6' },
] as const;

export interface StripSection {
  /** Ten groups: index 0 = key 1 … index 9 = key 0. */
  readonly groups: Signal<readonly ControlGroupData[]>;
  readonly activeGroup: Signal<number | null>;
  /** Idle engineers (no order for ≥ 2 s, no assist; the Reeve does not count). 1 Hz. */
  readonly idleEngineers: Signal<number>;
  readonly idleFactories: Signal<number>;
}

export function emptyGroups(): readonly ControlGroupData[] {
  return Array.from({ length: CONTROL_GROUP_COUNT }, () => ({ count: 0, iconTypeId: null }));
}

/** Ten groups from a sparse list (index → data); missing indices stay empty. */
export function groupsFrom(entries: Readonly<Record<number, ControlGroupData>>): readonly ControlGroupData[] {
  return emptyGroups().map((g, i) => entries[i] ?? g);
}

/** Count badge text of the idle button (only shown when > 0; above 99 → "99+"). */
export function idleBadgeText(n: number): string {
  if (!(n > 0)) return '';
  return n > 99 ? '99+' : String(Math.trunc(n));
}

export function createStripSection(): StripSection {
  return {
    groups: signal(emptyGroups()),
    activeGroup: signal<number | null>(null),
    idleEngineers: signal(0),
    idleFactories: signal(0),
  };
}
