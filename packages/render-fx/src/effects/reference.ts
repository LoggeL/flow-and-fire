/**
 * CPU reference of the stateless particle model (PLAN §3.7 "f(t − t0) im VS"). The particle vertex
 * shader (particles/, rfx-p3) mirrors these formulas exactly; the parity test compares both.
 *
 * Per-particle random values (all derived from the particle `seed` and the global layer index):
 *
 *   h_k = fxHash32(seed, layer, k)                      for k = 0..4   (see random.ts)
 *   lo(h) = (h & 0xFFFF) / 65536,  hi(h) = (h >>> 16) / 65536
 *   uLife = lo(h0)  uSpeed = hi(h0)
 *   uCos  = lo(h1)  uPhi   = hi(h1)
 *   uSpin = lo(h2)  uAngle = hi(h2)
 *   uSize = lo(h3)  uRad   = hi(h3)
 *   uDelay= lo(h4)  uPhase = hi(h4)
 *
 * Derived values (layer fields from the compiled table, `L_*` in compile.ts; scale/speedMul from
 * the spawn, both default 1):
 *
 *   life  = mix(lifeMin, lifeMax, uLife)       delay = mix(delayMin, delayMax, uDelay)
 *   t     = age − delay; alive ⇔ 0 ≤ t < life;  a = t / life
 *   cosθ  = cosInner − uCos·(cosInner − cosSpread);  sinθ = √max(0, 1 − cos²θ);  φ = 2π·uPhi
 *   (b1, b2) = orthonormalBasis(axis)           (Duff et al., random.ts)
 *   d     = b1·sinθ·cosφ + b2·sinθ·sinφ + axis·cosθ
 *   speed = mix(speedMin, speedMax, uSpeed) · speedMul · scale;   v0 = d·speed
 *   p0    = origin + d · emitRadius · scale · uRad
 *   ballistic, g = (0, gravity, 0), k = drag:
 *     k ≤ 1e-6: p = p0 + v0·t + ½·g·t²;                 v = v0 + g·t
 *     k > 1e-6: p = p0 + g·t/k + (v0 − g/k)·(1 − e^(−k·t))/k;  v = g/k + (v0 − g/k)·e^(−k·t)
 *   stream (origin O → target T, D = T − O, axisS = D/|D| or axis if |D| ≤ 1e-6):
 *     (c1, c2) = orthonormalBasis(axisS);  ψ = 2π·uPhi;  n = c1·cosψ + c2·sinψ
 *     lat = emitRadius·scale·uRad·(1 − a) + streamWave·scale·sin(π·a)·sin(2π·(streamWaves·a + uPhase))
 *     p   = O + D·a + n·lat + (0, ½·gravity·t·(t − life), 0)      (speed/spread unused)
 *   size  = lutSize(a) · scale · (1 + sizeJitter·(2·uSize − 1))
 *   color = lutColor(a) (· tint/255 per channel if the layer has tint 'spawn'; tint 0xRRGGBB)
 *   blend = lutBlend(a);  rotation = 2π·uAngle + mix(spinMin, spinMax, uSpin)·t
 *
 * LUT lookups use linear filtering at x = a·(LUT_WIDTH − 1) ({@link sampleBaked}).
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
  L_SIZE_JITTER,
  L_SPEED_MAX,
  L_SPEED_MIN,
  L_SPIN_MAX,
  L_SPIN_MIN,
  L_STREAM_WAVE,
  L_STREAM_WAVES,
  L_TINT,
  LAYER_STRIDE,
  MOTION_ID,
} from './compile.ts';
import type { EffectLibrary } from './compile.ts';
import { sampleBaked } from './curves.ts';
import { fxHash32, orthonormalBasis } from './random.ts';

export interface ParticleRandoms {
  uLife: number;
  uSpeed: number;
  uCos: number;
  uPhi: number;
  uSpin: number;
  uAngle: number;
  uSize: number;
  uRad: number;
  uDelay: number;
  uPhase: number;
}

/** Raw per-particle uniforms in [0, 1) (16-bit resolution), see the module comment. */
export function particleRandoms(seed: number, layerIdx: number, out?: ParticleRandoms): ParticleRandoms {
  const r = out ?? { uLife: 0, uSpeed: 0, uCos: 0, uPhi: 0, uSpin: 0, uAngle: 0, uSize: 0, uRad: 0, uDelay: 0, uPhase: 0 };
  let h = fxHash32(seed, layerIdx, 0);
  r.uLife = (h & 0xffff) / 65536;
  r.uSpeed = (h >>> 16) / 65536;
  h = fxHash32(seed, layerIdx, 1);
  r.uCos = (h & 0xffff) / 65536;
  r.uPhi = (h >>> 16) / 65536;
  h = fxHash32(seed, layerIdx, 2);
  r.uSpin = (h & 0xffff) / 65536;
  r.uAngle = (h >>> 16) / 65536;
  h = fxHash32(seed, layerIdx, 3);
  r.uSize = (h & 0xffff) / 65536;
  r.uRad = (h >>> 16) / 65536;
  h = fxHash32(seed, layerIdx, 4);
  r.uDelay = (h & 0xffff) / 65536;
  r.uPhase = (h >>> 16) / 65536;
  return r;
}

