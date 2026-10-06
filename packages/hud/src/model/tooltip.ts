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

/** Forecast line of the resource tooltip ("leer in 7 s", "voll in 12 s", "voll", "stabil"). */
export type ResourceForecastKind = 'emptyIn' | 'fullIn' | 'full' | 'empty' | 'steady';

export interface ResourceForecast {
  readonly kind: ResourceForecastKind;
  /** Whole seconds (rounded up) for emptyIn/fullIn, 0 otherwise. */
  readonly seconds: number;
}

/** Net rates within ±0.05/s count as steady (same threshold as the grey net value). */
const FORECAST_EPS = 0.05;

/**
 * Forecast of a storage from stored/capacity and the net rate (ui.md §5.1 tooltip "leer/voll in N s"):
 * draining → empty in N s (or "empty" when already empty), filling → full in N s (or "full" at capacity),
 * otherwise steady.
 */
export function resourceForecast(stored: number, capacity: number, netPerSec: number): ResourceForecast {
  if (netPerSec < -FORECAST_EPS) {
    if (stored <= 0) return { kind: 'empty', seconds: 0 };
    return { kind: 'emptyIn', seconds: Math.ceil(stored / -netPerSec) };
  }
  if (netPerSec > FORECAST_EPS) {
    if (capacity > 0 && stored >= capacity) return { kind: 'full', seconds: 0 };
    if (capacity > 0) return { kind: 'fullIn', seconds: Math.ceil((capacity - stored) / netPerSec) };
  }
  return { kind: 'steady', seconds: 0 };
}

/**
 * The build flow of a unit exceeds what the economy can spare (ui.md §5.6/§5.12: flow demand in yellow
 * when it is larger than the current net of either resource).
 */
export function flowDemandExceedsNet(massPerS: number, energyPerS: number, massNet: number, energyNet: number): boolean {
  return (massPerS > 0 && massPerS > massNet) || (energyPerS > 0 && energyPerS > energyNet);
}
