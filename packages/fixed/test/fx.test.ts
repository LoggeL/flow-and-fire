import { afterEach, describe, expect, it } from 'vitest';
import {
  FX_ONE,
  FX_RAW_MAX,
  FX_RAW_MIN,
  FX_SMALL_MAX_RAW,
  type Fx,
  type FxSmall,
  asArmyId,
  asFx,
  asHandle,
  floorDivExact,
  fx,
  fxAbs,
  fxAdd,
  fxCeilToInt,
  fxClamp,
  fxDist,
  fxDist2,
  fxDiv,
  fxDivInt,
  fxFloorToInt,
  fxFrac,
  fxFromInt,
  fxLen2D,
  fxLen3D,
  fxLerp,
  fxMul,
  fxMulInt,
  fxMulSmall,
  fxNeg,
  fxRoundToInt,
  fxSmall,
  fxSqrt,
  fxSub,
  handleGen,
  handleIndex,
  isqrt,
  makeHandle,
  setFixedDebug,
  toFxSmall,
} from '@faf/fixed';

afterEach(() => setFixedDebug(false));

describe('fx literal helpers', () => {
  it('rounds half up like Math.round', () => {
    expect(fx(1)).toBe(4096);
    expect(fx(1.5)).toBe(6144);
    expect(fx(-1.5)).toBe(-6144);
    expect(fx(0.1)).toBe(Math.round(0.1 * 4096));
    expect(fx(-0.1)).toBe(Math.round(-0.1 * 4096));
    expect(fx(3.0)).toBe(12288);
    expect(fx(1 / 8192)).toBe(1); // exactly half a raw unit → up
    expect(fx(-1 / 8192)).toBe(0); // Math.round(-0.5) === -0 → normalized 0
    expect(Object.is(fx(-0), 0)).toBe(true);
    for (let i = -2000; i <= 2000; i++) {
      const v = i / 997;
      expect(fx(v)).toBe(Math.round(v * 4096) + 0);
    }
  });

  it('rejects values outside int32', () => {
    expect(() => fx(524288)).toThrow(RangeError);
    expect(() => fx(Number.NaN)).toThrow(RangeError);
    expect(fx(524287)).toBe(524287 * 4096);
  });

  it('fxSmall/toFxSmall enforce the FxSmall range', () => {
    expect(fxSmall(0.5)).toBe(2048);
    expect(toFxSmall(asFx(FX_SMALL_MAX_RAW))).toBe(FX_SMALL_MAX_RAW);
    expect(() => toFxSmall(asFx(FX_SMALL_MAX_RAW + 1))).toThrow(RangeError);
    expect(() => fxSmall(8)).toThrow(RangeError);
  });
});

