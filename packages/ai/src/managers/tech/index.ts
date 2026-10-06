/**
 * TechManager (ai.md §5.2, T1 → T2). `techManager` is the ManagerFactory (composition: tai-p5).
 */
import type { ManagerFactory } from '../../brain.ts';
import { TechManager } from './manager.ts';

export const techManager: ManagerFactory = {
  name: 'tech',
  create: (init) => new TechManager(init),
};

export * from './manager.ts';
