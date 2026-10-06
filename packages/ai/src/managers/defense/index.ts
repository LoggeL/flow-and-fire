/**
 * DefenseManager (ai.md §5.7, minimal A8): one point defense per attacked mex cluster.
 */
import type { ManagerFactory } from '../../brain.ts';
import { DefenseManager } from './defense-manager.ts';

export * from './defense-manager.ts';

/** Default ManagerFactory of the DefenseManager. */
export const defenseManager: ManagerFactory = { name: 'defense', create: (init) => new DefenseManager(init) };
