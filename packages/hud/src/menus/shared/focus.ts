/**
 * Keyboard helpers of the menus (ui.md §7.7, §8.5): arrows move, Enter confirms, Esc goes back, Tab moves
 * between columns; focus is always visible and lands on the primary action when a page opens.
 */
import { useLayoutEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keyboard-reachable elements inside `root` in DOM order (hidden subtrees excluded). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.closest('[hidden]') === null && el.getAttribute('aria-hidden') !== 'true');
}

/**
 * Focus trap for modals: Tab / Shift+Tab wrap around inside `root`. Returns true when the key was handled.
 */
export function trapTab(root: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== 'Tab') return false;
  const items = focusables(root);
  if (items.length === 0) {
    e.preventDefault();
    return true;
  }
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = root.ownerDocument.activeElement;
  const inside = active instanceof HTMLElement && root.contains(active);
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** True if the key event targets a text field or a native select (they keep Enter/arrows for themselves). */
export function isFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return type !== 'range' && type !== 'checkbox' && type !== 'radio';
  }
  return target.isContentEditable;
}

/** Focuses `ref` once after mount (primary action of a page, §7.7). */
export function useInitialFocus(ref: RefObject<HTMLElement>, when = true): void {
  useLayoutEffect(() => {
    if (when) ref.current?.focus({ preventScroll: true });
  }, [when]);
}
