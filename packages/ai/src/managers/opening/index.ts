/**
 * OpeningRunner (ai.md §4, A1). `openingManager` is the ManagerFactory (composition: tai-p5).
 */
import type { ManagerFactory } from '../../brain.ts';
import { OpeningRunner } from './runner.ts';

export const openingManager: ManagerFactory = {
  name: 'opening',
  create: (init) => new OpeningRunner(init),
};

export * from './runner.ts';
export * from './plan.ts';
