/**
 * GroundPass: fixed test plane at y = 0 (MS1 stand-in for the CDLOD terrain).
 *
 * The quad corners are integer raw coordinates; the VS subtracts `camPosInt` in integers, so the
 * plane is camera-relative precise anywhere on the map. The FS draws a procedural grid with 1, 8
 * and 32 WU spacing. Grid coordinates are `rel + (camPosInt mod 32 WU)`, which stays small and
 * therefore precise even at 2^26 raw.
 */
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import { Std140Writer, std140Layout } from '../std140.ts';
import { FRAME_BLOCK_GLSL, SLOT_FRAME, SLOT_PASS } from './shared.ts';

export interface GroundOptions {
  /** Plane extent in WU (x, z); default 512 × 512. */
  readonly sizeWU?: readonly [number, number];
  /** Minimum corner in WU; default (0, 0). */
  readonly originWU?: readonly [number, number];
  /** Plane height in WU; default 0. */
  readonly heightWU?: number;
  readonly baseColor?: readonly [number, number, number];
  readonly lineColor?: readonly [number, number, number];
}

const GROUND_LAYOUT = std140Layout([
  { name: 'min', type: 'ivec4' },
  { name: 'max', type: 'ivec4' },
  { name: 'base', type: 'vec4' },
  { name: 'line', type: 'vec4' },
]);

const GROUND_BLOCK = /* glsl */ `
layout(std140) uniform Ground {
  ivec4 u_min;   // raw
  ivec4 u_max;   // raw
  vec4 u_base;
  vec4 u_line;
};
`;

const GROUND_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${GROUND_BLOCK}
layout(location = 0) in uvec2 a_corner; // (0|1, 0|1): selects min/max per axis
out vec3 v_rel;
out vec3 v_grid;
out vec2 v_edge;

