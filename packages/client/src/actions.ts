/**
 * Keyboard action mapping (G16/C11, MS2): action → list of physical keys (`KeyboardEvent.code`)
 * plus modifiers. Lookups use `code` only — never `key` — so hotkeys sit at the same physical
 * position on every layout (DE-QWERTZ: the key labelled "Y" reports `code 'KeyZ'` and triggers the
 * KeyZ action; WASD stays WASD).
 *
 * Modifier rule per binding: `anyModifiers` ignores all modifiers (held pan keys, console key);
 * otherwise Ctrl/Alt/Shift/Meta must match exactly, where `primary` means "Ctrl or Meta" (⌘ on
 * macOS) and the other of the two may then not be required.
 */

export type KeyAction =
  | 'panForward'
  | 'panBack'
  | 'panLeft'
  | 'panRight'
  | 'selectAll'
  | 'stop'
  | 'togglePause'
  | 'stepOnce'
  | 'toggleConsole'
  | 'jumpToCommander'
  | 'resetCamera'
  | 'toggleFullscreen'
  | 'deselect'
  | 'groupStore'
  | 'groupAdd'
  | 'groupRecall'
  | 'groupRecallAdd';

export const KEY_ACTIONS: readonly KeyAction[] = [
  'panForward',
  'panBack',
  'panLeft',
  'panRight',
  'selectAll',
  'stop',
  'togglePause',
  'stepOnce',
  'toggleConsole',
  'jumpToCommander',
  'resetCamera',
  'toggleFullscreen',
  'deselect',
  'groupStore',
  'groupAdd',
  'groupRecall',
  'groupRecallAdd',
];

/** Control-group actions: the group number comes from the key (`Digit3` → 3), see control-groups.ts. */
export const CONTROL_GROUP_ACTIONS: readonly KeyAction[] = ['groupStore', 'groupAdd', 'groupRecall', 'groupRecallAdd'];

/** Physical digit keys of the control groups: `Digit0`–`Digit9` and `Numpad0`–`Numpad9`. */
export const DIGIT_CODES: readonly string[] = [
  ...Array.from({ length: 10 }, (_, d) => `Digit${d}`),
  ...Array.from({ length: 10 }, (_, d) => `Numpad${d}`),
];

function digitBindings(mods: Omit<KeyBinding, 'code'>): KeyBinding[] {
  return DIGIT_CODES.map((code) => ({ code, ...mods }));
}

/** Held camera-pan actions (queried per frame, not fired). */
export const PAN_ACTIONS: readonly KeyAction[] = ['panForward', 'panBack', 'panLeft', 'panRight'];

export interface KeyBinding {
  /** `KeyboardEvent.code` (physical key). */
  readonly code: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
  /** Ctrl or Meta (⌘). */
  readonly primary?: boolean;
  /** Ignore all modifiers (held keys). */
  readonly anyModifiers?: boolean;
}

export type ActionTable = Readonly<Record<KeyAction, readonly KeyBinding[]>>;

/** Default bindings (FA-like where FA has them). */
export const DEFAULT_ACTION_MAP: ActionTable = {
  panForward: [
    { code: 'KeyW', anyModifiers: true },
    { code: 'ArrowUp', anyModifiers: true },
  ],
  panBack: [
    { code: 'KeyS', anyModifiers: true },
    { code: 'ArrowDown', anyModifiers: true },
  ],
  panLeft: [
    { code: 'KeyA', anyModifiers: true },
    { code: 'ArrowLeft', anyModifiers: true },
  ],
  panRight: [
    { code: 'KeyD', anyModifiers: true },
    { code: 'ArrowRight', anyModifiers: true },
  ],
  selectAll: [{ code: 'KeyA', primary: true }],
  // S tapped = stop (released within the hold threshold), S held = pan back.
  stop: [{ code: 'KeyS' }],
  togglePause: [{ code: 'KeyP' }, { code: 'Pause' }],
  stepOnce: [{ code: 'KeyN' }],
  // ^ on DE / ` on US; macOS ISO keyboards report that key as IntlBackslash.
  toggleConsole: [
    { code: 'Backquote', anyModifiers: true },
    { code: 'IntlBackslash', anyModifiers: true },
    { code: 'F1', anyModifiers: true },
  ],
  jumpToCommander: [{ code: 'KeyH' }],
  resetCamera: [{ code: 'Home' }],
  toggleFullscreen: [{ code: 'Enter', alt: true }],
  deselect: [{ code: 'Escape' }],
  // Store: Ctrl+digit (preventDefault; some browsers still take it for tab switching) and the
  // browser-safe Alt+digit. Never ⌘ (macOS/Safari reserve ⌘+digit).
  groupStore: [...digitBindings({ ctrl: true }), ...digitBindings({ alt: true })],
  groupAdd: [...digitBindings({ ctrl: true, shift: true }), ...digitBindings({ alt: true, shift: true })],
  groupRecall: digitBindings({}),
  groupRecallAdd: digitBindings({ shift: true }),
};

