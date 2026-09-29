/**
 * Small byte helpers shared by the codecs: a DataView cache (allocation-free re-reading of the
 * same buffers). The strict UTF-8 codec lives in utf8.ts.
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
