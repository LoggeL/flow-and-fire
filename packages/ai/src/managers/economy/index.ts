/**
 * EconomyManager (ai.md §5.1). `economyManager` is the ManagerFactory (composition: tai-p5).
 */
import type { ManagerFactory } from '../../brain.ts';
import { EconomyManager } from './manager.ts';

export const economyManager: ManagerFactory = {
  name: 'economy',
  create: (init) => new EconomyManager(init),
};

export * from './manager.ts';
export * from './balance.ts';
