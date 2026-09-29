import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_WORDS,
  CategoryExprError,
  CategoryRegistry,
  compileCategoryExpr,
  createMask,
  matchesMask,
  maskContainsAll,
  maskHasBit,
  maskIntersects,
  MAX_CATEGORIES,
  motionLayerOf,
  MotionLayer,
  parseCategoryExpr,
  categoryExprNames,
  type CategoryExprNode,
} from '../src/index.ts';

const NAMES = ['TECH1', 'LAND', 'FACTORY', 'MOBILE', 'AIR', 'ENGINEER', 'STRUCTURE', 'TECH2', 'NAVAL', 'ALLUNITS'];

describe('CategoryRegistry', () => {
  it('assigns bits by sorted code-unit order, deduplicated, independent of input order', () => {
    const a = new CategoryRegistry(NAMES);
    const b = new CategoryRegistry([...NAMES].reverse().concat(['LAND', 'AIR']));
    expect(a.names).toEqual(['AIR', 'ALLUNITS', 'ENGINEER', 'FACTORY', 'LAND', 'MOBILE', 'NAVAL', 'STRUCTURE', 'TECH1', 'TECH2']);
    expect(b.names).toEqual(a.names);
    expect(a.bitOf('AIR')).toBe(0);
    expect(a.bitOf('TECH2')).toBe(9);
    expect(a.bitOf('NOPE')).toBe(-1);
    expect(a.nameOf(4)).toBe('LAND');
    expect(() => a.nameOf(10)).toThrow(RangeError);
    // Upper case sorts before '_' and digits sort before letters (code units, not locale).
    const c = new CategoryRegistry(['A_B', 'AB', 'A1', 'A']);
    expect(c.names).toEqual(['A', 'A1', 'AB', 'A_B']);
  });

  it('rejects invalid names and more than 128 categories', () => {
    expect(() => new CategoryRegistry(['land'])).toThrow(/invalid category name/);
    expect(() => new CategoryRegistry(['1ABC'])).toThrow(/invalid category name/);
    expect(() => new CategoryRegistry(['A B'])).toThrow(/invalid category name/);
    const many = Array.from({ length: MAX_CATEGORIES }, (_, i) => `C${i}`);
    expect(new CategoryRegistry(many).size).toBe(128);
    expect(() => new CategoryRegistry([...many, 'EXTRA'])).toThrow(/too many categories/);
  });

  it('builds 128-bit masks over all four words', () => {
    const many = Array.from({ length: MAX_CATEGORIES }, (_, i) => `C${String(i).padStart(3, '0')}`);
    const reg = new CategoryRegistry(many);
    const m = reg.maskOf(['C000', 'C031', 'C032', 'C127']);
    expect(m.length).toBe(CATEGORY_WORDS);
    expect(Array.from(m)).toEqual([0x80000001, 0x00000001, 0, 0x80000000]);
    expect(reg.namesOf(m)).toEqual(['C000', 'C031', 'C032', 'C127']);
    expect(maskHasBit(m, 0, 127)).toBe(true);
    expect(maskHasBit(m, 0, 126)).toBe(false);
    expect(() => reg.maskOf(['NOPE'])).toThrow(/unknown category 'NOPE'/);

    const table = createMask(2);
    reg.maskOf(['C005'], table, 4);
    expect(Array.from(table)).toEqual([0, 0, 0, 0, 32, 0, 0, 0]);
    expect(maskContainsAll(m, 0, reg.maskOf(['C000', 'C127']), 0)).toBe(true);
    expect(maskContainsAll(m, 0, reg.maskOf(['C000', 'C126']), 0)).toBe(false);
    expect(maskIntersects(m, 0, reg.maskOf(['C126', 'C032']), 0)).toBe(true);
    expect(maskIntersects(m, 0, reg.maskOf(['C126']), 0)).toBe(false);
  });
});

