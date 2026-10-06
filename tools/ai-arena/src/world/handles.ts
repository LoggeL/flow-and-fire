/**
 * Entity handles like the sim (PLAN §3.5): `index:20 | gen:12`, slots are reused through a FIFO
 * freelist and the generation is bumped on every free. Generations start at 1, so a handle is never
 * 0 (0 = "no unit" in orders and perception).
 */
import { HANDLE_GEN_MASK, HANDLE_INDEX_MASK, makeHandle } from '@faf/fixed';

export class HandleTable {
  private gens: number[] = [];
  private live: boolean[] = [];
  /** FIFO freelist: slots in the order they were freed. */
  private free: number[] = [];
  private freeHead = 0;

  /** Number of slots ever allocated (iteration bound). */
  get highWater(): number {
    return this.gens.length;
  }

  /** Allocates a slot; returns its handle. */
  alloc(): number {
    let slot: number;
    if (this.freeHead < this.free.length) {
      slot = this.free[this.freeHead++]!;
      if (this.freeHead > 1024 && this.freeHead * 2 > this.free.length) {
        this.free = this.free.slice(this.freeHead);
        this.freeHead = 0;
      }
    } else {
      slot = this.gens.length;
      if (slot > HANDLE_INDEX_MASK) throw new RangeError('arena: handle index space exhausted');
      this.gens.push(1);
      this.live.push(false);
    }
    this.live[slot] = true;
    return makeHandle(slot, this.gens[slot]!);
  }

  /** Frees a live slot (generation +1, skipping 0) and appends it to the freelist. */
  freeSlot(slot: number): void {
    if (this.live[slot] !== true) throw new Error(`arena: slot ${slot} is not live`);
    this.live[slot] = false;
    let g = (this.gens[slot]! + 1) & HANDLE_GEN_MASK;
    if (g === 0) g = 1;
    this.gens[slot] = g;
    this.free.push(slot);
  }

  /** Slot of a live handle with the current generation, −1 otherwise. */
  resolve(handle: number): number {
    const slot = handle & HANDLE_INDEX_MASK;
    if (slot >= this.gens.length || this.live[slot] !== true) return -1;
    return makeHandle(slot, this.gens[slot]!) === handle >>> 0 ? slot : -1;
  }
}
