/**
 * OverlayPass: client-side immediate feedback (PLAN §3.6 "Latenz"): click markers (expanding ring at
 * a world position with a start time) and waypoint lines (segments). Each kind is one instanced
 * draw. Instance data live in small 3-region rings that grow on demand.
 */
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import { FRAME_BLOCK_GLSL, SLOT_FRAME } from './shared.ts';

export interface OverlayMarker {
  /** World position (raw Q20.12). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Start time in the same clock as `RenderView.timeMs`. */
  readonly startMs: number;
  /** 0xRRGGBB, default green. */
  readonly color?: number;
  /** Final ring radius in WU, default 1.5. */
  readonly radiusWU?: number;
  /** Lifetime in ms, default 700. */
  readonly durationMs?: number;
}

export interface OverlaySegment {
  /** Start and end (raw Q20.12). */
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  /** 0xRRGGBB, default green. */
  readonly color?: number;
  /** Line width in WU, default 0.18. */
  readonly widthWU?: number;
}

export interface Overlays {
  readonly markers: readonly OverlayMarker[];
  readonly lines: readonly OverlaySegment[];
}

export const MARKER_STRIDE = 24; // pos i32×3 | t f32 | radius f32 | color unorm8×4
export const SEGMENT_STRIDE = 32; // a i32×3 | b i32×3 | color unorm8×4 | width f32
const RING_REGIONS = 3;
const DEFAULT_COLOR = 0x40ff60;
const LIFT = '0.03'; // WU above the ground against z-fighting

const MARKER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
layout(location = 0) in ivec3 a_pos;
layout(location = 1) in vec2 a_params;  // t (0..1), radius WU
layout(location = 2) in vec4 a_color;
out vec2 v_q;
out float v_t;
out vec4 v_color;
void main() {
  int id = gl_VertexID;
  vec2 q = vec2((id == 1 || id == 2 || id == 4) ? 1.0 : -1.0, (id == 2 || id == 4 || id == 5) ? 1.0 : -1.0);
  vec3 rel = vec3(a_pos - u_camPosInt.xyz) / 4096.0;
  float r = a_params.y;
  vec3 world = rel + vec3(q.x * r, ${LIFT}, q.y * r);
  v_q = q;
  v_t = a_params.x;
  v_color = a_color;
  gl_Position = u_viewProj * vec4(world, 1.0);
}
`;

const MARKER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_q;
in float v_t;
in vec4 v_color;
out vec4 o_color;
void main() {
  float d = length(v_q);
  float ringR = mix(0.2, 0.92, sqrt(v_t));
  float fw = max(fwidth(d), 1e-4);
  float ring = 1.0 - smoothstep(0.06, 0.06 + fw * 1.5, abs(d - ringR));
  float dot0 = (1.0 - smoothstep(0.1, 0.1 + fw, d)) * (1.0 - v_t);
  float a = max(ring, dot0) * (1.0 - v_t * v_t);
  if (a <= 0.003) discard;
  o_color = vec4(v_color.rgb, a * v_color.a);
}
`;

const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
layout(location = 0) in ivec3 a_a;
layout(location = 1) in ivec3 a_b;
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_width;
out float v_along;
out float v_side;
out vec4 v_color;
void main() {
  int id = gl_VertexID;
  float end = (id == 1 || id == 2 || id == 4) ? 1.0 : 0.0;
  float side = (id == 2 || id == 4 || id == 5) ? 1.0 : -1.0;
  vec3 ra = vec3(a_a - u_camPosInt.xyz) / 4096.0;
  vec3 rb = vec3(a_b - u_camPosInt.xyz) / 4096.0;
  vec2 d = rb.xz - ra.xz;
  float len = length(d);
  vec2 dir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec3 world = mix(ra, rb, end) + vec3(perp.x, 0.0, perp.y) * side * a_width * 0.5 + vec3(0.0, ${LIFT}, 0.0);
  v_along = end * len;
  v_side = side;
  v_color = a_color;
  gl_Position = u_viewProj * vec4(world, 1.0);
}
`;

const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
in float v_along;
in float v_side;
in vec4 v_color;
out vec4 o_color;
void main() {
  // Dashes crawl towards the segment end (0.8 WU period).
  float dash = fract((v_along - u_camMod.w * 1.6) / 0.8);
  float on = 0.45 + 0.55 * step(dash, 0.6);
  float fw = max(fwidth(v_side), 1e-4);
  float edge = 1.0 - smoothstep(1.0 - fw * 1.5, 1.0, abs(v_side));
  o_color = vec4(v_color.rgb, v_color.a * on * edge * 0.9);
}
`;

class InstanceRing {
  buf: BufH | null = null;
  capacity = 0;
  region = 0;
  staging = new ArrayBuffer(0);
  i32 = new Int32Array(0);
  f32 = new Float32Array(0);
  u8 = new Uint8Array(0);

  constructor(
    private readonly dev: GpuDevice,
    private readonly stride: number,
    private readonly label: string,
  ) {}

  ensure(n: number): void {
    if (n <= this.capacity && this.buf !== null) return;
    let cap = Math.max(32, this.capacity);
    while (cap < n) cap *= 2;
    if (this.buf !== null) this.dev.destroyBuffer(this.buf);
    this.buf = this.dev.createBuffer({ label: this.label, usage: 'vertex', size: cap * this.stride * RING_REGIONS, dynamic: true });
    this.staging = new ArrayBuffer(cap * this.stride);
    this.i32 = new Int32Array(this.staging);
    this.f32 = new Float32Array(this.staging);
    this.u8 = new Uint8Array(this.staging);
    this.capacity = cap;
  }