void main() {
  int cx = int(a_corner.x);
  int cz = int(a_corner.y);
  ivec3 p = ivec3(cx == 1 ? u_max.x : u_min.x, u_min.y, cz == 1 ? u_max.z : u_min.z);
  vec3 rel = vec3(p - u_camPosInt.xyz) / 4096.0;
  v_rel = rel - u_camFrac.xyz;
  v_grid = rel + u_camMod.xyz;
  v_edge = vec2(float(cx), float(cz)) * vec2(u_max.xz - u_min.xz) / 4096.0;
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;

const GROUND_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${GROUND_BLOCK}
in vec3 v_rel;
in vec3 v_grid;
in vec2 v_edge;
out vec4 o_color;

// Anti-aliased grid line intensity for a cell size; fades out once lines get denser than ~3 px.
float gridLine(vec2 p, float cell, float widthPx) {
  vec2 q = p / cell;
  vec2 fw = max(fwidth(q), vec2(1e-6));
  vec2 g = abs(fract(q - 0.5) - 0.5) / fw;
  float line = 1.0 - clamp(min(g.x, g.y) / widthPx, 0.0, 1.0);
  float density = max(fw.x, fw.y);
  return line * (1.0 - smoothstep(0.15, 0.35, density));
}

void main() {
  vec2 p = v_grid.xz;
  float l1 = gridLine(p, 1.0, 1.0) * 0.25;
  float l8 = gridLine(p, 8.0, 1.2) * 0.5;
  float l32 = gridLine(p, 32.0, 1.6) * 0.9;
  float line = max(l1, max(l8, l32));
  // Plane border.
  vec2 size = vec2(u_max.xz - u_min.xz) / 4096.0;
  vec2 fwE = max(fwidth(v_edge), vec2(1e-6));
  vec2 de = min(v_edge, size - v_edge) / fwE;
  float border = 1.0 - clamp(min(de.x, de.y) / 2.5, 0.0, 1.0);

  vec3 n = vec3(0.0, 1.0, 0.0);
  float ndl = max(dot(n, u_sunDir.xyz), 0.0);
  vec3 lit = u_base.rgb * (u_skyColor.rgb * 0.55 + u_sunColor.rgb * ndl * 0.6);
  vec3 color = mix(lit, u_line.rgb, line * u_line.a);
  color = mix(color, vec3(0.95, 0.85, 0.3), border);
  float dist = length(v_rel);
  float fog = clamp((dist - u_fog.w) / max(u_fog.w, 1.0), 0.0, 0.85);
  o_color = vec4(mix(color, u_fog.rgb, fog), 1.0);
}
`;

/**
 * Corner codes of the two triangles (0,0) (1,0) (1,1) / (0,0) (1,1) (0,1), u8×2 padded to 4 bytes.
 * A real vertex stream on location 0 (instead of gl_VertexID only) avoids the attribute-0
 * emulation path of Firefox on desktop GL/macOS.
 */
const CORNERS = Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0);

export class GroundPass {
  readonly pipeline: PipeH;
  private readonly corners: BufH;
  private readonly streams: VertexStreamBinding[];
  private readonly ubo: BufH;
  private readonly group: BindGroupH;
  private readonly data = new Std140Writer(GROUND_LAYOUT);
  /** Plane bounds in raw units: [minX, y, minZ, maxX, maxZ]. */
  readonly boundsRaw = new Int32Array(5);

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    opts: GroundOptions = {},
  ) {
    this.pipeline = dev.createPipeline({
      label: 'ground',
      vertex: GROUND_VS,
      fragment: GROUND_FS,
      streams: [
        { stepMode: 'vertex', stride: 4, attributes: [{ location: 0, format: vf('u8', 2, 'int'), offset: 0 }] },
      ],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'Ground', slot: SLOT_PASS },
      ],
      cullMode: 'none',
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less',
    });
    this.corners = dev.createBuffer({
      label: 'ground.corners',
      usage: 'vertex',
      size: CORNERS.byteLength,
      restore: (h) => dev.writeBuffer(h, 0, CORNERS),
    });
    dev.writeBuffer(this.corners, 0, CORNERS);
    this.streams = [{ buffer: this.corners, offset: 0 }];
    this.ubo = dev.createBuffer({
      label: 'ground.ubo',
      usage: 'uniform',
      size: GROUND_LAYOUT.size,
      restore: (h) => dev.writeBuffer(h, 0, this.data.bytes),
    });
    this.group = dev.createBindGroup({ label: 'ground', buffers: [{ slot: SLOT_PASS, buffer: this.ubo }] });
    this.configure(opts);
  }

  configure(opts: GroundOptions): void {
    const [sx, sz] = opts.sizeWU ?? [512, 512];
    const [ox, oz] = opts.originWU ?? [0, 0];
    const y = opts.heightWU ?? 0;
    const minX = Math.round(ox * 4096);
    const minZ = Math.round(oz * 4096);
    const maxX = Math.round((ox + sx) * 4096);
    const maxZ = Math.round((oz + sz) * 4096);
    const yRaw = Math.round(y * 4096);
    this.boundsRaw.set([minX, yRaw, minZ, maxX, maxZ]);
    const base = opts.baseColor ?? [0.3, 0.36, 0.3];
    const line = opts.lineColor ?? [0.78, 0.86, 0.8];
    const w = this.data;
    w.ivec4(GROUND_LAYOUT.offsetOf('min'), minX, yRaw, minZ, 0);
    w.ivec4(GROUND_LAYOUT.offsetOf('max'), maxX, yRaw, maxZ, 0);
    w.vec4(GROUND_LAYOUT.offsetOf('base'), base[0], base[1], base[2], 1);
    w.vec4(GROUND_LAYOUT.offsetOf('line'), line[0], line[1], line[2], 0.8);
    this.dev.writeBuffer(this.ubo, 0, w.bytes);
  }

  draw(enc: PassEncoder): void {
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.group);
    enc.setVertexStreams(this.streams);
    enc.drawInstanced(6, 1);
  }

  dispose(): void {
    this.dev.destroyBindGroup(this.group);
    this.dev.destroyBuffer(this.ubo);
    this.dev.destroyBuffer(this.corners);
    this.dev.destroyPipeline(this.pipeline);
  }
}
