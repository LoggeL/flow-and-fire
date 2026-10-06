/** Text builders shared by the menu pages (all through i18n; names of houses and maps are data). */
import { fmtDec } from '../../format/index.ts';
import { tDynamic, t } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import type { GraphicsPreset } from '../../model/menus/settings.ts';
import type { AiDifficulty, Compass, TeamColorMode, VictoryCondition } from '../../model/menus/skirmish.ts';

const AI_LEVEL: Readonly<Record<AiDifficulty, MsgKey>> = { easy: 'ui.skirmish.ai.easy', normal: 'ui.skirmish.ai.normal', hard: 'ui.skirmish.ai.hard' };

export function aiLevelLabel(d: AiDifficulty): string {
  return t(AI_LEVEL[d]);
}

const VICTORY: Readonly<Record<VictoryCondition, MsgKey>> = {
  assassination: 'ui.skirmish.victory.assassination',
  supremacy: 'ui.skirmish.victory.supremacy',
  annihilation: 'ui.skirmish.victory.annihilation',
};

export function victoryLabel(v: VictoryCondition): string {
  return t(VICTORY[v]);
}

const VICTORY_HINT: Readonly<Record<VictoryCondition, MsgKey>> = {
  assassination: 'ui.skirmish.victory.assassination.hint',
  supremacy: 'ui.skirmish.victory.supremacy.hint',
  annihilation: 'ui.skirmish.victory.annihilation.hint',
};

export function victoryHint(v: VictoryCondition): string {
  return t(VICTORY_HINT[v]);
}

const REGION: Readonly<Record<Compass, MsgKey>> = {
  north: 'ui.skirmish.region.north',
  northeast: 'ui.skirmish.region.northeast',
  east: 'ui.skirmish.region.east',
  southeast: 'ui.skirmish.region.southeast',
  south: 'ui.skirmish.region.south',
  southwest: 'ui.skirmish.region.southwest',
  west: 'ui.skirmish.region.west',
  northwest: 'ui.skirmish.region.northwest',
  center: 'ui.skirmish.region.center',
};

export function compassLabel(c: Compass): string {
  return t(REGION[c]);
}

/** "Haus Ambrecht" / "House Ambrecht". */
export function houseLabel(name: string): string {
  return t('ui.skirmish.house', { name });
}

/** Colour name of a house colour token ("team-blau" → "Blau"). */
export function colorName(token: string): string {
  return tDynamic(`ui.skirmish.color.${token}`);
}

const PRESET: Readonly<Record<GraphicsPreset, MsgKey>> = {
  low: 'ui.settings.opt.preset.low',
  medium: 'ui.settings.opt.preset.medium',
  high: 'ui.settings.opt.preset.high',
  ultra: 'ui.settings.opt.preset.ultra',
  custom: 'ui.settings.opt.preset.custom',
};

export function presetLabel(p: GraphicsPreset): string {
  return t(PRESET[p]);
}

const TEAM_MODE: Readonly<Record<TeamColorMode, MsgKey>> = {
  house: 'ui.skirmish.teams.house',
  relation: 'ui.skirmish.teams.relation',
  cvd: 'ui.skirmish.teams.cvd',
};

export function teamModeLabel(m: TeamColorMode): string {
  return t(TEAM_MODE[m]);
}

/** "×1,3" (AIx factor / speed). */
export function factorText(v: number): string {
  return t('ui.skirmish.aix.value', { factor: fmtDec(v, 1) });
}

/** Map description or note: i18n key or literal text. */
export function dataText(keyOrText: string): string {
  return tDynamic(keyOrText);
}

