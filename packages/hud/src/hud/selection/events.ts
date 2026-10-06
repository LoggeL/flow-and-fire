import type { ClickMods } from '../../commands/mods.ts';
import { clickModsFromEvent } from '../../commands/mods.ts';

/**
 * Click modifiers of a `click` or `contextmenu` event. On macOS, Ctrl+left click opens the context menu
 * instead of clicking (no `click` event follows), so a `contextmenu` with button 0 counts as a left click
 * with Ctrl, which keeps "Strg+Klick" working there.
 */
export function pointerMods(e: MouseEvent): ClickMods {
  const m = clickModsFromEvent(e);
  if (e.type === 'contextmenu' && e.button === 0) return { ...m, button: 0, ctrl: true };
  if (e.type === 'contextmenu') return { ...m, button: 2 };
  return m;
}

/** Closest element with the data attribute `name` below `root` (event delegation, one listener per list). */
export function closestData(target: EventTarget | null, root: Element, name: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(`[data-${name}]`);
  return el !== null && root.contains(el) ? el : null;
}
