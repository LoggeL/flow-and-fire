/**
 * std140 uniform-block layout and packer (GLSL ES 3.00 §2.12.6.4 / OpenGL ES 3.0 "Standard Uniform Block Layout").
 *
 * Rules implemented:
 * - scalar (float/int/uint): size 4, align 4
 * - vec2: size 8, align 8; vec3: size 12, align 16; vec4: size 16, align 16
 * - arrays: element stride rounded up to 16, array aligned to 16 (so `float[4]` takes 64 bytes)
 * - mat3: three vec3 columns with stride 16 (48 bytes), mat4: 64 bytes, both aligned to 16
 * - block size rounded up to 16
 */

export type Std140Type =
  | 'float'
  | 'int'
  | 'uint'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'ivec2'
  | 'ivec3'
  | 'ivec4'
  | 'uvec2'
  | 'uvec3'
  | 'uvec4'
  | 'mat3'
  | 'mat4';

export interface Std140Field {
  readonly name: string;
  readonly type: Std140Type;
  /** Array length; omitted = not an array. */
  readonly count?: number;
}

export interface Std140FieldLayout {
  readonly name: string;
  readonly type: Std140Type;
  /** Array length (1 for non-arrays). */
  readonly count: number;
  readonly isArray: boolean;
  /** Byte offset in the block. */
  readonly offset: number;
  /** Byte stride between array elements (element size for non-arrays). */
  readonly stride: number;
}

export interface Std140Layout {
  /** Block size in bytes (multiple of 16). */
  readonly size: number;
  readonly fields: readonly Std140FieldLayout[];
  /** Byte offset of a field by name; throws for unknown names. */
  offsetOf(name: string): number;
}

function baseInfo(t: Std140Type): { size: number; align: number } {
  switch (t) {
    case 'float':
    case 'int':
    case 'uint':
      return { size: 4, align: 4 };
    case 'vec2':
    case 'ivec2':
    case 'uvec2':
      return { size: 8, align: 8 };
    case 'vec3':
    case 'ivec3':
    case 'uvec3':
      return { size: 12, align: 16 };
    case 'vec4':
    case 'ivec4':
    case 'uvec4':
      return { size: 16, align: 16 };
    case 'mat3':
      return { size: 48, align: 16 };
    case 'mat4':
      return { size: 64, align: 16 };
  }
}

const roundUp = (v: number, a: number): number => Math.ceil(v / a) * a;

/** Computes the std140 layout of a uniform block given its members in declaration order. */
export function std140Layout(fields: readonly Std140Field[]): Std140Layout {
  let off = 0;
  const out: Std140FieldLayout[] = [];
  for (const f of fields) {
    const { size, align } = baseInfo(f.type);
    const isArray = f.count !== undefined;
    const count = f.count ?? 1;
    if (!Number.isInteger(count) || count < 1) throw new Error(`std140: field ${f.name}: invalid array length ${count}`);
    if (isArray) {
      const stride = roundUp(size, 16);
      off = roundUp(off, 16);
      out.push({ name: f.name, type: f.type, count, isArray, offset: off, stride });
      off += stride * count;
    } else {
      off = roundUp(off, align);
      out.push({ name: f.name, type: f.type, count: 1, isArray, offset: off, stride: size });
      off += size;
    }
  }
  const size = roundUp(Math.max(off, 16), 16);
  const byName: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const f of out) {
    if (f.name in byName) throw new Error(`std140: duplicate field ${f.name}`);
    byName[f.name] = f.offset;
  }
  return {
    size,
    fields: out,
    offsetOf(name: string): number {
      const o = byName[name];
      if (o === undefined) throw new Error(`std140: unknown field ${name}`);
      return o;
    },
  };
}

/**
 * Packs values into a std140 block. Offsets are byte offsets (from {@link Std140Layout.offsetOf});
 * all writes go through preallocated typed views (no allocation per call).
 */
export class Std140Writer {
  readonly buffer: ArrayBuffer;
  readonly bytes: Uint8Array;
  readonly f32: Float32Array;
  readonly i32: Int32Array;
  readonly u32: Uint32Array;

