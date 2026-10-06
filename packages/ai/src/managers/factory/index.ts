/**
 * FactoryManager (ai.md §5.4): engineers up to the target, production requests, base mix with
 * counter table as repeat loops, scout replacement, rally. Composition (createDefaultBrain) is
 * tai-p5's job; this module only exports the factory.
 */
import type { ManagerFactory } from '../../brain.ts';
import { FactoryManager, type FactoryManagerOptions } from './factory-manager.ts';

export * from './mix.ts';
export * from './factory-manager.ts';

/** ManagerFactory of the FactoryManager with options. */
export function createFactoryManager(opts: FactoryManagerOptions = {}): ManagerFactory {
  return { name: 'factory', create: (init) => new FactoryManager(init, opts) };
}

/** Default ManagerFactory of the FactoryManager. */
export const factoryManager: ManagerFactory = createFactoryManager();
