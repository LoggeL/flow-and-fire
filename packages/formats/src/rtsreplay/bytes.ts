/**
 * Byte-level helpers of the .rtsreplay chunks: a growing little-endian writer and a strict,
 * bounds-checked reader. Every malformed input surfaces as FormatError (never RangeError or
 * TypeError), tagged with the chunk id and the chunk's file offset.
 *
 * Varints are unsigned LEB128 limited to 32 bits (at most 5 bytes, the fifth ≤ 0x0f) and must be
 * minimal (no redundant 0x80 … 0x00 tails), so every value has exactly one encoding.
 */

import { decodeUtf8, encodeUtf8 } from '@faf/protocol';
import { FormatError, type FormatErrorCode } from '../errors.ts';

/** Zigzag mapping of a signed 32-bit integer to an unsigned one (0, −1, 1, −2 … → 0, 1, 2, 3 …). */
export function zigzag(v: number): number {
  return ((v << 1) ^ (v >> 31)) >>> 0;
}

/** Inverse of {@link zigzag}; returns a signed 32-bit integer. */
export function unzigzag(u: number): number {
  return (u >>> 1) ^ -(u & 1);
}

/** Growing byte buffer with little-endian and varint writers. */
export class ByteWriter {
  private buf: Uint8Array;
  private dv: DataView;
  private len = 0;

  constructor(initialCapacity = 256) {
    this.buf = new Uint8Array(initialCapacity < 16 ? 16 : initialCapacity);
    this.dv = new DataView(this.buf.buffer);
  }

  get length(): number {
    return this.len;
  }

  private ensure(extra: number): void {
    const need = this.len + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  i8(v: number): void {
    this.u8(v & 0xff);
  }

  u16(v: number): void {
    this.ensure(2);
    this.dv.setUint16(this.len, v, true);
    this.len += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.dv.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }

  /** Unsigned varint of a u32 value. */
  varint(v: number): void {
    let x = v >>> 0;
    this.ensure(5);
    while (x >= 0x80) {
      this.buf[this.len++] = (x & 0x7f) | 0x80;
      x >>>= 7;
    }
    this.buf[this.len++] = x;
  }

  /** Zigzag varint of a signed 32-bit value. */
  svarint(v: number): void {
    this.varint(zigzag(v));
  }

  bytes(b: Uint8Array, start = 0, end = b.length): void {
    const n = end - start;
    this.ensure(n);
    this.buf.set(b.subarray(start, end), this.len);
    this.len += n;
  }

  /** u16 byte length + strict UTF-8 (FormatError 'bad-value' if not encodable or > 65535 B). */
  str16(s: string, chunkId: string, what: string): void {
    const b = encodeText(s, chunkId, what);
    if (b.length > 0xffff) throw new FormatError('bad-value', `${what} is ${b.length} bytes, max 65535`, chunkId);
    this.u16(b.length);
    this.bytes(b);
  }

  /** Copy of the written bytes. */
  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }

  /** View of the written bytes (valid until the next write). */
  view(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

/** UTF-8 encoding with FormatError instead of RangeError (lone surrogates). */
export function encodeText(s: string, chunkId: string | null, what: string): Uint8Array {
  if (typeof s !== 'string') throw new FormatError('bad-value', `${what} must be a string`, chunkId);
  try {
    return encodeUtf8(s);
  } catch (e) {
    throw new FormatError('bad-value', `${what} is not valid Unicode (${(e as Error).message})`, chunkId);
  }
}

/** Strict bounds-checked reader over `bytes[start, end)`. */
export class ByteReader {
  private readonly dv: DataView;
  pos: number;

  constructor(
    readonly bytes: Uint8Array,
    /** Chunk the bytes belong to (error context). */
    readonly chunkId: string,
    /** File offset of the chunk (error context), −1 if unknown. */
    readonly chunkOffset: number,
    start = 0,
    readonly end: number = bytes.length,
  ) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = start;
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  fail(code: FormatErrorCode, detail: string): never {
    throw new FormatError(code, `${detail} (data byte ${this.pos})`, this.chunkId, this.chunkOffset);
  }

  need(n: number, what: string): void {
    if (n > this.end - this.pos) this.fail('truncated', `${what}: needs ${n} bytes, ${this.end - this.pos} left`);
  }

  u8(what: string): number {
    this.need(1, what);
    return this.bytes[this.pos++]!;
  }

  i8(what: string): number {
    return (this.u8(what) << 24) >> 24;
  }

  u16(what: string): number {
    this.need(2, what);
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(what: string): number {
    this.need(4, what);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(what: string): number {
    this.need(4, what);
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Minimal unsigned LEB128 varint of at most 32 bits. */
  varint(what: string): number {
    let v = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      if (this.pos >= this.end) this.fail('truncated', `${what}: varint runs past the end`);
      const b = this.bytes[this.pos++]!;
      if (i === 4 && b > 0x0f) this.fail('bad-value', `${what}: varint overflows 32 bits`);
      v = (v | ((b & 0x7f) << shift)) >>> 0;
      if ((b & 0x80) === 0) {
        if (b === 0 && i > 0) this.fail('non-canonical', `${what}: varint is not minimal`);
        return v;
      }
      shift += 7;
    }
    return this.fail('bad-value', `${what}: varint longer than 5 bytes`);
  }

  /** Varint that must not exceed `max`. */
  varintMax(max: number, what: string): number {
    const v = this.varint(what);
    if (v > max) this.fail('bad-value', `${what} ${v} exceeds ${max}`);
    return v;
  }

  svarint(what: string): number {
    return unzigzag(this.varint(what));
  }

  /** View of the next `n` bytes (no copy). */
  take(n: number, what: string): Uint8Array {
    this.need(n, what);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** u16 byte length + strict UTF-8. */
  str16(what: string): string {
    const n = this.u16(`${what} length`);
    const b = this.take(n, what);
    try {
      return decodeUtf8(b);
    } catch (e) {
      return this.fail('bad-value', `${what} is not valid UTF-8 (${(e as Error).message})`);
    }
  }

  /** Throws unless every byte was consumed. */
  done(what: string): void {
    if (this.pos !== this.end) this.fail('trailing-bytes', `${this.end - this.pos} unexpected bytes after ${what}`);
  }
}
