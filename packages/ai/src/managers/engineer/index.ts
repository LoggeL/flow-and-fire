/**
 * EngineerManager (ai.md §5.3) and the shared placement/spot/job helpers of the build managers.
 * `engineerManager` is the ManagerFactory; the composition (`createDefaultBrain`) is tai-p5.
 */
import type { ManagerFactory } from '../../brain.ts';
import { EngineerManager } from './manager.ts';

export const engineerManager: ManagerFactory = {
  name: 'engineer',
  create: (init) => new EngineerManager(init),
};

export * from './manager.ts';
export * from './shared.ts';
export * from './placement.ts';
export * from './spots.ts';
export * from './jobs.ts';
