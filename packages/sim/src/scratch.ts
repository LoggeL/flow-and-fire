/**
 * Transient scratch buffers of the sim phases (not simulation state): every value is written
 * before it is read within one phase call, nothing survives a step semantically. Module-level so
 * the tick path allocates nothing. The stamp counter only makes "marked in this call" checks
 * O(1) without clearing the stamp array.
 */
import { CAP_UNITS, MAX_SEPARATION_NEIGHBORS } from './constants.ts';

export const SC = {
  /** Unit slots of the current command (sorted by slot). */
  units: new Int32Array(CAP_UNITS),
  /** Per-slot stamp (equal to `stampGen` ⇔ marked in the current call). */
  stamp: new Int32Array(CAP_UNITS),
  stampGen: 0,
  /** Offsets of the current group command (Fx), indexed like `units`. */
  offX: new Int32Array(CAP_UNITS),
  offZ: new Int32Array(CAP_UNITS),
  /** Index into `units` per slot (valid where stamped). */
  indexOf: new Int32Array(CAP_UNITS),
  /** Collision displacement accumulators per slot (Fx). */
  dx: new Int32Array(CAP_UNITS),
  dz: new Int32Array(CAP_UNITS),
  /** Moving unit that pushed an idle unit in the collision pass (−1 = none), per slot. */
  pushedBy: new Int32Array(CAP_UNITS),
  /** Overlap seen by a unit in the collision pass (sleep decision), per slot. */
  overlap: new Uint8Array(CAP_UNITS),
  /** Nearest-neighbour selection of the separation (slot, distance). */
  nbSlot: new Int32Array(MAX_SEPARATION_NEIGHBORS),
  nbDist: new Int32Array(MAX_SEPARATION_NEIGHBORS),
  /** Nav outputs (x, z). */
  pt: new Int32Array(2),
  pt2: new Int32Array(2),
  /** Path points of the watch section. */
  points: new Int32Array(64),
};

/** Starts a new stamp generation (all previous marks become invalid). */
export function nextStamp(): number {
  SC.stampGen = (SC.stampGen + 1) | 0;
  if (SC.stampGen === 0) {
    SC.stamp.fill(0);
    SC.stampGen = 1;
  }
  return SC.stampGen;
}
