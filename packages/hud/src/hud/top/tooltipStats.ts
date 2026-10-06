/**
 * Value grid (3 × 2) of the unit tooltip (ui.md §5.12), ported from the mockup's FF.unitTip:
 * HP · DPS (or Mass/s, Energy/s production of unarmed producers) · Range (or Storage, Build Power) · Speed (or Upkeep, Vision) ·
 * build time at the builder's BP (or regeneration without a builder) · Tech.
 */
import type { UnitCatalog } from '../../data/catalog.ts';
import { unitStats } from '../../data/roster.ts';
import { MINUS, fmtDec, fmtInt, fmtRate } from '../../format/index.ts';
import type { Locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import type { TooltipStat } from '../../ui/TooltipFrame.tsx';

const NONE = '–';

/**
 * The six cells of the unit tooltip grid, translated for `loc`. Unknown ids (not in the catalog, e.g. test
 * or mod blueprints) get the same six labels with „–“ values instead of throwing.
 */
export function unitTooltipStats(cat: UnitCatalog, typeId: string, builderBp: number | undefined, loc: Locale): readonly TooltipStat[] {
  const u = cat.find(typeId);
  const s = unitStats(cat, typeId);
  if (u === undefined || s === null) {
    const keys = ['hp', 'dps', 'range', 'speed', 'buildTime', 'tech'] as const;
    return keys.map((k) => ({ label: t(`ui.tooltip.stat.${k}`, undefined, loc), value: NONE }));
  }
  const wu = (v: number): string => t('ui.common.worldUnits', { value: fmtInt(v, loc) }, loc);
  const cells: TooltipStat[] = [{ label: t('ui.tooltip.stat.hp', undefined, loc), value: fmtInt(s.hp, loc) }];

  // Cell 2: DPS; producers without weapons show their production instead (the armed Reeve keeps DPS).
  let c2: TooltipStat = { label: t('ui.tooltip.stat.dps', undefined, loc), value: s.dps > 0 ? fmtDec(s.dps, 1, loc) : NONE };
  if (s.dps <= 0 && s.massPerS > 0) c2 = { label: t('ui.tooltip.stat.mass', undefined, loc), value: fmtRate(s.massPerS, 1, true, loc) };
  if (s.dps <= 0 && s.energyPerS > 0) {
    c2 = { label: t('ui.tooltip.stat.energy', undefined, loc), value: fmtRate(s.energyPerS, 0, true, loc) };
  }
  cells.push(c2);

  // Cell 3: range, replaced by storage (economy) or build power (builders).
  let c3: TooltipStat = { label: t('ui.tooltip.stat.range', undefined, loc), value: s.range > 0 ? wu(s.range) : NONE };
  if (s.storageMass > 0 && u.group === 'eco') {
    c3 = { label: t('ui.tooltip.stat.storage', undefined, loc), value: t('ui.tooltip.unit.massStore', { value: fmtInt(s.storageMass, loc) }, loc) };
  }
  if (s.storageEnergy > 0 && u.group === 'eco') {
    c3 = { label: t('ui.tooltip.stat.storage', undefined, loc), value: t('ui.tooltip.unit.energyStore', { value: fmtInt(s.storageEnergy, loc) }, loc) };
  }
  if (s.buildPower > 0 && u.group !== 'eco') {
    c3 = { label: t('ui.tooltip.stat.buildPower', undefined, loc), value: fmtInt(s.buildPower, loc) };
  }
  cells.push(c3);

  // Cell 4: speed for mobile units, upkeep or vision for structures.
  if (s.speed > 0) {
    cells.push({ label: t('ui.tooltip.stat.speed', undefined, loc), value: t('ui.tooltip.unit.speed', { value: fmtDec(s.speed, 1, loc) }, loc) });
  } else if (s.upkeepEnergyPerS > 0) {
    cells.push({
      label: t('ui.tooltip.stat.upkeep', undefined, loc),
      value: t('ui.tooltip.unit.energyRate', { value: `${MINUS}${fmtInt(s.upkeepEnergyPerS, loc)}` }, loc),
    });
  } else {
    cells.push({ label: t('ui.tooltip.stat.vision', undefined, loc), value: s.vision > 0 ? wu(s.vision) : NONE });
  }

  // Cell 5: build time at the current builder's BP; without a builder the regeneration.
  if (builderBp !== undefined && builderBp > 0) {
    cells.push({
      label: t('ui.tooltip.stat.buildTime', undefined, loc),
      value: t('ui.common.seconds', { n: fmtDec(s.buildTime / builderBp, 1, loc) }, loc),
      sub: t('ui.tooltip.atBp', { bp: fmtInt(builderBp, loc) }, loc),
    });
  } else {
    cells.push({ label: t('ui.tooltip.stat.regen', undefined, loc), value: s.regenPerS > 0 ? fmtRate(s.regenPerS, 1, true, loc) : NONE });
  }

  // Cell 6: tech tier (the commander has none).
  cells.push({ label: t('ui.tooltip.stat.tech', undefined, loc), value: s.tech > 0 ? t('ui.common.tier', { n: s.tech }, loc) : NONE });
  return cells;
}
