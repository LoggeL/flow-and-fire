import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATAN_XXH32,
  type Ang16,
  SIN_QUARTER_XXH32,
  angAdd,
  angDiff,
  angRotateTowards,
  angSub,
  angToDir,
  asAng16,
  atan2A,
  cosA,
  deg,
  sinA,
  xxHash32,
} from '@faf/fixed';
import { ATAN_DATA, SIN_QUARTER_DATA } from '../src/luts.generated.ts';
import { computeAtan, computeSinQuarter, toLeBytes } from '../scripts/gen-luts.ts';
import { TestRng } from './support/prng.ts';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sinBin = new Uint8Array(readFileSync(resolve(pkgDir, 'luts/sin_quarter.bin')));
const atanBin = new Uint8Array(readFileSync(resolve(pkgDir, 'luts/atan.bin')));

/** Pinned LUT hashes (xxHash32, seed 0). Changing a LUT breaks every replay — update deliberately. */
const PINNED_SIN_QUARTER_XXH32 = 0x5a60f785;
const PINNED_ATAN_XXH32 = 0x7bb4897c;

function u16le(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) out.push(bytes[i]! | (bytes[i + 1]! << 8));
  return out;
}

const TAU = 2 * Math.PI;

describe('LUT integrity', () => {
  it('checked-in .bin files have the pinned xxHash32', () => {
    expect(sinBin.length).toBe(4096 * 2);
    expect(atanBin.length).toBe(1024 * 2);
    expect(xxHash32(sinBin, 0, sinBin.length, 0)).toBe(PINNED_SIN_QUARTER_XXH32);
    expect(xxHash32(atanBin, 0, atanBin.length, 0)).toBe(PINNED_ATAN_XXH32);
    expect(SIN_QUARTER_XXH32).toBe(PINNED_SIN_QUARTER_XXH32);
    expect(ATAN_XXH32).toBe(PINNED_ATAN_XXH32);
  });

  it('luts.generated.ts equals the .bin files', () => {
    expect([...SIN_QUARTER_DATA]).toEqual(u16le(sinBin));
    expect([...ATAN_DATA]).toEqual(u16le(atanBin));
  });

  it('the generator reproduces the .bin files on this engine', () => {
    expect(toLeBytes(computeSinQuarter())).toEqual(sinBin);
    expect(toLeBytes(computeAtan())).toEqual(atanBin);
  });
});

describe('deg and angle arithmetic', () => {
  it('deg() converts and wraps', () => {
    expect(deg(0)).toBe(0);
    expect(deg(90)).toBe(16384);
    expect(deg(180)).toBe(32768);
    expect(deg(-90)).toBe(49152);
    expect(deg(360)).toBe(0);
    expect(deg(45)).toBe(8192);
    expect(deg(22.5)).toBe(4096);
    expect(deg(1)).toBe(182); // 65536/360 = 182.04
  });

  it('angAdd/angSub/angDiff wrap and pick the shortest way', () => {
    expect(angAdd(deg(337.5), deg(45))).toBe(deg(22.5));
    expect(angSub(deg(22.5), deg(45))).toBe(deg(337.5));
    expect(angDiff(deg(337.5), deg(22.5))).toBe(deg(45));
    expect(angDiff(deg(22.5), deg(337.5))).toBe(-deg(45));
    expect(angDiff(asAng16(0), asAng16(32768))).toBe(-32768);
    expect(angDiff(asAng16(0), asAng16(32767))).toBe(32767);
    const rng = new TestRng(0xa11);
    for (let i = 0; i < 10000; i++) {
      const a = asAng16(rng.u32());
      const b = asAng16(rng.u32());
      const d = angDiff(a, b);
      expect(d).toBeGreaterThanOrEqual(-32768);
      expect(d).toBeLessThanOrEqual(32767);
      expect(angAdd(a, d)).toBe(b);
    }
  });

  it('angRotateTowards steps by at most maxStep and lands exactly', () => {
    let cur = deg(350);
    const target = deg(20);
    const seen: number[] = [];
    for (let i = 0; i < 10 && cur !== target; i++) {
      const next = angRotateTowards(cur, target, deg(8));
      expect(Math.abs(angDiff(cur, next))).toBeLessThanOrEqual(deg(8));
      cur = next;
      seen.push(cur);
    }
    expect(cur).toBe(target);
    expect(seen.length).toBe(4); // 30° in steps of ≤ 8°
    expect(angRotateTowards(deg(10), deg(10), 0)).toBe(deg(10));
    expect(angRotateTowards(deg(10), deg(350), deg(5))).toBe(deg(5));
  });
});

