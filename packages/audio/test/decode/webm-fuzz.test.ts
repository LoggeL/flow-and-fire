import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { demuxWebmOpus, WebmParseError } from '../../src/decode/index.ts';
import { realBytes, realVariants } from './real-files.ts';

/** Per-case time limit: a hang or pathological loop would blow far past this. */
const CASE_LIMIT_MS = 50;

function check(bytes: Uint8Array): 'ok' | 'error' {
  const t0 = performance.now();
  let outcome: 'ok' | 'error';
  try {
    const t = demuxWebmOpus(bytes);
    // A result must be internally consistent.
    expect(t.packets.length).toBeGreaterThan(0);
    expect(t.timestampsUs.length).toBe(t.packets.length);
    expect(t.channels).toBeGreaterThan(0);
    for (const p of t.packets) {
      expect(p.buffer).toBe(bytes.buffer);
      expect(p.byteOffset + p.length).toBeLessThanOrEqual(bytes.byteOffset + bytes.length);
    }
    outcome = 'ok';
  } catch (e) {
    if (!(e instanceof WebmParseError)) throw e;
    expect(Number.isInteger(e.offset)).toBe(true);
    outcome = 'error';
  }
  const ms = performance.now() - t0;
  expect(ms).toBeLessThan(CASE_LIMIT_MS);
  return outcome;
}

describe('demuxWebmOpus robustness (fast-check)', () => {
  const files = realVariants()
    .filter((_, i) => i % 5 === 0)
    .map((v) => realBytes(v.opus));

  it('500 random truncations and bit flips of real files: result or WebmParseError, never a hang', () => {
    const counts = { ok: 0, error: 0 };
    fc.assert(
      fc.property(
        fc.nat({ max: files.length - 1 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.nat({ max: 7 })), { maxLength: 8 }),
        fc.boolean(),
        (fileIdx, cut, flips, truncate) => {
          const src = files[fileIdx]!;
          const len = truncate ? Math.floor(cut * src.length) : src.length;
          const bytes = src.slice(0, len);
          for (const [where, bit] of flips) {
            if (bytes.length === 0) break;
            const at = Math.min(bytes.length - 1, Math.floor(where * bytes.length));
            bytes[at]! ^= 1 << bit;
          }
          counts[check(bytes)]++;
        },
      ),
      { numRuns: 500, seed: 0x5eed },
    );
    // Both outcomes must actually occur (flips in packet payloads keep the container valid).
    expect(counts.ok).toBeGreaterThan(0);
    expect(counts.error).toBeGreaterThan(0);
  });

  it('flips concentrated in the container header (first 512 bytes) are handled', () => {
    fc.assert(
      fc.property(fc.nat({ max: files.length - 1 }), fc.array(fc.tuple(fc.nat({ max: 511 }), fc.nat({ max: 7 })), { minLength: 1, maxLength: 4 }), (fileIdx, flips) => {
        const bytes = files[fileIdx]!.slice();
        for (const [at, bit] of flips) bytes[Math.min(at, bytes.length - 1)]! ^= 1 << bit;
        check(bytes);
      }),
      { numRuns: 300, seed: 42 },
    );
  });

  it('random garbage and EBML-looking prefixes never throw anything but WebmParseError', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), fc.boolean(), (garbage, withHeader) => {
        const prefix = withHeader ? files[0]!.subarray(0, 64) : new Uint8Array(0);
        const bytes = new Uint8Array(prefix.length + garbage.length);
        bytes.set(prefix, 0);
        bytes.set(garbage, prefix.length);
        check(bytes);
      }),
      { numRuns: 300, seed: 7 },
    );
  });
});
