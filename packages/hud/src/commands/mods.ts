/** Modifier state of a click or key press (ui.md §7.3). */
export interface Mods {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
}

/** Mouse click with modifiers; button 0 = left, 2 = right. */
export interface ClickMods extends Mods {
  readonly button: 0 | 2;
}

export const NO_MODS: Mods = { shift: false, ctrl: false, alt: false };
export const LEFT_CLICK: ClickMods = { shift: false, ctrl: false, alt: false, button: 0 };

/** Reads modifiers from a DOM mouse/keyboard event (⌘ counts as Ctrl on macOS). */
export function modsFromEvent(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): Mods {
  return { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
}

/** Click modifiers from a mouse event; any non-primary button counts as right click. */
export function clickModsFromEvent(e: {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  button: number;
}): ClickMods {
  return { ...modsFromEvent(e), button: e.button === 0 ? 0 : 2 };
}
