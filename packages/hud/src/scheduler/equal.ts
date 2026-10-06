/**
 * Structural equality for the plain snapshot data the scheduler diffs (ui.md §9.2: "Text nur setzen, wenn
 * sich der Wert ändert"). Numbers, strings, booleans, null, arrays, plain objects and typed arrays; depth is
 * bounded because snapshot data is shallow (unit detail → orders → entry).
 */
const MAX_DEPTH = 6;

function isTypedArray(v: unknown): v is ArrayLike<number> {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function equalAt(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (depth >= MAX_DEPTH) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equalAt(a[i], b[i], depth + 1)) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  if (isTypedArray(a)) {
    if (!isTypedArray(b) || a.length !== b.length || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  if (isTypedArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Readonly<Record<string, unknown>>;
  const rb = b as Readonly<Record<string, unknown>>;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(rb, k)) return false;
    if (!equalAt(ra[k], rb[k], depth + 1)) return false;
  }
  return true;
}

/** Deep structural equality of snapshot data (identical references short-circuit). */
export function sameData(a: unknown, b: unknown): boolean {
  return equalAt(a, b, 0);
}

/** Reference equality (for wrappers of typed arrays that producers refill in place). */
export function sameRef(a: unknown, b: unknown): boolean {
  return Object.is(a, b);
}
