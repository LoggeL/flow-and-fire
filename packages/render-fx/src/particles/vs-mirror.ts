/**
 * JS mirror of the particle vertex shader ({@link PARTICLE_VS}): same inputs (a decoded spawn
 * record, the layer table, the curve LUT, the FX time and camera axes), same constants and the same
 * operation order, with float32 rounding (`Math.fround`) where the shader computes in f32. Used by
 * the parity test against the CPU reference `evalParticle` and by the smoke case to predict pixels.
 */
import {
  L_COS_SPREAD,
  L_COS_SPREAD_INNER,
  L_DELAY_MAX,
  L_DELAY_MIN,
  L_DRAG,
  L_EMIT_RADIUS,
  L_GRAVITY,
  L_LIFE_MAX,
  L_LIFE_MIN,
  L_LUT_ROW,
  L_MOTION,
  L_ORIENT,
  L_SHAPE,
  L_SIZE_JITTER,
  L_SPEED_MAX,
  L_SPEED_MIN,
  L_SPIN_MAX,
  L_SPIN_MIN,
  L_STREAM_WAVE,
  L_STREAM_WAVES,
  L_TINT,
  LAYER_STRIDE,
} from '../effects/compile.ts';
import type { EffectLut } from '../effects/compile.ts';
import { fxHash32 } from '../effects/random.ts';
import { FX_TIME_WRAP_S } from '../core/slots.ts';
import type { ParticleRecord } from './record.ts';
import { GROUND_LIFT_WU, STREAK_SECONDS } from './shaders.ts';

const f = Math.fround;
const PI = f(3.14159265358979);
const TWO_PI = f(6.28318530717959);

export interface MirrorState {
  alive: boolean;
  /** Normalized age a. */
  age01: number;
  /** f32 age in s since the spawn record's t0 (before the delay). */
  ageS: number;
  /** Offset from the record origin (WU, f32 like the shader). */
  offsetWu: [number, number, number];
  /** Absolute particle position in WU (origin + offset, float64). */
  posWu: [number, number, number];
  velWu: [number, number, number];
  sizeWu: number;
  color: [number, number, number, number];
  blend: number;
  stretch: number;
  rotation: number;
  shape: number;
  orient: number;
}

export function createMirrorState(): MirrorState {
  return {
    alive: false,
    age01: 0,
    ageS: 0,
    offsetWu: [0, 0, 0],
    posWu: [0, 0, 0],
    velWu: [0, 0, 0],
    sizeWu: 0,
    color: [0, 0, 0, 0],
    blend: 0,
    stretch: 0,
    rotation: 0,
    shape: 0,
    orient: 0,
  };
}

/** lo/hi 16-bit halves of a hash as uniforms (exact in f32). */
function lo(h: number): number {
  return (h & 0xffff) / 65536;
}
function hi(h: number): number {
  return (h >>> 16) / 65536;
}

const b1 = new Float64Array(3);
const b2 = new Float64Array(3);

/** Duff ONB in f32, same expression order as `fxOnb` in the shader. */
function onb(nx: number, ny: number, nz: number): void {
  const s = nz >= 0 ? 1 : -1;
  const a = f(-1 / f(s + nz));
  const b = f(f(nx * ny) * a);
  b1[0] = f(1 + f(f(f(s * nx) * nx) * a));
  b1[1] = f(s * b);
  b1[2] = f(-s * nx);
  b2[0] = b;
  b2[1] = f(s + f(f(ny * ny) * a));
  b2[2] = -ny;
}

/**
 * Linear LUT sample like the GPU sampler at u = (a·(W−1) + 0.5)/W (texel-centre aligned, so the
 * result equals `sampleBaked`); `row` is the LUT row, `ch` the channel.
 */
export function mirrorLut(lut: EffectLut, row: number, a: number, ch: number): number {
  const x = Math.min(Math.max(a, 0), 1) * (lut.width - 1);
  const i = Math.min(lut.width - 2, Math.floor(x));
  const fr = x - i;
  const o = (row * lut.width + i) * 4 + ch;
  const v0 = lut.data[o]!;
  const v1 = lut.data[o + 4]!;
  return f(v0 + (v1 - v0) * fr);
}

/**
 * Evaluates one spawn record at wrapped FX time `fxTime` exactly like the vertex shader
 * (everything except the quad expansion, see {@link mirrorCorner}).
 */
