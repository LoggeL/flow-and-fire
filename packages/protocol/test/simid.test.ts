import { xxHash32 } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import { computeSimId, simIdBytes, utf8Encode } from '../src/index.ts';

describe('simId', () => {
  it('has a documented canonical byte encoding', () => {
    const b = simIdBytes('b1', 0x11223344, 0xaabbccdd, ['core']);
    expect(Array.from(b)).toEqual([
      ...Array.from(utf8Encode('FAFSIMID')),
      2, 0, 0, 0, 0x62, 0x31,
      0x44, 0x33, 0x22, 0x11,
      0xdd, 0xcc, 0xbb, 0xaa,
      1, 0, 0, 0,
      4, 0, 0, 0, 0x63, 0x6f, 0x72, 0x65,
    ]);
    expect(computeSimId('b1', 0x11223344, 0xaabbccdd, ['core'])).toBe(xxHash32(b, 0, b.length, 0));
  });

  it('is stable (pinned) and sensitive to every input incl. mod order', () => {
    const base = computeSimId('ms1-dev', 0x12345678, 0x9abcdef0, ['core', 'balance']);
    expect(base).toBe(computeSimId('ms1-dev', 0x12345678, 0x9abcdef0, ['core', 'balance']));
    expect(base >>> 0).toBe(base);
    expect(base).toBe(3416417874);
    const variants = [
      computeSimId('ms1-dev2', 0x12345678, 0x9abcdef0, ['core', 'balance']),
      computeSimId('ms1-dev', 0x12345679, 0x9abcdef0, ['core', 'balance']),
      computeSimId('ms1-dev', 0x12345678, 0x9abcdef1, ['core', 'balance']),
      computeSimId('ms1-dev', 0x12345678, 0x9abcdef0, ['balance', 'core']),
      computeSimId('ms1-dev', 0x12345678, 0x9abcdef0, ['corebalance']),
      computeSimId('ms1-dev', 0x12345678, 0x9abcdef0, []),
    ];
    for (const v of variants) expect(v).not.toBe(base);
  });

  it('utf8Encode matches the platform encoder', () => {
    for (const s of ['', 'abc', 'Größe', '€', '𝄞 music', 'x\ud800y']) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(new TextEncoder().encode(s)));
    }
  });
});
