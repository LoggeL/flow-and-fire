/**
 * Minimal EBML reading primitives (RFC 8794) for the WebM/Opus demuxer.
 * Every read is bounds-checked against an explicit end offset and throws {@link WebmParseError}
 * with the byte offset of the problem; nothing here can loop.
 */

/** Parse failure of a WebM/EBML stream. `offset` is the byte position where parsing failed. */
export class WebmParseError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message} (at byte ${offset})`);
    this.name = 'WebmParseError';
    this.offset = offset;
  }
}

/** Header of one EBML element as read by {@link EbmlReader.readHeader}. */
export interface EbmlHeader {
  /** Element ID including its length-marker bits (e.g. 0x1A45DFA3). */
  id: number;
  /** Offset of the first header byte. */
  start: number;
  /** Offset of the first data byte. */
  dataStart: number;
  /** Data size in bytes; meaningless when `unknownSize` is true. */
  size: number;
  /** True for the reserved "unknown size" value (all data bits set). */
  unknownSize: boolean;
}

/** Number of leading zero bits of a byte (0..8). */
function leadingZeros8(b: number): number {
  return Math.clz32(b & 0xff) - 24;
}

/** Bounds-checked big-endian EBML reader over a byte array. Reuses one header object. */
export class EbmlReader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  /** Scratch header filled by {@link readHeader}; copy fields out before the next call. */
  readonly header: EbmlHeader = { id: 0, start: 0, dataStart: 0, size: 0, unknownSize: false };

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /**
   * Reads the element header at `pos` (ID + size VINT) into {@link header}. IDs are 1–4 bytes,
   * sizes 1–8 bytes. A known size that does not fit before `end` is an error.
   */
  readHeader(pos: number, end: number): EbmlHeader {
    const b = this.bytes;
    if (pos >= end) throw new WebmParseError('unexpected end of data before element ID', pos);
    const first = b[pos]!;
    const idLen = leadingZeros8(first) + 1;
    if (idLen > 4) throw new WebmParseError(`invalid element ID byte 0x${first.toString(16)}`, pos);
    if (pos + idLen > end) throw new WebmParseError('truncated element ID', pos);
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + b[pos + i]!;
    const sizePos = pos + idLen;
    if (sizePos >= end) throw new WebmParseError('unexpected end of data before element size', sizePos);
    const s0 = b[sizePos]!;
    const sizeLen = leadingZeros8(s0) + 1;
    if (sizeLen > 8) throw new WebmParseError('invalid element size VINT (length > 8)', sizePos);
    if (sizePos + sizeLen > end) throw new WebmParseError('truncated element size', sizePos);
    let size = s0 & (0xff >> sizeLen);
    let allOnes = size === 0xff >> sizeLen;
    for (let i = 1; i < sizeLen; i++) {
      const v = b[sizePos + i]!;
      if (v !== 0xff) allOnes = false;
      size = size * 256 + v;
    }
    const dataStart = sizePos + sizeLen;
    const h = this.header;
    h.id = id;
    h.start = pos;
    h.dataStart = dataStart;
    h.unknownSize = allOnes;
    h.size = allOnes ? 0 : size;
    if (!allOnes && size > end - dataStart) {
      throw new WebmParseError(
        `element 0x${id.toString(16)} size ${size} exceeds its parent (${end - dataStart} bytes left)`,
        pos,
      );
    }
    return h;
  }

  /** Unsigned integer element data (0–8 bytes, big-endian). */
  readUint(pos: number, size: number): number {
    if (size > 8) throw new WebmParseError(`unsigned integer of ${size} bytes`, pos);
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + this.bytes[pos + i]!;
    return v;
  }

  /** Signed integer element data (0–8 bytes, big-endian two's complement). */
  readInt(pos: number, size: number): number {
    if (size === 0) return 0;
    const u = this.readUint(pos, size);
    const neg = (this.bytes[pos]! & 0x80) !== 0;
    return neg ? u - 2 ** (8 * size) : u;
  }

  /** Float element data (0, 4 or 8 bytes). */
  readFloat(pos: number, size: number): number {
    if (size === 0) return 0;
    if (size === 4) return this.view.getFloat32(pos, false);
    if (size === 8) return this.view.getFloat64(pos, false);
    throw new WebmParseError(`float of ${size} bytes`, pos);
  }

  /** ASCII/UTF-8 string element data; trailing NUL padding is removed. */
  readString(pos: number, size: number): string {
    let s = '';
    for (let i = 0; i < size; i++) {
      const c = this.bytes[pos + i]!;
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /** Signed 16-bit big-endian (block relative timecode). */
  readInt16(pos: number): number {
    return this.view.getInt16(pos, false);
  }
}

/**
 * Reads a VINT "number" as used inside Block headers and EBML lacing (marker bit removed).
 * Writes the value into out[0] and the byte length into out[1].
 */
export function readVintValue(bytes: Uint8Array, pos: number, end: number, out: Float64Array): void {
  if (pos >= end) throw new WebmParseError('unexpected end of data in VINT', pos);
  const first = bytes[pos]!;
  const len = leadingZeros8(first) + 1;
  if (len > 8) throw new WebmParseError('invalid VINT (length > 8)', pos);
  if (pos + len > end) throw new WebmParseError('truncated VINT', pos);
  let v = first & (0xff >> len);
  for (let i = 1; i < len; i++) v = v * 256 + bytes[pos + i]!;
  out[0] = v;
  out[1] = len;
}