describe('fx basic arithmetic', () => {
  it('int conversions floor/ceil/round correctly for negatives', () => {
    expect(fxFromInt(3)).toBe(12288);
    expect(fxFromInt(-3)).toBe(-12288);
    expect(Object.is(fxFromInt(-0), 0)).toBe(true);
    expect(fxFloorToInt(asFx(-1))).toBe(-1);
    expect(fxFloorToInt(asFx(4095))).toBe(0);
    expect(fxFloorToInt(asFx(-4096))).toBe(-1);
    expect(fxCeilToInt(asFx(1))).toBe(1);
    expect(fxCeilToInt(asFx(-1))).toBe(0);
    expect(fxCeilToInt(asFx(4096))).toBe(1);
    expect(fxRoundToInt(asFx(2048))).toBe(1);
    expect(fxRoundToInt(asFx(2047))).toBe(0);
    expect(fxRoundToInt(asFx(-2048))).toBe(0);
    expect(fxRoundToInt(asFx(-2049))).toBe(-1);
    expect(fxFrac(asFx(-1))).toBe(4095);
  });

  it('add/sub/neg wrap to int32 and never produce −0', () => {
    expect(fxAdd(asFx(FX_RAW_MAX), asFx(1))).toBe(FX_RAW_MIN);
    expect(fxSub(asFx(FX_RAW_MIN), asFx(1))).toBe(FX_RAW_MAX);
    expect(Object.is(fxNeg(asFx(0)), 0)).toBe(true);
    expect(fxNeg(asFx(5))).toBe(-5);
    expect(fxAbs(asFx(-7))).toBe(7);
    expect(fxClamp(asFx(10), asFx(0), asFx(5))).toBe(5);
    expect(fxMulInt(fx(1.5), 3)).toBe(fx(4.5));
    expect(fxLerp(fx(0), fx(10), fx(0.5))).toBe(fx(5));
    expect(fxLerp(fx(10), fx(0), fx(0.25))).toBe(fx(7.5));
  });

  it('fxMul edge cases', () => {
    expect(fxMul(fx(1.5), fx(2))).toBe(fx(3));
    expect(fxMul(fx(-1.5), fx(2))).toBe(fx(-3));
    expect(fxMul(asFx(-1), asFx(1))).toBe(-1); // floor(-1/4096) = -1
    expect(fxMul(asFx(1), asFx(1))).toBe(0);
    expect(Object.is(fxMul(asFx(0), asFx(-5)), 0)).toBe(true);
  });

  it('fxMul debug detects inexact products', () => {
    setFixedDebug(true);
    expect(() => fxMul(asFx(FX_RAW_MAX), asFx(FX_RAW_MAX))).toThrow(RangeError);
    expect(fxMul(asFx(1 << 26), asFx(1 << 26))).toBe(Number(BigInt.asIntN(32, (1n << 52n) >> 12n)));
  });

  it('fxMulSmall debug throws when operands are not FxSmall', () => {
    const big = asFx(1 << 20) as FxSmall;
    setFixedDebug(false);
    expect(() => fxMulSmall(big, big)).not.toThrow();
    setFixedDebug(true);
    expect(() => fxMulSmall(big, big)).toThrow(RangeError);
    expect(fxMulSmall(fxSmall(1.5), fxSmall(-2))).toBe(fx(-3));
  });

  it('fxDiv: floor semantics for all sign combinations, division by zero throws', () => {
    expect(fxDiv(fx(3), fx(2))).toBe(fx(1.5));
    expect(fxDiv(fx(-3), fx(2))).toBe(fx(-1.5));
    expect(fxDiv(fx(3), fx(-2))).toBe(fx(-1.5));
    expect(fxDiv(fx(-3), fx(-2))).toBe(fx(1.5));
    expect(fxDiv(asFx(1), asFx(3 * FX_ONE))).toBe(0); // 4096/12288 → 0
    expect(fxDiv(asFx(-1), asFx(3 * FX_ONE))).toBe(-1); // floor(−0.33) = −1
    expect(fxDiv(asFx(1), asFx(-3 * FX_ONE))).toBe(-1);
    expect(fxDiv(asFx(-1), asFx(-3 * FX_ONE))).toBe(0);
    expect(Object.is(fxDiv(asFx(0), asFx(-7)), 0)).toBe(true);
    expect(fxDiv(asFx(FX_RAW_MIN), asFx(FX_RAW_MIN))).toBe(FX_ONE);
    expect(fxDiv(asFx(FX_RAW_MAX), asFx(FX_RAW_MAX))).toBe(FX_ONE);
    expect(() => fxDiv(fx(1), asFx(0))).toThrow(RangeError);
    expect(() => fxDivInt(fx(1), 0)).toThrow(RangeError);
    expect(fxDivInt(asFx(-7), 2)).toBe(-4);
  });

  it('floorDivExact corrects float quotients', () => {
    expect(floorDivExact(7, 2)).toBe(3);
    expect(floorDivExact(-7, 2)).toBe(-4);
    expect(floorDivExact(7, -2)).toBe(-4);
    expect(floorDivExact(-7, -2)).toBe(3);
    expect(Object.is(floorDivExact(0, -3), 0)).toBe(true);
    // Quotient close to an integer at large magnitude.
    const d = 2147483647;
    const n = d * 2097151 - 1; // < 2^52
    expect(floorDivExact(n, d)).toBe(2097150);
    expect(floorDivExact(n + 1, d)).toBe(2097151);
    expect(() => floorDivExact(1, 0)).toThrow(RangeError);
  });

  it('lengths and sqrt via isqrt', () => {
    expect(fxLen2D(fx(3), fx(4))).toBe(fx(5));
    expect(fxLen3D(fx(2), fx(3), fx(6))).toBe(fx(7));
    expect(fxDist(fx(1), fx(1), fx(4), fx(5))).toBe(fx(5));
    expect(fxDist2(fx(0), fx(0), fx(1), fx(1))).toBe(2 * FX_ONE * FX_ONE);
    expect(fxSqrt(fx(4))).toBe(fx(2));
    expect(fxSqrt(fx(2))).toBe(5792); // floor(sqrt(2)·4096)
    expect(fxSqrt(asFx(0))).toBe(0);
    expect(() => fxSqrt(asFx(-1))).toThrow(RangeError);
    expect(Object.is(isqrt(-0), 0)).toBe(true);
    expect(() => isqrt(-1)).toThrow(RangeError);
    expect(() => isqrt(2 ** 53)).toThrow(RangeError);
    expect(() => isqrt(Number.NaN)).toThrow(RangeError);
  });
});

describe('handles and brands', () => {
  it('packs index:20 | gen:12', () => {
    const h = makeHandle(0xfffff, 0xfff);
    expect(h).toBe(0xffffffff);
    expect(handleIndex(h)).toBe(0xfffff);
    expect(handleGen(h)).toBe(0xfff);
    const h2 = makeHandle(12345, 7);
    expect(handleIndex(h2)).toBe(12345);
    expect(handleGen(h2)).toBe(7);
    expect(asHandle(-1)).toBe(0xffffffff);
    expect(asArmyId(17)).toBe(1);
  });
});

describe('fx types', () => {
  it('rejects raw number arithmetic on brands at compile time', () => {
    const a = fx(1);
    const b = fx(2);
    // @ts-expect-error — Fx + Fx is a number, not an Fx
    const bad: Fx = a + b;
    expect(bad).toBe(fx(3));
    // @ts-expect-error — a plain number is not an Fx
    const bad2: Fx = 5;
    expect(bad2).toBe(5);
  });
});
