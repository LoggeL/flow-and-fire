import { batch, signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Alerts (ui.md §5.11, P8). Alerts only come from the sim event stream, never from client logic. */

export type AlertType =
  | 'commanderDanger'
  | 'energyStall'
  | 'massStall'
  | 'baseAttacked'
  | 'unitAttacked'
  | 'enemyAir'
  | 'enemyCommanderSpotted'
  | 'storageFull'
  | 'buildComplete'
  | 'factoryUpgraded';

/** Severity; each has its own symbol (octagon / triangle / circle / circle with check, ui.md §8.1). */
export type AlertLevel = 'crit' | 'warn' | 'info' | 'ok';
export const ALERT_LEVELS: readonly AlertLevel[] = ['crit', 'warn', 'info', 'ok'];

/** Where "Zum Ort" jumps. */
export type AlertJumpTarget = 'unit' | 'structure' | 'sighting' | 'flowDetails' | 'none';

export interface AlertDef {
  readonly level: AlertLevel;
  /** Same-type alerts within this interval merge ("×3"). */
  readonly repeatS: number;
  readonly jump: AlertJumpTarget;
  /** Sound id from content/audio/SOUNDLIST.md. */
  readonly sound: string;
}

export const ALERT_DEFS: Readonly<Record<AlertType, AlertDef>> = {
  commanderDanger: { level: 'crit', repeatS: 8, jump: 'unit', sound: 'alt_commander_danger' },
  energyStall: { level: 'crit', repeatS: 20, jump: 'flowDetails', sound: 'alt_energy_stall' },
  massStall: { level: 'warn', repeatS: 20, jump: 'flowDetails', sound: 'alt_mass_stall' },
  baseAttacked: { level: 'warn', repeatS: 15, jump: 'structure', sound: 'alt_base_attacked' },
  unitAttacked: { level: 'warn', repeatS: 10, jump: 'unit', sound: 'alt_unit_attacked' },
  enemyAir: { level: 'warn', repeatS: 30, jump: 'sighting', sound: 'alt_enemy_air' },
  enemyCommanderSpotted: { level: 'info', repeatS: 30, jump: 'sighting', sound: 'alt_enemy_commander_spotted' },
  storageFull: { level: 'info', repeatS: 30, jump: 'none', sound: 'alt_storage_full' },
  buildComplete: { level: 'ok', repeatS: 5, jump: 'structure', sound: 'alt_build_complete' },
  factoryUpgraded: { level: 'ok', repeatS: 5, jump: 'structure', sound: 'alt_factory_upgraded' },
};

export const ALERT_TYPES = Object.keys(ALERT_DEFS) as readonly AlertType[];

/** Alerts dim after 20 s and disappear after 60 s; at most 3 are visible. */
export const ALERT_STALE_S = 20;
export const ALERT_EXPIRE_S = 60;
export const ALERT_MAX_VISIBLE = 3;

export interface AlertLocation {
  readonly x: number;
  readonly z: number;
}

/** Coarse place of an alert for the meta line ("Nordost", "Kartenmitte", "Basis"). */
export type AlertRegion =
  | 'north'
  | 'northEast'
  | 'east'
  | 'southEast'
  | 'south'
  | 'southWest'
  | 'west'
  | 'northWest'
  | 'center'
  | 'base';

export const ALERT_REGIONS: readonly AlertRegion[] = [
  'north',
  'northEast',
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
  'center',
  'base',
];

export interface AlertItem {
  readonly id: number;
  readonly type: AlertType;
  /** Merged occurrences (≥ 1). */
  readonly count: number;
  readonly createdAtS: number;
  readonly lastAtS: number;
  readonly location: AlertLocation | null;
  readonly subjectTypeId?: string | undefined;
  /** Place for the meta line (the game derives it from the location, see mapRegion()). */
  readonly region?: AlertRegion | undefined;
  /** Flow factor 0..1 for energy/mass stall alerts ("Flow 72 %"). */
  readonly flow?: number | undefined;
}

/** One alert event from the sim event stream (PLAN §3.1 "Präsentation"). */
export interface AlertEvent {
  readonly type: AlertType;
  /** Sim time of the event in seconds. */
  readonly atS: number;
  readonly location?: AlertLocation | null | undefined;
  readonly subjectTypeId?: string | undefined;
  readonly region?: AlertRegion | undefined;
  readonly flow?: number | undefined;
}

export interface AlertsSection {
  /** Active alerts, newest first. */
  readonly items: Signal<readonly AlertItem[]>;
  /** Expired alerts kept for cycling through (Shift+Space); counted in "N ältere". */
  readonly historyCount: Signal<number>;
  /** Next alert id (ids are unique per match and never reused). */
  readonly nextId: Signal<number>;
}

export function createAlertsSection(): AlertsSection {
  return {
    items: signal<readonly AlertItem[]>([]),
    historyCount: signal(0),
    nextId: signal(1),
  };
}

/** Critical alerts flash twice while younger than this (ui.md §5.11; off with reduced motion). */
export const ALERT_FLASH_S = 2;

/** Alerts whose subject belongs into the title ("Bau fertig: Zapfstelle I"); others name it in the meta line. */
export const ALERT_SUBJECT_IN_TITLE: Readonly<Record<AlertType, boolean>> = {
  commanderDanger: false,
  energyStall: false,
  massStall: false,
  baseAttacked: false,
  unitAttacked: false,
  enemyAir: false,
  enemyCommanderSpotted: false,
  storageFull: false,
  buildComplete: true,
  factoryUpgraded: true,
};

export interface MergeResult {
  /** New item list, newest (most recently raised or merged) first. */
  readonly items: readonly AlertItem[];
  /** Id of the new or merged alert. */
  readonly id: number;
  /** True when the event was folded into an existing alert (count + 1). */
  readonly merged: boolean;
}

/**
 * Adds an event (pure): an alert of the same type whose last occurrence lies within the type's
 * repeat interval absorbs it (count + 1, newest location, moved to the top, "Einheit angegriffen ×3");
 * otherwise a new alert with `nextId` is put on top.
 */
export function mergeAlert(items: readonly AlertItem[], ev: AlertEvent, nextId: number): MergeResult {
  const def = ALERT_DEFS[ev.type];
  const idx = items.findIndex((a) => a.type === ev.type && Math.abs(ev.atS - a.lastAtS) <= def.repeatS);
  if (idx >= 0) {
    const old = items[idx] as AlertItem;
    const merged: AlertItem = {
      ...old,
      count: old.count + 1,
      lastAtS: Math.max(old.lastAtS, ev.atS),
      location: ev.location ?? old.location,
      subjectTypeId: ev.subjectTypeId ?? old.subjectTypeId,
      region: ev.region ?? old.region,
      flow: ev.flow ?? old.flow,
    };
    const rest = items.filter((_, i) => i !== idx);
    return { items: [merged, ...rest], id: old.id, merged: true };
  }
  const item: AlertItem = {
    id: nextId,
    type: ev.type,
    count: 1,
    createdAtS: ev.atS,
    lastAtS: ev.atS,
    location: ev.location ?? null,
    subjectTypeId: ev.subjectTypeId,
    region: ev.region,
    flow: ev.flow,
  };
  return { items: [item, ...items], id: nextId, merged: false };
}

/** Seconds since the alert's last occurrence (never negative). */
export function alertAgeS(item: AlertItem, nowS: number): number {
  const a = nowS - item.lastAtS;
  return a > 0 ? a : 0;
}

/** Dimmed from 20 s ("veraltet", ui.md §3.7). */
export function isAlertStale(item: AlertItem, nowS: number): boolean {
  return alertAgeS(item, nowS) >= ALERT_STALE_S;
}

/** Removed from 60 s. */
export function isAlertExpired(item: AlertItem, nowS: number): boolean {
  return alertAgeS(item, nowS) >= ALERT_EXPIRE_S;
}

/** Critical alert that is still in its flash window (the flash itself is a CSS animation on mount). */
export function isAlertFlashing(item: AlertItem, nowS: number): boolean {
  return ALERT_DEFS[item.type].level === 'crit' && alertAgeS(item, nowS) < ALERT_FLASH_S;
}

export interface PruneResult {
  readonly items: readonly AlertItem[];
  /** Number of alerts removed (they go into the history). */
  readonly removed: number;
}

/** Removes expired alerts (pure); returns the same array when nothing expired. */
export function pruneAlerts(items: readonly AlertItem[], nowS: number): PruneResult {
  let removed = 0;
  for (const a of items) if (isAlertExpired(a, nowS)) removed++;
  if (removed === 0) return { items, removed: 0 };
  return { items: items.filter((a) => !isAlertExpired(a, nowS)), removed };
}

/** The alerts shown in the feed (at most 3, newest first). */
export function visibleAlerts(items: readonly AlertItem[], max: number = ALERT_MAX_VISIBLE): readonly AlertItem[] {
  return items.length > max ? items.slice(0, max) : items;
}

/** "N ältere": active alerts beyond the visible ones plus expired alerts in the history. */
export function olderAlertCount(items: readonly AlertItem[], historyCount: number, max: number = ALERT_MAX_VISIBLE): number {
  return Math.max(0, items.length - max) + Math.max(0, historyCount);
}

/** Adds an event to the section (merging, see mergeAlert) and returns the alert id. */
export function pushAlert(section: AlertsSection, ev: AlertEvent): number {
  const r = mergeAlert(section.items.peek(), ev, section.nextId.peek());
  batch(() => {
    section.items.value = r.items;
    if (!r.merged) section.nextId.value = r.id + 1;
  });
  return r.id;
}

/** Drops expired alerts into the history (call at 1 Hz with the sim time). Returns how many expired. */
export function tickAlerts(section: AlertsSection, nowS: number): number {
  const r = pruneAlerts(section.items.peek(), nowS);
  if (r.removed > 0) {
    batch(() => {
      section.items.value = r.items;
      section.historyCount.value = section.historyCount.peek() + r.removed;
    });
  }
  return r.removed;
}

/**
 * Coarse region of a world position on a `width` × `height` map (x east, z south): the middle
 * third in both axes is "center", otherwise one of eight compass sectors.
 */
export function mapRegion(x: number, z: number, width: number, height: number): Exclude<AlertRegion, 'base'> {
  const fx = width > 0 ? x / width : 0.5;
  const fz = height > 0 ? z / height : 0.5;
  const col = fx < 1 / 3 ? 0 : fx < 2 / 3 ? 1 : 2;
  const row = fz < 1 / 3 ? 0 : fz < 2 / 3 ? 1 : 2;
  const grid: readonly (readonly Exclude<AlertRegion, 'base'>[])[] = [
    ['northWest', 'north', 'northEast'],
    ['west', 'center', 'east'],
    ['southWest', 'south', 'southEast'],
  ];
  return (grid[row] as readonly Exclude<AlertRegion, 'base'>[])[col] as Exclude<AlertRegion, 'base'>;
}

/** Severity of an alert type (symbol + colour, ui.md §8.1). */
export function alertLevel(type: AlertType): AlertLevel {
  return ALERT_DEFS[type].level;
}

/** Where "Zum Ort" of this alert type jumps ('none' = no jump button, e.g. storage full). */
export function alertJumpTarget(type: AlertType): AlertJumpTarget {
  return ALERT_DEFS[type].jump;
}

/** The feed is announced assertively while a critical alert is visible (ui.md §5.11), politely otherwise. */
export function alertLiveMode(visible: readonly AlertItem[]): 'assertive' | 'polite' {
  for (const a of visible) if (ALERT_DEFS[a.type].level === 'crit') return 'assertive';
  return 'polite';
}

/** Resolved jump of an alert ("Zum Ort" / Space): what the game should do for `jumpToAlert(id)`. */
export interface AlertJump {
  readonly id: number;
  readonly target: Exclude<AlertJumpTarget, 'none'>;
  /** World position for unit/structure/sighting targets (null for flow details or unknown places). */
  readonly location: AlertLocation | null;
}

/**
 * Resolves `jumpToAlert(id)` for the game (pure): unit/structure/sighting → camera to the alert's newest
 * location; energy/mass stall → open the flow details (set eco.detailsOpen, do not toggle). Null for
 * unknown ids and alerts without a jump target (storage full).
 */
export function resolveAlertJump(items: readonly AlertItem[], id: number): AlertJump | null {
  const item = items.find((a) => a.id === id);
  if (!item) return null;
  const target = ALERT_DEFS[item.type].jump;
  if (target === 'none') return null;
  return { id, target, location: target === 'flowDetails' ? null : item.location };
}

/** Id the Space key jumps to: the newest visible alert with a jump target (null when there is none). */
export function newestJumpAlertId(items: readonly AlertItem[]): number | null {
  for (const a of visibleAlerts(items)) if (ALERT_DEFS[a.type].jump !== 'none') return a.id;
  return null;
}
