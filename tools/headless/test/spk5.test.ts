import { xxHash32 } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import { crossCheckXxh32, fillPseudoRandom, loadWasmXxh32 } from '../src/spk5/bench.ts';
import { loadXxh32Wasm } from '../scripts/lib.ts';

describe('SPK5 WASM xxHash32', () => {
  it('matches the reference vectors', async () => {
    const w = await loadWasmXxh32(loadXxh32Wasm(), 1);
    expect(w.hash(0, 0, 0)).toBe(0x02cc5d05); // XXH32("", 0)
    const abc = new TextEncoder().encode('abc');
    w.bytes.set(abc, 0);
    expect(w.hash(0, 3, 0)).toBe(0x32d153ff); // XXH32("abc", 0)
    expect(w.hash(0, 3, 0)).toBe(xxHash32(abc, 0, 3, 0));
  });

  it('equals the JS xxHash32 on random data (every length 0..96 at offsets 0..7, random ranges and seeds)', async () => {
    const w = await loadWasmXxh32(loadXxh32Wasm(), 16);
    fillPseudoRandom(w.bytes, 0xdecafbad);
    for (let off = 0; off < 8; off++) {
      for (let len = 0; len <= 96; len++) {
        for (const seed of [0, 1, 0x9e3779b1, 0xffffffff]) {
          expect(w.hash(off, len, seed)).toBe(xxHash32(w.bytes, off, len, seed));
        }
      }
    }
    for (const s of [1, 2, 3]) {
      const r = crossCheckXxh32(w, 300, s);
      expect(r.mismatches, r.firstMismatch ?? '').toBe(0);
    }
    expect(w.hash(0, w.bytes.length, 7)).toBe(xxHash32(w.bytes, 0, w.bytes.length, 7));
  });
});
