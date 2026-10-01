/**
 * Projectile trails (PLAN §3.7, P5 "Tracer, Raketen-Trails"): one instanced quad per projectile.
 *
 * The caller passes the projectile's previous and current sim positions (raw Q20.12, like the unit
 * records); the head is interpolated on the GPU with the frame alpha (`u_camFrac.w`, FRAME_BLOCK_GLSL),
 * exactly like units, and the tail extends `lengthWu` behind the head along normalize(cur − prev) with a
 * width taper. A standing projectile (prev == cur) collapses the tail to a soft dot at the head – no NaN.
 * Smoke behind missiles is a particle emitter (rfx-p3); this pass draws the glowing streak only.
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME, vf } from '@faf/render';
import type { BindGroupH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding, VertexStreamLayout } from '@faf/render';
import { DynamicInstanceBuffer } from '../core/instance-buffer.ts';
import { SLOT_FX_VIEW } from '../core/slots.ts';
import { FX_COMMON_GLSL, FX_VIEW_BLOCK_GLSL, fxSharedBufferBindings } from '../core/view.ts';
import type { FxBindings } from '../core/view.ts';
import { FX_HALF_GLSL, FX_RIBBON_GLSL, glslFloat } from './glsl.ts';
import { clamp01, rawAt, writeHalf4 } from './pack.ts';

/** Visual style of a trail. Colors are linear HDR RGB with an opacity/intensity in a. */
export interface TrailStyle {
  /** Tail length behind the head in WU. */
  readonly lengthWu: number;
  /** Width at the head in WU (the tail tapers to {@link TRAIL_TAIL_TAPER} of it). */
  readonly widthWu: number;
  /** Head color (linear HDR) and intensity. */
  readonly head: readonly [number, number, number, number];
  /** Tail-end color and intensity (usually a = 0 → fades out). */
  readonly tail: readonly [number, number, number, number];
  /** 0 = additive (default), 1 = alpha-blended (premultiplied, e.g. a dark smoke streak). */
  readonly blend?: number;
}

export interface TrailPassOptions {
  /** Maximum trails per frame. Default 8192. */
  readonly capacity?: number;
}

export interface TrailPassStats {
  /** Trails drawn by the last `encode`. */
  trails: number;
  /** Trails rejected since the last `begin()`. */
  dropped: number;
  droppedTotal: number;
  draws: number;
  uploadBytes: number;
}

// Instance record (48 bytes).
export const TRAIL_STRIDE = 48;
/** prev: i32×3 raw Q20.12 (sim position of the previous tick). */
export const TRAIL_OFF_PREV = 0;
/** cur: i32×3 raw Q20.12 (sim position of the current tick). */
export const TRAIL_OFF_CUR = 12;
/** f16×4: head r, g, b, a. */
export const TRAIL_OFF_HEAD = 24;
/** f16×4: tail r, g, b, a. */
export const TRAIL_OFF_TAIL = 32;
/** f16×4: length (WU), width (WU), blend, reserved. */
export const TRAIL_OFF_DIMS = 40;

/** Width at the tail end relative to the head width. */
export const TRAIL_TAIL_TAPER = 0.3;
/** Squared-length threshold (WU²) below which cur − prev counts as standing still. */
export const TRAIL_MIN_DIR_SQ = 1e-10;

/**
 * JS mirror of the vertex shader's head/tail computation (for tests and CPU-side culling):
 * head = mix(prev, cur, alpha) (WU), dir = normalize(cur − prev) or 0 when standing, tail = head − dir·L·scale.
 * Writes head xyz into out[0..2] and tail xyz into out[3..5] (absolute WU) and returns the effective length.
 */
