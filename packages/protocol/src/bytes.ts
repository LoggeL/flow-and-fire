/**
 * Small byte helpers shared by the codecs: a DataView cache (allocation-free re-reading of the
 * same buffers) and UTF-8 encoding without TextEncoder (not part of lib ES2022).
 */

/**
 * Remembers DataViews for up to `size` distinct Uint8Arrays (identity + offset + length), so
 * reusing the same frame/batch buffers never allocates a new DataView.
 */
export class DataViewCache {
  private readonly keys: (Uint8Array | null)[];
  private readonly views: (DataView | null)[];
  private next = 0;

  constructor(size = 4) {
    this.keys = new Array<Uint8Array | null>(size).fill(null);
    this.views = new Array<DataView | null>(size).fill(null);
  }

  /** DataView covering exactly `u8`. */
  get(u8: Uint8Array): DataView {
    const keys = this.keys;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === u8) {
        const v = this.views[i]!;
        // A transferred (detached) buffer shrinks to 0; re-create then.
        if (v.byteLength === u8.byteLength && u8.byteLength !== 0) return v;
        const nv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        this.views[i] = nv;
        return nv;
      }
    }
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const slot = this.next;
    keys[slot] = u8;
    this.views[slot] = v;
    this.next = slot + 1 === keys.length ? 0 : slot + 1;
    return v;
  }
}

/** UTF-8 bytes of a string (well-formed; lone surrogates become U+FFFD). */
export function utf8Encode(s: string): Uint8Array {
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
