/**
 * Adaptive binary range coder (LZMA style, integer only) and the symbol models built on it — the
 * entropy stage of the CMDS raw block encoding (cmds.ts).
 *
 * Coder: 32-bit range, 33-bit low with carry propagation (cache + cacheSize), 12-bit
 * probabilities with a per-cell observation count: the adaptation rate starts at ½ and slows to
 * 1/16 (RATE_SHIFT), so the flat models of each 600-tick block learn quickly and then settle.
 * The encoder emits exactly (normalizations + 5) bytes, the first always 0; the
 * decoder consumes exactly as many, so a stream that is too short or too long is detected
 * ('truncated' / 'trailing-bytes').
 *
 * Models (all state in Uint16Array probability tables, flat = PROB_INIT):
 *  - bit:        one probability.
 *  - byte tree:  255 probabilities, MSB first (LZMA literal coder).
 *  - UIntModel:  u32 as bit-length class c = 0..32 (6-bit tree), then the c−1 bits below the leading
 *                one: the top MANTISSA_ADAPTIVE_BITS through a per-class tree, the rest as direct
 *                (equiprobable) bits.
 *
 * Every function takes a `Coder` and a value; the encoder codes the value and returns it, the
 * decoder ignores the argument and returns the decoded value. One code path therefore defines
 * both directions.
 */

import { FormatError } from '../errors.ts';
import { ByteWriter } from './bytes.ts';

const PROB_BITS = 12;
const PROB_ONE = 1 << PROB_BITS;
/** Model cell: probability of a 0 (12 bits) << 4 | observation count (saturating at 15). */
export const PROB_INIT = (PROB_ONE >>> 1) << 4;
/**
 * Adaptation shift by observation count: a fresh model moves fast (≈ 1/(n + 2), a KT-like
 * estimate), a trained one by 1/16. Tuned on the synthetic 30-min 1v1 (p1 status fragment).
 */
const RATE_SHIFT: readonly number[] = [1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4];

/** Probability of a 0 (12 bits) of a model cell. */
function probOf(cell: number): number {
  return cell >>> 4;
}

/** Cell after observing `bit`. */
function adapt(cell: number, bit: number): number {
  const cnt = cell & 15;
  const prob = cell >>> 4;
  const sh = RATE_SHIFT[cnt]!;
  const np = bit === 0 ? prob + ((PROB_ONE - prob) >>> sh) : prob - (prob >>> sh);
  return (np << 4) | (cnt < 15 ? cnt + 1 : 15);
}

const TOP = 0x1000000;
const TWO32 = 0x100000000;

/** Bits of the mantissa (below the leading one) coded adaptively per class. */
const MANTISSA_ADAPTIVE_BITS = 4;
const CLASS_TREE_BITS = 6;
const MAX_CLASS = 32;
/** 2^i for i = 0..32 (exact doubles). */
const POW2: readonly number[] = (() => {
  const t = [1];
  for (let i = 1; i <= 32; i++) t.push(t[i - 1]! * 2);
  return t;
})();

export interface Coder {
  readonly decoding: boolean;
  /** Codes `bit` (0/1) with probability p[i]; returns the (decoded) bit. */
  bit(p: Uint16Array, i: number, bit: number): number;
  /** Codes the low `n` (0..32) bits of `v` with probability ½ each, MSB first. */
  direct(v: number, n: number): number;
}

export class RangeEncoder implements Coder {
  readonly decoding = false;
  private low = 0;
  private range = 0xffffffff;
  private cache = 0;
  private cacheSize = 1;
  private readonly out = new ByteWriter(1024);

  private shiftLow(): void {
    if (this.low < 0xff000000 || this.low >= TWO32) {
      const carry = this.low >= TWO32 ? 1 : 0;
      let c = this.cache;
      do {
        this.out.u8(c + carry);
        c = 0xff;
      } while (--this.cacheSize !== 0);
      this.cache = (this.low >>> 24) & 0xff;
    }
    this.cacheSize++;
    this.low = (this.low % TOP) * 256;
  }

  bit(p: Uint16Array, i: number, bit: number): number {
    const cell = p[i]!;
    const bound = (this.range >>> PROB_BITS) * probOf(cell);
    if (bit === 0) {
      this.range = bound;
    } else {
      this.low += bound;
      this.range -= bound;
    }
    p[i] = adapt(cell, bit);
    while (this.range < TOP) {
      this.range = (this.range * 256) >>> 0;
      this.shiftLow();
    }
    return bit;
  }

  direct(v: number, n: number): number {
    for (let k = n - 1; k >= 0; k--) {
      this.range = this.range >>> 1;
      if (((v >>> k) & 1) !== 0) this.low += this.range;
      while (this.range < TOP) {
        this.range = (this.range * 256) >>> 0;
        this.shiftLow();
      }
    }
    return lowBits(v, n);
  }

  /** Flushes the coder and returns the coded bytes. */
  finish(): Uint8Array {
    for (let i = 0; i < 5; i++) this.shiftLow();
    return this.out.finish();
  }
}

