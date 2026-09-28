/**
 * xxHash32 (reference: Yann Collet, XXH32) — one-shot and allocation-free streaming variant.
 * Used for the rule hash over arena live ranges (PLAN §3.5), LUT pinning and content hashes.
 *
 * All arithmetic is 32-bit via Math.imul and `| 0`; results are u32 (`>>> 0`).
 * Fast path: aligned input is read through a cached Uint32Array view of the underlying buffer
 * (only on little-endian hosts, checked once at load). The view is cached per ArrayBuffer so
 * hashing the (non-growing) arena never allocates.
 */

const P1 = 0x9e3779b1;
const P2 = 0x85ebca77;
const P3 = 0xc2b2ae3d;
const P4 = 0x27d4eb2f;
const P5 = 0x165667b1;

/** True if the host stores integers little-endian (all current browsers/Node on x86/ARM). */
export const IS_LITTLE_ENDIAN: boolean = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

let cachedBuffer: ArrayBufferLike | null = null;
let cachedU32: Uint32Array | null = null;

function u32ViewOf(buffer: ArrayBufferLike): Uint32Array {
  if (buffer !== cachedBuffer || cachedU32 === null || cachedU32.length !== buffer.byteLength >>> 2) {
    cachedBuffer = buffer;
    cachedU32 = new Uint32Array(buffer, 0, buffer.byteLength >>> 2);
  }
  return cachedU32;
}

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

function round(acc: number, lane: number): number {
  acc = (acc + Math.imul(lane, P2)) | 0;
  acc = rotl(acc, 13);
  return Math.imul(acc, P1);
}

function readU32(b: Uint8Array, p: number): number {
  return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) | 0;
}

function avalanche(h: number): number {
  h ^= h >>> 15;
  h = Math.imul(h, P2);
  h ^= h >>> 13;
  h = Math.imul(h, P3);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Processes the tail (< 16 bytes) and finalizes. */
function finalize(h: number, b: Uint8Array, p: number, end: number): number {
  while (p + 4 <= end) {
    h = (h + Math.imul(readU32(b, p), P3)) | 0;
    h = Math.imul(rotl(h, 17), P4);
    p += 4;
  }
  while (p < end) {
    h = (h + Math.imul(b[p]!, P5)) | 0;
    h = Math.imul(rotl(h, 11), P1);
    p++;
  }
  return avalanche(h);
}

/**
 * One-shot xxHash32 of bytes[offset, offset + length) with the given seed (u32).
 */
export function xxHash32(bytes: Uint8Array, offset: number, length: number, seed: number): number {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new RangeError('xxHash32: range out of bounds');
  }
  seed |= 0;
  let p = offset;
  const end = offset + length;
  let h: number;
  if (length >= 16) {
    let v1 = (seed + P1 + P2) | 0;
    let v2 = (seed + P2) | 0;
    let v3 = seed;
    let v4 = (seed - P1) | 0;
    const limit = end - 16;
    const abs = bytes.byteOffset + p;
    if (IS_LITTLE_ENDIAN && (abs & 3) === 0) {
      const u32 = u32ViewOf(bytes.buffer);
      let w = abs >>> 2;
      while (p <= limit) {
        v1 = round(v1, u32[w]! | 0);
        v2 = round(v2, u32[w + 1]! | 0);
        v3 = round(v3, u32[w + 2]! | 0);
        v4 = round(v4, u32[w + 3]! | 0);
        w += 4;
        p += 16;
      }
    } else {
      while (p <= limit) {
        v1 = round(v1, readU32(bytes, p));
        v2 = round(v2, readU32(bytes, p + 4));
        v3 = round(v3, readU32(bytes, p + 8));
        v4 = round(v4, readU32(bytes, p + 12));
        p += 16;
      }
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
  } else {
    h = (seed + P5) | 0;
  }
  h = (h + length) | 0;
  return finalize(h, bytes, p, end);
}

/**
 * Streaming xxHash32. Allocation-free after construction:
 * `reset(seed)`, any number of `update(u8, off, len)`, then `digest()` (does not modify state).
 */
export class XxHash32 {
  private v1 = 0;
  private v2 = 0;
  private v3 = 0;
  private v4 = 0;
  private seed = 0;
  /** Total bytes consumed (exact up to 2^53). */
  private total = 0;
  private readonly mem = new Uint8Array(16);
  private memSize = 0;

  constructor(seed = 0) {
    this.reset(seed);
  }

  reset(seed: number): this {
    const s = seed | 0;
    this.seed = s;
    this.v1 = (s + P1 + P2) | 0;
    this.v2 = (s + P2) | 0;
    this.v3 = s;
    this.v4 = (s - P1) | 0;
    this.total = 0;
    this.memSize = 0;
    return this;
  }

  update(u8: Uint8Array, off: number, len: number): this {
    if (off < 0 || len < 0 || off + len > u8.length) {
      throw new RangeError('XxHash32.update: range out of bounds');
    }
    this.total += len;
    let p = off;
    const end = off + len;
    const mem = this.mem;

    if (this.memSize + len < 16) {
      const base = this.memSize;
      for (let i = 0; i < len; i++) mem[base + i] = u8[p + i]!;
      this.memSize = base + len;
      return this;
    }

    let v1 = this.v1;
    let v2 = this.v2;
    let v3 = this.v3;
    let v4 = this.v4;

    if (this.memSize > 0) {
      const fill = 16 - this.memSize;
      for (let i = 0; i < fill; i++) mem[this.memSize + i] = u8[p + i]!;
      p += fill;
      v1 = round(v1, readU32(mem, 0));
      v2 = round(v2, readU32(mem, 4));
      v3 = round(v3, readU32(mem, 8));
      v4 = round(v4, readU32(mem, 12));
      this.memSize = 0;
    }

    const limit = end - 16;
    if (p <= limit) {
      const abs = u8.byteOffset + p;
      if (IS_LITTLE_ENDIAN && (abs & 3) === 0) {
        const u32 = u32ViewOf(u8.buffer);
        let w = abs >>> 2;
        while (p <= limit) {
          v1 = round(v1, u32[w]! | 0);
          v2 = round(v2, u32[w + 1]! | 0);
          v3 = round(v3, u32[w + 2]! | 0);
          v4 = round(v4, u32[w + 3]! | 0);
          w += 4;
          p += 16;
        }
      } else {
        while (p <= limit) {
          v1 = round(v1, readU32(u8, p));
          v2 = round(v2, readU32(u8, p + 4));
          v3 = round(v3, readU32(u8, p + 8));
          v4 = round(v4, readU32(u8, p + 12));
          p += 16;
        }
      }
    }

    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
    this.v4 = v4;

    const rest = end - p;
    for (let i = 0; i < rest; i++) mem[i] = u8[p + i]!;
    this.memSize = rest;
    return this;
  }

  /** Current hash (u32). Can be called repeatedly; further updates continue the stream. */
  digest(): number {
    let h: number;
    if (this.total >= 16) {
      h = (rotl(this.v1, 1) + rotl(this.v2, 7) + rotl(this.v3, 12) + rotl(this.v4, 18)) | 0;
    } else {
      h = (this.seed + P5) | 0;
    }
    // The spec adds the total length mod 2^32.
    h = (h + (this.total >>> 0)) | 0;
    return finalize(h, this.mem, 0, this.memSize);
  }
}
