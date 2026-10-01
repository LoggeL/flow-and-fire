import type { AlertCommands } from './alerts.ts';
import { ALERT_COMMAND_NAMES } from './alerts.ts';
import type { CardCommands } from './card.ts';
import { CARD_COMMAND_NAMES } from './card.ts';
import type { EcoCommands } from './eco.ts';
import { ECO_COMMAND_NAMES } from './eco.ts';
import type { FactoryCommands } from './factory.ts';
import { FACTORY_COMMAND_NAMES } from './factory.ts';
import type { MenuCommands } from './menus.ts';
import { MENU_COMMAND_NAMES } from './menus.ts';
import type { MinimapCommands } from './minimap.ts';
import { MINIMAP_COMMAND_NAMES } from './minimap.ts';
import type { OrderCommands } from './orders.ts';
import { ORDER_COMMAND_NAMES } from './orders.ts';
import type { SelectionCommands } from './selection.ts';
import { SELECTION_COMMAND_NAMES } from './selection.ts';
import type { MatchCommands } from './status.ts';
import { MATCH_COMMAND_NAMES } from './status.ts';
import type { StripCommands } from './strip.ts';
import { STRIP_COMMAND_NAMES } from './strip.ts';

export type { AlertCommands } from './alerts.ts';
export type { CardCommands } from './card.ts';
export type { EcoCommands } from './eco.ts';
export type { FactoryCommands } from './factory.ts';
export type { MenuCommands } from './menus.ts';
export type { MinimapCommands } from './minimap.ts';
export type { OrderCommands } from './orders.ts';
export type { SelectionCommands } from './selection.ts';
export type { MatchCommands } from './status.ts';
export type { SelectionFilterKind, StripCommands } from './strip.ts';
export { LEFT_CLICK, NO_MODS, clickModsFromEvent, modsFromEvent } from './mods.ts';
export type { ClickMods, Mods } from './mods.ts';
export {
  ALERT_COMMAND_NAMES,
  CARD_COMMAND_NAMES,
  ECO_COMMAND_NAMES,
  FACTORY_COMMAND_NAMES,
  MATCH_COMMAND_NAMES,
  MENU_COMMAND_NAMES,
  MINIMAP_COMMAND_NAMES,
  ORDER_COMMAND_NAMES,
  SELECTION_COMMAND_NAMES,
  STRIP_COMMAND_NAMES,
};

/**
 * Everything the HUD can ask the game to do. Components never change state themselves (ui.md §7.6);
 * the game turns these calls into sim commands, camera or selection API calls.
 */
export type HudCommands = EcoCommands &
  MatchCommands &
  AlertCommands &
  SelectionCommands &
  FactoryCommands &
  CardCommands &
  OrderCommands &
  StripCommands &
  MinimapCommands &
  MenuCommands;

export type CommandName = keyof HudCommands;

/** Runtime list of all command names (the per-section lists are checked against the interfaces). */
export const COMMAND_NAMES: readonly CommandName[] = [
  ...ECO_COMMAND_NAMES,
  ...MATCH_COMMAND_NAMES,
  ...ALERT_COMMAND_NAMES,
  ...SELECTION_COMMAND_NAMES,
  ...FACTORY_COMMAND_NAMES,
  ...CARD_COMMAND_NAMES,
  ...ORDER_COMMAND_NAMES,
  ...STRIP_COMMAND_NAMES,
  ...MINIMAP_COMMAND_NAMES,
  ...MENU_COMMAND_NAMES,
];

// Compile-time completeness: every interface member must appear in COMMAND_NAMES.
type Missing = Exclude<CommandName, (typeof COMMAND_NAMES)[number]>;
type AssertNever<T extends never> = T;
export type CommandNamesComplete = AssertNever<Missing>;

/** Commands that do nothing (default of HudProvider). */
export function createNoopCommands(): HudCommands {
  const out: Record<string, () => void> = {};
  for (const name of COMMAND_NAMES) out[name] = () => undefined;
  return out as unknown as HudCommands;
}

export interface RecordedCall {
  readonly name: CommandName;
  readonly args: readonly unknown[];
}

export interface RecordingCommands {
  readonly commands: HudCommands;
  /** Calls in order (mutable array, cleared by clear()). */
  readonly log: RecordedCall[];
  clear(): void;
}

/**
 * Commands that record every call (tests, gallery log) and optionally delegate to `impl`
 * (e.g. a gallery story toggling model signals).
 */
export function createRecordingCommands(impl: Partial<HudCommands> = {}): RecordingCommands {
  const log: RecordedCall[] = [];
  const out: Record<string, (...args: unknown[]) => void> = {};
  const delegate = impl as Readonly<Record<string, ((...args: unknown[]) => void) | undefined>>;
  for (const name of COMMAND_NAMES) {
    out[name] = (...args: unknown[]) => {
      log.push({ name, args });
      delegate[name]?.(...args);
    };
  }
  return {
    commands: out as unknown as HudCommands,
    log,
    clear: () => {
      log.length = 0;
    },
  };
}
