import { afterEach, describe, expect, it } from 'vitest';
import { safeAdd, safeSub, setFixedDebug, toSafeInt } from '@faf/fixed';

afterEach(() => setFixedDebug(false));

describe('SafeInt', () => {
  it('normalizes −0 to +0', () => {
    expect(Object.is(toSafeInt(-0), 0)).toBe(true);
    expect(Object.is(toSafeInt(0 * -1), 0)).toBe(true);
    expect(Object.is(safeSub(toSafeInt(5), 5), 0)).toBe(true);
    expect(Object.is(safeAdd(toSafeInt(-0), -0), 0)).toBe(true);
  });

  it('passes integers through unchanged', () => {
    expect(toSafeInt(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(toSafeInt(-123)).toBe(-123);
  });

  it('debug mode rejects non-integers and unsafe magnitudes', () => {
    expect(() => toSafeInt(1.5)).not.toThrow();
    setFixedDebug(true);
    expect(() => toSafeInt(1.5)).toThrow(RangeError);
    expect(() => toSafeInt(2 ** 53)).toThrow(RangeError);
    expect(() => toSafeInt(Number.NaN)).toThrow(RangeError);
    expect(() => safeAdd(toSafeInt(Number.MAX_SAFE_INTEGER), 1)).toThrow(RangeError);
    expect(toSafeInt(-0)).toBe(0);
  });
});
