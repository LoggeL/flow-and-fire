import { describe, expect, it } from 'vitest';
import { HALF_MAX, fromHalf, toHalf } from '../../src/index.ts';

const f16round = (Math as unknown as { f16round?: (x: number) => number }).f16round;

describe('binary16', () => {
  it('round-trips all 65536 bit patterns (NaN → canonical quiet NaN)', () => {
    let nan = 0;
    for (let h = 0; h < 65536; h++) {
      const f = fromHalf(h);
      if (Number.isNaN(f)) {
        nan++;
        expect(toHalf(f)).toBe(0x7e00);
      } else if (toHalf(f) !== h) {
        throw new Error(`pattern 0x${h.toString(16)} → ${f} → 0x${toHalf(f).toString(16)}`);
      }
    }
    expect(nan).toBe(2 * 1023);
  });

  it('decodes special values', () => {
    expect(fromHalf(0x3c00)).toBe(1);
    expect(fromHalf(0xc000)).toBe(-2);
    expect(fromHalf(0x7bff)).toBe(HALF_MAX);
    expect(fromHalf(0x0001)).toBe(2 ** -24);
    expect(fromHalf(0x0400)).toBe(2 ** -14);
    expect(fromHalf(0x7c00)).toBe(Infinity);
    expect(fromHalf(0xfc00)).toBe(-Infinity);
    expect(Object.is(fromHalf(0x8000), -0)).toBe(true);
  });

  it('rounds to nearest, ties to even', () => {
    expect(toHalf(1 + 2 ** -11)).toBe(0x3c00); // tie → even (down)
    expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02); // tie → even (up)
    expect(toHalf(1 + 2 ** -11 + 2 ** -30)).toBe(0x3c01); // just above the tie
    expect(toHalf(65519)).toBe(0x7bff);
    expect(toHalf(65520)).toBe(0x7c00); // tie with the next (infinite) step → overflow
    expect(toHalf(1e9)).toBe(0x7c00);
    expect(toHalf(-1e9)).toBe(0xfc00);
    expect(toHalf(2 ** -24)).toBe(0x0001);
    expect(toHalf(2 ** -25)).toBe(0x0000); // tie between 0 and 1 → 0
    expect(toHalf(2 ** -25 * 1.0001)).toBe(0x0001);
    expect(toHalf(3 * 2 ** -25)).toBe(0x0002); // 1.5 → 2
    expect(toHalf(2 ** -14 - 2 ** -25)).toBe(0x0400); // subnormal rounds up into the smallest normal
    expect(toHalf(-0)).toBe(0x8000);
    expect(toHalf(0)).toBe(0);
    expect(toHalf(Infinity)).toBe(0x7c00);
    expect(toHalf(Number.NaN)).toBe(0x7e00);
    expect(toHalf(2 - 2 ** -12)).toBe(0x4000); // mantissa overflow bumps the exponent
  });

  it('agrees with Math.f16round over pseudo-random doubles', () => {
    if (f16round === undefined) return;
    let s = 0x2545f491;
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 200_000; i++) {
      const exp = Math.floor(next() * 48) - 30;
      const x = (next() * 2 - 1) * 2 ** exp;
      const want = f16round(x);
      const got = fromHalf(toHalf(x));
      if (!Object.is(got, want)) throw new Error(`${x}: got ${got}, want ${want}`);
    }
  });
});
