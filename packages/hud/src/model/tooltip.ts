import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { SlotCode } from '../ui/keys.ts';
import type { ResourceKind } from './eco.ts';
import type { OrderId } from './orders.ts';

/** Tooltip layer (ui.md §5.12, C9): one reused node, opens after 350 ms (keyboard focus at once). */

/** Where a unit tooltip is shown: build cell, factory cell, or plain info (world/selection hover). */
export type UnitTooltipMode = 'build' | 'factory' | 'info';

/** Why a grid cell is locked (same shape as the card logic's CardLock). */
export interface UnitTooltipLock {
  readonly reason: 'needBuilderTech' | 'needFactoryUpgrade';
  readonly tier: number;
}

export interface UnitTooltipTarget {
  readonly kind: 'unit';
  readonly typeId: string;
  readonly slot?: SlotCode | undefined;
  /** Build power of the current builder (cost → flow demand, build time); absent = no cost section. */
  readonly builderBp?: number | undefined;
  /** Active simulation costs, when they differ from the roster presentation defaults. */
  readonly buildCost?: { readonly mass: number; readonly energy: number; readonly buildTime: number } | undefined;
  /** Default: 'build' with a builder, 'info' without. */
  readonly mode?: UnitTooltipMode | undefined;
  readonly locked?: UnitTooltipLock | null | undefined;
  /** Translated reason of a disabled cell ("Upgrade läuft"). */
  readonly disabledReason?: string | undefined;
}

export type TooltipTarget =
  | UnitTooltipTarget
  | { readonly kind: 'order'; readonly orderId: OrderId }
  | { readonly kind: 'resource'; readonly resource: ResourceKind };

/** Anchor: above the command card, or next to a point/rect (CSS px, measured once when opening). */
export type TooltipAnchor =
  | { readonly kind: 'card' }
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export const TOOLTIP_DELAY_MS = 350;

export interface TooltipSection {
  readonly target: Signal<TooltipTarget | null>;
  readonly anchor: Signal<TooltipAnchor>;
  readonly viaKeyboard: Signal<boolean>;
}

export function createTooltipSection(): TooltipSection {
  return {
    target: signal<TooltipTarget | null>(null),
    anchor: signal<TooltipAnchor>({ kind: 'card' }),
    viaKeyboard: signal(false),
  };
}