export function mirrorParticle(
  layers: Float32Array,
  lut: EffectLut,
  rec: Readonly<ParticleRecord>,
  fxTime: number,
  out: MirrorState = createMirrorState(),
): MirrorState {
  const layer = rec.layer;
  const o = layer * LAYER_STRIDE;
  const L = layers;
  const seed = rec.seed & 0xffff;
  const h0 = fxHash32(seed, layer, 0);
  const h4 = fxHash32(seed, layer, 4);
  const uLife = lo(h0);
  const uSpeed = hi(h0);
  const uDelay = lo(h4);
  const uPhase = hi(h4);
  const life = f(L[o + L_LIFE_MIN]! + f(f(L[o + L_LIFE_MAX]! - L[o + L_LIFE_MIN]!) * uLife));
  const delay = f(L[o + L_DELAY_MIN]! + f(f(L[o + L_DELAY_MAX]! - L[o + L_DELAY_MIN]!) * uDelay));
  let age = f(f(fxTime) - f(rec.t0));
  if (age < 0) age = f(age + FX_TIME_WRAP_S);
  const t = f(age - delay);
  out.ageS = age;
  out.shape = L[o + L_SHAPE]!;
  out.orient = L[o + L_ORIENT]!;
  if (!(t >= 0 && t < life)) {
    out.alive = false;
    out.age01 = 0;
    out.sizeWu = 0;
    out.color[0] = out.color[1] = out.color[2] = out.color[3] = 0;
    return out;
  }
  out.alive = true;
  const h1 = fxHash32(seed, layer, 1);
  const h2 = fxHash32(seed, layer, 2);
  const h3 = fxHash32(seed, layer, 3);
  const uCos = lo(h1);
  const uPhi = hi(h1);
  const uSpin = lo(h2);
  const uAngle = hi(h2);
  const uSize = lo(h3);
  const uRad = hi(h3);
  const a = f(t / life);
  out.age01 = a;
  const vx = f(rec.vec[0]);
  const vy = f(rec.vec[1]);
  const vz = f(rec.vec[2]);
  const scale = f(rec.vec[3]);
  const emitR = f(f(L[o + L_EMIT_RADIUS]! * scale) * uRad);
  const g = L[o + L_GRAVITY]!;
  const p = out.offsetWu;
  const v = out.velWu;
  if (L[o + L_MOTION]! > 0.5) {
    const len = f(Math.sqrt(f(f(vx * vx) + f(vy * vy) + f(vz * vz))));
    if (len > 1e-6) onb(f(vx / len), f(vy / len), f(vz / len));
    else onb(0, 1, 0);
    const psi = f(TWO_PI * uPhi);
    const cp = f(Math.cos(psi));
    const sp = f(Math.sin(psi));
    const nx = f(f(b1[0]! * cp) + f(b2[0]! * sp));
    const ny = f(f(b1[1]! * cp) + f(b2[1]! * sp));
    const nz = f(f(b1[2]! * cp) + f(b2[2]! * sp));
    const wave = f(L[o + L_STREAM_WAVE]! * scale);
    const waves = L[o + L_STREAM_WAVES]!;
    const pa = f(PI * a);
    const wArg = f(TWO_PI * f(f(waves * a) + uPhase));
    const sPa = f(Math.sin(pa));
    const cPa = f(Math.cos(pa));
    const sW = f(Math.sin(wArg));
    const cW = f(Math.cos(wArg));
    const lat = f(f(emitR * f(1 - a)) + f(f(wave * sPa) * sW));
    const latDa = f(-emitR + f(wave * f(f(f(PI * cPa) * sW) + f(f(f(sPa * TWO_PI) * waves) * cW))));
    const sag = f(f(f(0.5 * g) * t) * f(t - life));
    p[0] = f(f(vx * a) + f(nx * lat));
    p[1] = f(f(f(vy * a) + f(ny * lat)) + sag);
    p[2] = f(f(vz * a) + f(nz * lat));
    v[0] = f(f(vx + f(nx * latDa)) / life);
    v[1] = f(f(f(vy + f(ny * latDa)) / life) + f(f(0.5 * g) * f(f(2 * t) - life)));
    v[2] = f(f(vz + f(nz * latDa)) / life);
  } else {
    let ax = 0;
    let ay = 1;
    let az = 0;
    const l2 = f(f(vx * vx) + f(vy * vy) + f(vz * vz));
    if (l2 > 1e-12) {
      const il = f(1 / f(Math.sqrt(l2)));
      ax = f(vx * il);
      ay = f(vy * il);
      az = f(vz * il);
    }
    const cosIn = L[o + L_COS_SPREAD_INNER]!;
    const cosT = f(cosIn - f(uCos * f(cosIn - L[o + L_COS_SPREAD]!)));
    const sinT = f(Math.sqrt(Math.max(0, f(1 - f(cosT * cosT)))));
    const phi = f(TWO_PI * uPhi);
    onb(ax, ay, az);
    const c = f(sinT * f(Math.cos(phi)));
    const s = f(sinT * f(Math.sin(phi)));
    const dx = f(f(f(b1[0]! * c) + f(b2[0]! * s)) + f(ax * cosT));
    const dy = f(f(f(b1[1]! * c) + f(b2[1]! * s)) + f(ay * cosT));
    const dz = f(f(f(b1[2]! * c) + f(b2[2]! * s)) + f(az * cosT));
    const speed = f(f(L[o + L_SPEED_MIN]! + f(f(L[o + L_SPEED_MAX]! - L[o + L_SPEED_MIN]!) * uSpeed)) * scale);
    const v0x = f(dx * speed);
    const v0y = f(dy * speed);
    const v0z = f(dz * speed);
    const p0x = f(dx * emitR);
    const p0y = f(dy * emitR);
    const p0z = f(dz * emitR);
    const k = L[o + L_DRAG]!;
    if (k <= 1e-6) {
      p[0] = f(p0x + f(v0x * t));
      p[1] = f(f(p0y + f(v0y * t)) + f(f(f(0.5 * g) * t) * t));
      p[2] = f(p0z + f(v0z * t));
      v[0] = v0x;
      v[1] = f(v0y + f(g * t));
      v[2] = v0z;
    } else {
      const e = f(Math.exp(f(-k * t)));
      const ff = f(f(1 - e) / k);
      const gk = f(g / k);
      p[0] = f(p0x + f(v0x * ff));
      p[1] = f(f(p0y + f(v0y * ff)) + f(f(gk * t) - f(gk * ff)));
      p[2] = f(p0z + f(v0z * ff));
      v[0] = f(v0x * e);
      v[1] = f(f(v0y * e) + f(gk - f(gk * e)));
      v[2] = f(v0z * e);
    }
  }
  const row = L[o + L_LUT_ROW]!;
  const jitter = f(1 + f(L[o + L_SIZE_JITTER]! * f(f(2 * uSize) - 1)));
  out.sizeWu = f(f(mirrorLut(lut, row + 1, a, 0) * scale) * jitter);
  out.blend = mirrorLut(lut, row + 1, a, 1);
  out.stretch = mirrorLut(lut, row + 1, a, 2);
  const col = out.color;
  for (let ch = 0; ch < 4; ch++) col[ch] = mirrorLut(lut, row, a, ch);
  if (L[o + L_TINT]! > 0.5) {
    col[0] = f(col[0] * (((rec.tint >>> 16) & 255) / 255));
    col[1] = f(col[1] * (((rec.tint >>> 8) & 255) / 255));
    col[2] = f(col[2] * ((rec.tint & 255) / 255));
  }
  out.rotation = f(f(TWO_PI * uAngle) + f(f(L[o + L_SPIN_MIN]! + f(f(L[o + L_SPIN_MAX]! - L[o + L_SPIN_MIN]!) * uSpin)) * t));
  out.posWu[0] = rec.originRaw[0] / 4096 + p[0];
  out.posWu[1] = rec.originRaw[1] / 4096 + p[1];
  out.posWu[2] = rec.originRaw[2] / 4096 + p[2];
  return out;
}

