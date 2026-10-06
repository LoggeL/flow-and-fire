/**
 * Shield bubbles (PLAN §3.7 "Kugel-Instanzen mit Fresnel und 4 Ripples aus ShieldHit", K10, MS13):
 * one instanced icosphere draw for every shield (front and back faces together, cull none), additive-ish
 * premultiplied blending, depth test on, depth write off.
 *
 * Per shield: centre (raw Q20.12), radius, color, hpFrac (low → red + flicker), upFrac (power-up /
 * collapse: radius and opacity) and 4 ripple slots (direction centre → hit as snorm16, start time as
 * wrapped FX time, strength). A ripple is a ring at angular distance θ(t) = speed·(t − t0) that widens and
 * decays within {@link SHIELD_RIPPLE_LIFE_S}, plus a short flash at the impact point. The 5th concurrent
 * hit replaces the most decayed ripple (ties: the oldest hit).
 *
 * Shading: Fresnel rim pow(1 − |N·V|, 3), a subtle procedural triplanar honeycomb, back faces dimmer.
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME, vf } from '@faf/render';
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding, VertexStreamLayout } from '@faf/render';
import { wrapFxTime } from '../core/frame.ts';
import { DynamicInstanceBuffer } from '../core/instance-buffer.ts';
import { SLOT_FX_VIEW } from '../core/slots.ts';
import { FX_COMMON_GLSL, FX_VIEW_BLOCK_GLSL, fxSharedBufferBindings } from '../core/view.ts';
import type { FxBindings } from '../core/view.ts';
import { fxHash32 } from '../effects/random.ts';
import { FX_HALF_GLSL, FX_NOISE_GLSL, glslFloat } from '../trails/glsl.ts';
import { clamp01, packHalf, rawAt, writeHalf4 } from '../trails/pack.ts';
import { createIcosphere } from './icosphere.ts';

/** State of one shield, written with {@link ShieldPass.set}. */
export interface ShieldState {
  /** Centre, raw Q20.12 (x, y, z). */
  readonly centerRaw: ArrayLike<number>;
  readonly radiusWu: number;
  /** Linear RGB (may exceed 1 for a brighter shield). */
  readonly color: readonly [number, number, number];
  /** Health 0..1: below ~0.45 the color shifts to red, below 0.3 it flickers. */
  readonly hpFrac: number;
  /** Power state 0..1: 0 = down (invisible), rising = power-up, falling = collapse. */
  readonly upFrac: number;
}

export interface ShieldPassOptions {
  /** Maximum shields. Default 128. */
  readonly capacity?: number;
  /** Icosphere subdivisions (3 → 642 vertices, 1 280 triangles). Default 3. */
  readonly subdivisions?: number;
}

export interface ShieldPassStats {
  shields: number;
  /** Ripples younger than their lifetime after the last `update`. */
  ripplesActive: number;
  draws: number;
  uploadBytes: number;
  /** `set` calls rejected because the capacity was full (cumulative). */
  rejected: number;
  /** Hits applied (cumulative). */
  hits: number;
  /** Hits on unknown ids (cumulative, ignored). */
  hitsIgnored: number;
}

export const SHIELD_RIPPLES = 4;
/** Ripple lifetime in seconds. */
export const SHIELD_RIPPLE_LIFE_S = 1.2;
/** Angular speed of the ripple ring (rad/s). */
export const SHIELD_RIPPLE_SPEED = 2.4;
/** Ring width (rad) at t0 and its growth per second. */
export const SHIELD_RIPPLE_WIDTH = 0.16;
export const SHIELD_RIPPLE_WIDTH_GROWTH = 0.14;

// Instance record (88 bytes).
export const SHIELD_STRIDE = 88;
/** centre: i32×3 raw. */
export const SHIELD_OFF_CENTER = 0;
/** radius: f32 WU. */
export const SHIELD_OFF_RADIUS = 12;
/** f16×4: r, g, b, hpFrac. */
export const SHIELD_OFF_COLOR = 16;
/** f16×4: upFrac, phase (0..1 from the id), reserved×2. */
export const SHIELD_OFF_PARAMS = 24;
/** f32×4: ripple start times (wrapped FX time, s). */
export const SHIELD_OFF_RIPPLE_T0 = 32;
/** f16×4: ripple strengths (0 = slot empty). */
export const SHIELD_OFF_RIPPLE_STR = 48;
/** 4 × snorm16×4: ripple directions (xyz, w unused). */
export const SHIELD_OFF_RIPPLE_DIR = 56;

