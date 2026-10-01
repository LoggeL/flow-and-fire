import type { TechTier } from '../model/card.ts';
import type { SlotCode } from '../ui/keys.ts';
import type { ClickMods } from './mods.ts';

/** Command card commands (ui.md §5.6). */
export interface CardCommands {
  /** Cell click or grid key: hotbuild/placement, +1/+5 production, upgrade … */
  cardActivate(slot: SlotCode, mods: ClickMods): void;
  /** Tech tab T1–T3. */
  setTab(tier: TechTier): void;
  /** Esc / right click: leave placement or armed order mode. */
  cancelMode(): void;
}

export const CARD_COMMAND_NAMES = ['cardActivate', 'setTab', 'cancelMode'] as const satisfies readonly (keyof CardCommands)[];
