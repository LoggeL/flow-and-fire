/** Public lifecycle compatibility surface; systems import the acyclic storage/liveness seams. */
export {spawnUnit,cleanupPhase} from './unit-storage.ts';
export {killUnit} from './lifecycle.ts';
export {isActive} from './liveness.ts';