describe('category expressions', () => {
  const reg = new CategoryRegistry(NAMES);
  const mask = (...n: string[]): Uint32Array => reg.maskOf(n);
  const m = (expr: string, ...cats: string[]): boolean => matchesMask(mask(...cats), compileCategoryExpr(expr, reg));

  it('evaluates &, |, -, ! and parentheses with the documented precedence', () => {
    expect(m('FACTORY & LAND & TECH1', 'FACTORY', 'LAND', 'TECH1', 'STRUCTURE')).toBe(true);
    expect(m('FACTORY & LAND & TECH1', 'FACTORY', 'LAND', 'TECH2')).toBe(false);
    expect(m('LAND | AIR', 'AIR')).toBe(true);
    expect(m('LAND | AIR', 'NAVAL')).toBe(false);
    expect(m('MOBILE & LAND - ENGINEER', 'MOBILE', 'LAND')).toBe(true);
    expect(m('MOBILE & LAND - ENGINEER', 'MOBILE', 'LAND', 'ENGINEER')).toBe(false);
    expect(m('!AIR', 'LAND')).toBe(true);
    expect(m('!AIR', 'AIR')).toBe(false);
    expect(m('!!AIR', 'AIR')).toBe(true);
    // & binds tighter than |.
    expect(m('LAND & TECH1 | AIR', 'AIR')).toBe(true);
    expect(m('LAND & (TECH1 | AIR)', 'AIR')).toBe(false);
    // - is on the & level and left-associative: A - B - C = (A & !B) & !C.
    expect(m('MOBILE - LAND - AIR', 'MOBILE', 'NAVAL')).toBe(true);
    expect(m('MOBILE - LAND - AIR', 'MOBILE', 'AIR')).toBe(false);
    // | is lower than -: A | B - C = A | (B & !C).
    expect(m('AIR | LAND - TECH1', 'AIR', 'TECH1')).toBe(true);
    expect(m('AIR | LAND - TECH1', 'LAND', 'TECH1')).toBe(false);
    // ! binds tighter than &.
    expect(m('!AIR & LAND', 'LAND')).toBe(true);
    expect(m('!(AIR & LAND)', 'LAND')).toBe(true);
    expect(m('  ( ( LAND ) )\t', 'LAND')).toBe(true);
  });

  it('compiles to postfix bytecode with the stack depth', () => {
    const c = compileCategoryExpr('FACTORY & (LAND | AIR)', reg);
    // FACTORY=3, LAND=4, AIR=0 → Bit 3, Bit 4, Bit 0, Or, And
    expect(Array.from(c.code)).toEqual([1, 3, 1, 4, 1, 0, 3, 2]);
    expect(c.maxDepth).toBe(3);
    expect(categoryExprNames(parseCategoryExpr('A & (B | !C) - A'))).toEqual(['A', 'B', 'C', 'A']);
  });

  it('reports syntax errors with positions', () => {
    const err = (src: string): CategoryExprError => {
      try {
        compileCategoryExpr(src, reg);
      } catch (e) {
        expect(e).toBeInstanceOf(CategoryExprError);
        return e as CategoryExprError;
      }
      throw new Error(`expected '${src}' to fail`);
    };
    expect(err('').message).toMatch(/at 0: empty expression/);
    expect(err('   ').message).toMatch(/at 3: empty expression/);
    expect(err('LAND &').message).toMatch(/at 6: expected a category name, '!' or '\(', got end of expression/);
    expect(err('LAND AIR').message).toMatch(/at 5: expected an operator, got category name/);
    expect(err('(LAND | AIR').message).toMatch(/at 11: expected '\)' to close '\(' at 0, got end of expression/);
    expect(err('LAND)').message).toMatch(/at 4: unbalanced '\)'/);
    expect(err('()').message).toMatch(/at 1: empty '\(\)'/);
    expect(err('land & AIR').message).toMatch(/at 0: unexpected character 'l' \(category names are upper case\)/);
    expect(err('LAND + AIR').message).toMatch(/at 5: unexpected character '\+'/);
    expect(err('& LAND').message).toMatch(/at 0: expected a category name/);
    const unknown = err('LAND & HOVERCRAFT');
    expect(unknown.message).toMatch(/at 7: unknown category 'HOVERCRAFT'/);
    expect(unknown.pos).toBe(7);
    expect(err('X'.repeat(1025)).message).toMatch(/longer than 1024/);
    const deep = Array.from({ length: 40 }, () => 'LAND').join(' | (') + ')'.repeat(39);
    expect(err(deep).message).toMatch(/nests too deeply/);
  });

  it('matches a reference evaluator on random expressions and masks (property)', () => {
    const names = reg.names;
    const leaf = fc.constantFrom(...names).map((name): CategoryExprNode => ({ kind: 'name', name, pos: 0 }));
    const { tree } = fc.letrec<{ tree: CategoryExprNode }>((tie) => ({
      tree: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        leaf,
        tie('tree').map((arg): CategoryExprNode => ({ kind: 'not', arg })),
        fc
          .tuple(fc.constantFrom('and', 'or', 'without') as fc.Arbitrary<'and' | 'or' | 'without'>, tie('tree'), tie('tree'))
          .map(([kind, left, right]): CategoryExprNode => ({ kind, left, right })),
      ),
    }));
    const print = (n: CategoryExprNode): string =>
      n.kind === 'name'
        ? n.name
        : n.kind === 'not'
          ? `!(${print(n.arg)})`
          : `(${print(n.left)}) ${n.kind === 'and' ? '&' : n.kind === 'or' ? '|' : '-'} (${print(n.right)})`;
    const evalRef = (n: CategoryExprNode, set: ReadonlySet<string>): boolean =>
      n.kind === 'name'
        ? set.has(n.name)
        : n.kind === 'not'
          ? !evalRef(n.arg, set)
          : n.kind === 'and'
            ? evalRef(n.left, set) && evalRef(n.right, set)
            : n.kind === 'or'
              ? evalRef(n.left, set) || evalRef(n.right, set)
              : evalRef(n.left, set) && !evalRef(n.right, set);
    fc.assert(
      fc.property(tree, fc.subarray([...names]), (t, cats) => {
        const src = print(t);
        let compiled;
        try {
          compiled = compileCategoryExpr(src, reg);
        } catch (e) {
          // Only the depth limit may reject generated trees.
          expect((e as Error).message).toMatch(/nests too deeply/);
          return;
        }
        expect(matchesMask(reg.maskOf(cats), compiled)).toBe(evalRef(t, new Set(cats)));
      }),
      { numRuns: 2000 },
    );
  });

  it('evaluates without allocating', () => {
    const c = compileCategoryExpr('(LAND | AIR) & MOBILE - ENGINEER & !NAVAL', reg);
    const masks = [mask('LAND', 'MOBILE'), mask('AIR', 'ENGINEER'), mask('NAVAL')];
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (matchesMask(masks[i % 3]!, c)) hits++;
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1_000_000; i++) if (matchesMask(masks[i % 3]!, c)) hits++;
    gc?.();
    const grown = process.memoryUsage().heapUsed - before;
    expect(hits).toBeGreaterThan(0);
    expect(grown).toBeLessThan(256 * 1024);
  });
});

describe('motion layers', () => {
  it('pins the append-only layer values', () => {
    expect(MotionLayer).toEqual({ Land: 0, Water: 1, Seabed: 2, Hover: 3, Amphibious: 4, Air: 5 });
    expect(motionLayerOf('land')).toBe(0);
    expect(motionLayerOf('air')).toBe(5);
    expect(motionLayerOf('space')).toBe(-1);
  });
});