  constructor(sizeOrLayout: number | Std140Layout) {
    const size = typeof sizeOrLayout === 'number' ? roundUp(sizeOrLayout, 16) : sizeOrLayout.size;
    this.buffer = new ArrayBuffer(size);
    this.bytes = new Uint8Array(this.buffer);
    this.f32 = new Float32Array(this.buffer);
    this.i32 = new Int32Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
  }

  float(off: number, v: number): void {
    this.f32[off >> 2] = v;
  }
  int(off: number, v: number): void {
    this.i32[off >> 2] = v;
  }
  uint(off: number, v: number): void {
    this.u32[off >> 2] = v >>> 0;
  }
  vec2(off: number, x: number, y: number): void {
    const i = off >> 2;
    this.f32[i] = x;
    this.f32[i + 1] = y;
  }
  vec3(off: number, x: number, y: number, z: number): void {
    const i = off >> 2;
    this.f32[i] = x;
    this.f32[i + 1] = y;
    this.f32[i + 2] = z;
  }
  vec4(off: number, x: number, y: number, z: number, w: number): void {
    const i = off >> 2;
    this.f32[i] = x;
    this.f32[i + 1] = y;
    this.f32[i + 2] = z;
    this.f32[i + 3] = w;
  }
  ivec4(off: number, x: number, y: number, z: number, w: number): void {
    const i = off >> 2;
    this.i32[i] = x;
    this.i32[i + 1] = y;
    this.i32[i + 2] = z;
    this.i32[i + 3] = w;
  }
  uvec4(off: number, x: number, y: number, z: number, w: number): void {
    const i = off >> 2;
    this.u32[i] = x >>> 0;
    this.u32[i + 1] = y >>> 0;
    this.u32[i + 2] = z >>> 0;
    this.u32[i + 3] = w >>> 0;
  }
  /** Column-major 4×4 matrix (gl-matrix order). */
  mat4(off: number, m: ArrayLike<number>): void {
    const i = off >> 2;
    for (let k = 0; k < 16; k++) this.f32[i + k] = m[k]!;
  }
  /** Column-major 3×3 matrix; each column padded to 16 bytes. */
  mat3(off: number, m: ArrayLike<number>): void {
    const i = off >> 2;
    for (let c = 0; c < 3; c++) {
      this.f32[i + c * 4] = m[c * 3]!;
      this.f32[i + c * 4 + 1] = m[c * 3 + 1]!;
      this.f32[i + c * 4 + 2] = m[c * 3 + 2]!;
      this.f32[i + c * 4 + 3] = 0;
    }
  }
  /** `float[]`: element stride 16. `values[0..n)`. */
  floatArray(off: number, values: ArrayLike<number>, n = values.length): void {
    const i = off >> 2;
    for (let k = 0; k < n; k++) this.f32[i + k * 4] = values[k]!;
  }
  /** `int[]`: element stride 16. */
  intArray(off: number, values: ArrayLike<number>, n = values.length): void {
    const i = off >> 2;
    for (let k = 0; k < n; k++) this.i32[i + k * 4] = values[k]!;
  }
  /** `uint[]`: element stride 16. */
  uintArray(off: number, values: ArrayLike<number>, n = values.length): void {
    const i = off >> 2;
    for (let k = 0; k < n; k++) this.u32[i + k * 4] = values[k]! >>> 0;
  }
  /** `vec4[]` from a flat xyzw array (`n` elements). */
  vec4Array(off: number, flat: ArrayLike<number>, n = flat.length >> 2): void {
    const i = off >> 2;
    for (let k = 0; k < n * 4; k++) this.f32[i + k] = flat[k]!;
  }
  /** `ivec4[]` from a flat xyzw array. */
  ivec4Array(off: number, flat: ArrayLike<number>, n = flat.length >> 2): void {
    const i = off >> 2;
    for (let k = 0; k < n * 4; k++) this.i32[i + k] = flat[k]!;
  }
  /** `mat4[]` from consecutive column-major matrices. */
  mat4Array(off: number, flat: ArrayLike<number>, n = flat.length >> 4): void {
    const i = off >> 2;
    for (let k = 0; k < n * 16; k++) this.f32[i + k] = flat[k]!;
  }
}
