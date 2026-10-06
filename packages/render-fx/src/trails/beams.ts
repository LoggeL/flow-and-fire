/**
 * Beams (PLAN §3.7 "Beams … instanzierte Quads"): lasers, lightning, the build/reclaim "Gießstrom" core.
 *
 * Immediate mode: `begin()` once per frame, `add()` per visible beam, `encode()` draws everything in one
 * instanced draw (4-vertex triangle strip per beam). Short shots (`addTimed`) live in a pool that fades
 * itself out (`update(nowS)` ages it) and is appended to the immediate beams at encode time.
 *
 * Geometry: an axis billboard around the segment (width perpendicular to the axis and the view ray)
 * with soft round end caps; profile = narrow HDR core + wide glow; optional scrolling noise (flicker /
 * lateral wobble) and a width taper. Additive (premultiplied blend with alpha 0), depth test on, depth
 * write off.
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME, vf } from '@faf/render';
import type { BindGroupH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding, VertexStreamLayout } from '@faf/render';
import { DynamicInstanceBuffer } from '../core/instance-buffer.ts';
import { SLOT_FX_VIEW } from '../core/slots.ts';
import { FX_COMMON_GLSL, FX_VIEW_BLOCK_GLSL, fxSharedBufferBindings } from '../core/view.ts';
import type { FxBindings } from '../core/view.ts';
import { FX_HALF_GLSL, FX_NOISE_GLSL, FX_RIBBON_GLSL, glslFloat } from './glsl.ts';
import { clamp01, packHalf, rawAt, writeHalf4 } from './pack.ts';

/** Visual style of a beam. Colors are linear HDR (values > 1 bloom). */
export interface BeamStyle {
  /** Full visible width (glow edge to glow edge) in WU. */
  readonly widthWu: number;
  /** Core color (narrow centre line), linear HDR. */
  readonly core: readonly [number, number, number];
  /** Glow color (wide soft falloff), linear HDR. */
  readonly glow: readonly [number, number, number];
  /** Overall intensity multiplier 0..1 (fading). */
  readonly alpha: number;
  /** Speed of the scrolling noise along the beam in WU/s (positive = from → to). Default 0. */
  readonly scrollSpeed?: number;
  /** 0..1: flicker and lateral core wobble (e.g. the build stream core). Default 0. */
  readonly noise?: number;
  /** Width multipliers at [from, to]. Default [1, 1]. */
  readonly taper?: readonly [number, number];
}

export interface BeamPassOptions {
  /** Maximum beams per frame (immediate + timed). Default 4096. */
  readonly capacity?: number;
  /** Maximum concurrently alive timed beams. Default min(capacity, 1024). */
  readonly timedCapacity?: number;
}

export interface BeamPassStats {
  /** Beams drawn by the last `encode` (immediate + timed). */
  beams: number;
  /** Alive timed beams after the last `update`. */
  timed: number;
  /** Beams rejected since the last `begin()` (capacity or timed pool full). */
  dropped: number;
  /** Beams rejected since construction. */
  droppedTotal: number;
  /** Draw calls of the last `encode` (0 or 1). */
  draws: number;
  /** Bytes uploaded by the last `encode`. */
  uploadBytes: number;
}

// Instance record (52 bytes).
export const BEAM_STRIDE = 52;
/** from: i32×3 raw Q20.12. */
export const BEAM_OFF_FROM = 0;
/** to: i32×3 raw Q20.12. */
export const BEAM_OFF_TO = 12;
/** f16×4: core r, g, b, width (WU). */
export const BEAM_OFF_CORE = 24;
/** f16×4: glow r, g, b, alpha. */
export const BEAM_OFF_GLOW = 32;
/** f16×4: scroll speed (WU/s), noise, taper start, taper end. */
export const BEAM_OFF_PARAMS = 40;
/** f16×2: noise phase (0..1), reserved. */
export const BEAM_OFF_MISC = 48;

/** Width fraction of the core (Gaussian 1/e half-width relative to the half width). */
export const BEAM_CORE_WIDTH = 0.22;
/** Glow Gaussian sharpness (exp(−k·r²), r = 0..1 across the half width). */
export const BEAM_GLOW_SHARPNESS = 3.2;
/** Relative strength of the glow term. */
export const BEAM_GLOW_WEIGHT = 0.9;

/**
 * Cross profile of a beam at normalized radial distance r (0 = axis, 1 = quad edge), identical to the
 * fragment shader without noise: `coreLum · core(r) + glowLum · glow(r)`.
 */