/** Remaining ripple energy at age `ageS` (the replacement criterion): strength · (1 − age/life)². */
export function shieldRippleEnergy(strength: number, ageS: number): number {
  if (!(strength > 0) || ageS >= SHIELD_RIPPLE_LIFE_S) return 0;
  if (ageS <= 0) return strength;
  const f = 1 - ageS / SHIELD_RIPPLE_LIFE_S;
  return strength * f * f;
}

/** Visual radius factor for a power state: 1 − (1 − up)³ blended from 35 % (JS mirror of the VS). */
export function shieldRadiusScale(upFrac: number): number {
  const d = 1 - clamp01(upFrac);
  return 0.35 + 0.65 * (1 - d * d * d);
}

const RIPPLE_GLSL = /* glsl */ `
// acos approximation (|error| < 7e-5 rad) on 4 lanes, much cheaper than the builtin on some GPUs.
vec4 fastAcos4(vec4 x) {
  vec4 a = abs(x);
  vec4 r = sqrt(max(1.0 - a, 0.0)) * (1.5707288 + a * (-0.2121144 + a * (0.0742610 - 0.0187293 * a)));
  return mix(r, 3.14159265 - r, lessThan(x, vec4(0.0)));
}
const float RIPPLE_LIFE = ${glslFloat(SHIELD_RIPPLE_LIFE_S)};
const float RIPPLE_SPEED = ${glslFloat(SHIELD_RIPPLE_SPEED)};
const float RIPPLE_W0 = ${glslFloat(SHIELD_RIPPLE_WIDTH)};
const float RIPPLE_W1 = ${glslFloat(SHIELD_RIPPLE_WIDTH_GROWTH)};
const float FLASH_SHARPNESS = 45.0;
const float FLASH_DECAY = 7.0;
// Ring intensity of the 4 ripples at angular distances th (rad) from their impact points, given the
// per-shield ring radii, inverse widths and amplitudes (see rippleParams).
float rippleRings(vec4 th, vec4 radius, vec4 invW, vec4 amp) {
  vec4 k = (th - radius) * invW;
  return dot(amp, exp(-k * k));
}
`;

