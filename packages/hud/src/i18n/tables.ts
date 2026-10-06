/*
 * Message tables (P12). One JSON pair per namespace: locales/<ns>.de.json is the source, the English
 * table is typed against it (Record<keyof DE, string>), so a missing English key is a tsc error and
 * breaks the build (PLAN MS4). Extra English keys, placeholder mismatches and empty values are caught
 * by test/foundation/i18n.test.ts. Keys are full paths prefixed with "ui.<namespace>.".
 * Namespace owners (TRACK-HUD contract) only edit their JSON files; this module stays unchanged.
 */
import commonDe from './locales/common.de.json';
import commonEn from './locales/common.en.json';
import ecoDe from './locales/eco.de.json';
import ecoEn from './locales/eco.en.json';
import statusDe from './locales/status.de.json';
import statusEn from './locales/status.en.json';
import alertsDe from './locales/alerts.de.json';
import alertsEn from './locales/alerts.en.json';
import tooltipDe from './locales/tooltip.de.json';
import tooltipEn from './locales/tooltip.en.json';
import selectionDe from './locales/selection.de.json';
import selectionEn from './locales/selection.en.json';
import factoryDe from './locales/factory.de.json';
import factoryEn from './locales/factory.en.json';
import cardDe from './locales/card.de.json';
import cardEn from './locales/card.en.json';
import ordersDe from './locales/orders.de.json';
import ordersEn from './locales/orders.en.json';
import stripDe from './locales/strip.de.json';
import stripEn from './locales/strip.en.json';
import minimapDe from './locales/minimap.de.json';
import minimapEn from './locales/minimap.en.json';
import hudDe from './locales/hud.de.json';
import hudEn from './locales/hud.en.json';
import menuDe from './locales/menu.de.json';
import menuEn from './locales/menu.en.json';
import skirmishDe from './locales/skirmish.de.json';
import skirmishEn from './locales/skirmish.en.json';
import loadingDe from './locales/loading.de.json';
import loadingEn from './locales/loading.en.json';
import gamemenuDe from './locales/gamemenu.de.json';
import gamemenuEn from './locales/gamemenu.en.json';
import settingsDe from './locales/settings.de.json';
import settingsEn from './locales/settings.en.json';
import scoreDe from './locales/score.de.json';
import scoreEn from './locales/score.en.json';

/** German tables per namespace (source of all keys). */
export const DE_TABLES = {
  common: commonDe,
  eco: ecoDe,
  status: statusDe,
  alerts: alertsDe,
  tooltip: tooltipDe,
  selection: selectionDe,
  factory: factoryDe,
  card: cardDe,
  orders: ordersDe,
  strip: stripDe,
  minimap: minimapDe,
  hud: hudDe,
  menu: menuDe,
  skirmish: skirmishDe,
  loading: loadingDe,
  gamemenu: gamemenuDe,
  settings: settingsDe,
  score: scoreDe,
} as const;

export type DeTables = typeof DE_TABLES;
export type Namespace = keyof DeTables;

/** Every message key (union of all German keys). */
export type MsgKey = { [N in Namespace]: Extract<keyof DeTables[N], string> }[Namespace];

/** English tables: exactly the German keys per namespace (missing key → compile error). */
export type EnTables = { readonly [N in Namespace]: Readonly<Record<keyof DeTables[N], string>> };

export const EN_TABLES: EnTables = {
  common: commonEn,
  eco: ecoEn,
  status: statusEn,
  alerts: alertsEn,
  tooltip: tooltipEn,
  selection: selectionEn,
  factory: factoryEn,
  card: cardEn,
  orders: ordersEn,
  strip: stripEn,
  minimap: minimapEn,
  hud: hudEn,
  menu: menuEn,
  skirmish: skirmishEn,
  loading: loadingEn,
  gamemenu: gamemenuEn,
  settings: settingsEn,
  score: scoreEn,
};

export const NAMESPACES = Object.keys(DE_TABLES) as readonly Namespace[];

function flatten(tables: { readonly [N in Namespace]: Readonly<Record<string, string>> }): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const ns of NAMESPACES) Object.assign(out, tables[ns]);
  return out;
}

/** All German messages by key. */
export const DE_MESSAGES: Readonly<Record<string, string>> = flatten(DE_TABLES);
/** All English messages by key. */
export const EN_MESSAGES: Readonly<Record<string, string>> = flatten(EN_TABLES);
