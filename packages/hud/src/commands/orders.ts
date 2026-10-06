import type { OrderId } from '../model/orders.ts';
import type { ClickMods } from './mods.ts';

/** Order bar / order grid commands (ui.md §5.8). */
export interface OrderCommands {
  /** Arm, toggle, cycle or trigger an order (self-destruct: start/abort the countdown). */
  activateOrder(id: OrderId, mods: ClickMods): void;
}

export const ORDER_COMMAND_NAMES = ['activateOrder'] as const satisfies readonly (keyof OrderCommands)[];
