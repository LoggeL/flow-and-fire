import { afterEach, describe, expect, it } from 'vitest';
import {
  FX_MUL_OPERAND_MAX,
  FX_RAW_MAX,
  FX_RAW_MIN,
  FX_SMALL_MAX_RAW,
  type Fx,
  type FxSmall,
  fxDiv,
  fxMul,
  fxMulSmall,
  isqrt,
  setFixedDebug,
} from '@faf/fixed';
import { TestRng, bigFloorDiv } from './support/prng.ts';

/**
 * L1 BigInt oracle (PLAN §3.12, MS1 acceptance): 10^6 cases per operation, 0 deviations.
 * The oracle defines the i64-port semantics: exact product/quotient, floor, then `as i32`.
 */
const N = 1_000_000;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

afterEach(() => setFixedDebug(false));

function oracleMul(a: number, b: number): number {
  return Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b)) >> 12n));
}

function oracleDiv(a: number, b: number): number {
  return Number(BigInt.asIntN(32, bigFloorDiv(BigInt(a) * 4096n, BigInt(b))));
}

function isIsqrt(n: number, r: number): boolean {
  const N0 = BigInt(n);
  const R = BigInt(r);
  return R >= 0n && R * R <= N0 && (R + 1n) * (R + 1n) > N0;
}

const EDGE_MUL = [
  0, 1, -1, 2, -2, 4095, -4095, 4096, -4096, 4097, -4097, 8191, 8192, -8192, 32767, -32768,
  FX_MUL_OPERAND_MAX, -FX_MUL_OPERAND_MAX, FX_MUL_OPERAND_MAX - 1, -(FX_MUL_OPERAND_MAX - 1),
];

describe('BigInt oracle', () => {
  it('fxMul matches floor(a·b/4096) as i32 in 10^6 cases', () => {
    const rng = new TestRng(0xf1_0001);
    let mismatches = 0;
    let first = '';
    const check = (a: number, b: number): void => {
      const got = fxMul(a as Fx, b as Fx);
      const want = oracleMul(a, b);
      if (got !== want) {
        mismatches++;
        if (first === '') first = `fxMul(${a}, ${b}) = ${got}, oracle ${want}`;
      }
    };
    for (const a of EDGE_MUL) for (const b of EDGE_MUL) check(a, b);
    for (let i = 0; i < N; i++) {
      const mode = i & 3;
      let a: number;
      let b: number;
      if (mode === 3) {
        // one full int32 operand, the other bounded so that |a·b| ≤ 2^53 − 1
        a = rng.range(FX_RAW_MIN, FX_RAW_MAX);
        const bound = Math.max(1, Math.floor(MAX_SAFE / Math.max(1, Math.abs(a))));
        b = rng.range(-Math.min(bound, FX_RAW_MAX), Math.min(bound, FX_RAW_MAX));
      } else {
        a = rng.signedLog(26);
        b = rng.signedLog(26);
      }
      check(a, b);
    }
    expect(first).toBe('');
    expect(mismatches).toBe(0);
  });

  it('fxDiv matches floor(a·4096/b) as i32 in 10^6 cases (all signs)', () => {
    const rng = new TestRng(0xf1_0002);
    const edges = [0, 1, -1, 4095, 4096, -4096, 4097, 65536, FX_RAW_MAX, FX_RAW_MIN, FX_RAW_MAX - 1, FX_RAW_MIN + 1];
    let mismatches = 0;
    let first = '';
    const check = (a: number, b: number): void => {
      const got = fxDiv(a as Fx, b as Fx);
      const want = oracleDiv(a, b);
      if (got !== want) {
        mismatches++;
        if (first === '') first = `fxDiv(${a}, ${b}) = ${got}, oracle ${want}`;
      }
    };
    for (const a of edges) for (const b of edges) if (b !== 0) check(a, b);
    for (let i = 0; i < N; i++) {
      const a = (i & 1) === 0 ? rng.signedLog(31) : rng.range(FX_RAW_MIN, FX_RAW_MAX);
      let b = (i & 2) === 0 ? rng.signedLog(31) : rng.range(FX_RAW_MIN, FX_RAW_MAX);
      if (b === 0) b = 1;
      if (b < FX_RAW_MIN) b = FX_RAW_MIN;
      if (a < FX_RAW_MIN) continue;
      check(a, b);
    }
    expect(first).toBe('');
    expect(mismatches).toBe(0);
  });

  it('isqrt satisfies r² ≤ n < (r+1)² for 10^6 cases in [0, 2^53 − 1]', () => {
    const rng = new TestRng(0xf1_0003);
    let mismatches = 0;
    let first = '';
    const check = (n: number): void => {
      const r = isqrt(n);
      if (!isIsqrt(n, r)) {
        mismatches++;
        if (first === '') first = `isqrt(${n}) = ${r}`;
      }
    };
    const edges = [0, 1, 2, 3, 4, 5, 8, 9, 15, 16, 17, MAX_SAFE, MAX_SAFE - 1, 2 ** 52, 2 ** 52 - 1, 2 ** 52 + 1];
    const kMax = 94_906_265; // floor(sqrt(2^53 − 1))
    for (const n of edges) check(n);
    for (let k = kMax - 64; k <= kMax; k++) {
      check(k * k);
      check(k * k - 1);
      if (k * k + 1 <= MAX_SAFE) check(k * k + 1);
    }
    for (let i = 0; i < N; i++) {
      if ((i & 1) === 0) {
        check(rng.bits(rng.range(0, 53)));
      } else {
        // around perfect squares, where floor(Math.sqrt) is most likely to be off
        const k = rng.range(1, kMax);
        const n = k * k + rng.range(-2, 2);
        if (n >= 0 && n <= MAX_SAFE) check(n);
        else check(k * k);
      }
    }
    expect(first).toBe('');
    expect(mismatches).toBe(0);
  });

  it('fxMulSmall equals fxMul (and the oracle) for 10^6 FxSmall pairs, debug on', () => {
    setFixedDebug(true);
    const rng = new TestRng(0xf1_0004);
    let mismatches = 0;
    let first = '';
    const edges = [0, 1, -1, 4095, 4096, -4096, FX_SMALL_MAX_RAW, -FX_SMALL_MAX_RAW, FX_SMALL_MAX_RAW - 1];
    const check = (a: number, b: number): void => {
      const got = fxMulSmall(a as FxSmall, b as FxSmall); // debug compares with fxMul internally
      const want = oracleMul(a, b);
      if (got !== want || got !== fxMul(a as Fx, b as Fx)) {
        mismatches++;
        if (first === '') first = `fxMulSmall(${a}, ${b}) = ${got}, oracle ${want}`;
      }
    };
    for (const a of edges) for (const b of edges) check(a, b);
    for (let i = 0; i < N; i++) {
      const a = (i & 1) === 0 ? rng.range(-FX_SMALL_MAX_RAW, FX_SMALL_MAX_RAW) : rng.signedLog(14);
      const b = (i & 2) === 0 ? rng.range(-FX_SMALL_MAX_RAW, FX_SMALL_MAX_RAW) : rng.signedLog(14);
      check(a, b);
    }
    expect(first).toBe('');
    expect(mismatches).toBe(0);
  });
});
