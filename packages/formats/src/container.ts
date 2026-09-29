/**
 * Chunk container (PLAN §3.1 "Container"): the shared envelope of .rtsmap (and later .rtsreplay /
 * saves). Layout, all integers little-endian:
 *
 *   File header (16 B):  u32 magic (4CC, ASCII bytes in file order) | u16 containerVersion (= 1)
 *                        | u16 formatVersion | u32 chunkCount | u32 reserved (= 0)
 *   Chunk (repeated):    4CC id | u32 dataLength | data | zero padding to a multiple of 4
 *                        | u32 CRC-32 over (id ‖ dataLength ‖ data)
 *
 * The reader validates magic, versions, bounds, padding and every CRC and throws FormatError
 * (code, chunkId, offset). It does not interpret chunk contents: format readers decide which ids
 * they know and keep the rest (see rtsmap.ts, "unknown chunks survive byte-exact").
 */

import { crc32Update } from './crc32.ts';
import { FormatError } from './errors.ts';

export const CONTAINER_VERSION = 1;
export const CONTAINER_HEADER_BYTES = 16;
/** Bytes a chunk adds on top of its data (id, length, CRC; padding excluded). */
export const CHUNK_OVERHEAD_BYTES = 12;

export interface ContainerChunk {
  /** Four printable ASCII characters (0x20..0x7e), e.g. 'META' or 'HGT '. */
  readonly id: string;
  readonly data: Uint8Array;
}

export interface ReadChunk extends ContainerChunk {
  /** Byte offset of the chunk's id field in the file. */
  readonly offset: number;
}

export interface Container {
  readonly magic: string;
  readonly formatVersion: number;
  /** Chunks in file order; `data` are views into the input bytes (no copy). */
  readonly chunks: readonly ReadChunk[];
}

/** True if `id` is a valid 4CC (exactly four printable ASCII characters). */
export function isFourCC(id: string): boolean {
  if (id.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const c = id.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** The u32 value of a 4CC as stored little-endian (first character = lowest byte). */
export function fourCC(id: string): number {
  if (!isFourCC(id)) throw new FormatError('bad-chunk-id', `invalid 4CC ${JSON.stringify(id)}`);
  return (id.charCodeAt(0) | (id.charCodeAt(1) << 8) | (id.charCodeAt(2) << 16) | (id.charCodeAt(3) << 24)) >>> 0;
}

function fourCCAt(b: Uint8Array, p: number): string | null {
  const c0 = b[p]!;
  const c1 = b[p + 1]!;
  const c2 = b[p + 2]!;
  const c3 = b[p + 3]!;
  if (c0 < 0x20 || c0 > 0x7e || c1 < 0x20 || c1 > 0x7e || c2 < 0x20 || c2 > 0x7e || c3 < 0x20 || c3 > 0x7e) return null;
  return String.fromCharCode(c0, c1, c2, c3);
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function viewOf(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

/**
 * Parses a container and checks its magic. Throws FormatError on any structural problem
 * (truncation, wrong magic/version, non-zero reserved/padding, CRC mismatch, trailing bytes).
 */
export function readContainer(bytes: Uint8Array, magic: string): Container {
  const expected = fourCC(magic);
  if (bytes.length < CONTAINER_HEADER_BYTES) {
    throw new FormatError('truncated', `file has ${bytes.length} bytes, header needs ${CONTAINER_HEADER_BYTES}`, null, 0);
  }
  const dv = viewOf(bytes);
  if (dv.getUint32(0, true) !== expected) {
    throw new FormatError('bad-magic', `expected '${magic}'`, null, 0);
  }
  const containerVersion = dv.getUint16(4, true);
  if (containerVersion !== CONTAINER_VERSION) {
    throw new FormatError('bad-container-version', `container version ${containerVersion}, expected ${CONTAINER_VERSION}`, null, 4);
  }
  const formatVersion = dv.getUint16(6, true);
  const chunkCount = dv.getUint32(8, true);
  if (dv.getUint32(12, true) !== 0) throw new FormatError('bad-reserved', 'reserved header word must be 0', null, 12);
  // Every chunk needs at least CHUNK_OVERHEAD_BYTES: reject absurd counts before looping.
  if (chunkCount * CHUNK_OVERHEAD_BYTES > bytes.length - CONTAINER_HEADER_BYTES) {
    throw new FormatError('truncated', `chunk count ${chunkCount} does not fit into ${bytes.length} bytes`, null, 8);
  }

  const chunks: ReadChunk[] = [];
  let p = CONTAINER_HEADER_BYTES;
  for (let i = 0; i < chunkCount; i++) {
    if (p + 8 > bytes.length) throw new FormatError('truncated', `chunk ${i} header past end of file`, null, p);
    const id = fourCCAt(bytes, p);
    if (id === null) throw new FormatError('bad-chunk-id', `chunk ${i} has a non-ASCII id`, null, p);
    const len = dv.getUint32(p + 4, true);
    const dataStart = p + 8;
    const padded = pad4(len);
    if (len > bytes.length || dataStart + padded + 4 > bytes.length) {
      throw new FormatError('truncated', `chunk data (${len} B) runs past end of file`, id, p);
    }
    for (let k = dataStart + len; k < dataStart + padded; k++) {
      if (bytes[k] !== 0) throw new FormatError('bad-padding', 'padding bytes must be 0', id, k);
    }
    const stored = dv.getUint32(dataStart + padded, true);
    const crc = crc32Update(0, bytes, p, 8 + len);
    if (crc !== stored) {
      throw new FormatError('bad-crc', `CRC 0x${crc.toString(16)} != stored 0x${stored.toString(16)}`, id, dataStart + padded);
    }
    chunks.push({ id, data: bytes.subarray(dataStart, dataStart + len), offset: p });
    p = dataStart + padded + 4;
  }
  if (p !== bytes.length) throw new FormatError('trailing-bytes', `${bytes.length - p} bytes after the last chunk`, null, p);
  return { magic, formatVersion, chunks };
}

/** Size in bytes of the container that writeContainer produces for `chunks`. */
export function containerSize(chunks: readonly ContainerChunk[]): number {
  let n = CONTAINER_HEADER_BYTES;
  for (const c of chunks) n += CHUNK_OVERHEAD_BYTES + pad4(c.data.length);
  return n;
}

/** Serializes chunks (in the given order) into a container. */
export function writeContainer(magic: string, formatVersion: number, chunks: readonly ContainerChunk[]): Uint8Array {
  const m = fourCC(magic);
  if (!Number.isInteger(formatVersion) || formatVersion < 0 || formatVersion > 0xffff) {
    throw new FormatError('bad-format-version', `format version ${formatVersion} is not a u16`);
  }
  const out = new Uint8Array(containerSize(chunks));
  const dv = viewOf(out);
  dv.setUint32(0, m, true);
  dv.setUint16(4, CONTAINER_VERSION, true);
  dv.setUint16(6, formatVersion, true);
  dv.setUint32(8, chunks.length, true);
  dv.setUint32(12, 0, true);
  let p = CONTAINER_HEADER_BYTES;
  for (const c of chunks) {
    dv.setUint32(p, fourCC(c.id), true);
    const len = c.data.length;
    dv.setUint32(p + 4, len, true);
    out.set(c.data, p + 8);
    const padded = pad4(len);
    dv.setUint32(p + 8 + padded, crc32Update(0, out, p, 8 + len), true);
    p += 8 + padded + 4;
  }
  return out;
}