/** Camera axes as in the FxView block (world axes, unit vectors). */
export interface MirrorAxes {
  readonly right: ArrayLike<number>;
  readonly up: ArrayLike<number>;
  readonly fwd: ArrayLike<number>;
}

/**
 * World position (WU, absolute) of quad corner (cx, cy) ∈ {−1, 1}² of an alive particle, following the
 * shader's orientation modes (billboard, velocity streak, ground).
 */
export function mirrorCorner(s: Readonly<MirrorState>, axes: MirrorAxes, cx: number, cy: number, out: [number, number, number]): [number, number, number] {
  const hs = 0.5 * s.sizeWu;
  const cr = Math.cos(s.rotation);
  const sr = Math.sin(s.rotation);
  const rx = cx * cr - cy * sr;
  const ry = cx * sr + cy * cr;
  const p = s.posWu;
  const orient = Math.round(s.orient);
  if (orient === 1) {
    const fw = axes.fwd;
    const vv = s.velWu;
    const dv = vv[0] * fw[0]! + vv[1] * fw[1]! + vv[2] * fw[2]!;
    let px = vv[0] - fw[0]! * dv;
    let py = vv[1] - fw[1]! * dv;
    let pz = vv[2] - fw[2]! * dv;
    const sp = Math.hypot(px, py, pz);
    if (sp > 1e-4) {
      px /= sp;
      py /= sp;
      pz /= sp;
    } else {
      px = axes.right[0]!;
      py = axes.right[1]!;
      pz = axes.right[2]!;
    }
    // across = cross(fwd, along)
    const qx = fw[1]! * pz - fw[2]! * py;
    const qy = fw[2]! * px - fw[0]! * pz;
    const qz = fw[0]! * py - fw[1]! * px;
    const len = s.sizeWu + s.stretch * sp * STREAK_SECONDS;
    const back = 0.5 * (len - s.sizeWu);
    out[0] = p[0] - px * back + px * cx * 0.5 * len + qx * cy * hs;
    out[1] = p[1] - py * back + py * cx * 0.5 * len + qy * cy * hs;
    out[2] = p[2] - pz * back + pz * cx * 0.5 * len + qz * cy * hs;
  } else if (orient === 2) {
    out[0] = p[0] + rx * hs;
    out[1] = p[1] + GROUND_LIFT_WU;
    out[2] = p[2] + ry * hs;
  } else {
    const r = axes.right;
    const u = axes.up;
    out[0] = p[0] + r[0]! * rx * hs + u[0]! * ry * hs;
    out[1] = p[1] + r[1]! * rx * hs + u[1]! * ry * hs;
    out[2] = p[2] + r[2]! * rx * hs + u[2]! * ry * hs;
  }
  return out;
}
