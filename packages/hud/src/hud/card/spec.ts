/**
 * Resolved command card page for a model (ui.md §5.6). The model holds the inputs (selected types,
 * requested tab); the layout itself comes only from `resolveCardPage` (src/data/card-logic.ts).
 */
import { computed } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { resolveCardPage } from '../../data/card-logic.ts';
import type { CardPageSpec } from '../../data/card-logic.ts';
import { registerCardPageResolver } from '../../model/card.ts';
import type { CardPage, CardSection, TechTier } from '../../model/card.ts';
// The model's `page` signal resolves through the roster-based card logic (see src/model/card.ts).
registerCardPageResolver((types): CardPage => resolveCardPage(types).page);
/**
 * Page spec for a selection and a requested tab. Tabs above the highest tier the selected builders can
 * build directly are locked (ui.md §5.6), so the effective tab is clamped to `defaultTab`.
 */
export function resolveCardSpec(selectedTypes: readonly string[], requestedTab: TechTier | null): CardPageSpec {
    const base = resolveCardPage(selectedTypes, null);
    if (base.maxTab === 0 || requestedTab === null)
        return base;
    const tab = Math.max(1, Math.min(requestedTab, base.defaultTab));
    return tab === base.tab ? base : resolveCardPage(selectedTypes, tab);
}
const SPECS = new WeakMap<CardSection, ReadonlySignal<CardPageSpec>>();
/** Cached computed spec of a card section (recomputed on selection/tab events only). */
export function cardSpec(card: CardSection): ReadonlySignal<CardPageSpec> {
    let s = SPECS.get(card);
    if (s === undefined) {
        s = computed(() => resolveCardSpec(card.selectedTypes.value, card.tab.value));
        SPECS.set(card, s);
    }
    return s;
}
/** True if a tech tab is locked for the page (above the directly buildable tier). */
export function isTabLocked(spec: CardPageSpec, tier: number): boolean {
    return spec.maxTab > 0 && tier > spec.defaultTab;
}
/** Order bar visibility (ui.md §5.8): build/production pages and structures (self-destruct lives there, R4). */
export function orderBarVisible(page: CardPage): boolean {
    return page === 'build' || page === 'production' || page === 'structure';
}
