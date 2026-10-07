/**
 * Spawn-record layout of the particle ring (one record per particle, 32 bytes, instance stream):
 *
 * | Byte  | Type      | Shader input          | Content                                                   |
 * |-------|-----------|-----------------------|-----------------------------------------------------------|
 * | 0–11  | i32 × 3   | `ivec3 a_origin`      | emitter origin, raw Q20.12 (1 WU = 4096)                  |
 * | 12–15 | f32       | `float a_t0`          | spawn time, FX seconds mod FX_TIME_WRAP_S                 |
 * | 16–23 | f16 × 4   | `uvec4 a_vec` (bits)  | ballistic: emission axis xyz (unit), stream: target − origin in WU; w = effect scale |
 * | 24–25 | u16       | `uvec2 a_layerSeed.x` | global layer index                                        |
 * | 26–27 | u16       | `uvec2 a_layerSeed.y` | particle seed                                             |
 * | 28–31 | u8 × 4    | `vec4 a_tint` (norm)  | spawn tint R, G, B, 255                                   |
 *
 * The RHI has no half-float vertex format, so the four f16 values travel as raw u16 bits and the
 * vertex shader decodes them with `unpackHalf2x16`.
 */
import type { VertexStreamLayout } from '@faf/render';
import { vf } from '@faf/render';
import { fromHalf, toHalf } from '../core/half.ts';

/** Bytes per spawn record. */
export const PARTICLE_RECORD_STRIDE = 32;
/** Byte offsets inside a record. */
export const REC_ORIGIN = 0;
export const REC_T0 = 12;
export const REC_VEC = 16;
export const REC_LAYER = 24;
export const REC_SEED = 26;
export const REC_TINT = 28;

/** Attribute locations of the particle vertex shader. */
export const PARTICLE_ATTR = { origin: 0, t0: 1, vec: 2, layerSeed: 3, tint: 4 } as const;

/** Instance stream layout of the ring buffer (one record per instance, 4 vertices from gl_VertexID). */
export const PARTICLE_STREAM_LAYOUT: VertexStreamLayout = {
  stepMode: 'instance',
  stride: PARTICLE_RECORD_STRIDE,
  attributes: [
    { location: PARTICLE_ATTR.origin, format: vf('i32', 3, 'int'), offset: REC_ORIGIN },
    { location: PARTICLE_ATTR.t0, format: vf('f32', 1, 'float'), offset: REC_T0 },
    { location: PARTICLE_ATTR.vec, format: vf('u16', 4, 'int'), offset: REC_VEC },
    { location: PARTICLE_ATTR.layerSeed, format: vf('u16', 2, 'int'), offset: REC_LAYER },
    { location: PARTICLE_ATTR.tint, format: vf('u8', 4, 'norm'), offset: REC_TINT },
  ],
};

/** Decoded view of one record (what the vertex shader sees). */
export interface ParticleRecord {
  originRaw: [number, number, number];
  /** Wrapped FX spawn time (f32 value). */
  t0: number;
  /** Decoded f16 vector: axis (ballistic) or target delta in WU (stream); w = scale. */
  vec: [number, number, number, number];
  layer: number;
  seed: number;
  /** 0xRRGGBB. */
  tint: number;
}

export function createParticleRecord(): ParticleRecord {
  return { originRaw: [0, 0, 0], t0: 0, vec: [0, 0, 0, 0], layer: 0, seed: 0, tint: 0xffffff };
}

/** Typed views over one ring memory block (shared by the system, the mirror and tests). */
export interface RecordViews {
  readonly i32: Int32Array;
  readonly f32: Float32Array;
  readonly u16: Uint16Array;
  readonly u8: Uint8Array;
}

export function recordViews(buf: ArrayBuffer): RecordViews {
  return { i32: new Int32Array(buf), f32: new Float32Array(buf), u16: new Uint16Array(buf), u8: new Uint8Array(buf) };
}

