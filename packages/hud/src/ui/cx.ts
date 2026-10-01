/** Class list value: strings are kept when truthy, object keys when their value is truthy. */
export type ClassValue = string | false | null | undefined | Readonly<Record<string, boolean | null | undefined>>;

/** Joins class names (`cx('ff-cell', { 'is-active': armed })`). */
export function cx(...values: readonly ClassValue[]): string {
  let out = '';
  for (const v of values) {
    if (!v) continue;
    if (typeof v === 'string') {
      out = out ? `${out} ${v}` : v;
      continue;
    }
    for (const key in v) {
      if (v[key]) out = out ? `${out} ${key}` : key;
    }
  }
  return out;
}