describe('sinA / cosA', () => {
  it('exact at the cardinal angles', () => {
    expect(sinA(asAng16(0))).toBe(0);
    expect(sinA(asAng16(16384))).toBe(4096);
    expect(sinA(asAng16(32768))).toBe(0);
    expect(sinA(asAng16(49152))).toBe(-4096);
    expect(cosA(asAng16(0))).toBe(4096);
    expect(cosA(asAng16(16384))).toBe(0);
    expect(cosA(asAng16(32768))).toBe(-4096);
    expect(cosA(asAng16(49152))).toBe(0);
    expect(Object.is(sinA(asAng16(32768)), 0)).toBe(true);
  });

  it('error ≤ 1.5 raw units against Math.sin/cos over all 65536 angles', () => {
    let maxErr = 0;
    for (let a = 0; a < 65536; a++) {
      const ang = a as Ang16;
      const es = Math.abs(sinA(ang) - Math.sin((a * TAU) / 65536) * 4096);
      const ec = Math.abs(cosA(ang) - Math.cos((a * TAU) / 65536) * 4096);
      maxErr = Math.max(maxErr, es, ec);
    }
    expect(maxErr).toBeLessThanOrEqual(1.5);
  });

  it('is odd/symmetric: sin(−a) = −sin(a), sin(a + 180°) = −sin(a)', () => {
    for (let a = 0; a < 65536; a += 7) {
      const ang = a as Ang16;
      expect(sinA(asAng16(-a))).toBe(-sinA(ang) + 0);
      expect(sinA(angAdd(ang, 32768))).toBe(-sinA(ang) + 0);
    }
  });

  it('angToDir writes (cos, sin)', () => {
    const out = new Int32Array(4);
    angToDir(deg(90), out, 2);
    expect([...out]).toEqual([0, 0, 0, 4096]);
  });
});

describe('atan2A', () => {
  it('exact on axes and diagonals', () => {
    expect(atan2A(0, 0)).toBe(0);
    expect(atan2A(0, 5)).toBe(0);
    expect(atan2A(5, 0)).toBe(16384);
    expect(atan2A(0, -5)).toBe(32768);
    expect(atan2A(-5, 0)).toBe(49152);
    expect(atan2A(7, 7)).toBe(8192);
    expect(atan2A(7, -7)).toBe(24576);
    expect(atan2A(-7, -7)).toBe(40960);
    expect(atan2A(-7, 7)).toBe(57344);
  });

  it('error ≤ 2 Ang16 units against Math.atan2 for 200k vectors of all magnitudes', () => {
    const rng = new TestRng(0xa7a2);
    let maxErr = 0;
    for (let i = 0; i < 200_000; i++) {
      const x = rng.signedLog(31);
      const y = rng.signedLog(31);
      if (x === 0 && y === 0) continue;
      const got = atan2A(y, x);
      const want = ((Math.atan2(y, x) * 65536) / TAU + 65536) % 65536;
      let err = Math.abs(got - want);
      if (err > 32768) err = 65536 - err;
      maxErr = Math.max(maxErr, err);
    }
    expect(maxErr).toBeLessThanOrEqual(2);
  });

  it('round-trips with sinA/cosA', () => {
    let maxErr = 0;
    for (let a = 0; a < 65536; a += 3) {
      const ang = a as Ang16;
      const back = atan2A(sinA(ang) * 1024, cosA(ang) * 1024);
      maxErr = Math.max(maxErr, Math.abs(angDiff(ang, back)));
    }
    // sin/cos carry ±1.5/4096 error → up to ≈ 24 Ang16 near the axes; generous bound 32.
    expect(maxErr).toBeLessThanOrEqual(32);
  });
});