export interface ParticleSpawn {
  /** Emitter origin in WU. */
  readonly originWu: ArrayLike<number>;
  /** Unit emission axis (default +y). */
  readonly dir?: ArrayLike<number>;
  /** Speed multiplier (default 1). */
  readonly speed?: number;
  /** Effect scale: multiplies size, speed, emitRadius and streamWave (default 1). */
  readonly scale?: number;
  /** Per-particle seed (u32; the ring stores u16). */
  readonly seed: number;
  /** Stream target in WU (motion 'stream'; default = origin). */
  readonly targetWu?: ArrayLike<number>;
  /** Spawn tint 0xRRGGBB for layers with tint 'spawn' (default 0xFFFFFF). */
  readonly tint?: number;
}

export interface ParticleState {
  alive: boolean;
  /** Normalized age a ∈ [0, 1) (0 when not alive). */
  age01: number;
  posWu: [number, number, number];
  velWu: [number, number, number];
  sizeWu: number;
  color: [number, number, number, number];
  blend: number;
  stretch: number;
  rotation: number;
  /** Particle lifetime in s. */
  lifeS: number;
  /** Spawn delay in s. */
  delayS: number;
}

export function createParticleState(): ParticleState {
  return {
    alive: false,
    age01: 0,
    posWu: [0, 0, 0],
    velWu: [0, 0, 0],
    sizeWu: 0,
    color: [0, 0, 0, 0],
    blend: 0,
    stretch: 0,
    rotation: 0,
    lifeS: 0,
    delayS: 0,
  };
}

const TWO_PI = Math.PI * 2;
const rnd: ParticleRandoms = particleRandoms(0, 0);
const basis = new Float64Array(6);

/**
 * Evaluates one particle of layer `layerIdx` at `ageS` seconds after its spawn (formulas in the
 * module comment). Pass `out` to avoid allocation.
 */
