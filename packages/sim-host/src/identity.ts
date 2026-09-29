/**
 * Sim identity inputs of MS1 (PLAN §3.1 "Sim-Identität"):
 * simId = computeSimId(SIM_BUILD, bpSimHash, mapSimHash, modList).
 */

import { xxHash32 } from '@faf/fixed';
import { computeSimId, utf8Encode } from '@faf/protocol';

/**
 * Version tag of the simulation code. Bump whenever sim behaviour changes in a way that makes
 * old command logs/replays diverge (it is part of simId).
 */
export const SIM_BUILD = 'faf-sim/ms1.1';

/** Mods loaded (MS1: none). */
export const MOD_LIST: readonly string[] = [];

/**
 * mapSimHash of the flat MS1 test plane (no heightmap/nav data yet): xxHash32 of its canonical
 * description. Real maps hash their static sim data (MS2).
 */
export function testPlaneMapSimHash(mapSizeWu: number): number {
  const b = utf8Encode(`faf-map:testplane:v1:size=${mapSizeWu}`);
  return xxHash32(b, 0, b.length, 0) >>> 0;
}

/** simId of a session on the test plane. */
export function simIdOf(bpSimHash: number, mapSizeWu: number): number {
  return computeSimId(SIM_BUILD, bpSimHash, testPlaneMapSimHash(mapSizeWu), MOD_LIST) >>> 0;
}
