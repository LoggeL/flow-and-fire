import type { SimBpTable } from '@faf/blueprints/simbin';
import type { SkirmishConfig } from '@faf/hud';
import { validateSkirmishInitialization, type SkirmishInitialization } from '@faf/protocol';

/** Menu army order is the command army order, and start indices refer to verified map records. */
export function skirmishInitialization(config: SkirmishConfig, table: SimBpTable): SkirmishInitialization {
  const faction = table.factionIds.indexOf('core:faction_core');
  if (faction < 0) throw new Error('Die gewählte Fraktion ist in den Spielinhalten nicht vorhanden.');
  if (config.slots.filter(slot => slot.controller === 'human').length !== 1) throw new Error('Ein lokales Gefecht benötigt genau einen menschlichen Spieler.');
  const setup: SkirmishInitialization = {
    kind: 'skirmish', faction,
    slots: config.slots.map(slot => ({ start: slot.start, team: slot.team, faction, controller: slot.controller,
      ...(slot.controller === 'ai' && slot.ai !== null ? { difficulty: slot.ai.difficulty, aixFactorQ16: Math.round((slot.ai.aix ? slot.ai.aixFactor : 1) * 65536) } : {}) })),
    rules: { unitCap: config.rules.unitCap, fog: config.rules.fog, victory: config.rules.victory },
  };
  validateSkirmishInitialization(setup, config.slots.length);
  return setup;
}
