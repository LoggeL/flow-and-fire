/**
 * Text builders of the top HUD zone (pure functions of model data + locale). Unit names come from
 * src/data (unitText), everything else from the eco/status/alerts/tooltip namespaces.
 */
import type { UnitCatalog } from '../../data/catalog.ts';
import { unitName } from '../../data/roster.ts';
import { fmtPct } from '../../format/index.ts';
import { t } from '../../i18n/t.ts';
import type { Locale } from '../../i18n/locale.ts';
import { ALERT_SUBJECT_IN_TITLE, alertAgeS } from '../../model/alerts.ts';
import type { AlertItem, AlertRegion } from '../../model/alerts.ts';
import type { FlowConsumer, FlowConsumerKind, IncomeSource, ResourceKind } from '../../model/eco.ts';

/** Joins meta parts ("Funke · Kartenmitte · vor 9 s"). */
export const META_SEPARATOR = ' · ';
/** Separator of the stall priority list ("Fabriken ▸ Engineers ▸ Upgrades"). */
export const PRIORITY_SEPARATOR = ' ▸ ';

/**
 * Upgrade target shortened against its source when both share the base name
 * ("Zapfstelle I" → "Zapfstelle II" becomes "II", like the mockup's "Zapfstelle I → II").
 */
export function upgradeTargetLabel(fromName: string, toName: string): string {
  const cut = toName.lastIndexOf(' ');
  if (cut <= 0) return toName;
  const base = toName.slice(0, cut);
  return fromName.startsWith(`${base} `) ? toName.slice(cut + 1) : toName;
}

/** Row label of a flow consumer ("Landwerk I · Punze", "Lehrling ×2 · Zapfstelle I", "Horcher I (Unterhalt)"). */
export function consumerLabel(cat: UnitCatalog, c: FlowConsumer, loc: Locale): string {
  const name = unitName(cat, c.typeId, loc);
  const count = c.count ?? 1;
  const base = count > 1 ? t('ui.eco.consumer.count', { name, n: count }, loc) : name;
  if (c.kind === 'upkeep') return t('ui.eco.consumer.upkeep', { name: base }, loc);
  if (!c.targetTypeId) return base;
  const target = unitName(cat, c.targetTypeId, loc);
  if (c.kind === 'upgrade') return t('ui.eco.consumer.upgrade', { from: base, to: upgradeTargetLabel(name, target) }, loc);
  return t('ui.eco.consumer.building', { name: base, target }, loc);
}

export function consumerKindLabel(kind: FlowConsumerKind, loc: Locale): string {
  return t(`ui.eco.kind.${kind}`, undefined, loc);
}

/** "Unterhalt ▸ Fabriken ▸ Upgrades ▸ Engineers". */
export function priorityLabel(kinds: readonly FlowConsumerKind[], loc: Locale): string {
  return kinds.map((k) => consumerKindLabel(k, loc)).join(PRIORITY_SEPARATOR);
}

export function incomeSourceLabel(source: IncomeSource, loc: Locale): string {
  return t(`ui.eco.source.${source}`, undefined, loc);
}

export function resourceLabel(kind: ResourceKind, loc: Locale): string {
  return t(kind === 'mass' ? 'ui.common.resource.mass' : 'ui.common.resource.energy', undefined, loc);
}

export function regionLabel(region: AlertRegion, loc: Locale): string {
  return t(`ui.alerts.region.${region}`, undefined, loc);
}

/** "vor 9 s" below one minute, then "vor 2 min". */
export function ageLabel(ageS: number, loc: Locale): string {
  const s = Math.max(0, Math.floor(ageS));
  if (s < 60) return t('ui.common.agoSeconds', { n: s }, loc);
  return t('ui.common.agoMinutes', { n: Math.floor(s / 60) }, loc);
}

/** Alert title with subject (ok alerts) and merge count: "Bau fertig: Zapfstelle I", "Einheit angegriffen ×3". */
export function alertTitle(cat: UnitCatalog, item: AlertItem, loc: Locale): string {
  let title = t(`ui.alerts.type.${item.type}`, undefined, loc);
  if (item.subjectTypeId && ALERT_SUBJECT_IN_TITLE[item.type]) {
    title = t('ui.alerts.withSubject', { title, subject: unitName(cat, item.subjectTypeId, loc) }, loc);
  }
  if (item.count > 1) title = t('ui.alerts.count', { title, n: item.count }, loc);
  return title;
}

/**
 * Meta line: stall alerts show the flow ("Flow 72 % · alle Baustellen gedrosselt"); others show
 * subject (when not in the title), region and age ("Funke · Kartenmitte · vor 9 s").
 */
export function alertMeta(cat: UnitCatalog, item: AlertItem, nowS: number, loc: Locale): string {
  if ((item.type === 'energyStall' || item.type === 'massStall') && item.flow !== undefined) {
    return t('ui.alerts.meta.stall', { pct: fmtPct(item.flow, 0, loc) }, loc);
  }
  const parts: string[] = [];
  if (item.subjectTypeId && !ALERT_SUBJECT_IN_TITLE[item.type]) parts.push(unitName(cat, item.subjectTypeId, loc));
  if (item.region) parts.push(regionLabel(item.region, loc));
  parts.push(ageLabel(alertAgeS(item, nowS), loc));
  return parts.join(META_SEPARATOR);
}

/** Target layers of a unit's weapons ("Land + Luft"), '' without weapons. */
export function layersLabel(layers: readonly string[], loc: Locale): string {
  const out: string[] = [];
  for (const l of layers) {
    if (l === 'land') out.push(t('ui.tooltip.layer.land', undefined, loc));
    else if (l === 'air') out.push(t('ui.tooltip.layer.air', undefined, loc));
  }
  return out.join(' + ');
}
