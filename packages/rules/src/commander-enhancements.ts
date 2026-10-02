/** Supported commander modules, represented by real immutable unit blueprints. */
export type CommanderEnhancementId = 'engineering' | 'cannon' | 'armor';
export type CommanderEnhancementSlot = 'left' | 'right' | 'back';
export const COMMANDER_ENHANCEMENTS = [
  { id: 'engineering', slot: 'left', bit: 1 },
  { id: 'cannon', slot: 'right', bit: 2 },
  { id: 'armor', slot: 'back', bit: 4 },
] as const;
/** Bit index is the installed module set. Historical engineering/armored IDs stay valid. */
export const COMMANDER_VARIANTS = [
  'core:cmd_commander', 'core:cmd_commander_engineering',
  'core:cmd_commander_cannon', 'core:cmd_commander_engineering_cannon',
  'core:cmd_commander_protection', 'core:cmd_commander_armored',
  'core:cmd_commander_cannon_protection', 'core:cmd_commander_enhanced',
] as const;
export function commanderEnhancementMask(id: string): number {
  return COMMANDER_VARIANTS.indexOf(id as typeof COMMANDER_VARIANTS[number]);
}
/** Exactly one additional module, with every installed module preserved. */
export function commanderEnhancementAdded(source: string, target: string): CommanderEnhancementId | null {
  const before = commanderEnhancementMask(source), after = commanderEnhancementMask(target);
  if (before < 0 || after < 0 || (before & after) !== before) return null;
  const added = before ^ after;
  for (const module of COMMANDER_ENHANCEMENTS) if (added === module.bit) return module.id;
  return null;
}
export function commanderEnhancementTarget(source: string, moduleId: CommanderEnhancementId): string | null {
  const mask = commanderEnhancementMask(source), module = COMMANDER_ENHANCEMENTS.find(entry => entry.id === moduleId);
  return mask < 0 || !module || (mask & module.bit) !== 0 ? null : COMMANDER_VARIANTS[mask | module.bit]!;
}
/** Standalone variant carries the cost/work of its module, independent of install order. */
export function commanderEnhancementCostId(moduleId: CommanderEnhancementId): string {
  const module = COMMANDER_ENHANCEMENTS.find(entry => entry.id === moduleId)!;
  return COMMANDER_VARIANTS[module.bit]!;
}