export function evalParticle(
  lib: EffectLibrary,
  layerIdx: number,
  spawn: ParticleSpawn,
  ageS: number,
  out: ParticleState = createParticleState(),
): ParticleState {
  if (!(layerIdx >= 0 && layerIdx < lib.layerCount)) throw new Error(`evalParticle: layer ${layerIdx} out of range`);
  const L = lib.layers;
  const o = layerIdx * LAYER_STRIDE;
  const r = particleRandoms(spawn.seed >>> 0, layerIdx, rnd);
  const life = L[o + L_LIFE_MIN]! + (L[o + L_LIFE_MAX]! - L[o + L_LIFE_MIN]!) * r.uLife;
  const delay = L[o + L_DELAY_MIN]! + (L[o + L_DELAY_MAX]! - L[o + L_DELAY_MIN]!) * r.uDelay;
  const t = ageS - delay;
  out.lifeS = life;
  out.delayS = delay;
  if (!(t >= 0 && t < life)) {
    out.alive = false;
    out.age01 = 0;
    out.sizeWu = 0;
    out.color[0] = out.color[1] = out.color[2] = out.color[3] = 0;
    return out;
  }
  out.alive = true;
  const a = t / life;
  out.age01 = a;
  const scale = spawn.scale ?? 1;
  const ox = spawn.originWu[0]!;
  const oy = spawn.originWu[1]!;
  const oz = spawn.originWu[2]!;
  const ax = spawn.dir?.[0] ?? 0;
  const ay = spawn.dir?.[1] ?? 1;
  const az = spawn.dir?.[2] ?? 0;
  const emitR = L[o + L_EMIT_RADIUS]! * scale * r.uRad;
  const g = L[o + L_GRAVITY]!;
  const p = out.posWu;
  const v = out.velWu;
  if (L[o + L_MOTION] === MOTION_ID.stream) {
    const tx = spawn.targetWu?.[0] ?? ox;
    const ty = spawn.targetWu?.[1] ?? oy;
    const tz = spawn.targetWu?.[2] ?? oz;
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-6) orthonormalBasis(dx / len, dy / len, dz / len, basis);
    else orthonormalBasis(ax, ay, az, basis);
    const psi = TWO_PI * r.uPhi;
    const cp = Math.cos(psi);
    const sp = Math.sin(psi);
    const nx = basis[0]! * cp + basis[3]! * sp;
    const ny = basis[1]! * cp + basis[4]! * sp;
    const nz = basis[2]! * cp + basis[5]! * sp;
    const wave = L[o + L_STREAM_WAVE]! * scale;
    const waves = L[o + L_STREAM_WAVES]!;
    const pa = Math.PI * a;
    const wArg = TWO_PI * (waves * a + r.uPhase);
    const lat = emitR * (1 - a) + wave * Math.sin(pa) * Math.sin(wArg);
    const latDa = -emitR + wave * (Math.PI * Math.cos(pa) * Math.sin(wArg) + Math.sin(pa) * TWO_PI * waves * Math.cos(wArg));
    const sag = 0.5 * g * t * (t - life);
    p[0] = ox + dx * a + nx * lat;
    p[1] = oy + dy * a + ny * lat + sag;
    p[2] = oz + dz * a + nz * lat;
    const inv = 1 / life;
    v[0] = (dx + nx * latDa) * inv;
    v[1] = (dy + ny * latDa) * inv + 0.5 * g * (2 * t - life);
    v[2] = (dz + nz * latDa) * inv;
  } else {
    const cosIn = L[o + L_COS_SPREAD_INNER]!;
    const cosT = cosIn - r.uCos * (cosIn - L[o + L_COS_SPREAD]!);
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = TWO_PI * r.uPhi;
    orthonormalBasis(ax, ay, az, basis);
    const c = sinT * Math.cos(phi);
    const s = sinT * Math.sin(phi);
    const dx = basis[0]! * c + basis[3]! * s + ax * cosT;
    const dy = basis[1]! * c + basis[4]! * s + ay * cosT;
    const dz = basis[2]! * c + basis[5]! * s + az * cosT;
    const speed = (L[o + L_SPEED_MIN]! + (L[o + L_SPEED_MAX]! - L[o + L_SPEED_MIN]!) * r.uSpeed) * (spawn.speed ?? 1) * scale;
    const vx = dx * speed;
    const vy = dy * speed;
    const vz = dz * speed;
    const px = ox + dx * emitR;
    const py = oy + dy * emitR;
    const pz = oz + dz * emitR;
    const k = L[o + L_DRAG]!;
    if (k <= 1e-6) {
      p[0] = px + vx * t;
      p[1] = py + vy * t + 0.5 * g * t * t;
      p[2] = pz + vz * t;
      v[0] = vx;
      v[1] = vy + g * t;
      v[2] = vz;
    } else {
      const e = Math.exp(-k * t);
      const f = (1 - e) / k;
      const gk = g / k;
      p[0] = px + vx * f;
      p[1] = py + gk * t + (vy - gk) * f;
      p[2] = pz + vz * f;
      v[0] = vx * e;
      v[1] = gk + (vy - gk) * e;
      v[2] = vz * e;
    }
  }
  const lut = lib.lut;
  const row = L[o + L_LUT_ROW]!;
  const rowFloats = lut.width * 4;
  const cOff = row * rowFloats;
  const sOff = (row + 1) * rowFloats;
  const jitter = 1 + L[o + L_SIZE_JITTER]! * (2 * r.uSize - 1);
  out.sizeWu = sampleBaked(lut.data, sOff, lut.width, 4, a, 0) * scale * jitter;
  out.blend = sampleBaked(lut.data, sOff, lut.width, 4, a, 1);
  out.stretch = sampleBaked(lut.data, sOff, lut.width, 4, a, 2);
  const col = out.color;
  for (let ch = 0; ch < 4; ch++) col[ch] = sampleBaked(lut.data, cOff, lut.width, 4, a, ch);
  if (L[o + L_TINT] === 1) {
    const tint = spawn.tint ?? 0xffffff;
    col[0] *= ((tint >> 16) & 255) / 255;
    col[1] *= ((tint >> 8) & 255) / 255;
    col[2] *= (tint & 255) / 255;
  }
  out.rotation = TWO_PI * r.uAngle + (L[o + L_SPIN_MIN]! + (L[o + L_SPIN_MAX]! - L[o + L_SPIN_MIN]!) * r.uSpin) * t;
  return out;
}
