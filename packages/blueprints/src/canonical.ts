/**
 * Canonical JSON (sorted keys by UTF-16 code units, no whitespace in the compact form) and a
 * UTF-8 encoder. Used for bundle.json/view.json and their hashes.
 */

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function write(v: unknown, indent: string, depth: number, path: string): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new RangeError(`canonicalJson: non-finite number at ${path || '/'}`);
      return JSON.stringify(Object.is(v, -0) ? 0 : v);
    case 'string':
      return JSON.stringify(v);
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof v} at ${path || '/'}`);
  }
  const nl = indent === '' ? '' : '\n' + indent.repeat(depth + 1);
  const end = indent === '' ? '' : '\n' + indent.repeat(depth);
  const colon = indent === '' ? ':' : ': ';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const items = v.map((x, i) => write(x, indent, depth + 1, `${path}/${i}`));
    // Pretty form keeps arrays of primitives on one line (e.g. vectors, category lists).
    if (indent !== '' && v.every((x) => x === null || typeof x !== 'object')) return '[' + items.join(', ') + ']';
    return '[' + nl + items.join(',' + nl) + end + ']';
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort(compareKeys);
  if (keys.length === 0) return '{}';
  const items = keys.map((k) => JSON.stringify(k) + colon + write(obj[k], indent, depth + 1, `${path}/${k}`));
  return '{' + nl + items.join(',' + nl) + end + '}';
}

/**
 * Serializes `v` canonically: object keys sorted, `undefined` entries dropped, −0 → 0,
 * non-finite numbers rejected. `indent` > 0 pretty-prints (same key order).
 */
export function canonicalJson(v: unknown, indent = 0): string {
  return write(v, ' '.repeat(indent), 0, '');
}

/** UTF-8 encoding of a string (lone surrogates become U+FFFD). */
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** u32 as `0x` + 8 upper-case hex digits. */
export function hex32(v: number): string {
  return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
