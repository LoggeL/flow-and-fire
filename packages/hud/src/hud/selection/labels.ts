/**
 * Text builders of the selection panel and factory queue (pure functions of model data + locale).
 * Unit names/roles come from src/data (unitText), everything else from the selection/factory namespaces.
 */
import type { UnitCatalog } from '../../data/catalog.ts';
import { unitName, unitText } from '../../data/roster.ts';
import { MINUS, fmtDec, fmtInt, fmtPct } from '../../format/index.ts';
import type { Locale } from '../../i18n/locale.ts';
import { t, tn } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import type { FactoryDetailData, RallyState } from '../../model/factory.ts';
import type { OrderEntry, OrderKind, TapshotState, TypeCount, VetState } from '../../model/selection.ts';
import type { LineIconName } from '../../ui/icons.ts';

/** Joins inline parts ("Punze · noch 3,1 s"). */
export const SEP = ' · ';

export function unitRole(cat: UnitCatalog, typeId: string, loc: Locale): string {
  return unitText(cat, typeId, 'role', loc);
}

/** Tech label of the portrait: CMD (tier 0), T1–T3, EXP (tier 4). */
export function techLabel(cat: UnitCatalog, typeId: string, loc: Locale): string {
  const tech = cat.find(typeId)?.tech ?? 1;
  if (tech === 0) return t('ui.selection.tech.commander', undefined, loc);
  if (tech >= 4) return t('ui.selection.tech.experimental', undefined, loc);
  return t('ui.common.tier', { n: String(tech) }, loc);
}

export function isCommander(cat: UnitCatalog, typeId: string): boolean {
  return cat.find(typeId)?.tech === 0;
}

const ORDER_KEYS: Readonly<Record<OrderKind, MsgKey>> = {
  move: 'ui.selection.order.move',
  attack: 'ui.selection.order.attack',
  attackMove: 'ui.selection.order.attackMove',
  build: 'ui.selection.order.build',
  assist: 'ui.selection.order.assist',
  guard: 'ui.selection.order.guard',
  repair: 'ui.selection.order.repair',
  reclaim: 'ui.selection.order.reclaim',
  patrol: 'ui.selection.order.patrol',
  upgrade: 'ui.selection.order.upgrade',
};

/** Line icon of an order kind (running row marker, icon of orders without a unit target). */
export const ORDER_ICONS: Readonly<Record<OrderKind, LineIconName>> = {
  move: 'move',
  attack: 'attack',
  attackMove: 'attackmove',
  // A running build shows the build beam (assist chevrons), like the mockup's order chain.
  build: 'assist',
  assist: 'assist',
  guard: 'guard',
  repair: 'repair',
  reclaim: 'reclaim',
  patrol: 'patrol',
  upgrade: 'upgrade',
};

export function orderKindLabel(kind: OrderKind, loc: Locale): string {
  return t(ORDER_KEYS[kind], undefined, loc);
}

/**
 * Row label of an order: a build shows the building ("Glutkessel I"), an area reclaim the number of
 * targets ("Reclaim · 3 Wracks"), orders on a unit type "Assist · Landwerk I", the rest the order name.
 */
export function orderLabel(cat: UnitCatalog, o: OrderEntry, loc: Locale): string {
  const kind = orderKindLabel(o.kind, loc);
  if (o.kind === 'build' && o.typeId !== undefined) return unitName(cat, o.typeId, loc);
  if (o.targets !== undefined && o.targets > 0) {
    return tn('ui.selection.order.targets', o.targets, { order: kind }, loc);
  }
  if (o.typeId !== undefined) return t('ui.selection.order.withTarget', { order: kind, target: unitName(cat, o.typeId, loc) }, loc);
  return kind;
}

/** Right-hand value of an order row: mass of reclaim targets ("86 M"), else the progress ("64 %"), else ''. */
export function orderValue(o: OrderEntry, loc: Locale): string {
  if (o.mass !== undefined) return t('ui.selection.order.mass', { value: fmtInt(o.mass, loc) }, loc);
  if (o.progress !== undefined) return fmtPct(o.progress, 0, loc);
  return '';
}

