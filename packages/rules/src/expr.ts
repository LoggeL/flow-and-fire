/**
 * Category expressions (PLAN §3.2 rules, §3.9 step 4), e.g. `FACTORY & LAND & TECH1`,
 * `MOBILE & LAND - ENGINEER`, `!(AIR | NAVAL)`.
 *
 * Grammar (precedence low → high, binary operators left-associative):
 *   expr    := term ( '|' term )*
 *   term    := unary ( ( '&' | '-' ) unary )*        a - b  ≡  a & !b  ("without")
 *   unary   := '!' unary | primary
 *   primary := NAME | '(' expr ')'
 *   NAME    := [A-Z][A-Z0-9_]*
 *
 * Compiled form: postfix bytecode in an Int32Array evaluated on a fixed-size stack — no closures,
 * no allocation per evaluation (sim hot path).
 */
import type { CategoryRegistry } from './categories.ts';

/** Bytecode ops (postfix). `Bit` is followed by one operand word (the bit index). */
export const ExprOp = {
  Bit: 1,
  And: 2,
  Or: 3,
  Not: 4,
  AndNot: 5,
} as const;
export type ExprOp = (typeof ExprOp)[keyof typeof ExprOp];

/** Maximum evaluation stack depth of a compiled expression. */
export const MAX_EXPR_DEPTH = 32;
/** Maximum source length of an expression. */
export const MAX_EXPR_LENGTH = 1024;

/** Parse tree of a category expression. */
export type CategoryExprNode =
  | { readonly kind: 'name'; readonly name: string; readonly pos: number }
  | { readonly kind: 'not'; readonly arg: CategoryExprNode }
  | { readonly kind: 'and' | 'or' | 'without'; readonly left: CategoryExprNode; readonly right: CategoryExprNode };

/** Compiled expression: postfix code plus its stack requirement. */
export interface CompiledCategoryExpr {
  readonly source: string;
  readonly code: Int32Array;
  readonly maxDepth: number;
}

/** Syntax or name error with the character position (0-based) in the source. */
export class CategoryExprError extends Error {
  readonly pos: number;
  readonly source: string;

  constructor(source: string, pos: number, detail: string) {
    super(`category expression '${source}' at ${pos}: ${detail}`);
    this.name = 'CategoryExprError';
    this.pos = pos;
    this.source = source;
  }
}

const T_NAME = 1;
const T_AND = 2;
const T_OR = 3;
const T_WITHOUT = 4;
const T_NOT = 5;
const T_LPAREN = 6;
const T_RPAREN = 7;
const T_END = 8;

function tokenText(t: number): string {
  switch (t) {
    case T_AND:
      return "'&'";
    case T_OR:
      return "'|'";
    case T_WITHOUT:
      return "'-'";
    case T_NOT:
      return "'!'";
    case T_LPAREN:
      return "'('";
    case T_RPAREN:
      return "')'";
    case T_END:
      return 'end of expression';
    default:
      return 'category name';
  }
}

function isUpper(c: number): boolean {
  return c >= 65 && c <= 90;
}
function isNameChar(c: number): boolean {
  return isUpper(c) || (c >= 48 && c <= 57) || c === 95;
}

/** Recursive-descent parser over the source string. */
class Parser {
  private pos = 0;
  private tok = T_END;
  private tokPos = 0;
  private tokName = '';

  constructor(private readonly src: string) {
    this.advance();
  }

  private fail(pos: number, detail: string): never {
    throw new CategoryExprError(this.src, pos, detail);
  }

  private advance(): void {
    const s = this.src;
    let p = this.pos;
    while (p < s.length) {
      const c = s.charCodeAt(p);
      if (c === 32 || c === 9 || c === 10 || c === 13) p++;
      else break;
    }
    this.tokPos = p;
    if (p >= s.length) {
      this.tok = T_END;
      this.pos = p;
      return;
    }
    const c = s.charCodeAt(p);
    if (isUpper(c)) {
      let e = p + 1;
      while (e < s.length && isNameChar(s.charCodeAt(e))) e++;
      this.tok = T_NAME;
      this.tokName = s.slice(p, e);
      this.pos = e;
      return;
    }
    this.pos = p + 1;
    switch (c) {
      case 38: // &
        this.tok = T_AND;
        return;
      case 124: // |
        this.tok = T_OR;
        return;
      case 45: // -
        this.tok = T_WITHOUT;
        return;
      case 33: // !
        this.tok = T_NOT;
        return;
      case 40: // (
        this.tok = T_LPAREN;
        return;
      case 41: // )
        this.tok = T_RPAREN;
        return;
      default: {
        const ch = s[p]!;
        if (c >= 97 && c <= 122) this.fail(p, `unexpected character '${ch}' (category names are upper case)`);
        this.fail(p, `unexpected character '${ch}'`);
      }
    }
  }

  parse(): CategoryExprNode {
    if (this.tok === T_END) this.fail(this.tokPos, 'empty expression');
    const n = this.expr();
    if (this.tok !== T_END) {
      if (this.tok === T_RPAREN) this.fail(this.tokPos, "unbalanced ')'");
      this.fail(this.tokPos, `expected an operator, got ${tokenText(this.tok)}`);
    }
    return n;
  }

