/**
 * Synchronous raw DEFLATE codec (RFC 1951, no zlib/gzip framing) over fflate — the compression of
 * .rtsreplay CMDS blocks and of heap keyframes (PLAN §3.11).
 *
 * Canonical output: the compressed bytes are a pure function of (input, level) for a pinned
 * fflate version. fflate derives its hash-table size from `Math.log(input.length)` unless `mem`
 * is given; that float path could differ between engines, so `mem` is always fixed
 * (DEFLATE_MEM_LEVEL). The remaining encoder is integer-only (Huffman tree sort uses a
 * comparator; Array.prototype.sort is stable in every engine since ES2019). A golden test pins the
 * bytes, so an fflate update that changes the output fails loudly (written replays stay readable
 * either way — only byte-identical rewriting depends on it).
 *
 * The decoder reads every valid raw DEFLATE stream, including output of node:zlib and of the
 * browser's CompressionStream('deflate-raw'). It never grows its output: the caller states the
 * exact decompressed length (stored in the container) and anything else is a FormatError.
 */

import { deflateSync, inflateSync, type DeflateOptions } from 'fflate';
import { FormatError } from './errors.ts';

/**
 * Compression level used by the replay writer and the keyframe store. Measured on a 1,000-unit
 * arena snapshot (1.48 MB) and on the synthetic 30-min 1v1 command stream in 600-tick blocks
 * (docs/status/track-replay/p0.md): on commands level 6 is 3.7 % smaller than level 1 and equal to
 * level 9 (+12 % time); on the snapshot all levels are within 0.6 %, level 9 is 6× slower.
 * Changing it changes written bytes (golden tests), so it is part of the canonical writer.
 */
export const DEFAULT_DEFLATE_LEVEL = 6;

/**
 * fflate memory level (hash table = 2^(12 + mem) u16 entries). Fixed for canonical output; 4 means
 * a 128 KiB hash table per call, cheap for the many small CMDS blocks and within 0.1 % of mem 8 on
 * both measured inputs.
 */
export const DEFLATE_MEM_LEVEL = 4;

/** Upper bound of a single decompressed buffer (keyframe budget is 128 MB, snapshots stay below). */
export const MAX_INFLATE_BYTES = 256 * 1024 * 1024;

/** Valid compression levels (0 = stored blocks only, 9 = best). */
export type DeflateLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

function checkLevel(level: number): DeflateLevel {
  if (!Number.isInteger(level) || level < 0 || level > 9) throw new RangeError(`deflate level must be 0..9, got ${level}`);
  return level as DeflateLevel;
}

/**
 * Compresses `bytes` as a raw DEFLATE stream. Deterministic and engine-independent for a fixed
 * `level` (see module doc). An empty input yields the 2-byte empty stream.
 */
export function deflateRaw(bytes: Uint8Array, level: number = DEFAULT_DEFLATE_LEVEL): Uint8Array {
  const opts: DeflateOptions = { level: checkLevel(level), mem: DEFLATE_MEM_LEVEL };
  return deflateSync(bytes, opts);
}

/**
 * Decompresses a raw DEFLATE stream that must expand to exactly `expectedLength` bytes.
 *
 * - `expectedLength` > `maxLength` → FormatError('too-large') before any allocation.
 * - malformed or truncated data, an empty input, or an output shorter or longer than
 *   `expectedLength` → FormatError('bad-compression'). No other exception escapes for bad data.
 *
 * Memory is bounded by `expectedLength` (+1 guard byte): the output buffer is allocated up front
 * and never grown, so a deflate bomb cannot allocate more than the caller declared. Decoding a
 * bomb still costs CPU proportional to its expanded size (≤ 1032 × input), which the container's
 * chunk size limit bounds. The returned view has exactly `expectedLength` bytes; its underlying
 * buffer is one byte longer (the overflow guard).
 */
export function inflateRaw(bytes: Uint8Array, expectedLength: number, maxLength: number = MAX_INFLATE_BYTES): Uint8Array {
  if (!Number.isInteger(maxLength) || maxLength < 0) throw new RangeError(`inflateRaw: maxLength must be a non-negative integer, got ${maxLength}`);
  if (!Number.isInteger(expectedLength) || expectedLength < 0) {
    throw new FormatError('bad-value', `inflate: expected length must be a non-negative integer, got ${expectedLength}`);
  }
  if (expectedLength > maxLength) {
    throw new FormatError('too-large', `inflate: expected length ${expectedLength} exceeds the limit of ${maxLength} bytes`);
  }
  if (bytes.length === 0) throw new FormatError('bad-compression', 'inflate: empty input is not a deflate stream');
  // One guard byte: fflate never grows a caller-supplied buffer and drops writes past its end, so
  // a stream producing more than expectedLength bytes shows up as a full guard buffer.
  const out = new Uint8Array(expectedLength + 1);
  let res: Uint8Array;
  try {
    res = inflateSync(bytes, { out });
  } catch (e) {
    // fflate errors (bad block type, invalid code, unexpected EOF) and RangeErrors from stored
    // blocks that overrun the guard buffer.
    const msg = e instanceof Error ? e.message : String(e);
    throw new FormatError('bad-compression', `inflate failed: ${msg}`);
  }
  if (res.buffer !== out.buffer) throw new FormatError('bad-compression', 'inflate: decoder did not use the output buffer');
  if (res.length > expectedLength) {
    throw new FormatError('bad-compression', `inflate: stream expands to more than the expected ${expectedLength} bytes`);
  }
  if (res.length < expectedLength) {
    throw new FormatError('bad-compression', `inflate: stream expands to ${res.length} bytes, expected ${expectedLength}`);
  }
  return out.subarray(0, expectedLength);
}
