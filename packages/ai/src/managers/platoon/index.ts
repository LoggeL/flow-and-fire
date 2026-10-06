/**
 * PlatoonManager (ai.md §5.5): waves (forming → staging → attack → retreat, merge), mandatory first
 * attack at waves.maxS, raids, hunts and commander control (leash, burst retreat, overcharge).
 */
import type { ManagerFactory } from '../../brain.ts';
import { PlatoonManager, type PlatoonManagerOptions } from './platoon-manager.ts';

export * from './spatial.ts';
export * from './scene.ts';
export * from './targets.ts';
export * from './commander.ts';
export * from './platoon-manager.ts';

/** ManagerFactory of the PlatoonManager with options. */
export function createPlatoonManager(opts: PlatoonManagerOptions = {}): ManagerFactory {
  return { name: 'platoon', create: (init) => new PlatoonManager(init, opts) };
}

/** Default ManagerFactory of the PlatoonManager. */
export const platoonManager: ManagerFactory = createPlatoonManager();
