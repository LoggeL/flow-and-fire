/**
 * G5 category helpers for client and sim (PLAN §3.1 "128-Bit-Kategorie-Masken", §3.9 step 4).
 *
 * - The bit order of a blueprint bundle is the category name list of sim.bin
 *   (`SimBpTable.categoryNames`), i.e. the sorted distinct names of all emitted units. A registry
 *   rebuilt from that list ({@link registryFromBitOrder}) assigns the same bits.
 * - `maskFromNames` turns the `categories` of a view.json entry (or any name list) into a mask.
 * - `CategoryFilter` is a compiled expression for UI filters (selection by type, double-click,
 *   AI queries): it matches masks (allocation-free) and plain name lists.
 * - `evaluateCategoryExpr` evaluates a parse tree against a name list without any registry
 *   (unknown names are simply absent), for tooling and tests.
 */
import { CategoryRegistry, createMask, maskSetBit } from './categories.ts';
import { compileCategoryExpr, matchesMask, parseCategoryExpr, type CategoryExprNode, type CompiledCategoryExpr } from './expr.ts';

/**
 * Registry for an existing bit order (e.g. sim.bin category names). Throws if `names` is not the
 * strictly sorted (code-unit order) list a registry would produce — a different order would
 * silently assign different bits.
 */
export function registryFromBitOrder(names: readonly string[]): CategoryRegistry {
  const reg = new CategoryRegistry(names);
  if (reg.names.length !== names.length) throw new RangeError('category bit order contains duplicates');
  for (let i = 0; i < names.length; i++) {
    if (reg.names[i] !== names[i]) throw new RangeError(`category bit order is not sorted at ${i} ('${names[i]!}')`);
  }
  return reg;
}

/**
 * Mask of `names` in the bit order of `bits` (a registry or its bit-ordered name list), written
 * into `out` at `off` (cleared first). Unknown names throw unless `ignoreUnknown` is set.
 */
export function maskFromNames(
  names: readonly string[],
  bits: CategoryRegistry | readonly string[],
  out: Uint32Array = createMask(),
  off = 0,
  ignoreUnknown = false,
): Uint32Array {
  const reg = bits instanceof CategoryRegistry ? bits : registryFromBitOrder(bits);
  for (let i = 0; i < 4; i++) out[off + i] = 0;
  for (let i = 0; i < names.length; i++) {
    const b = reg.bitOf(names[i]!);
    if (b < 0) {
      if (ignoreUnknown) continue;
      throw new RangeError(`unknown category '${names[i]!}'`);
    }
    maskSetBit(out, off, b);
  }
  return out;
}

/** Evaluates a parse tree against a list of category names (unknown names count as absent). */
export function evaluateCategoryExpr(node: CategoryExprNode, names: readonly string[]): boolean {
  switch (node.kind) {
    case 'name':
      return names.includes(node.name);
    case 'not':
      return !evaluateCategoryExpr(node.arg, names);
    case 'and':
      return evaluateCategoryExpr(node.left, names) && evaluateCategoryExpr(node.right, names);
    case 'or':
      return evaluateCategoryExpr(node.left, names) || evaluateCategoryExpr(node.right, names);
    default:
      return evaluateCategoryExpr(node.left, names) && !evaluateCategoryExpr(node.right, names);
  }
}

/**
 * A category expression compiled against one bundle's bit order, e.g. for UI filters over
 * view.json entries (`new CategoryFilter('LAND & TECH1', simBp.categoryNames)`).
 */
export class CategoryFilter {
  readonly compiled: CompiledCategoryExpr;
  readonly registry: CategoryRegistry;
  private readonly scratch = createMask();

  /** Throws CategoryExprError (with position) for syntax errors and unknown categories. */
  constructor(source: string, bits: CategoryRegistry | readonly string[]) {
    this.registry = bits instanceof CategoryRegistry ? bits : registryFromBitOrder(bits);
    this.compiled = compileCategoryExpr(source, this.registry);
  }

  get source(): string {
    return this.compiled.source;
  }

  /** True if the mask at `off` matches (allocation-free). */
  matches(mask: Uint32Array, off = 0): boolean {
    return matchesMask(mask, this.compiled, off);
  }

  /** True if a unit with these category names matches (names outside the bit order are ignored). */
  matchesNames(names: readonly string[]): boolean {
    return matchesMask(maskFromNames(names, this.registry, this.scratch, 0, true), this.compiled, 0);
  }
}

/** Parses and evaluates `source` against `names` (convenience for tooling; throws on syntax errors). */
export function categoryExprMatchesNames(source: string, names: readonly string[]): boolean {
  return evaluateCategoryExpr(parseCategoryExpr(source), names);
}