  /** Uploads `n` staged instances into the next region; returns its byte offset. */
  upload(n: number): number {
    this.region = (this.region + 1) % RING_REGIONS;
    const off = this.region * this.capacity * this.stride;
    if (n > 0) this.dev.writeBuffer(this.buf!, off, this.u8, 0, n * this.stride);
    return off;
  }

  dispose(): void {
    if (this.buf !== null) this.dev.destroyBuffer(this.buf);
    this.buf = null;
  }
}

function packColor(u8: Uint8Array, at: number, rgb: number, alpha: number): void {
  u8[at] = (rgb >> 16) & 255;
  u8[at + 1] = (rgb >> 8) & 255;
  u8[at + 2] = rgb & 255;
  u8[at + 3] = alpha;
}

export class OverlayPass {
  readonly markerPipeline: PipeH;
  readonly linePipeline: PipeH;
  private readonly markers: InstanceRing;
  private readonly lines: InstanceRing;
  private markerCount = 0;
  private lineCount = 0;
  private markerOffset = 0;
  private lineOffset = 0;
  private readonly stream: VertexStreamBinding[] = [{ buffer: 0 as BufH, offset: 0 }];

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
  ) {
    const common = {
      uniformBlocks: [{ name: 'Frame', slot: SLOT_FRAME }],
      cullMode: 'none',
      depthTest: true,
      depthWrite: false,
      depthCompare: 'lequal',
      blend: 'alpha',
    } as const;
    this.markerPipeline = dev.createPipeline({
      label: 'overlay-markers',
      vertex: MARKER_VS,
      fragment: MARKER_FS,
      streams: [
        {
          stepMode: 'instance',
          stride: MARKER_STRIDE,
          attributes: [
            { location: 0, format: vf('i32', 3, 'int'), offset: 0 },
            { location: 1, format: vf('f32', 2, 'float'), offset: 12 },
            { location: 2, format: vf('u8', 4, 'norm'), offset: 20 },
          ],
        },
      ],
      ...common,
    });
    this.linePipeline = dev.createPipeline({
      label: 'overlay-lines',
      vertex: LINE_VS,
      fragment: LINE_FS,
      streams: [
        {
          stepMode: 'instance',
          stride: SEGMENT_STRIDE,
          attributes: [
            { location: 0, format: vf('i32', 3, 'int'), offset: 0 },
            { location: 1, format: vf('i32', 3, 'int'), offset: 12 },
            { location: 2, format: vf('u8', 4, 'norm'), offset: 24 },
            { location: 3, format: vf('f32', 1, 'float'), offset: 28 },
          ],
        },
      ],
      ...common,
    });
    this.markers = new InstanceRing(dev, MARKER_STRIDE, 'overlay-markers.ring');
    this.lines = new InstanceRing(dev, SEGMENT_STRIDE, 'overlay-lines.ring');
  }

  /** Stages and uploads this frame's overlays. Expired markers are skipped. */
  prepare(overlays: Overlays, timeMs: number): void {
    const ms = overlays.markers;
    this.markers.ensure(ms.length);
    const r = this.markers;
    let n = 0;
    for (const m of ms) {
      const dur = m.durationMs ?? 700;
      const age = timeMs - m.startMs;
      if (age < 0 || age >= dur) continue;
      const w = (n * MARKER_STRIDE) >> 2;
      r.i32[w] = m.x;
      r.i32[w + 1] = m.y;
      r.i32[w + 2] = m.z;
      r.f32[w + 3] = age / dur;
      r.f32[w + 4] = m.radiusWU ?? 1.5;
      packColor(r.u8, n * MARKER_STRIDE + 20, m.color ?? DEFAULT_COLOR, 255);
      n++;
    }
    this.markerCount = n;
    this.markerOffset = r.upload(n);

    const ls = overlays.lines;
    this.lines.ensure(ls.length);
    const l = this.lines;
    for (let i = 0; i < ls.length; i++) {
      const s = ls[i]!;
      const w = (i * SEGMENT_STRIDE) >> 2;
      l.i32[w] = s.ax;
      l.i32[w + 1] = s.ay;
      l.i32[w + 2] = s.az;
      l.i32[w + 3] = s.bx;
      l.i32[w + 4] = s.by;
      l.i32[w + 5] = s.bz;
      packColor(l.u8, i * SEGMENT_STRIDE + 24, s.color ?? DEFAULT_COLOR, 230);
      l.f32[w + 7] = s.widthWU ?? 0.18;
    }
    this.lineCount = ls.length;
    this.lineOffset = l.upload(ls.length);
  }

  /** Draws lines, then markers (each one instanced draw, skipped when empty). */
  draw(enc: PassEncoder): void {
    const s = this.stream[0]!;
    if (this.lineCount > 0) {
      enc.setPipeline(this.linePipeline);
      enc.setBindGroup(this.frameGroup);
      s.buffer = this.lines.buf!;
      s.offset = this.lineOffset;
      enc.setVertexStreams(this.stream);
      enc.drawInstanced(6, this.lineCount);
    }
    if (this.markerCount > 0) {
      enc.setPipeline(this.markerPipeline);
      enc.setBindGroup(this.frameGroup);
      s.buffer = this.markers.buf!;
      s.offset = this.markerOffset;
      enc.setVertexStreams(this.stream);
      enc.drawInstanced(6, this.markerCount);
    }
  }

  /** Visible markers / lines of the last `prepare`. */
  counts(): { markers: number; lines: number } {
    return { markers: this.markerCount, lines: this.lineCount };
  }

  dispose(): void {
    this.markers.dispose();
    this.lines.dispose();
    this.dev.destroyPipeline(this.markerPipeline);
    this.dev.destroyPipeline(this.linePipeline);
  }
}