/** "10.320 / 12.000" */
export function ofText(value: number, max: number, loc: Locale): string {
  return t('ui.common.of', { value: fmtInt(value, loc), max: fmtInt(max, loc) }, loc);
}

/** Vet meter text: "420 / 1.000 M", "Höchste Stufe" at level 5, else the progress in percent. */
export function vetText(v: VetState, maxLevel: number, loc: Locale): string {
  if (v.level >= maxLevel) return t('ui.selection.vetMax', undefined, loc);
  if (v.mass !== undefined && v.massNext !== undefined) {
    return t('ui.selection.vetMass', { value: fmtInt(v.mass, loc), max: fmtInt(v.massNext, loc) }, loc);
  }
  return fmtPct(v.progress, 0, loc);
}

export function tapshotReady(s: TapshotState): boolean {
  return s.stored >= s.threshold;
}

/** Tap-shot meter text (U8): "2.840 / 7.500 E", or "bereit · 7.500 E" at the threshold. */
export function tapshotText(s: TapshotState, loc: Locale): string {
  if (tapshotReady(s)) return t('ui.selection.tapshotReady', { value: fmtInt(s.stored, loc) }, loc);
  return t('ui.selection.tapshotValue', { value: fmtInt(s.stored, loc), max: fmtInt(s.threshold, loc) }, loc);
}

/** Helper list of a factory: "(Lehrling ×3, Assist)" or "(keine)". */
export function helpersText(cat: UnitCatalog, helpers: readonly TypeCount[], loc: Locale): string {
  if (helpers.length === 0) return t('ui.factory.helpersNone', undefined, loc);
  const list = helpers.map((h) => t('ui.factory.helperEntry', { name: unitName(cat, h.typeId, loc), n: String(h.count) }, loc)).join(', ');
  return t('ui.factory.helpersList', { list }, loc);
}

export function helperCount(helpers: readonly TypeCount[]): number {
  let n = 0;
  for (const h of helpers) n += h.count;
  return n;
}

/** Adjacency bonus of a factory (E11): "−9 % E" or "keine". */
export function adjacencyText(pct: number, loc: Locale): string {
  if (!(pct > 0)) return t('ui.factory.adjacencyNone', undefined, loc);
  return t('ui.factory.adjacencyValue', { value: `${MINUS}${fmtInt(pct, loc)}` }, loc);
}

const RALLY_KEYS: Readonly<Record<RallyState, MsgKey>> = {
  none: 'ui.factory.rally.none',
  point: 'ui.factory.rally.point',
  unit: 'ui.factory.rally.unit',
};

export function rallyText(r: RallyState, loc: Locale): string {
  return t(RALLY_KEYS[r], undefined, loc);
}

/** Build power line "20 + 15 = 35" (B2); without assist just "20". */
export function bpParts(d: Pick<FactoryDetailData, 'bpOwn' | 'bpAssist'>, loc: Locale): { readonly sum: string; readonly total: string } {
  if (!(d.bpAssist > 0)) return { sum: '', total: fmtInt(d.bpOwn, loc) };
  return { sum: `${fmtInt(d.bpOwn, loc)} + ${fmtInt(d.bpAssist, loc)} = `, total: fmtInt(d.bpOwn + d.bpAssist, loc) };
}

/** Remaining time of the item in production: "noch 3,1 s". */
export function remainingText(seconds: number, loc: Locale): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return t('ui.factory.remaining', { value: fmtDec(s, 1, loc) }, loc);
}

/** Speed/regen style values of the stat line. */
export function statDec(v: number, loc: Locale): string {
  return fmtDec(v, 1, loc);
}

/** Panel head text of each selection kind. */
export function headUnits(n: number, loc: Locale): string {
  return tn('ui.common.units', n, undefined, loc);
}

export function headTypes(n: number, loc: Locale): string {
  return tn('ui.common.types', n, undefined, loc);
}

/** Right side of the head: "Gruppe 3" (key 0 = group 10) or the house label. */
export function headGroup(controlGroup: number | null, label: string | null, loc: Locale): string {
  if (controlGroup !== null) return t('ui.selection.group', { n: String(controlGroup % 10) }, loc);
  return label ?? '';
}
