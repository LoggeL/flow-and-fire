import type { SimBpTable } from '@faf/blueprints/simbin';

/** Build-card roles; world strategic icons stay the FA-style hexagons. */
export type BuildRole = 'mass' | 'energy' | 'storage' | 'factory' | 'engineer' | 'radar' | 'defense' | 'artillery' | 'scout' | 'tank' | 'unit';

type Categories = Pick<SimBpTable, 'categoryNames' | 'categoryWord'>;
export function bpHasCategory(table: Categories, bp: number, name: string): boolean {
  const bit = table.categoryNames.indexOf(name);
  return bit >= 0 && (table.categoryWord(bp, bit >>> 5) & (1 << (bit & 31))) !== 0;
}
/** Role and tier from the compiled blueprint categories, never from display names. */
export function buildRole(table: Categories, bp: number): { role: BuildRole; tier: number } {
  const has = (name: string) => bpHasCategory(table, bp, name);
  const tier = has('TECH3') ? 3 : has('TECH2') ? 2 : has('TECH1') ? 1 : 0;
  const role: BuildRole = has('MASSEXTRACTION') ? 'mass' : has('ENERGYPRODUCTION') ? 'energy' : has('ENERGYSTORAGE') || has('MASSSTORAGE') ? 'storage'
    : has('FACTORY') ? 'factory' : has('RADAR') || (has('STRUCTURE') && has('INTELLIGENCE')) ? 'radar' : has('STRUCTURE') && (has('DEFENSE') || has('DIRECTFIRE')) ? 'defense'
    : has('ENGINEER') ? 'engineer' : has('ARTILLERY') || has('INDIRECTFIRE') ? 'artillery' : has('SCOUT') ? 'scout' : has('DIRECTFIRE') ? 'tank' : 'unit';
  return { role, tier };
}

/** Class colours shared by build glyphs and the placement volume preview. */
export const BUILD_ROLE_COLORS: Record<BuildRole, string> = {
  mass: 'var(--mass)', energy: 'var(--energy)', storage: '#e2a64a', factory: '#8fc3d6', engineer: '#d8c27a',
  radar: '#7fd6c4', defense: '#e07a5f', artillery: '#e0915f', scout: '#a7d3e8', tank: '#c9d6de', unit: '#c9d6de',
};
