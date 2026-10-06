import { computed, signal } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import { EMPTY_UNIT_CATALOG } from '../data/catalog.ts';
import type { UnitCatalog } from '../data/catalog.ts';
import type { SlotCode } from '../ui/keys.ts';

/**
 * Command card (ui.md §5.6; C8, B1, U5/B4, U10). Structure on events (selection, tab, cap), queue badges
 * on queue changes, production progress at 10 Hz.
 *
 * The model only holds the inputs. The page layout (which unit on which key, tiers, locks) is derived by
 * `resolveCardPage` (src/data/card-logic.ts) in the card components (`cardSpec`, src/hud/card). The model
 * cannot import the card logic itself (the card logic imports `CardPage` from here, and dependency-cruiser
 * forbids cycles), so `page` resolves through a resolver that src/hud/card registers on import.
 */

export type CardPage = 'build' | 'production' | 'structure' | 'orders' | 'empty';

export type TechTier = 1 | 2 | 3;

export const TECH_TIERS: readonly TechTier[] = [1, 2, 3];

/** Maps the selected type ids to the card page (through the unit catalog of the model). */
export type CardPageResolver = (selectedTypes: readonly string[], units: UnitCatalog) => CardPage;

/** Fallback before src/hud/card registered the real resolver (never used through the package barrel). */
const fallbackResolver: CardPageResolver = (types) => (types.length === 0 ? 'empty' : 'orders');

let pageResolver: CardPageResolver = fallbackResolver;

/** Registers the page resolver (called once by src/hud/card with the roster-based card logic). */
export function registerCardPageResolver(resolver: CardPageResolver): void {
  pageResolver = resolver;
}

export interface CardSection {
  /**
   * Distinct type ids of the current selection (`core:…`), in selection order. The game writes this on
   * every selection event and resets `tab`, `armedSlot` and `placingTypeId` to null at the same time (the
   * HudScheduler does so whenever the snapshot's `selectedTypes` change).
   */
  readonly selectedTypes: Signal<readonly string[]>;
  /** Number of selected units (head "Befehle · N Einheiten"). */
  readonly unitCount: Signal<number>;
  /** Requested tech tab; null = highest tier the selected builders can build (ui.md §5.6). */
  readonly tab: Signal<TechTier | null>;
  /** Page for the selection (derived, see module comment). */
  readonly page: ReadonlySignal<CardPage>;
  /** Cell waiting for placement (placement mode → is-active). */
  readonly armedSlot: Signal<SlotCode | null>;
  /** Type id of the ghost being placed, null when not placing. */
  readonly placingTypeId: Signal<string | null>;
  /** Queue counts per type id of the selected factories (badges; replace the tech stripes). */
  readonly queueCounts: Signal<Readonly<Record<string, number>>>;
  /** Production progress per type id, 0..1 (10 Hz; bound to --p without re-rendering the card). */
  readonly progress: Signal<Readonly<Record<string, number>>>;
  /** Unit cap reached: unit cells are disabled with a reason (U7). */
  readonly capReached: Signal<boolean>;
  /** Cell that flashes for 140 ms after a key press or click (ui.md §7.6), null otherwise. */
  readonly flashSlot: Signal<SlotCode | null>;
  /**
   * Build power of the selected builders including assist (`20 + 15 = 35`, B2) for the flow demand in cell
   * tooltips (ui.md §5.6, §5.12); null = own build power of the head builder from the roster.
   */
  readonly buildPower: Signal<number | null>;
}

/** @param units unit catalog signal of the model (`HudModel.units`); default: a fixed empty catalog. */
export function createCardSection(units: ReadonlySignal<UnitCatalog> = signal(EMPTY_UNIT_CATALOG)): CardSection {
  const selectedTypes = signal<readonly string[]>([]);
  return {
    selectedTypes,
    unitCount: signal(0),
    tab: signal<TechTier | null>(null),
    page: computed(() => pageResolver(selectedTypes.value, units.value)),
    armedSlot: signal<SlotCode | null>(null),
    placingTypeId: signal<string | null>(null),
    queueCounts: signal<Readonly<Record<string, number>>>({}),
    progress: signal<Readonly<Record<string, number>>>({}),
    capReached: signal(false),
    flashSlot: signal<SlotCode | null>(null),
    buildPower: signal<number | null>(null),
  };
}

/** True for tiers 1–3. */
export function isTechTier(n: number): n is TechTier {
  return n === 1 || n === 2 || n === 3;
}

/** Duration of the key/click flash of a cell in ms (ui.md §7.6). */
export const CELL_FLASH_MS = 140;

/** Queue badge text: counts above 99 collapse to "99+" (the badge is 16 px wide). */
export function queueBadgeText(count: number): string {
  if (!(count > 0)) return '';
  return count > 99 ? '99+' : String(Math.trunc(count));
}
