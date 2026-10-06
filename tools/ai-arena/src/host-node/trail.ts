/**
 * Hash trails for host comparisons (AI-DET-01 analogue: "identischer Command-Strom, Hash je 600
 * Ticks"): the applied command log is cut into windows of `window` ticks, each window is encoded
 * as a protocol batch (application ticks included) and hashed with xxHash32; world hashes are
 * sampled at every multiple of `window` before the step of that tick.
 */
import { xxHash32 } from '@faf/fixed';
import { encodeBatch, type CommandEnvelope } from '@faf/protocol';
import type { ArenaWorld, LoggedCommand } from '../world/world.ts';

export const TRAIL_WINDOW = 600;

/** xxHash32 per window of the command log (index = tick / window) up to `endTick`. */
export function commandTrail(log: readonly LoggedCommand[], endTick: number, window: number = TRAIL_WINDOW): number[] {
  const n = Math.max(1, Math.ceil(endTick / window));
  const buckets: CommandEnvelope[][] = [];
  for (let i = 0; i < n; i++) buckets.push([]);
  for (const c of log) {
    const i = Math.floor(c.tick / window);
    if (i >= n) throw new RangeError(`commandTrail: command at tick ${c.tick} after endTick ${endTick}`);
    // The logged application tick is part of the stream (a late command would change it).
    buckets[i]!.push({ ...c.env, tick: c.tick as CommandEnvelope['tick'] });
  }
  return buckets.map((b) => {
    const bytes = encodeBatch(b);
    return xxHash32(bytes, 0, bytes.length, 0x41495452);
  });
}

/** Records the world hash before the step of every tick ≡ 0 (mod window); use as runMatch onTick. */
export class WorldHashTrail {
  readonly hashes: { tick: number; hash: number }[] = [];
  readonly window: number;

  constructor(window: number = TRAIL_WINDOW) {
    this.window = window;
  }

  readonly onTick = (world: ArenaWorld, tick: number): void => {
    if (tick % this.window === 0) this.hashes.push({ tick, hash: world.hash() });
  };
}