export function trailEndpointsWu(
  prevRaw: ArrayLike<number>,
  curRaw: ArrayLike<number>,
  alpha: number,
  lengthWu: number,
  out: Float64Array | number[],
): number {
  const inv = 1 / 4096;
  let l2 = 0;
  const d = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const p = rawAt(prevRaw, k);
    const c = rawAt(curRaw, k);
    d[k] = (c - p) * inv;
    l2 += d[k]! * d[k]!;
    out[k] = (p + (c - p) * alpha) * inv;
  }
  const moving = l2 > TRAIL_MIN_DIR_SQ;
  const s = moving ? 1 / Math.sqrt(l2) : 0;
  const len = moving ? lengthWu : 0;
  for (let k = 0; k < 3; k++) out[k + 3] = out[k]! - d[k]! * s * len;
  return len;
}

const TRAIL_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${FX_VIEW_BLOCK_GLSL}
${FX_COMMON_GLSL}
${FX_HALF_GLSL}
${FX_RIBBON_GLSL}
layout(location = 0) in ivec3 a_prev;
layout(location = 1) in ivec3 a_cur;
layout(location = 2) in uvec2 a_head;
layout(location = 3) in uvec2 a_tail;
layout(location = 4) in uvec2 a_dims;
out vec4 v_head;
out vec4 v_tail;
out vec3 v_geo;        // x: along (WU from the head towards the tail), y: perpendicular offset, z: half width
flat out vec2 v_trail; // x: length (WU), y: blend
void main() {
  vec4 dims = fxHalf4(a_dims);
  vec3 prev = fxRelPos(a_prev);
  vec3 cur = fxRelPos(a_cur);
  vec3 head = mix(prev, cur, u_camFrac.w);
  vec3 d = vec3(a_cur - a_prev) * FX_INV_RAW;
  float l2 = dot(d, d);
  bool moving = l2 > ${glslFloat(TRAIL_MIN_DIR_SQ)};
  vec3 dir = moving ? d * inversesqrt(l2) : vec3(0.0);
  float len = moving ? max(dims.x, 0.0) : 0.0;
  vec3 tail = head - dir * len;
  // Ribbon axis from head to tail; a standing head uses any axis (the quad is then a round dot).
  vec3 axis = moving ? -dir : u_fxRight.xyz;
  float halfW = 0.5 * max(dims.y, 0.0);
  FxRibbon r = fxRibbon(gl_VertexID, head, tail, axis, len, halfW, halfW * ${glslFloat(TRAIL_TAIL_TAPER)});
  v_head = fxHalf4(a_head) * vec4(1.0, 1.0, 1.0, r.gain);
  v_tail = fxHalf4(a_tail) * vec4(1.0, 1.0, 1.0, r.gain);
  v_geo = vec3(r.along, r.side * r.halfW, r.halfW);
  v_trail = vec2(len, dims.z);
  gl_Position = u_viewProj * vec4(r.pos, 1.0);
}
`;

const TRAIL_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 v_head;
in vec4 v_tail;
in vec3 v_geo;
flat in vec2 v_trail;
out vec4 o_color;
void main() {
  float hw = max(v_geo.z, 1e-4);
  float x = v_geo.x;
  float len = v_trail.x;
  float y = v_geo.y / hw;
  float t = len > 0.0 ? clamp(x / len, 0.0, 1.0) : 0.0;
  float dx = max(max(-x, x - len), 0.0) / hw;
  float r2 = dx * dx + y * y;
  // Cross profile: bright core + soft glow, zero at the quad edge.
  float edge = 1.0 - smoothstep(0.65, 1.0, sqrt(r2));
  float prof = (exp(-r2 * 14.0) * 0.8 + exp(-r2 * 3.0) * 0.45) * edge;
  // Hot spot at the head (the projectile itself).
  float hx = x / hw;
  float hot = exp(-(hx * hx * 0.6 + y * y) * 5.0) * 0.9;
  vec4 c = mix(v_head, v_tail, t);
  float body = c.a * prof * sqrt(1.0 - t);
  float headK = v_head.a * hot;
  vec3 rgb = c.rgb * body + v_head.rgb * headK;
  float k = body + headK;
  o_color = vec4(rgb, clamp(k, 0.0, 1.0) * v_trail.y);
}
`;

