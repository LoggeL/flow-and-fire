/**
 * Strict UTF-8 codec without TextEncoder/TextDecoder (the sim packages compile against lib ES2022
 * only, and the result must be identical in every engine). Rejects lone surrogates, overlong
 * forms, code points above U+10FFFF and truncated sequences.
 *
 * The one UTF-8 codec of the sim packages: simId (mod list, tag), .rtsmap (META, PROP) and the
 * command-log header all encode strings through it, so a string is either accepted everywhere
 * with the same bytes or rejected everywhere.
 */

/** Encodes a string as UTF-8. Throws RangeError on lone surrogates. */
export function encodeUtf8(s: string): Uint8Array {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) throw new RangeError('encodeUtf8: lone high surrogate');
      n += 4;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new RangeError('encodeUtf8: lone low surrogate');
    else n += 3;
  }
  const out = new Uint8Array(n);
  let p = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out[p++] = c;
    } else if (c < 0x800) {
      out[p++] = 0xc0 | (c >>> 6);
      out[p++] = 0x80 | (c & 0x3f);
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(++i);
      c = 0x10000 + (((c - 0xd800) << 10) | (d - 0xdc00));
      out[p++] = 0xf0 | (c >>> 18);
      out[p++] = 0x80 | ((c >>> 12) & 0x3f);
      out[p++] = 0x80 | ((c >>> 6) & 0x3f);
      out[p++] = 0x80 | (c & 0x3f);
    } else {
      out[p++] = 0xe0 | (c >>> 12);
      out[p++] = 0x80 | ((c >>> 6) & 0x3f);
      out[p++] = 0x80 | (c & 0x3f);
    }
  }
  return out;
}

function cont(b: Uint8Array, i: number, end: number): number {
  if (i >= end) throw new RangeError('decodeUtf8: truncated sequence');
  const v = b[i]!;
  if ((v & 0xc0) !== 0x80) throw new RangeError('decodeUtf8: invalid continuation byte');
  return v & 0x3f;
}

/** Decodes bytes[offset, offset + length) as strict UTF-8. Throws RangeError on malformed input. */
export function decodeUtf8(b: Uint8Array, offset = 0, length = b.length - offset): string {
  const end = offset + length;
  if (offset < 0 || length < 0 || end > b.length) throw new RangeError('decodeUtf8: range out of bounds');
  const units: number[] = [];
  let s = '';
  for (let i = offset; i < end; ) {
    const b0 = b[i]!;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      cp = ((b0 & 0x1f) << 6) | cont(b, i + 1, end);
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      cp = ((b0 & 0x0f) << 12) | (cont(b, i + 1, end) << 6) | cont(b, i + 2, end);
      if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) throw new RangeError('decodeUtf8: overlong form or surrogate');
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      cp = ((b0 & 0x07) << 18) | (cont(b, i + 1, end) << 12) | (cont(b, i + 2, end) << 6) | cont(b, i + 3, end);
      if (cp < 0x10000 || cp > 0x10ffff) throw new RangeError('decodeUtf8: overlong form or out of range');
      i += 4;
    } else {
      throw new RangeError('decodeUtf8: invalid lead byte');
    }
    if (cp >= 0x10000) {
      const v = cp - 0x10000;
      units.push(0xd800 | (v >>> 10), 0xdc00 | (v & 0x3ff));
    } else {
      units.push(cp);
    }
    if (units.length >= 4096) {
      s += String.fromCharCode(...units);
      units.length = 0;
    }
  }
  return s + String.fromCharCode(...units);
}
