import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Esc menu in game (ui.md §5.15, G12): resume, settings, key overview, surrender (confirm), main menu. */
export interface GameMenuSection {
  readonly open: Signal<boolean>;
  readonly confirmSurrender: Signal<boolean>;
}

export function createGameMenuSection(): GameMenuSection {
  return { open: signal(false), confirmSurrender: signal(false) };
}
