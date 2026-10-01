import { createBrain, type AiBrain, type ManagerName } from './brain.ts';
import { defenseManager,economyManager,engineerManager,factoryManager,intelManager,openingManager,platoonManager,techManager } from './managers/index.ts';
export function createDefaultBrain(options:{managers?:readonly ManagerName[]}={}):AiBrain{
  const factories=[intelManager,openingManager,economyManager,techManager,defenseManager,factoryManager,engineerManager,platoonManager];
  return createBrain({managers:factories.filter(f=>!options.managers||options.managers.includes(f.name))});
}
