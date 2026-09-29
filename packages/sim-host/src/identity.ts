/**
 * Sim identity inputs (PLAN §3.1 "Sim-Identität"):
 * simId = computeSimId(SIM_BUILD, bpSimHash, mapSimHash, modList).
 * mapSimHash is always @faf/formats `mapSimHash(map)` — the flat test plane is a generated map
 * (formats `createTestPlaneMap`) like any other.
 */

import { computeSimId } from '@faf/protocol';
import { SIM_BUILD } from '@faf/sim';

/**
 * Version tag of the simulation code, owned by @faf/sim next to the code it versions (bump rule
 * and golden enforcement there).
 */
export { SIM_BUILD };

/** Mods loaded (MS2: none). */
export const MOD_LIST: readonly string[] = [];

/** simId of a session with the given map identity. */
export function simIdFor(bpSimHash: number, mapSimHash: number): number {
  return computeSimId(SIM_BUILD, bpSimHash, mapSimHash, MOD_LIST) >>> 0;
}
