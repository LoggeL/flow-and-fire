import { Signal, effect } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { useLayoutEffect } from 'preact/hooks';
import type { Inputs } from 'preact/hooks';

/** A plain value or a signal of it (hot values are passed as signals and bound without re-render). */
export type MaybeSignal<T> = T | ReadonlySignal<T>;

export function isSignal<T>(v: MaybeSignal<T>): v is ReadonlySignal<T> {
  return v instanceof Signal;
}

/** Current value without subscribing. */
export function peekValue<T>(v: MaybeSignal<T>): T {
  return isSignal(v) ? v.peek() : v;
}

/**
 * Runs `write` in a signals effect bound to the component lifetime (ui.md §9.2: hot updates only touch
 * textContent, classes and CSS variables of leaf nodes, never re-render the component).
 */
export function useBindEffect(write: () => void, deps: Inputs): void {
  useLayoutEffect(() => effect(write), deps);
}

export function clamp01(v: number): number {
  if (!(v > 0)) return 0;
  return v > 1 ? 1 : v;
}
