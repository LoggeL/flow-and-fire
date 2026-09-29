/**
 * GPU height probe (M1 acceptance "Höhen auf CPU und GPU in 10.000 Stichproben identisch"): draws N
 * points (POINTS, one pixel each) into an R32I render target; the VS evaluates the very same
 * {@link TERRAIN_HEIGHT_GLSL} function as the terrain, the FS writes the integer result, and the
 * target is read back synchronously. Tests/debug only – the readback stalls the GPU.
 */
import type { BindGroupH, BufH, GpuDevice, PipeH, TexH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import { TERRAIN_HEIGHT_GLSL, SLOT_TERRAIN_HEIGHT, UNIT_HEIGHTMAP } from '../terrain/glsl.ts';
import type { TerrainHeightResources } from './terrain.ts';

/** Probe target: 256 × 64 texels = points per batch. */
export const PROBE_WIDTH = 256;
export const PROBE_HEIGHT = 64;
export const PROBE_BATCH = PROBE_WIDTH * PROBE_HEIGHT;

const PROBE_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${TERRAIN_HEIGHT_GLSL}
layout(location = 0) in ivec2 a_xz; // Q20.12 raw
flat out int v_height;
void main() {
  int i = gl_VertexID;
  vec2 px = vec2(float(i % ${PROBE_WIDTH}) + 0.5, float(i / ${PROBE_WIDTH}) + 0.5);
  gl_Position = vec4(px / vec2(${PROBE_WIDTH}.0, ${PROBE_HEIGHT}.0) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  v_height = terrainHeightRaw(a_xz);
}
`;

const PROBE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
flat in int v_height;
layout(location = 0) out int o_height;
void main() {
  o_height = v_height;
}
`;

export class HeightProbe {
  readonly pipeline: PipeH;
  readonly target: TexH;
  private readonly points: BufH;
  private readonly streams: VertexStreamBinding[];
  private readonly readback = new Int32Array(PROBE_BATCH);
  /** Points probed in total (diagnostics). */
  probed = 0;

  constructor(
    private readonly dev: GpuDevice,
    private readonly heights: TerrainHeightResources,
  ) {
    this.pipeline = dev.createPipeline({
      label: 'terrain-probe',
      vertex: PROBE_VS,
      fragment: PROBE_FS,
      streams: [{ stepMode: 'vertex', stride: 8, attributes: [{ location: 0, format: vf('i32', 2, 'int'), offset: 0 }] }],
      uniformBlocks: [{ name: 'TerrainHeight', slot: SLOT_TERRAIN_HEIGHT }],
      samplers: [{ name: 'u_heightmap', unit: UNIT_HEIGHTMAP }],
      primitive: 'points',
      cullMode: 'none',
      depthTest: false,
      depthWrite: false,
      blend: 'none',
    });
    this.target = dev.createTexture({ label: 'terrain-probe.target', width: PROBE_WIDTH, height: PROBE_HEIGHT, format: 'r32i' });
    this.points = dev.createBuffer({ label: 'terrain-probe.points', usage: 'vertex', size: PROBE_BATCH * 8, dynamic: true });
    this.streams = [{ buffer: this.points, offset: 0 }];
  }

  /**
   * Heights (raw) at the points `xzRaw = [x0, z0, x1, z1, …]` into `out` (one value per point).
   * Throws while the context is lost.
   */
  probe(xzRaw: Int32Array, out: Int32Array): void {
    const n = xzRaw.length >> 1;
    if (out.length < n) throw new Error(`probeHeights: out holds ${out.length} values, need ${n}`);
    const dev = this.dev;
    if (dev.isLost()) throw new Error('probeHeights: context lost');
    const group: BindGroupH = this.heights.group;
    for (let first = 0; first < n; first += PROBE_BATCH) {
      const count = Math.min(PROBE_BATCH, n - first);
      dev.writeBuffer(this.points, 0, xzRaw, first * 2, count * 2);
      const enc = dev.beginPass({ label: 'terrain-probe', colorAttachments: [{ texture: this.target }], clearColor: [0, 0, 0, 0] });
      enc.setPipeline(this.pipeline);
      enc.setBindGroup(group);
      enc.setVertexStreams(this.streams);
      enc.drawInstanced(count, 1);
      enc.end();
      const rows = Math.ceil(count / PROBE_WIDTH);
      dev.readTexture(this.target, { x: 0, y: 0, width: PROBE_WIDTH, height: rows }, this.readback);
      for (let i = 0; i < count; i++) out[first + i] = this.readback[i]!;
      this.probed += count;
    }
  }

  dispose(): void {
    this.dev.destroyBuffer(this.points);
    this.dev.destroyTexture(this.target);
    this.dev.destroyPipeline(this.pipeline);
  }
}