const TRAIL_STREAM: VertexStreamLayout = {
  stepMode: 'instance',
  stride: TRAIL_STRIDE,
  attributes: [
    { location: 0, format: vf('i32', 3, 'int'), offset: TRAIL_OFF_PREV },
    { location: 1, format: vf('i32', 3, 'int'), offset: TRAIL_OFF_CUR },
    { location: 2, format: vf('u32', 2, 'int'), offset: TRAIL_OFF_HEAD },
    { location: 3, format: vf('u32', 2, 'int'), offset: TRAIL_OFF_TAIL },
    { location: 4, format: vf('u32', 2, 'int'), offset: TRAIL_OFF_DIMS },
  ],
};

export class TrailPass {
  readonly capacity: number;
  /** Staging + GPU instance buffer (exposed for tests and debugging). */
  readonly instances: DynamicInstanceBuffer;
  readonly stats: TrailPassStats = { trails: 0, dropped: 0, droppedTotal: 0, draws: 0, uploadBytes: 0 };

  private readonly pipeline: PipeH;
  private readonly group: BindGroupH;
  private readonly streams: VertexStreamBinding[];
  private count = 0;
  private destroyed = false;

  constructor(
    private readonly dev: GpuDevice,
    bindings: FxBindings,
    opts: TrailPassOptions = {},
  ) {
    this.capacity = opts.capacity ?? 8192;
    this.instances = new DynamicInstanceBuffer(dev, { label: 'fx.trails', stride: TRAIL_STRIDE, capacity: this.capacity });
    this.pipeline = dev.createPipeline({
      label: 'fx.trails',
      vertex: TRAIL_VS,
      fragment: TRAIL_FS,
      streams: [TRAIL_STREAM],
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
    this.group = dev.createBindGroup({ label: 'fx.trails', buffers: fxSharedBufferBindings(bindings) });
    this.streams = [{ buffer: this.instances.buffer, offset: 0 }];
  }

  /** Starts a new frame (immediate mode): forgets all trails and resets `stats.dropped`. */
  begin(): void {
    this.count = 0;
    this.stats.dropped = 0;
  }

  /**
   * Adds the trail of one projectile: `prevRaw`/`curRaw` = sim positions of the previous/current tick.
   * `lengthScale` (0..1, default 1) shortens the tail, e.g. while a fresh projectile has not yet flown
   * `lengthWu`. Returns false (and counts `dropped`) when the capacity is exhausted.
   */
  add(prevRaw: ArrayLike<number>, curRaw: ArrayLike<number>, style: TrailStyle, lengthScale = 1): boolean {
    if (this.count >= this.capacity) {
      this.stats.dropped++;
      this.stats.droppedTotal++;
      return false;
    }
    const slot = this.count++;
    const ib = this.instances;
    const w = (slot * TRAIL_STRIDE) >> 2;
    const i32 = ib.i32;
    i32[w] = rawAt(prevRaw, 0);
    i32[w + 1] = rawAt(prevRaw, 1);
    i32[w + 2] = rawAt(prevRaw, 2);
    i32[w + 3] = rawAt(curRaw, 0);
    i32[w + 4] = rawAt(curRaw, 1);
    i32[w + 5] = rawAt(curRaw, 2);
    const h = (slot * TRAIL_STRIDE) >> 1;
    const u16 = ib.u16;
    const hd = style.head;
    const tl = style.tail;
    writeHalf4(u16, h + (TRAIL_OFF_HEAD >> 1), hd[0], hd[1], hd[2], hd[3]);
    writeHalf4(u16, h + (TRAIL_OFF_TAIL >> 1), tl[0], tl[1], tl[2], tl[3]);
    writeHalf4(u16, h + (TRAIL_OFF_DIMS >> 1), style.lengthWu * clamp01(lengthScale), style.widthWu, clamp01(style.blend ?? 0), 0);
    return true;
  }

  /** Uploads and draws all trails of this frame in one draw. Returns the draw count. */
  encode(enc: PassEncoder): number {
    const n = this.count;
    this.stats.trails = n;
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.instances.destroy();
    this.dev.destroyBindGroup(this.group);
    this.dev.destroyPipeline(this.pipeline);
  }
}