/** The fields of a KeyboardEvent the mapping looks at (no `key`). */
export interface KeyChord {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

/** True if `b` matches the chord. */
export function bindingMatches(b: KeyBinding, ev: KeyChord): boolean {
  if (b.code !== ev.code) return false;
  if (b.anyModifiers === true) return true;
  if ((b.alt === true) !== ev.altKey || (b.shift === true) !== ev.shiftKey) return false;
  if (b.primary === true) return ev.ctrlKey || ev.metaKey;
  return (b.ctrl === true) === ev.ctrlKey && (b.meta === true) === ev.metaKey;
}

/** True if the binding needs a modifier (Ctrl/Alt/Meta/primary) to be held. */
export function bindingNeedsModifier(b: KeyBinding): boolean {
  return b.anyModifiers !== true && (b.ctrl === true || b.alt === true || b.meta === true || b.primary === true);
}

/** Human-readable binding, e.g. `Alt+Enter`, `Strg/⌘+KeyA`. */
export function formatBinding(b: KeyBinding): string {
  const mods: string[] = [];
  if (b.primary === true) mods.push('Strg/⌘');
  if (b.ctrl === true) mods.push('Strg');
  if (b.meta === true) mods.push('⌘');
  if (b.alt === true) mods.push('Alt');
  if (b.shift === true) mods.push('Shift');
  return [...mods, b.code].join('+');
}

export class ActionMap {
  readonly table: ActionTable;
  private readonly entries: { action: KeyAction; binding: KeyBinding }[] = [];
  /** code → pan direction (x right, y forward) for held keys. */
  private readonly panDir = new Map<string, [number, number]>();

  /** `overrides` replace the default bindings of the given actions. */
  constructor(overrides: Partial<ActionTable> = {}) {
    const table = { ...DEFAULT_ACTION_MAP, ...overrides } as ActionTable;
    this.table = table;
    for (const action of KEY_ACTIONS) {
      for (const binding of table[action]) this.entries.push({ action, binding });
    }
    const dirs: Record<string, [number, number]> = {
      panForward: [0, 1],
      panBack: [0, -1],
      panLeft: [-1, 0],
      panRight: [1, 0],
    };
    for (const a of PAN_ACTIONS) {
      for (const b of table[a]) {
        const d = this.panDir.get(b.code) ?? [0, 0];
        this.panDir.set(b.code, [d[0] + dirs[a]![0], d[1] + dirs[a]![1]]);
      }
    }
  }

  /** All actions bound to the chord, in KEY_ACTIONS order (lookup by `code` only). */
  match(ev: KeyChord): KeyAction[] {
    const out: KeyAction[] = [];
    for (const e of this.entries) if (bindingMatches(e.binding, ev) && !out.includes(e.action)) out.push(e.action);
    return out;
  }

  /** First non-pan action bound to the chord, or null. */
  lookup(ev: KeyChord): KeyAction | null {
    for (const e of this.entries) {
      if (!PAN_ACTIONS.includes(e.action) && bindingMatches(e.binding, ev)) return e.action;
    }
    return null;
  }

  /** True if one of the chord's matching non-pan bindings requires a modifier. */
  matchesWithModifier(ev: KeyChord): boolean {
    for (const e of this.entries) {
      if (!PAN_ACTIONS.includes(e.action) && bindingNeedsModifier(e.binding) && bindingMatches(e.binding, ev)) return true;
    }
    return false;
  }

  /** Pan direction of a held key code (x right, y forward), or null if it is no pan key. */
  panDirection(code: string): readonly [number, number] | null {
    return this.panDir.get(code) ?? null;
  }

  /** True if `action` is bound to the chord. */
  is(action: KeyAction, ev: KeyChord): boolean {
    for (const b of this.table[action]) if (bindingMatches(b, ev)) return true;
    return false;
  }
}
