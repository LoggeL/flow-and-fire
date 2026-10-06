/**
 * Texts of the command card, order bar and order tooltip (ui.md §5.6, §5.8). Unit names come from
 * src/data (unitText, P12 key schema unit.core.<id>.<field>); everything else from the card/orders
 * namespaces. Pure functions of (inputs, locale) so tests can call them without rendering.
 */
import type { CardLock, CardPageSpec } from '../../data/card-logic.ts';
import type { UnitCatalog } from '../../data/catalog.ts';
import { mvpUnits, unitName, unitText } from '../../data/roster.ts';
import { locale as localeSignal } from '../../i18n/locale.ts';
import type { Locale } from '../../i18n/locale.ts';
import { t, tn } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import type { CardPage } from '../../model/card.ts';
import { ORDER_TEXT, orderDef, orderUsesAlt } from '../../model/orders.ts';
import type { OrderId } from '../../model/orders.ts';
import { keyLabel } from '../../ui/keys.ts';
import type { KeyboardLayout, SlotCode } from '../../ui/keys.ts';

/**
 * Cell labels are bounded to 10 characters in every locale (58-px cell, ui.md §5.6/§5.8). The pseudo
 * locale therefore only accents them (same rule as unitText(…, 'short')), the brackets and padding of
 * the +30 % pass would test a length the contract excludes.
 */
export function cellText(key: MsgKey, loc: Locale = localeSignal.value): string {
  return boundedText(t(key, undefined, loc), loc);
}

/**
 * Same rule for an already translated bounded label (tech tab „T2“: a tier symbol that is identical in every
 * language, ui.md §5.6 – DECISIONS HUD-6): the pseudo locale keeps only the accents.
 */
export function boundedText(s: string, loc: Locale = localeSignal.value): string {
  if (loc !== 'pseudo' || !s.startsWith('[')) return s;
  return s.slice(1, s.endsWith(']') ? -1 : undefined).replace(/~+$/, '');
}

/** Short name of a unit for a cell (≤ 10 characters, without roman tier). Unknown ids fall back to the id. */
export function unitShort(cat: UnitCatalog, typeId: string, loc: Locale = localeSignal.value): string {
  return unitText(cat, typeId, 'short', loc);
}

/** Card head (ui.md §5.6): „Bau · Vogt“, „Produktion · Landwerk I“, „Gebäude · Zapfstelle I“, „Befehle · N Einheiten“. */
export function cardHeadText(cat: UnitCatalog, spec: CardPageSpec, unitCount: number, loc: Locale = localeSignal.value): string {
  const head = spec.headTypeId;
  switch (spec.page) {
    case 'build':
      return t('ui.card.head.build', { name: head ? unitName(cat, head, loc) : '' }, loc);
    case 'production':
      return t('ui.card.head.production', { name: head ? unitName(cat, head, loc) : '' }, loc);
    case 'structure':
      return t('ui.card.head.structure', { name: head ? unitName(cat, head, loc) : '' }, loc);
    case 'orders':
      return tn('ui.card.head.orders', unitCount, undefined, loc);
    case 'empty':
      return t('ui.card.head.empty', undefined, loc);
  }
}

/** Accessible name of the grid per page. */
export function gridLabel(page: CardPage, loc: Locale = localeSignal.value): string {
  return t(`ui.card.grid.${page}`, undefined, loc);
}

/** Builder that unlocks a build tier: the engineer of that tier (Geselle for T2, Meister for T3). */
export function builderForTier(cat: UnitCatalog, tier: number): string | null {
  const u = mvpUnits(cat).find((r) => r.tech === tier && r.categories.includes('ENGINEER') && !r.categories.includes('COMMAND'));
  return u ? u.id : null;
}

/**
 * Prerequisite of a locked cell or tab (tooltip, aria): „ab T2: Geselle (T2-Engineer)“ on build pages,
 * „ab T2: Landwerk freisprechen“ on production pages.
 */
export function lockText(cat: UnitCatalog, lock: CardLock, headTypeId: string | null, loc: Locale = localeSignal.value): string {
  if (lock.reason === 'needBuilderTech') {
    const b = builderForTier(cat, lock.tier);
    return t('ui.card.lock.needBuilderTech', { tier: String(lock.tier), builder: b ? unitName(cat, b, loc) : '' }, loc);
  }
  const factory = headTypeId ? unitShort(cat, headTypeId, loc) : '';
  return t('ui.card.lock.needFactoryUpgrade', { tier: String(lock.tier), factory }, loc);
}

/** Label of a physical key for the layout (grid keys by position: KeyZ → „Y“ on German keyboards). */
export function slotKeyText(slot: SlotCode, layout: KeyboardLayout): string {
  return keyLabel(slot, layout);
}

/** True on Apple platforms (self-destruct additionally on Ctrl+⌫, ui.md §5.8). */
export function isMacPlatform(nav?: { readonly platform?: string; readonly userAgent?: string }): boolean {
  const n = nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
  if (!n) return false;
  return /Mac|iPhone|iPad/i.test(n.platform ?? '') || /Mac OS X/i.test(n.userAgent ?? '');
}

/** Key combination of self-destruct: „Strg+Entf“ (macOS additionally „Strg+⌫“). */
export function selfDestructKeys(mac: boolean, loc: Locale = localeSignal.value): string {
  return t(mac ? 'ui.orders.key.selfDestructMac' : 'ui.orders.key.selfDestruct', undefined, loc);
}

/**
 * Key hint of an order for the page (ui.md §5.8, §7.2): grid key on the orders page, Alt + key otherwise;
 * in the WASD scheme build pages use Alt+⇧. Self-destruct: the key combination.
 */
export function orderKeysText(
  id: OrderId,
  page: CardPage,
  layout: KeyboardLayout,
  opts: { readonly mac?: boolean; readonly scheme?: 'grid' | 'wasd' } = {},
  loc: Locale = localeSignal.value,
): string {
  const def = orderDef(id);
  if (def.key === null) return selfDestructKeys(opts.mac ?? false, loc);
  const key = keyLabel(def.key, layout);
  if (!orderUsesAlt(page)) return t('ui.orders.key.grid', { key }, loc);
  if (opts.scheme === 'wasd') return t('ui.orders.key.altShift', { key }, loc);
  return t('ui.orders.key.alt', { key }, loc);
}

/** Key cap text of an order (tooltip head): the bare key on the orders page, otherwise like orderKeysText. */
export function orderKeyCap(
  id: OrderId,
  page: CardPage,
  layout: KeyboardLayout,
  opts: { readonly mac?: boolean; readonly scheme?: 'grid' | 'wasd' } = {},
  loc: Locale = localeSignal.value,
): string {
  const def = orderDef(id);
  if (def.key !== null && !orderUsesAlt(page)) return keyLabel(def.key, layout);
  return orderKeysText(id, page, layout, opts, loc);
}

/** Full order name. */
export function orderName(id: OrderId, loc: Locale = localeSignal.value): string {
  return t(ORDER_TEXT[id].name, undefined, loc);
}

/** Short order label for a 58-px cell (≤ 10 characters). */
export function orderShort(id: OrderId, loc: Locale = localeSignal.value): string {
  return cellText(ORDER_TEXT[id].short, loc);
}
