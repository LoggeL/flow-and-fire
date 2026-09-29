import { describe, expect, it } from 'vitest';
import { FRAME_LAYOUT, PALETTE_LAYOUT, MAX_ARMY_COLORS } from '../src/passes/shared.ts';
import { Std140Writer, std140Layout } from '../src/std140.ts';

describe('std140Layout', () => {
  it('aligns scalars to 4, vec2 to 8, vec3/vec4 to 16', () => {
    const l = std140Layout([
      { name: 'a', type: 'float' },
      { name: 'b', type: 'vec2' },
      { name: 'c', type: 'float' },
      { name: 'd', type: 'vec3' },
      { name: 'e', type: 'float' },
      { name: 'f', type: 'vec4' },
      { name: 'g', type: 'int' },
      { name: 'h', type: 'uint' },
    ]);
    expect(l.offsetOf('a')).toBe(0);
    expect(l.offsetOf('b')).toBe(8);
    expect(l.offsetOf('c')).toBe(16);
    expect(l.offsetOf('d')).toBe(32);
    // A scalar may fill the 4-byte tail of a vec3.
    expect(l.offsetOf('e')).toBe(44);
    expect(l.offsetOf('f')).toBe(48);
    expect(l.offsetOf('g')).toBe(64);
    expect(l.offsetOf('h')).toBe(68);
    expect(l.size).toBe(80);
  });

  it('rounds array element strides up to 16 and aligns arrays to 16', () => {
    const l = std140Layout([
      { name: 'x', type: 'float' },
      { name: 'fa', type: 'float', count: 4 },
      { name: 'ia', type: 'int', count: 3 },
      { name: 'va', type: 'vec2', count: 2 },
      { name: 'y', type: 'float' },
    ]);
    const fa = l.fields[1]!;
    expect(fa.offset).toBe(16);
    expect(fa.stride).toBe(16);
    expect(l.offsetOf('ia')).toBe(16 + 64);
    expect(l.offsetOf('va')).toBe(16 + 64 + 48);
    expect(l.fields[3]!.stride).toBe(16);
    // The member after an array starts at the next 16-byte boundary (array end is already aligned).
    expect(l.offsetOf('y')).toBe(16 + 64 + 48 + 32);
    expect(l.size).toBe(176);
  });

  it('lays out mat3 as three padded columns and mat4 as 64 bytes', () => {
    const l = std140Layout([
      { name: 's', type: 'float' },
      { name: 'm3', type: 'mat3' },
      { name: 'm4', type: 'mat4' },
      { name: 'ma', type: 'mat4', count: 2 },
    ]);
    expect(l.offsetOf('m3')).toBe(16);
    expect(l.offsetOf('m4')).toBe(64);
    expect(l.offsetOf('ma')).toBe(128);
    expect(l.fields[3]!.stride).toBe(64);
    expect(l.size).toBe(256);
  });

  it('rounds the block size up to 16 and rejects bad input', () => {
    expect(std140Layout([{ name: 'a', type: 'float' }]).size).toBe(16);
    expect(std140Layout([]).size).toBe(16);
    expect(() => std140Layout([{ name: 'a', type: 'float', count: 0 }])).toThrow(/invalid array length/);
    expect(() =>
      std140Layout([
        { name: 'a', type: 'float' },
        { name: 'a', type: 'int' },
      ]),
    ).toThrow(/duplicate/);
    expect(() => std140Layout([{ name: 'a', type: 'float' }]).offsetOf('b')).toThrow(/unknown field/);
  });

  it('matches the GLSL Frame and Palette blocks', () => {
    expect(FRAME_LAYOUT.offsetOf('viewProj')).toBe(0);
    expect(FRAME_LAYOUT.offsetOf('camPosInt')).toBe(64);
    expect(FRAME_LAYOUT.offsetOf('camFrac')).toBe(80);
    expect(FRAME_LAYOUT.offsetOf('viewport')).toBe(64 + 16 * 8);
    expect(FRAME_LAYOUT.size).toBe(64 + 16 * 9);
    expect(PALETTE_LAYOUT.offsetOf('visual')).toBe(MAX_ARMY_COLORS * 16);
  });
});

describe('Std140Writer', () => {
  it('packs mat4/vec4/ivec4/float/int/uint arrays at the layout offsets', () => {
    const l = std140Layout([
      { name: 'm', type: 'mat4' },
      { name: 'v', type: 'vec4' },
      { name: 'iv', type: 'ivec4' },
      { name: 'f', type: 'float', count: 3 },
      { name: 'i', type: 'int', count: 2 },
      { name: 'u', type: 'uint', count: 2 },
      { name: 'm3', type: 'mat3' },
    ]);
    const w = new Std140Writer(l);
    expect(w.bytes.byteLength).toBe(l.size);
    const m = Float32Array.from({ length: 16 }, (_, k) => k + 1);
    w.mat4(l.offsetOf('m'), m);
    w.vec4(l.offsetOf('v'), 1.5, 2.5, 3.5, 4.5);
    w.ivec4(l.offsetOf('iv'), -1, 2, -3, 2147483647);
    w.floatArray(l.offsetOf('f'), [0.25, 0.5, 0.75]);
    w.intArray(l.offsetOf('i'), [-7, 9]);
    w.uintArray(l.offsetOf('u'), [0xffffffff, 3]);
    w.mat3(l.offsetOf('m3'), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const f32 = new Float32Array(w.buffer);
    const i32 = new Int32Array(w.buffer);
    const u32 = new Uint32Array(w.buffer);
    expect(Array.from(f32.subarray(0, 16))).toEqual(Array.from(m));
    expect(Array.from(f32.subarray(16, 20))).toEqual([1.5, 2.5, 3.5, 4.5]);
    expect(Array.from(i32.subarray(20, 24))).toEqual([-1, 2, -3, 2147483647]);
    const fo = l.offsetOf('f') >> 2;
    expect([f32[fo], f32[fo + 4], f32[fo + 8]]).toEqual([0.25, 0.5, 0.75]);
    expect(f32[fo + 1]).toBe(0); // padding untouched
    const io = l.offsetOf('i') >> 2;
    expect([i32[io], i32[io + 4]]).toEqual([-7, 9]);
    const uo = l.offsetOf('u') >> 2;
    expect([u32[uo], u32[uo + 4]]).toEqual([0xffffffff, 3]);
    const mo = l.offsetOf('m3') >> 2;
    expect(Array.from(f32.subarray(mo, mo + 12))).toEqual([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0]);
  });

  it('packs vec4/ivec4/mat4 arrays from flat input', () => {
    const l = std140Layout([
      { name: 'va', type: 'vec4', count: 2 },
      { name: 'ia', type: 'ivec4', count: 2 },
      { name: 'ma', type: 'mat4', count: 2 },
    ]);
    const w = new Std140Writer(l);
    w.vec4Array(l.offsetOf('va'), [1, 2, 3, 4, 5, 6, 7, 8]);
    w.ivec4Array(l.offsetOf('ia'), [-1, -2, -3, -4, 5, 6, 7, 8]);
    const mats = Array.from({ length: 32 }, (_, k) => k);
    w.mat4Array(l.offsetOf('ma'), mats);
    const f32 = new Float32Array(w.buffer);
    const i32 = new Int32Array(w.buffer);
    expect(Array.from(f32.subarray(0, 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(i32.subarray(8, 16))).toEqual([-1, -2, -3, -4, 5, 6, 7, 8]);
    expect(Array.from(f32.subarray(16, 48))).toEqual(mats);
  });
});
