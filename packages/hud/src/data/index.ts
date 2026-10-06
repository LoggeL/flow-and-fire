/**
 * Unit catalog, icon data and command card logic. Unit data (stats, costs, buildable-by, hotbuild slots,
 * names/roles/short names/descriptions/adjacency) reaches the HUD only through a UnitCatalog in
 * `HudModel.units` (the game builds it from its blueprints); unitText() reads it, never the i18n tables
 * (P12 key schema unit.core.<id>.<field>). The generated roster (scripts/gen-data.ts) is only the demo
 * catalog of gallery, tests and benchmarks (src/demo/catalog.ts). Icons are generated from content/icons.
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
export { EMPTY_UNIT_CATALOG, createUnitCatalog } from './catalog.ts';
export type { UnitCatalog, UnitCatalogSource } from './catalog.ts';
export {
  UNIT_TEXT_FIELDS,
  buildTimeS,
  findUnit,
  flowDemand,
  getUnit,
  mvpUnits,
  normalizeTypeId,
  unitName,
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
