/**
 * Roster/icon data and command card logic (generated from docs/design/roster.json and content/icons by
 * scripts/gen-data.ts). Unit names/roles/short names/descriptions/adjacency come from here via unitText(),
 * never from the i18n tables (P12 key schema unit.core.<id>.<field>).
 */
import './icons-mask.gen.css';

export type {
  HotbuildMenu,
  LocalizedText,
  RosterSlot,
  UnitEconomy,
  UnitHotbuild,
  UnitRecord,
  UnitShield,
  UnitWeapons,
} from './types.ts';
export { BUILD_TABLE } from './build-table.gen.ts';
export {
  MVP_UNITS,
  ROSTER,
  UNIT_TEXT_FIELDS,
  buildTimeS,
  findUnit,
  flowDemand,
  getUnit,
  normalizeTypeId,
  unitStats,
  unitText,
  unitTextKey,
  upgradeTarget,
} from './roster.ts';
export type { FlowDemand, UnitStats, UnitTextField } from './roster.ts';
export {
  buildableBy,
  builderMenu,
  canBuild,
  headBuilder,
  isBuilderType,
  menuMaxTab,
  nextHotbuildTier,
  resolveCardPage,
  rosterSlot,
  slotCodeOf,
} from './card-logic.ts';
export type { CardCellKind, CardCellSpec, CardLock, CardMenu, CardPageSpec, HotbuildStep } from './card-logic.ts';
export {
  GHOST_ICON_IDS,
  ICON_IDS,
  ICON_SPRITE,
  ICON_SPRITE_ID,
  ensureIconSprite,
  hasGhostIcon,
  iconMaskClass,
  iconOf,
  iconSymbolId,
  isIconId,
} from './icons.ts';
export type { IconId, IconState } from './icons.ts';
export { IconSprite, StrategicIcon } from './StrategicIcon.tsx';
export type { IconTeam, StrategicIconProps } from './StrategicIcon.tsx';
