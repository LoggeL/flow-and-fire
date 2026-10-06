import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Esc menu in game (ui.md §5.15, G12): resume, settings, key overview, surrender (confirm), main menu. */
export interface GameMenuSection {
  readonly open: Signal<boolean>;
  /** The surrender confirmation is showing. */
  readonly confirmSurrender: Signal<boolean>;
  /** Single player: opening the menu pauses the sim (shown as a note). */
  readonly singlePlayer: Signal<boolean>;
}

export function createGameMenuSection(): GameMenuSection {
  return { open: signal(false), confirmSurrender: signal(false), singlePlayer: signal(true) };
}

export type GameMenuAction = 'resume' | 'settings' | 'keys' | 'surrender' | 'quit';
export const GAME_MENU_ACTIONS: readonly GameMenuAction[] = ['resume', 'settings', 'keys', 'surrender', 'quit'];
