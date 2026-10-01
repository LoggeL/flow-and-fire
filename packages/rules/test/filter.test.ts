// G5 (MS3): category helpers for client and sim – bit order from sim.bin, masks from view.json
// category names, UI filters, pool bytecode evaluation/validation.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CategoryExprError,
  CategoryFilter,
  CategoryRegistry,
  categoryExprMatchesNames,
  compileCategoryExpr,
  createMask,
  evaluateCategoryExpr,
  ExprOp,
  maskFromNames,
  matchesMask,
  matchesMaskCode,
  MAX_EXPR_DEPTH,
  parseCategoryExpr,
  registryFromBitOrder,
  validateCategoryCode,
} from '../src/index.ts';

const BITS = ['ARTILLERY', 'DIRECTFIRE', 'FACTORY', 'LAND', 'MOBILE', 'SCOUT', 'STRUCTURE', 'TECH1', 'TECH2', 'TECH3'];

describe('bit order and masks', () => {
  it('registryFromBitOrder accepts the sorted sim.bin list and rejects other orders', () => {
    const reg = registryFromBitOrder(BITS);
    expect(reg.names).toEqual(BITS);
    expect(() => registryFromBitOrder(['LAND', 'AIR'])).toThrow(/not sorted at 0/);
    expect(() => registryFromBitOrder(['AIR', 'AIR'])).toThrow(/duplicates/);
  });

  it('maskFromNames builds masks from view.json category names', () => {
    const m = maskFromNames(['TECH1', 'LAND', 'MOBILE'], BITS);
    expect(Array.from(m)).toEqual([(1 << 3) | (1 << 4) | (1 << 7), 0, 0, 0]);
    expect(() => maskFromNames(['NAVAL'], BITS)).toThrow(/unknown category 'NAVAL'/);
    const out = createMask(2);
    out.fill(0xffffffff);
    maskFromNames(['NAVAL', 'LAND'], new CategoryRegistry(BITS), out, 4, true);
    expect(Array.from(out.subarray(4))).toEqual([1 << 3, 0, 0, 0]);
    expect(out[0]).toBe(0xffffffff);
  });
});

describe('CategoryFilter (UI filters, AI queries)', () => {
  it('matches masks and name lists; errors carry positions', () => {
    const f = new CategoryFilter('MOBILE & LAND - SCOUT', BITS);
    expect(f.source).toBe('MOBILE & LAND - SCOUT');
    expect(f.matchesNames(['LAND', 'MOBILE', 'TECH1', 'DIRECTFIRE'])).toBe(true);
    expect(f.matchesNames(['LAND', 'MOBILE', 'SCOUT'])).toBe(false);
    expect(f.matchesNames(['LAND', 'MOBILE', 'UNKNOWN_EXTRA'])).toBe(true);
    const table = createMask(2);
    maskFromNames(['STRUCTURE', 'FACTORY', 'LAND'], BITS, table, 0);
    maskFromNames(['LAND', 'MOBILE'], BITS, table, 4);
    expect([f.matches(table, 0), f.matches(table, 4)]).toEqual([false, true]);
    expect(() => new CategoryFilter('LAND & (AIR', BITS)).toThrow(CategoryExprError);
    try {
      new CategoryFilter('LAND & NAVAL', BITS);
    } catch (e) {
      expect((e as CategoryExprError).pos).toBe(7);
    }
  });

  it('tree evaluation over names equals bytecode evaluation over masks (fast-check)', () => {
    const reg = new CategoryRegistry(BITS);
    const leaf = fc.constantFrom(...BITS);
    const expr: fc.Arbitrary<string> = fc.letrec((tie) => ({
      e: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        leaf,
        fc.tuple(tie('e'), fc.constantFrom('&', '|', '-'), tie('e')).map(([a, op, b]) => `(${a as string} ${op} ${b as string})`),
        tie('e').map((a) => `!${a as string}`),
      ),
    })).e;
    fc.assert(
      fc.property(expr, fc.subarray(BITS), (src, names) => {
        const tree = evaluateCategoryExpr(parseCategoryExpr(src), names);
        expect(categoryExprMatchesNames(src, names)).toBe(tree);
        expect(matchesMask(maskFromNames(names, reg), compileCategoryExpr(src, reg))).toBe(tree);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('pool bytecode (sim.bin CEXC)', () => {
  it('matchesMaskCode evaluates a slice of a shared pool', () => {
    const reg = new CategoryRegistry(BITS);
    const a = compileCategoryExpr('LAND & MOBILE', reg).code;
    const b = compileCategoryExpr('STRUCTURE | TECH3', reg).code;
    const pool = new Int32Array([...a, ...b]);
    const mask = maskFromNames(['STRUCTURE'], reg);
    expect(matchesMaskCode(mask, 0, pool, 0, a.length)).toBe(false);
    expect(matchesMaskCode(mask, 0, pool, a.length, b.length)).toBe(true);
  });

  it('validateCategoryCode returns the stack depth or −1', () => {
    const reg = new CategoryRegistry(BITS);
    const c = compileCategoryExpr('(LAND | STRUCTURE) & !(TECH1 - SCOUT)', reg);
    expect(validateCategoryCode(c.code, 0, c.code.length, BITS.length)).toBe(c.maxDepth);
    const v = (code: number[], n = BITS.length) => validateCategoryCode(Int32Array.from(code), 0, code.length, n);
    expect(v([ExprOp.Bit, 0])).toBe(1);
    expect(v([ExprOp.Bit, 10])).toBe(-1); // bit outside the registry
    expect(v([ExprOp.Bit, 0, ExprOp.And])).toBe(-1); // underflow
    expect(v([ExprOp.Bit, 0, ExprOp.Bit, 1])).toBe(-1); // two results
    expect(v([ExprOp.Not])).toBe(-1);
    expect(v([9])).toBe(-1);
    expect(v([ExprOp.Bit])).toBe(-1); // truncated operand
    expect(v([])).toBe(-1);
    const deep = Array.from({ length: MAX_EXPR_DEPTH + 1 }, () => [ExprOp.Bit, 0]).flat();
    expect(v(deep)).toBe(-1);
    expect(validateCategoryCode(Int32Array.from([ExprOp.Bit, 0]), 1, 2, 10)).toBe(-1); // out of bounds
  });
});