/**
 * Writes record `slot`. `vecHalf` holds the four f16 bit patterns (see {@link encodeVecHalf}),
 * `tint` is 0xRRGGBB.
 */
export function writeRecord(
  v: RecordViews,
  slot: number,
  ox: number,
  oy: number,
  oz: number,
  t0: number,
  h0: number,
  h1: number,
  h2: number,
  h3: number,
  layer: number,
  seed: number,
  tint: number,
): void {
  const w = slot * 8; // 32-bit words
  v.i32[w] = ox;
  v.i32[w + 1] = oy;
  v.i32[w + 2] = oz;
  v.f32[w + 3] = t0;
  const h = slot * 16; // 16-bit words
  v.u16[h + 8] = h0;
  v.u16[h + 9] = h1;
  v.u16[h + 10] = h2;
  v.u16[h + 11] = h3;
  v.u16[h + 12] = layer;
  v.u16[h + 13] = seed & 0xffff;
  const b = slot * PARTICLE_RECORD_STRIDE + REC_TINT;
  v.u8[b] = (tint >>> 16) & 255;
  v.u8[b + 1] = (tint >>> 8) & 255;
  v.u8[b + 2] = tint & 255;
  v.u8[b + 3] = 255;
}

const TWO_POW_M14 = 2 ** -14;
const TWO_POW_24 = 2 ** 24;

/**
 * binary16 bit pattern of `src[i]` – bit-identical to `toHalf(src[i])` (core/half.ts, round to
 * nearest even, ±Inf, subnormals, NaN → 0x7e00). The value is read from a typed array and the
 * result is a small integer, so hot paths can convert without boxing doubles at call boundaries.
 */
export function halfBitsAt(src: Float64Array, i: number): number {
  const f = src[i]!;
  if (f !== f) return 0x7e00;
  const sign = f < 0 || (f === 0 && 1 / f < 0) ? 0x8000 : 0;
  const a = f < 0 ? -f : f;
  if (a === Infinity) return sign | 0x7c00;
  if (a < TWO_POW_M14) {
    const x = a * TWO_POW_24; // exact (power-of-two scale)
    let r = Math.floor(x);
    const d = x - r;
    if (d > 0.5 || (d === 0.5 && (r & 1) === 1)) r++;
    return sign | r;
  }
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e--;
  else if (2 ** (e + 1) <= a) e++;
  const x = (a / 2 ** e - 1) * 1024;
  let m = Math.floor(x);
  const d = x - m;
  if (d > 0.5 || (d === 0.5 && (m & 1) === 1)) m++;
  if (m === 1024) {
    m = 0;
    e++;
  }
  if (e > 15) return sign | 0x7c00;
  return sign | ((e + 15) << 10) | m;
}

/** Encodes (x, y, z, w) as four f16 bit patterns into `out`. */
export function encodeVecHalf(x: number, y: number, z: number, w: number, out: Uint16Array | number[]): void {
  out[0] = toHalf(x);
  out[1] = toHalf(y);
  out[2] = toHalf(z);
  out[3] = toHalf(w);
}

/** Reads record `slot` back (tests, mirror). */
export function readRecord(v: RecordViews, slot: number, out: ParticleRecord = createParticleRecord()): ParticleRecord {
  const w = slot * 8;
  out.originRaw[0] = v.i32[w]!;
  out.originRaw[1] = v.i32[w + 1]!;
  out.originRaw[2] = v.i32[w + 2]!;
  out.t0 = v.f32[w + 3]!;
  const h = slot * 16;
  for (let i = 0; i < 4; i++) out.vec[i] = fromHalf(v.u16[h + 8 + i]!);
  out.layer = v.u16[h + 12]!;
  out.seed = v.u16[h + 13]!;
  const b = slot * PARTICLE_RECORD_STRIDE + REC_TINT;
  out.tint = (v.u8[b]! << 16) | (v.u8[b + 1]! << 8) | v.u8[b + 2]!;
  return out;
}
