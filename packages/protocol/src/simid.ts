/**
 * Sim identity (PLAN §3.1): simId = xxHash32(simBuild ‖ bpSimHash ‖ mapSimHash ‖ modList).
 * Two sessions/replays are compatible iff their simIds match.
 *
 * Canonical bytes (little-endian):
 *   "FAFSIMID" | u32 len + UTF-8 simBuild | u32 bpSimHash | u32 mapSimHash |
 *   u32 modCount | per mod (in load order): u32 len + UTF-8 mod id
 */

import { xxHash32 } from '@faf/fixed';
import { utf8Encode } from './bytes.ts';

const TAG = 'FAFSIMID';

/** Canonical byte encoding of the simId inputs. */
export function simIdBytes(
  simBuild: string,
  bpSimHash: number,
  mapSimHash: number,
  modList: readonly string[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const u32 = (v: number): Uint8Array => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    return b;
  };
  const str = (s: string): void => {
    const b = utf8Encode(s);
    parts.push(u32(b.length), b);
  };
  parts.push(utf8Encode(TAG));
  str(simBuild);
  parts.push(u32(bpSimHash), u32(mapSimHash), u32(modList.length));
  for (const m of modList) str(m);
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** simId as u32. Mod order is significant (load order changes the simulation). */
export function computeSimId(
  simBuild: string,
  bpSimHash: number,
  mapSimHash: number,
  modList: readonly string[],
): number {
  const b = simIdBytes(simBuild, bpSimHash, mapSimHash, modList);
  return xxHash32(b, 0, b.length, 0);
}
