/**
 * Entity handles `index:20 | gen:12` (PLAN §2 "Sim-Speicher"). A handle stays valid as long as
 * the slot it names is alive with the same generation; freeing a slot bumps the generation so
 * stale handles resolve to −1.
 */

import {
  HANDLE_GEN_BITS,
  HANDLE_GEN_MASK,
  HANDLE_INDEX_BITS,
  HANDLE_INDEX_MASK,
  handleGen,
  handleIndex,
  makeHandle,
  type Handle,
} from '@faf/fixed';

export { HANDLE_GEN_BITS, HANDLE_GEN_MASK, HANDLE_INDEX_BITS, HANDLE_INDEX_MASK };

/** "No entity". Its index 0xFFFFF is never a valid slot (table caps are ≤ 0xFFFFF). */
export const HANDLE_NONE = 0xffffffff as Handle;

/** Packs slot index (20 bit) and generation (12 bit). */
export function packHandle(index: number, gen: number): Handle {
  return makeHandle(index, gen);
}

/** Slot index of a handle. */
export function unpackIndex(h: Handle | number): number {
  return handleIndex(h as Handle);
}

/** Generation of a handle. */
export function unpackGen(h: Handle | number): number {
  return handleGen(h as Handle);
}

/** Next generation after a free (12-bit wrap). */
export function nextGen(gen: number): number {
  return (gen + 1) & HANDLE_GEN_MASK;
}
