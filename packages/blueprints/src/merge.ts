/**
 * Merge semantics of blueprint patches and `extends` (PLAN §3.9 steps 1–2).
 *
 * `mergePatch(base, patch)` returns a new value (inputs are never modified):
 * - plain objects merge key by key (recursively); a `null` value deletes the key;
 * - arrays whose elements are all objects with a string `id` (in base and non-empty patch)
 *   merge by `id`: existing ids merge recursively in place, new ids are appended in patch
 *   order, an element `{ id, $remove: true }` removes that id;
 * - any other array, and every primitive, replaces the base value;
 * - `undefined` in the patch leaves the base value untouched.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** True for non-null, non-array objects. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIdArray(a: readonly unknown[]): boolean {
  for (const e of a) if (!isPlainObject(e) || typeof e.id !== 'string') return false;
  return true;
}

/** Deep copy that drops `null`/`undefined` object entries and `$remove` markers. */
function cleanClone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cleanClone);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (x === null || x === undefined || k === '$remove') continue;
      out[k] = cleanClone(x);
    }
    return out;
  }
  return v;
}

/** Plain deep copy (keeps nulls). */
export function deepClone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(deepClone) as T;
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
    return out as T;
  }
  return v;
}

function mergeIdArrays(base: readonly Record<string, unknown>[], patch: readonly Record<string, unknown>[]): unknown[] {
  const out: Record<string, unknown>[] = base.map((e) => deepClone(e));
  for (const p of patch) {
    let at = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i]!.id === p.id) {
        at = i;
        break;
      }
    }
    if (p.$remove === true) {
      if (at >= 0) out.splice(at, 1);
      continue;
    }
    if (at >= 0) out[at] = mergePatch(out[at], p) as Record<string, unknown>;
    else out.push(cleanClone(p) as Record<string, unknown>);
  }
  return out;
}

/** Applies `patch` on top of `base` (see module docs). */
export function mergePatch(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return deepClone(base);
  if (isPlainObject(patch)) {
    if (!isPlainObject(base)) return cleanClone(patch);
    const out: Record<string, unknown> = deepClone(base);
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v === undefined) continue;
      if (v === null) {
        delete out[k];
        continue;
      }
      out[k] = mergePatch(out[k], v);
    }
    return out;
  }
  if (Array.isArray(patch)) {
    if (Array.isArray(base) && patch.length > 0 && isIdArray(base) && isIdArray(patch)) {
      return mergeIdArrays(base as Record<string, unknown>[], patch as Record<string, unknown>[]);
    }
    return cleanClone(patch);
  }
  return patch;
}