export function beamProfile(r: number, coreLum: number, glowLum: number): number {
  const a = Math.abs(r);
  const c = Math.exp(-(a * a) / (BEAM_CORE_WIDTH * BEAM_CORE_WIDTH));
  const edge = 1 - smoothstep(0.7, 1, a);
  const g = Math.exp(-BEAM_GLOW_SHARPNESS * a * a) * edge * BEAM_GLOW_WEIGHT;
  return coreLum * c + glowLum * g;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

const BEAM_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${FX_VIEW_BLOCK_GLSL}
${FX_COMMON_GLSL}
${FX_HALF_GLSL}
${FX_RIBBON_GLSL}
layout(location = 0) in ivec3 a_from;
layout(location = 1) in ivec3 a_to;
layout(location = 2) in uvec2 a_core;
layout(location = 3) in uvec2 a_glow;
layout(location = 4) in uvec2 a_params;
layout(location = 5) in uint a_misc;
out vec3 v_core;
out vec3 v_glow;
out vec3 v_geo;          // x: along (WU from 'from'), y: perpendicular offset (WU), z: local half width
flat out vec4 v_beam;    // x: length (WU), y: scroll (WU/s), z: noise, w: phase
void main() {
  vec4 core = fxHalf4(a_core);
  vec4 glow = fxHalf4(a_glow);
  vec4 params = fxHalf4(a_params);
  vec2 misc = fxHalf2(a_misc);
  vec3 a = fxRelPos(a_from);
  vec3 b = fxRelPos(a_to);
  vec3 d = vec3(a_to - a_from) * FX_INV_RAW;
  float len = length(d);
  vec3 axis = len > 1e-4 ? d / len : u_fxRight.xyz;
  float halfW = 0.5 * core.w;
  FxRibbon r = fxRibbon(gl_VertexID, a, b, axis, len, halfW * params.z, halfW * params.w);
  float k = glow.w * r.gain;
  v_core = core.rgb * k;
  v_glow = glow.rgb * k;
  v_geo = vec3(r.along, r.side * r.halfW, r.halfW);
  v_beam = vec4(len, params.x, params.y, misc.x);
  gl_Position = u_viewProj * vec4(r.pos, 1.0);
}
`;

const BEAM_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FX_VIEW_BLOCK_GLSL}
${FX_NOISE_GLSL}
in vec3 v_core;
in vec3 v_glow;
in vec3 v_geo;
flat in vec4 v_beam;
out vec4 o_color;
const float CORE_W = ${glslFloat(BEAM_CORE_WIDTH)};
const float GLOW_K = ${glslFloat(BEAM_GLOW_SHARPNESS)};
const float GLOW_WEIGHT = ${glslFloat(BEAM_GLOW_WEIGHT)};
void main() {
  float hw = max(v_geo.z, 1e-4);
  float x = v_geo.x;
  float len = v_beam.x;
  float y = v_geo.y / hw;
  // Distance beyond the ends in half widths → round soft caps.
  float dx = max(max(-x, x - len), 0.0) / hw;
  float noise = v_beam.z;
  float flick = 1.0;
  if (noise > 0.0) {
    // Scrolling noise along the beam: flowing brightness pulses and a lateral core wobble.
    float s = mod(x * 0.45 - u_fxTime.x * v_beam.y * 0.45 + v_beam.w * 97.0, 256.0);
    float n = fxNoise3(s);
    float w = fxNoise1(mod(x * 0.23 - u_fxTime.x * v_beam.y * 0.23 + v_beam.w * 53.0, 256.0)) - 0.5;
    y -= w * noise * 0.9;
    flick = 1.0 + noise * (n - 0.5) * 1.6;
  }
  float r2 = dx * dx + y * y;
  float r = sqrt(r2);
  float core = exp(-r2 / (CORE_W * CORE_W));
  float glow = exp(-GLOW_K * r2) * (1.0 - smoothstep(0.7, 1.0, r)) * GLOW_WEIGHT;
  vec3 c = (v_core * core + v_glow * glow) * max(flick, 0.0);
  o_color = vec4(c, 0.0);
}
`;

const BEAM_STREAM: VertexStreamLayout = {
  stepMode: 'instance',
  stride: BEAM_STRIDE,
  attributes: [
    { location: 0, format: vf('i32', 3, 'int'), offset: BEAM_OFF_FROM },
    { location: 1, format: vf('i32', 3, 'int'), offset: BEAM_OFF_TO },
    { location: 2, format: vf('u32', 2, 'int'), offset: BEAM_OFF_CORE },
    { location: 3, format: vf('u32', 2, 'int'), offset: BEAM_OFF_GLOW },
    { location: 4, format: vf('u32', 2, 'int'), offset: BEAM_OFF_PARAMS },
    { location: 5, format: vf('u32', 1, 'int'), offset: BEAM_OFF_MISC },
  ],
};

/** Fade of a timed beam at normalized age a ∈ [0, 1]: quick flash-in, then quadratic fade-out. */
export function timedBeamFade(a: number): number {
  if (!(a >= 0) || a >= 1) return 0;
  const inT = a < 0.08 ? a / 0.08 : 1;
  const out = 1 - a;
  return inT * out * out;
}

/** Deterministic noise phase in [0, 1) from a counter (golden-ratio sequence). */
function phaseOf(n: number): number {
  const v = n * 0.6180339887498949;
  return v - Math.floor(v);
}

export class BeamPass {
  readonly capacity: number;
  readonly timedCapacity: number;
  /** Staging + GPU instance buffer (exposed for tests and debugging). */
  readonly instances: DynamicInstanceBuffer;
  readonly stats: BeamPassStats = { beams: 0, timed: 0, dropped: 0, droppedTotal: 0, draws: 0, uploadBytes: 0 };

  private readonly pipeline: PipeH;
  private readonly group: BindGroupH;
  private readonly streams: VertexStreamBinding[];
  /** Immediate beams written since `begin()`. */
  private count = 0;
  private serial = 0;
  // Timed pool (dense, swap-remove).
  private timedN = 0;
  private readonly tPos: Int32Array;
  private readonly tStart: Float64Array;
  private readonly tLife: Float64Array;
  private readonly tFade: Float32Array;
  private readonly tPhase: Float32Array;
  private readonly tStyle: (BeamStyle | null)[];
  private destroyed = false;

  constructor(
    private readonly dev: GpuDevice,
    bindings: FxBindings,
    opts: BeamPassOptions = {},
  ) {
    this.capacity = opts.capacity ?? 4096;
    this.timedCapacity = opts.timedCapacity ?? Math.min(this.capacity, 1024);
    if (!Number.isInteger(this.timedCapacity) || this.timedCapacity < 0) {
      throw new Error(`BeamPass: invalid timedCapacity ${this.timedCapacity}`);
    }
    this.instances = new DynamicInstanceBuffer(dev, { label: 'fx.beams', stride: BEAM_STRIDE, capacity: this.capacity });
    const tc = Math.max(1, this.timedCapacity);
    this.tPos = new Int32Array(tc * 6);
    this.tStart = new Float64Array(tc);
    this.tLife = new Float64Array(tc);
    this.tFade = new Float32Array(tc);
    this.tPhase = new Float32Array(tc);
    this.tStyle = new Array<BeamStyle | null>(tc).fill(null);
    this.pipeline = dev.createPipeline({
      label: 'fx.beams',
      vertex: BEAM_VS,
      fragment: BEAM_FS,
      streams: [BEAM_STREAM],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'FxView', slot: SLOT_FX_VIEW },
      ],
      primitive: 'triangle-strip',
      cullMode: 'none',
      depthTest: true,
      depthWrite: false,
      blend: 'premultiplied',
    });
    this.group = dev.createBindGroup({ label: 'fx.beams', buffers: fxSharedBufferBindings(bindings) });
    this.streams = [{ buffer: this.instances.buffer, offset: 0 }];
  }

  /** Starts a new frame: forgets all immediate beams (timed beams stay) and resets `stats.dropped`. */
  begin(): void {
    this.count = 0;
    this.stats.dropped = 0;
  }

  /** Adds a beam for this frame. Returns false (and counts `dropped`) when the capacity is exhausted. */
  add(fromRaw: ArrayLike<number>, toRaw: ArrayLike<number>, style: BeamStyle): boolean {
    if (this.count >= this.capacity) {
      this.drop();
      return false;
    }
    this.write(this.count++, fromRaw, 0, toRaw, 0, style, 1, phaseOf(++this.serial));
    return true;
  }

  /**
   * Adds a short-lived beam (laser shot, lightning) that lives `lifeS` seconds from `t0S` (same clock as
   * `update`) and fades out by itself. Returns false when the timed pool is full.
   */
  addTimed(fromRaw: ArrayLike<number>, toRaw: ArrayLike<number>, style: BeamStyle, t0S: number, lifeS: number): boolean {
    if (this.timedN >= this.timedCapacity || !(lifeS > 0)) {
      this.drop();
      return false;
    }
    const i = this.timedN++;
    const o = i * 6;
    this.tPos[o] = rawAt(fromRaw, 0);
    this.tPos[o + 1] = rawAt(fromRaw, 1);
    this.tPos[o + 2] = rawAt(fromRaw, 2);
    this.tPos[o + 3] = rawAt(toRaw, 0);
    this.tPos[o + 4] = rawAt(toRaw, 1);
    this.tPos[o + 5] = rawAt(toRaw, 2);
    this.tStart[i] = t0S;
    this.tLife[i] = lifeS;
    this.tFade[i] = timedBeamFade(0);
    this.tPhase[i] = phaseOf(++this.serial);
    this.tStyle[i] = style;
    return true;
  }

  /** Ages the timed pool: computes each fade and removes expired beams. */
  update(nowS: number): void {
    let i = 0;
    while (i < this.timedN) {
      const a = (nowS - this.tStart[i]!) / this.tLife[i]!;
      if (a >= 1) {
        this.removeTimed(i);
        continue;
      }
      this.tFade[i] = a < 0 ? 0 : timedBeamFade(a);
      i++;
    }
    this.stats.timed = this.timedN;
  }

  /** Uploads and draws all beams of this frame (immediate + timed) in one draw. Returns the draw count. */
  encode(enc: PassEncoder): number {
    let n = this.count;
    for (let i = 0; i < this.timedN; i++) {
      const fade = this.tFade[i]!;
      if (fade <= 0) continue;
      if (n >= this.capacity) {
        this.drop();
        continue;
      }
      this.write(n++, this.tPos, i * 6, this.tPos, i * 6 + 3, this.tStyle[i]!, fade, this.tPhase[i]!);
    }
    this.stats.beams = n;
    this.stats.draws = 0;
    this.stats.uploadBytes = 0;
    if (n === 0) return 0;
    this.stats.uploadBytes = this.instances.upload(n);
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.group);
    enc.setVertexStreams(this.streams);
    enc.drawInstanced(4, n);
    this.stats.draws = 1;
    return 1;
  }

  /** Removes all timed beams. */
  clearTimed(): void {
    for (let i = 0; i < this.timedN; i++) this.tStyle[i] = null;
    this.timedN = 0;
    this.stats.timed = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.instances.destroy();
    this.dev.destroyBindGroup(this.group);
    this.dev.destroyPipeline(this.pipeline);
  }

  private drop(): void {
    this.stats.dropped++;
    this.stats.droppedTotal++;
  }

  private removeTimed(i: number): void {
    const last = --this.timedN;
    if (i !== last) {
      this.tPos.copyWithin(i * 6, last * 6, last * 6 + 6);
      this.tStart[i] = this.tStart[last]!;
      this.tLife[i] = this.tLife[last]!;
      this.tFade[i] = this.tFade[last]!;
      this.tPhase[i] = this.tPhase[last]!;
      this.tStyle[i] = this.tStyle[last]!;
    }
    this.tStyle[last] = null;
  }

  private write(
    slot: number,
    from: ArrayLike<number>,
    fo: number,
    to: ArrayLike<number>,
    to0: number,
    s: BeamStyle,
    fade: number,
    phase: number,
  ): void {
    const ib = this.instances;
    const w = (slot * BEAM_STRIDE) >> 2;
    const i32 = ib.i32;
    i32[w] = rawAt(from, fo);
    i32[w + 1] = rawAt(from, fo + 1);
    i32[w + 2] = rawAt(from, fo + 2);
    i32[w + 3] = rawAt(to, to0);
    i32[w + 4] = rawAt(to, to0 + 1);
    i32[w + 5] = rawAt(to, to0 + 2);
    const h = (slot * BEAM_STRIDE) >> 1;
    const u16 = ib.u16;
    writeHalf4(u16, h + (BEAM_OFF_CORE >> 1), s.core[0], s.core[1], s.core[2], s.widthWu);
    writeHalf4(u16, h + (BEAM_OFF_GLOW >> 1), s.glow[0], s.glow[1], s.glow[2], clamp01(s.alpha) * fade);
    const taper = s.taper;
    writeHalf4(
      u16,
      h + (BEAM_OFF_PARAMS >> 1),
      s.scrollSpeed ?? 0,
      clamp01(s.noise ?? 0),
      taper === undefined ? 1 : taper[0],
      taper === undefined ? 1 : taper[1],
    );
    u16[h + (BEAM_OFF_MISC >> 1)] = packHalf(phase);
    u16[h + (BEAM_OFF_MISC >> 1) + 1] = 0;
  }
}
