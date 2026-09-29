// Shared test support: the checked-in hollow-ridge map and a deterministic PRNG.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientMap } from '../../src/map.ts';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

let cached: ClientMap | null = null;

/** content/maps/hollow-ridge.rtsmap as ClientMap (cached per worker). */
export function hollowRidge(): ClientMap {
  cached ??= ClientMap.fromBytes(new Uint8Array(readFileSync(join(REPO_ROOT, 'content/maps/hollow-ridge.rtsmap'))));
  return cached;
}

/** mulberry32: deterministic float PRNG in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