  private expr(): CategoryExprNode {
    let left = this.term();
    while (this.tok === T_OR) {
      this.advance();
      left = { kind: 'or', left, right: this.term() };
    }
    return left;
  }

  private term(): CategoryExprNode {
    let left = this.unary();
    while (this.tok === T_AND || this.tok === T_WITHOUT) {
      const kind = this.tok === T_AND ? 'and' : 'without';
      this.advance();
      left = { kind, left, right: this.unary() };
    }
    return left;
  }

  private unary(): CategoryExprNode {
    if (this.tok === T_NOT) {
      this.advance();
      return { kind: 'not', arg: this.unary() };
    }
    return this.primary();
  }

  private primary(): CategoryExprNode {
    const t = this.tok;
    const at = this.tokPos;
    if (t === T_NAME) {
      const name = this.tokName;
      this.advance();
      return { kind: 'name', name, pos: at };
    }
    if (t === T_LPAREN) {
      this.advance();
      if (this.tok === T_RPAREN) this.fail(this.tokPos, "empty '()'");
      const inner = this.expr();
      if (this.tok !== T_RPAREN) this.fail(this.tokPos, `expected ')' to close '(' at ${at}, got ${tokenText(this.tok)}`);
      this.advance();
      return inner;
    }
    this.fail(at, `expected a category name, '!' or '(', got ${tokenText(t)}`);
  }
}

/** Parses an expression into a tree (throws CategoryExprError). */
export function parseCategoryExpr(source: string): CategoryExprNode {
  if (source.length > MAX_EXPR_LENGTH) {
    throw new CategoryExprError(source.slice(0, 32) + '…', 0, `expression longer than ${MAX_EXPR_LENGTH} characters`);
  }
  return new Parser(source).parse();
}

/** Collects the category names referenced by an expression (source order, with repeats). */
export function categoryExprNames(node: CategoryExprNode, out: string[] = []): string[] {
  switch (node.kind) {
    case 'name':
      out.push(node.name);
      break;
    case 'not':
      categoryExprNames(node.arg, out);
      break;
    default:
      categoryExprNames(node.left, out);
      categoryExprNames(node.right, out);
  }
  return out;
}

/**
 * Compiles an expression against a registry. Unknown category names throw a CategoryExprError
 * pointing at the name.
 */
export function compileCategoryExpr(source: string, registry: CategoryRegistry): CompiledCategoryExpr {
  const root = parseCategoryExpr(source);
  const code: number[] = [];
  let depth = 0;
  let maxDepth = 0;
  const emit = (n: CategoryExprNode): void => {
    switch (n.kind) {
      case 'name': {
        const bit = registry.bitOf(n.name);
        if (bit < 0) throw new CategoryExprError(source, n.pos, `unknown category '${n.name}'`);
        code.push(ExprOp.Bit, bit);
        depth++;
        if (depth > maxDepth) maxDepth = depth;
        return;
      }
      case 'not':
        emit(n.arg);
        code.push(ExprOp.Not);
        return;
      default:
        emit(n.left);
        emit(n.right);
        code.push(n.kind === 'and' ? ExprOp.And : n.kind === 'or' ? ExprOp.Or : ExprOp.AndNot);
        depth--;
    }
  };
  emit(root);
  if (maxDepth > MAX_EXPR_DEPTH) {
    throw new CategoryExprError(source, 0, `expression nests too deeply (stack ${maxDepth} > ${MAX_EXPR_DEPTH})`);
  }
  return { source, code: Int32Array.from(code), maxDepth };
}

/** Evaluation stack shared by all evaluations (single-threaded, not re-entrant). */
const STACK = new Uint8Array(MAX_EXPR_DEPTH);

/**
 * Evaluates a compiled expression against the mask at `off` (4 u32 words). Allocation-free.
 */
export function matchesMask(mask: Uint32Array, compiled: CompiledCategoryExpr, off = 0): boolean {
  const code = compiled.code;
  const st = STACK;
  let sp = 0;
  let pc = 0;
  const n = code.length;
  while (pc < n) {
    const op = code[pc++]!;
    switch (op) {
      case ExprOp.Bit: {
        const bit = code[pc++]!;
        st[sp++] = (mask[off + (bit >>> 5)]! >>> (bit & 31)) & 1;
        break;
      }
      case ExprOp.And:
        sp--;
        st[sp - 1] = st[sp - 1]! & st[sp]!;
        break;
      case ExprOp.Or:
        sp--;
        st[sp - 1] = st[sp - 1]! | st[sp]!;
        break;
      case ExprOp.AndNot:
        sp--;
        st[sp - 1] = st[sp - 1]! & (st[sp]! ^ 1);
        break;
      case ExprOp.Not:
        st[sp - 1] = st[sp - 1]! ^ 1;
        break;
      default:
        throw new RangeError(`matchesMask: bad opcode ${op} at ${pc - 1}`);
    }
  }
  if (sp !== 1) throw new RangeError('matchesMask: malformed bytecode');
  return st[0] === 1;
}

