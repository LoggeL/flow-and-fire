/**
 * IntelManager (ai.md §5.6): 16-WU threat grid with lazy decay (replaces the blackboard's local
 * threat estimate after its first pass) and scout routes. Also exports the unit classification
 * shared by the army/situation managers.
 */
import type { ManagerFactory } from '../../brain.ts';
import { IntelManager, type IntelOptions } from './intel-manager.ts';

export * from './threat-grid.ts';
export * from './unit-classes.ts';
export * from './intel-manager.ts';

/** ManagerFactory of the IntelManager with options. */
export function createIntelManager(opts: IntelOptions = {}): ManagerFactory {
  return { name: 'intel', create: (init) => new IntelManager(init, opts) };
}

/** Default ManagerFactory of the IntelManager. */
export const intelManager: ManagerFactory = createIntelManager();