function lowBits(v: number, n: number): number {
  if (n >= 32) return v >>> 0;
  if (n === 0) return 0;
  return (v >>> 0) & (((1 << n) >>> 0) - 1);
}

export class RangeDecoder implements Coder {
  readonly decoding = true;
  private range = 0xffffffff;
  private code = 0;
  private pos: number;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly chunkId: string,
    private readonly chunkOffset: number,
  ) {
    if (bytes.length < 5) this.fail('truncated', `range coded data needs at least 5 bytes, has ${bytes.length}`);
    if (bytes[0] !== 0) this.fail('bad-value', 'range coded data must start with a zero byte');
    for (let i = 1; i < 5; i++) this.code = ((this.code << 8) | bytes[i]!) >>> 0;
    this.pos = 5;
  }

  private fail(code: 'truncated' | 'bad-value' | 'trailing-bytes', detail: string): never {
    throw new FormatError(code, detail, this.chunkId, this.chunkOffset);
  }

  private next(): number {
    if (this.pos >= this.bytes.length) this.fail('truncated', 'range coded data ends early');
    return this.bytes[this.pos++]!;
  }

  bit(p: Uint16Array, i: number): number {
    const cell = p[i]!;
    const bound = (this.range >>> PROB_BITS) * probOf(cell);
    let b: number;
    if (this.code < bound) {
      this.range = bound;
      b = 0;
    } else {
      this.code -= bound;
      this.range -= bound;
      b = 1;
    }
    p[i] = adapt(cell, b);
    while (this.range < TOP) {
      this.range = (this.range * 256) >>> 0;
      this.code = ((this.code * 256) % TWO32) + this.next();
    }
    return b;
  }

  direct(_v: number, n: number): number {
    let v = 0;
    for (let k = 0; k < n; k++) {
      this.range = this.range >>> 1;
      let b = 0;
      if (this.code >= this.range) {
        this.code -= this.range;
        b = 1;
      }
      v = v * 2 + b;
      while (this.range < TOP) {
        this.range = (this.range * 256) >>> 0;
        this.code = ((this.code * 256) % TWO32) + this.next();
      }
    }
    return v;
  }

  /** Throws unless every byte was consumed. */
  finish(): void {
    if (this.pos !== this.bytes.length) this.fail('trailing-bytes', `${this.bytes.length - this.pos} unused bytes after the range coded data`);
  }
}

// ---- models ----------------------------------------------------------------------------------

export function newProbs(n: number): Uint16Array {
  return new Uint16Array(n).fill(PROB_INIT);
}

/** Byte (0..255) through a 255-node binary tree `p` (index 1..255), MSB first. */
export function codeByte(c: Coder, p: Uint16Array, v: number): number {
  let node = 1;
  for (let k = 7; k >= 0; k--) node = node * 2 + c.bit(p, node, (v >>> k) & 1);
  return node - 256;
}

/** Small symbol 0..2^bits−1 through a (2^bits − 1)-node tree `p` at `base`. */
export function codeTree(c: Coder, p: Uint16Array, base: number, bits: number, v: number): number {
  let node = 1;
  for (let k = bits - 1; k >= 0; k--) node = node * 2 + c.bit(p, base + node, (v >>> k) & 1);
  return node - (1 << bits);
}

function bitLength(v: number): number {
  return 32 - Math.clz32(v);
}

/** Adaptive model of unsigned 32-bit integers (see module doc). */
export class UIntModel {
  readonly cls = newProbs(1 << CLASS_TREE_BITS);
  readonly man = newProbs((MAX_CLASS + 1) << MANTISSA_ADAPTIVE_BITS);
}

/**
 * Codes a u32 with model `m`. The decoder fails ('bad-value') on a class above 32 or a value
 * above `max`.
 */
export function codeUInt(c: Coder, m: UIntModel, v: number, max = 0xffffffff, what = 'integer', chunkId = 'CMDS', chunkOffset = -1): number {
  const cls = codeTree(c, m.cls, 0, CLASS_TREE_BITS, c.decoding ? 0 : bitLength(v));
  if (cls > MAX_CLASS) throw new FormatError('bad-value', `${what}: invalid integer class ${cls}`, chunkId, chunkOffset);
  let out: number;
  if (cls <= 1) {
    out = cls;
  } else {
    const mb = cls - 1;
    const a = mb < MANTISSA_ADAPTIVE_BITS ? mb : MANTISSA_ADAPTIVE_BITS;
    const rest = mb - a;
    const top = codeTree(c, m.man, cls << MANTISSA_ADAPTIVE_BITS, a, c.decoding ? 0 : lowBits(v >>> rest, a));
    const low = c.direct(c.decoding ? 0 : lowBits(v, rest), rest);
    // (1·2^a + top)·2^rest + low, exact in doubles for cls ≤ 32.
    out = ((1 << a) + top) * POW2[rest]! + low;
  }
  if (out > max) throw new FormatError('bad-value', `${what} ${out} exceeds ${max}`, chunkId, chunkOffset);
  return out;
}