const SHIELD_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${FX_VIEW_BLOCK_GLSL}
${FX_COMMON_GLSL}
${FX_HALF_GLSL}
${FX_NOISE_GLSL}
${RIPPLE_GLSL}
layout(location = 0) in vec3 a_pos;
layout(location = 1) in ivec3 a_center;
layout(location = 2) in float a_radius;
layout(location = 3) in uvec2 a_color;
layout(location = 4) in uvec2 a_params;
layout(location = 5) in vec4 a_rt0;
layout(location = 6) in uvec2 a_rstr;
layout(location = 7) in vec4 a_dir0;
layout(location = 8) in vec4 a_dir1;
layout(location = 9) in vec4 a_dir2;
layout(location = 10) in vec4 a_dir3;
out vec3 v_n;
out vec3 v_rel;
flat out vec4 v_color;  // rgb, hpFrac
flat out vec4 v_par;    // upFrac, phase, flicker, opacity
// Per-ripple constants (computed once per vertex instead of per fragment):
flat out vec4 v_rRadius; // ring radius θ(t) = speed·age (rad)
flat out vec4 v_rInvW;   // 1 / ring width
flat out vec4 v_rAmp;    // ring amplitude str·(1 − age/life)² (0 = slot idle/expired)
flat out vec4 v_fAmp;    // impact flash amplitude str·exp(−7·age)
flat out mat4 v_dirs;    // columns: impact directions (unit), w unused
vec4 safeDir(vec4 d) {
  float l = length(d.xyz);
  return vec4(l > 1e-4 ? d.xyz / l : vec3(0.0, 1.0, 0.0), 0.0);
}
void main() {
  vec4 par = fxHalf4(a_params);
  float up = clamp(par.x, 0.0, 1.0);
  float down = 1.0 - up;
  float rs = a_radius * (0.35 + 0.65 * (1.0 - down * down * down));
  vec4 str = max(fxHalf4(a_rstr), 0.0);
  vec4 age = vec4(fxAge(a_rt0.x), fxAge(a_rt0.y), fxAge(a_rt0.z), fxAge(a_rt0.w));
  vec4 alive = vec4(lessThan(age, vec4(RIPPLE_LIFE))) * step(vec4(1e-4), str);
  vec4 f = max(1.0 - age / RIPPLE_LIFE, 0.0);
  v_rRadius = RIPPLE_SPEED * age;
  v_rInvW = 1.0 / (RIPPLE_W0 + RIPPLE_W1 * age);
  v_rAmp = alive * str * f * f;
  v_fAmp = alive * str * exp(-FLASH_DECAY * age);
  v_dirs = mat4(safeDir(a_dir0), safeDir(a_dir1), safeDir(a_dir2), safeDir(a_dir3));
  // Slight outward bulge travelling with the ripple ring.
  float bump = 0.0;
  if (v_rAmp != vec4(0.0)) {
    vec4 th = fastAcos4(clamp(vec4(a_pos, 0.0) * v_dirs, -1.0, 1.0));
    bump = rippleRings(th, v_rRadius, v_rInvW, v_rAmp);
  }
  vec3 rel = fxRelPos(a_center) + a_pos * (rs * (1.0 + 0.02 * min(bump, 2.0)));
  v_n = a_pos;
  v_rel = rel;
  v_color = fxHalf4(a_color);
  // Low-health flicker (per shield and frame, so it is computed here once).
  float hp = clamp(v_color.a, 0.0, 1.0);
  float flick = 1.0;
  if (hp < 0.3) {
    uint tick = uint(int(floor(u_fxTime.x * 22.0))) + uint(int(par.y * 4096.0));
    float h = fxHash01(tick);
    float depth = (0.3 - hp) / 0.3;
    flick = 1.0 - depth * 0.75 * step(0.55, h) - depth * 0.2 * h;
  }
  v_par = vec4(up, par.y, flick, smoothstep(0.0, 0.5, up) * flick);
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;

const SHIELD_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${RIPPLE_GLSL}
in vec3 v_n;
in vec3 v_rel;
flat in vec4 v_color;
flat in vec4 v_par;
flat in vec4 v_rRadius;
flat in vec4 v_rInvW;
flat in vec4 v_rAmp;
flat in vec4 v_fAmp;
flat in mat4 v_dirs;
out vec4 o_color;
const float HEX_CELLS = 6.5;
// 1 on the honeycomb edges, 0 inside the cells; fw = screen-space footprint of p (anti-aliasing).
float hexLines(vec2 p, float fw) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 ag = abs(g);
  float d = 0.5 - max(dot(ag, vec2(0.5, 0.8660254)), ag.x);
  return 1.0 - smoothstep(0.015, 0.03 + fw, d);
}
void main() {
  vec3 n = normalize(v_n);
  vec3 view = normalize(-v_rel);
  float ndv = abs(dot(n, view));
  float rim = 1.0 - ndv;
  float fres = rim * rim * rim;
  float ring = 0.0;
  float flash = 0.0;
  // Idle shields (no live ripple) skip the ripple math entirely (flat → coherent branch).
  if (v_rAmp + v_fAmp != vec4(0.0)) {
    vec4 th = fastAcos4(clamp(vec4(n, 0.0) * v_dirs, -1.0, 1.0));
    ring = min(rippleRings(th, v_rRadius, v_rInvW, v_rAmp), 2.5);
    flash = dot(v_fAmp, exp(-FLASH_SHARPNESS * th * th));
  }
  // Triplanar honeycomb on the unit sphere (projections with negligible weight are skipped).
  vec3 an = abs(n);
  vec3 w3 = an * an;
  w3 *= w3;
  w3 /= w3.x + w3.y + w3.z;
  vec3 q = n * HEX_CELLS;
  float fw = length(fwidth(q)) * 0.7;
  float hex = 0.0;
  if (w3.x > 0.02) hex += w3.x * hexLines(q.yz, fw);
  if (w3.y > 0.02) hex += w3.y * hexLines(q.zx, fw);
  if (w3.z > 0.02) hex += w3.z * hexLines(q.xy, fw);
  float up = v_par.x;
  float hp = clamp(v_color.a, 0.0, 1.0);
  // Low health: shift towards red (the flicker is folded into v_par.w by the vertex shader).
  float danger = clamp((0.5 - hp) / 0.4, 0.0, 1.0);
  vec3 base = v_color.rgb;
  float baseLum = max(dot(base, vec3(0.3, 0.5, 0.2)), 0.5);
  vec3 col = mix(base, vec3(1.0, 0.12, 0.05) * baseLum * 1.8, danger);
  float forming = (1.0 - up) * step(0.001, up);
  float intensity = 0.05 + 0.95 * fres
    + hex * (0.04 + 0.35 * fres + 1.2 * ring + 1.2 * forming)
    + 0.8 * ring;
  float face = gl_FrontFacing ? 1.0 : 0.4;
  float opacity = v_par.w;
  vec3 rgb = col * (intensity * face * opacity) + vec3(1.0, 0.94, 0.85) * (flash * 1.8 * opacity);
  // A little coverage on the front face only: the bubble reads as a surface without darkening much.
  float alpha = gl_FrontFacing ? clamp(0.025 + 0.2 * fres + 0.08 * ring, 0.0, 0.3) * opacity : 0.0;
  o_color = vec4(rgb, alpha);
}
`;

const MESH_STREAM: VertexStreamLayout = {
  stepMode: 'vertex',
  stride: 12,
  attributes: [{ location: 0, format: vf('f32', 3, 'float'), offset: 0 }],
};

const INSTANCE_STREAM: VertexStreamLayout = {
  stepMode: 'instance',
  stride: SHIELD_STRIDE,
  attributes: [
    { location: 1, format: vf('i32', 3, 'int'), offset: SHIELD_OFF_CENTER },
    { location: 2, format: vf('f32', 1, 'float'), offset: SHIELD_OFF_RADIUS },
    { location: 3, format: vf('u32', 2, 'int'), offset: SHIELD_OFF_COLOR },
    { location: 4, format: vf('u32', 2, 'int'), offset: SHIELD_OFF_PARAMS },
    { location: 5, format: vf('f32', 4, 'float'), offset: SHIELD_OFF_RIPPLE_T0 },
    { location: 6, format: vf('u32', 2, 'int'), offset: SHIELD_OFF_RIPPLE_STR },
    { location: 7, format: vf('i16', 4, 'norm'), offset: SHIELD_OFF_RIPPLE_DIR },
    { location: 8, format: vf('i16', 4, 'norm'), offset: SHIELD_OFF_RIPPLE_DIR + 8 },
    { location: 9, format: vf('i16', 4, 'norm'), offset: SHIELD_OFF_RIPPLE_DIR + 16 },
    { location: 10, format: vf('i16', 4, 'norm'), offset: SHIELD_OFF_RIPPLE_DIR + 24 },
  ],
};

export class ShieldPass {
  readonly capacity: number;
  readonly subdivisions: number;
  /** Staging + GPU instance buffer, one record per shield in draw order (exposed for tests). */
  readonly instances: DynamicInstanceBuffer;
  readonly indexCount: number;
  readonly vertexCount: number;
  readonly stats: ShieldPassStats = { shields: 0, ripplesActive: 0, draws: 0, uploadBytes: 0, rejected: 0, hits: 0, hitsIgnored: 0 };

  private readonly vertexBuffer: BufH;
  private readonly indexBuffer: BufH;
  private readonly pipeline: PipeH;
  private readonly group: BindGroupH;
  private readonly streams: VertexStreamBinding[];
  /** Dense draw order: ids[i] is the shield at record i. */
  private readonly ids: Float64Array;
  private readonly posOf = new Map<number, number>();
  private n = 0;
  // Ripple bookkeeping (absolute seconds; the records hold the wrapped FX time).
  private readonly rStart: Float64Array;
  private readonly rStr: Float32Array;
  private readonly rSeq: Float64Array;
  private seq = 0;
  private dirty = false;
  private destroyed = false;

  constructor(
    private readonly dev: GpuDevice,
    bindings: FxBindings,
    opts: ShieldPassOptions = {},
  ) {
    this.capacity = opts.capacity ?? 128;
    this.subdivisions = opts.subdivisions ?? 3;
    const mesh = createIcosphere(this.subdivisions);
    this.indexCount = mesh.indices.length;
    this.vertexCount = mesh.vertexCount;
    this.instances = new DynamicInstanceBuffer(dev, { label: 'fx.shields', stride: SHIELD_STRIDE, capacity: this.capacity });
    this.ids = new Float64Array(this.capacity);
    this.rStart = new Float64Array(this.capacity * SHIELD_RIPPLES);
    this.rStr = new Float32Array(this.capacity * SHIELD_RIPPLES);
    this.rSeq = new Float64Array(this.capacity * SHIELD_RIPPLES);
    const positions = mesh.positions;
    const indices = mesh.indices;
    this.vertexBuffer = dev.createBuffer({
      label: 'fx.shields.mesh',
      usage: 'vertex',
      size: positions.byteLength,
      restore: (h) => dev.writeBuffer(h, 0, positions),
    });
    dev.writeBuffer(this.vertexBuffer, 0, positions);
    this.indexBuffer = dev.createBuffer({
      label: 'fx.shields.indices',
      usage: 'index',
      size: Math.ceil(indices.byteLength / 4) * 4,
      restore: (h) => dev.writeBuffer(h, 0, indices),
    });
    dev.writeBuffer(this.indexBuffer, 0, indices);
    this.pipeline = dev.createPipeline({
      label: 'fx.shields',
      vertex: SHIELD_VS,
      fragment: SHIELD_FS,
      streams: [MESH_STREAM, INSTANCE_STREAM],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'FxView', slot: SLOT_FX_VIEW },
      ],
      primitive: 'triangles',
      cullMode: 'none',
      depthTest: true,
      depthWrite: false,
      blend: 'premultiplied',
    });
    this.group = dev.createBindGroup({ label: 'fx.shields', buffers: fxSharedBufferBindings(bindings) });
    this.streams = [
      { buffer: this.vertexBuffer, offset: 0 },
      { buffer: this.instances.buffer, offset: 0 },
    ];
  }

  /** Number of shields. */
  get count(): number {
    return this.n;
  }

  /** Whether a shield with this id exists. */
  has(id: number): boolean {
    return this.posOf.has(id);
  }

  /** Draw-order index of a shield (−1 if unknown). */
  indexOf(id: number): number {
    return this.posOf.get(id) ?? -1;
  }

  /**
   * Creates or updates a shield. New shields are appended to the draw order; updates keep their place.
   * Returns false (and counts `rejected`) when a new shield does not fit the capacity.
   */
  set(id: number, s: ShieldState): boolean {
    let i = this.posOf.get(id);
    if (i === undefined) {
      if (this.n >= this.capacity) {
        this.stats.rejected++;
        return false;
      }
      i = this.n++;
      this.posOf.set(id, i);
      this.ids[i] = id;
      this.clearRipples(i);
      const phase = fxHash32(id >>> 0, (id / 4294967296) >>> 0) / 4294967296;
      const h = (i * SHIELD_STRIDE) >> 1;
      writeHalf4(this.instances.u16, h + (SHIELD_OFF_PARAMS >> 1), 0, phase, 0, 0);
    }
    const ib = this.instances;
    const w = (i * SHIELD_STRIDE) >> 2;
    ib.i32[w] = rawAt(s.centerRaw, 0);
    ib.i32[w + 1] = rawAt(s.centerRaw, 1);
    ib.i32[w + 2] = rawAt(s.centerRaw, 2);
    ib.f32[w + 3] = s.radiusWu > 0 ? s.radiusWu : 0;
    const h = (i * SHIELD_STRIDE) >> 1;
    writeHalf4(ib.u16, h + (SHIELD_OFF_COLOR >> 1), s.color[0], s.color[1], s.color[2], clamp01(s.hpFrac));
    ib.u16[h + (SHIELD_OFF_PARAMS >> 1)] = packHalf(clamp01(s.upFrac));
    this.dirty = true;
    return true;
  }

  /**
   * Registers a hit at `pointRaw` (usually on the surface) at time `nowS` (same clock as `update`).
   * Fills a free ripple slot or replaces the most decayed one (ties: the oldest hit). Unknown ids are
   * ignored (counted in `hitsIgnored`). Returns the ripple slot used or −1.
   */
  hit(id: number, pointRaw: ArrayLike<number>, nowS: number, strength = 1): number {
    const i = this.posOf.get(id);
    if (i === undefined) {
      this.stats.hitsIgnored++;
      return -1;
    }
    const base = i * SHIELD_RIPPLES;
    let best = 0;
    let bestE = Infinity;
    let bestSeq = Infinity;
    for (let k = 0; k < SHIELD_RIPPLES; k++) {
      const e = shieldRippleEnergy(this.rStr[base + k]!, nowS - this.rStart[base + k]!);
      const sq = this.rSeq[base + k]!;
      if (e < bestE || (e === bestE && sq < bestSeq)) {
        best = k;
        bestE = e;
        bestSeq = sq;
      }
    }
    const str = strength > 0 ? Math.min(strength, 4) : 0;
    this.rStart[base + best] = nowS;
    this.rStr[base + best] = str;
    this.rSeq[base + best] = ++this.seq;
    const ib = this.instances;
    const w = (i * SHIELD_STRIDE) >> 2;
    let dx = rawAt(pointRaw, 0) - ib.i32[w]!;
    let dy = rawAt(pointRaw, 1) - ib.i32[w + 1]!;
    let dz = rawAt(pointRaw, 2) - ib.i32[w + 2]!;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l > 0) {
      dx /= l;
      dy /= l;
      dz /= l;
    } else {
      dx = 0;
      dy = 1;
      dz = 0;
    }
    ib.f32[w + (SHIELD_OFF_RIPPLE_T0 >> 2) + best] = wrapFxTime(nowS);
    const h = (i * SHIELD_STRIDE) >> 1;
    ib.u16[h + (SHIELD_OFF_RIPPLE_STR >> 1) + best] = packHalf(str);
    const d = h + (SHIELD_OFF_RIPPLE_DIR >> 1) + best * 4;
    ib.i16[d] = Math.round(dx * 32767);
    ib.i16[d + 1] = Math.round(dy * 32767);
    ib.i16[d + 2] = Math.round(dz * 32767);
    ib.i16[d + 3] = 0;
    this.stats.hits++;
    this.dirty = true;
    return best;
  }

  /** Removes a shield; the remaining shields keep their relative draw order. */
  remove(id: number): boolean {
    const i = this.posOf.get(id);
    if (i === undefined) return false;
    this.posOf.delete(id);
    const last = this.n - 1;
    if (i < last) {
      const ib = this.instances;
      ib.u8.copyWithin(i * SHIELD_STRIDE, (i + 1) * SHIELD_STRIDE, this.n * SHIELD_STRIDE);
      this.ids.copyWithin(i, i + 1, this.n);
      this.rStart.copyWithin(i * SHIELD_RIPPLES, (i + 1) * SHIELD_RIPPLES, this.n * SHIELD_RIPPLES);
      this.rStr.copyWithin(i * SHIELD_RIPPLES, (i + 1) * SHIELD_RIPPLES, this.n * SHIELD_RIPPLES);
      this.rSeq.copyWithin(i * SHIELD_RIPPLES, (i + 1) * SHIELD_RIPPLES, this.n * SHIELD_RIPPLES);
      for (let k = i; k < last; k++) this.posOf.set(this.ids[k]!, k);
    }
    this.n = last;
    this.dirty = true;
    return true;
  }

  /** Removes every shield. */
  clear(): void {
    this.posOf.clear();
    this.n = 0;
    this.dirty = true;
  }

  /** Expires ripples older than their lifetime (clears their strength) and counts the active ones. */
  update(nowS: number): void {
    let active = 0;
    const u16 = this.instances.u16;
    for (let i = 0; i < this.n; i++) {
      const base = i * SHIELD_RIPPLES;
      for (let k = 0; k < SHIELD_RIPPLES; k++) {
        if (this.rStr[base + k]! <= 0) continue;
        if (nowS - this.rStart[base + k]! >= SHIELD_RIPPLE_LIFE_S) {
          this.rStr[base + k] = 0;
          u16[((i * SHIELD_STRIDE) >> 1) + (SHIELD_OFF_RIPPLE_STR >> 1) + k] = 0;
          this.dirty = true;
        } else active++;
      }
    }
    this.stats.shields = this.n;
    this.stats.ripplesActive = active;
  }

  /** Uploads changed records and draws every shield in one indexed instanced draw. Returns the draws. */
  encode(enc: PassEncoder): number {
    this.stats.shields = this.n;
    this.stats.draws = 0;
    this.stats.uploadBytes = 0;
    if (this.dirty) {
      this.stats.uploadBytes = this.instances.upload(this.n);
      this.dirty = false;
    }
    if (this.n === 0) return 0;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.group);
    enc.setVertexStreams(this.streams);
    enc.setIndexBuffer(this.indexBuffer, 'uint16');
    enc.drawIndexedInstanced(this.indexCount, this.n);
    this.stats.draws = 1;
    return 1;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.instances.destroy();
    this.dev.destroyBuffer(this.vertexBuffer);
    this.dev.destroyBuffer(this.indexBuffer);
    this.dev.destroyBindGroup(this.group);
    this.dev.destroyPipeline(this.pipeline);
  }

  private clearRipples(i: number): void {
    const base = i * SHIELD_RIPPLES;
    for (let k = 0; k < SHIELD_RIPPLES; k++) {
      this.rStart[base + k] = 0;
      this.rStr[base + k] = 0;
      this.rSeq[base + k] = 0;
    }
    this.instances.u8.fill(0, i * SHIELD_STRIDE, (i + 1) * SHIELD_STRIDE);
  }
}
