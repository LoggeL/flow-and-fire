import { describe, expect, it } from 'vitest';
import { RAW_PER_WU, rawToWu, wuToRaw } from '../../src/index.ts';

describe('units', () => {
  it('converts WU ↔ raw Q20.12', () => {
    expect(RAW_PER_WU).toBe(4096);
    expect(wuToRaw(1)).toBe(4096);
    expect(wuToRaw(256.5)).toBe(1050624);
    expect(wuToRaw(-0.25)).toBe(-1024);
    expect(wuToRaw(1 / 8192)).toBe(1); // rounds to nearest
    expect(rawToWu(4096 * 3 + 2048)).toBe(3.5);
    for (const x of [0, 1, 511.75, -37.125]) expect(rawToWu(wuToRaw(x))).toBe(x);
  });
});
