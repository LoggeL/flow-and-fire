import { RosterTable, type AiBlueprint, type AiBlueprintTable, type OpeningsDoc } from '@faf/ai';
import type { SimBpTable } from '@faf/blueprints/simbin';
import { CategoryRegistry, categoryExprNames, compileCategoryExpr, MOTION_LAYER_NAMES, mulDiv, parseCategoryExpr } from '@faf/rules';

/** Vocabulary is not a unit roster: only the compiled table supplies entities and numbers. */
const AI_CATEGORIES = ['COMMAND','ENGINEER','FACTORY','STRUCTURE','MOBILE','LAND','AIR','TECH1','TECH2','TECH3','TECH4','ENERGYSTORAGE','MASSSTORAGE','MASSEXTRACTION','HYDROCARBON','DIRECTFIRE','INDIRECTFIRE','ANTIAIR','SCOUT','SNIPER','TANK','BOT','SHIELD','DEFENSE','BOMBER','GUNSHIP','RADAR','ENERGYPRODUCTION','TRANSPORTATION','UPGRADE'];

/** Actual sim IDs, economy rates and mounted weapons, never the full design roster's indices. */
export function gameBlueprints(table: SimBpTable, openings: OpeningsDoc, incomeFactorQ16=65536): AiBlueprintTable {
  const names = [...table.categoryNames, ...AI_CATEGORIES];
  for (const expr of [...Object.values(openings.roles), ...table.exprSources]) categoryExprNames(parseCategoryExpr(expr), names);
  const registry = new CategoryRegistry(names), original = new CategoryRegistry(table.categoryNames);
  const list: AiBlueprint[] = [];
  for (let i = 0; i < table.count; i++) {
    const categories = original.namesOf(table.categoryMasks, i * 4);
    let dpsSurface = 0, dpsAir = 0, rangeMax = 0, rangeMin = Infinity, splash = 0;
    const first = table.firstMountCol[i]!, count = table.mountCountCol[i]!;
    for (let m = first; m < first + count; m++) {
      const weapon = table.mountWeaponCol[m]!, mask = table.mountLayerMaskCol[m]!;
      const reload = table.weaponReloadTicksCol[weapon]!;
      const dps = reload > 0 ? table.weaponDamageCol[weapon]! * table.weaponSalvoCol[weapon]! * 10 / reload : 0;
      if ((mask & 1) !== 0) dpsSurface += dps;
      if ((mask & 32) !== 0) dpsAir += dps;
      rangeMax = Math.max(rangeMax, table.weaponRangeCol[weapon]! / 4096);
      rangeMin = Math.min(rangeMin, table.weaponMinRangeCol[weapon]! / 4096);
      splash = Math.max(splash, table.weaponDamageRadiusCol[weapon]! / 4096);
    }
    const hp = table.maxHpCol[i]!, exprIndex = table.buildableByCol[i]!;
    const previous = Array.from(table.upgradesToCol).findIndex(x => x === i);
    list.push({ index: i, id: table.ids[i]!, name: table.ids[i]!, tech: categories.includes('COMMAND') ? 0 : [1,2,3,4].find(t => categories.includes(`TECH${t}`)) ?? 0,
      categories: registry.maskOf(categories), categoryNames: categories,
      mass: table.massCostCol[i]!, energy: table.energyCostCol[i]!, buildTime: table.buildTimeCol[i]!,
      buildPower: table.buildPowerQ16PerTickCol[i]! * 10 / 65536,
      massPerSec: mulDiv(table.massIncomeMilliPerTickCol[i]!,incomeFactorQ16,65536) / 100, energyPerSec: mulDiv(table.energyIncomeMilliPerTickCol[i]!,incomeFactorQ16,65536) / 100,
      upkeepEnergyPerSec: table.energyUpkeepMilliPerTickCol[i]! / 100,
      storageMass: table.massStorageMilliCol[i]! / 1000, storageEnergy: table.energyStorageMilliCol[i]! / 1000,
      hp, shieldHp: 0, hpEff: hp, speed: table.speed[i]! * 10 / 4096,
      footprint: [table.footprintWCol[i]!, table.footprintHCol[i]!], isStructure: categories.includes('STRUCTURE'),
      layer: MOTION_LAYER_NAMES[table.layerCol[i]!]!, vision: table.visionCol[i]! / 4096, radar: 0,
      dpsSurface, dpsAir, threatSurface: Math.sqrt(dpsSurface * hp), threatAir: Math.sqrt(dpsAir * hp),
      rangeMax, rangeMin: rangeMin === Infinity ? 0 : rangeMin, splash,
      upgradesTo: table.upgradesToCol[i]!, upgradeFrom: previous,
      buildableBy: exprIndex < 0 ? null : compileCategoryExpr(table.exprSources[exprIndex]!, registry), msFirst: 'MS4',
    });
  }
  return new RosterTable(list, registry);
}
