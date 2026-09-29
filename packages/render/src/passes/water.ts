/**
 * WaterPass (M2, PLAN §3.7 "Wasser"): one flat quad at the water level over the map plus a border.
 *
 * FS: depth = waterLevel − terrainHeightRaw (the same GLSL function as terrain and sim) → color and
 * alpha by depth (shallow turquoise/transparent → deep dark/opaque), scrolling procedural normals
 * (analytic sum of directional waves whose wave vectors are integer multiples of 2π/32 WU, so they
 * are evaluated exactly on `world mod 32 WU`), shore foam below ≈ 0.3 WU depth, Fresnel sky
 * reflection and a sun highlight. Dry fragments are discarded.
 *
 * Pass order Terrain → Units → Water → Overlay; depth test on, no depth write, alpha blending.
 * No water (`waterLevelRaw === null`) ⇒ the renderer does not create this pass.
 */
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import { Std140Writer, std140Layout } from '../std140.ts';
import { SLOT_TERRAIN_HEIGHT, TERRAIN_HEIGHT_GLSL, UNIT_HEIGHTMAP } from '../terrain/glsl.ts';
import type { WaterQuality } from '../presets.ts';
import { FRAME_BLOCK_GLSL, SLOT_FRAME, SLOT_PASS } from './shared.ts';
import type { TerrainHeightResources } from './terrain.ts';

/**
 * Water extends this far beyond the map edges (WU): a thin margin that closes the seam at the map
 * border. Beyond the map the terrain is clamped to the edge samples, so a wider plane would only
 * extend edge rivers into the void.
 */
export const WATER_BORDER_WU = 2;
/** Foam below this depth (WU). */
export const WATER_FOAM_DEPTH_WU = 0.3;

const WATER_LAYOUT = std140Layout([
  { name: 'min', type: 'ivec4' },
  { name: 'max', type: 'ivec4' },
  { name: 'shallow', type: 'vec4' },
  { name: 'deep', type: 'vec4' },
  { name: 'params', type: 'vec4' },
]);

const WATER_BLOCK = /* glsl */ `
layout(std140) uniform Water {
  ivec4 u_wMin;     // x, water level, z (raw)
  ivec4 u_wMax;     // x, water level, z (raw)
  vec4 u_shallow;   // rgb, alpha at zero depth
  vec4 u_deep;      // rgb, alpha when deep
  vec4 u_wparams;   // x: depth (WU) of full deep color, y: foam depth (WU), z: wave count, w: wave strength
};
`;

const WATER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${WATER_BLOCK}
layout(location = 0) in uvec2 a_corner;
out vec3 v_pos;  // world - camPosInt (WU)
out vec2 v_grid; // world mod 32 WU (continuous, see Frame.camMod)
void main() {
  ivec3 p = ivec3(a_corner.x == 1u ? u_wMax.x : u_wMin.x, u_wMin.y, a_corner.y == 1u ? u_wMax.z : u_wMin.z);
  vec3 rel = vec3(p - u_camPosInt.xyz) / 4096.0;
  v_pos = rel;
  v_grid = rel.xz + u_camMod.xz;
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;

const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${TERRAIN_HEIGHT_GLSL}
${WATER_BLOCK}
in vec3 v_pos;
in vec2 v_grid;
out vec4 o_color;

const float TAU = 6.283185307179586;
// Integer wave vectors (cycles per 32 WU) → exact periodicity on world mod 32 WU.
const ivec2 WAVES[6] = ivec2[6](ivec2(3, 1), ivec2(-2, 5), ivec2(7, -4), ivec2(-9, -6), ivec2(13, 11), ivec2(-17, 8));
const float SPEED[6] = float[6](0.55, 0.43, 0.81, 0.67, 1.13, 1.37);

void main() {
  ivec2 xzRaw = ivec2(floor(v_pos.xz * 4096.0 + 0.5)) + u_camPosInt.xz;
  int h = terrainHeightRaw(xzRaw);
  float depth = float(u_wMin.y - h) / 4096.0;
  if (depth <= 0.0) discard;

  // Scrolling analytic wave normals.
  float t = u_camMod.w;
  vec2 grad = vec2(0.0);
  int waves = int(u_wparams.z);
  for (int i = 0; i < 6; ++i) {
    if (i >= waves) break;
    vec2 k = vec2(WAVES[i]) * (TAU / 32.0);
    float amp = u_wparams.w / (1.0 + float(i) * 0.9);
    grad += k * amp * cos(dot(k, v_grid) - t * SPEED[i] * 2.0);
  }
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

  float f = clamp(depth / u_wparams.x, 0.0, 1.0);
  f = sqrt(f);
  vec3 base = mix(u_shallow.rgb, u_deep.rgb, f);
  float alpha = mix(u_shallow.a, u_deep.a, f);

  vec3 toEye = normalize(u_camFrac.xyz - v_pos);
  float ndv = max(dot(n, toEye), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 sky = mix(u_fog.rgb, u_skyColor.rgb * 1.35, 0.5);
  float ndl = max(dot(n, u_sunDir.xyz), 0.0);
  vec3 color = base * (0.35 + 0.65 * (u_skyColor.rgb + u_sunColor.rgb * ndl));
  color = mix(color, sky, fresnel * 0.8);
  vec3 refl = reflect(-toEye, n);
  color += u_sunColor.rgb * pow(max(dot(refl, u_sunDir.xyz), 0.0), 96.0) * 0.8;
  alpha = max(alpha, fresnel * 0.7);

  // Shore foam in very shallow water, broken up by the waves.
  float foamZone = 1.0 - smoothstep(0.0, u_wparams.y, depth);
  float streak = 0.6 + 0.4 * sin(dot(v_grid, vec2(TAU * 5.0 / 32.0, TAU * 3.0 / 32.0)) + t * 1.7 + grad.x * 3.0);
  float foam = foamZone * streak;
  color = mix(color, vec3(0.92, 0.96, 0.98), foam * 0.85);
  alpha = max(alpha, foam * 0.9);
  // Soft waterline.
  alpha *= smoothstep(0.0, 0.04, depth);

  float dist = length(v_pos - u_camFrac.xyz);
  float fog = clamp((dist - u_fog.w) / max(u_fog.w, 1.0), 0.0, 0.85);
  o_color = vec4(mix(color, u_fog.rgb, fog), alpha);
}
`;

/** Two triangles over the (0|1, 0|1) corners, u8×2 padded to 4 bytes (like the ground pass). */
const CORNERS = Uint8Array.of(0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0);

const WAVES_BY_QUALITY: { readonly [K in WaterQuality]: number } = { low: 2, medium: 4, high: 6 };

export class WaterPass {
  readonly pipeline: PipeH;
  private readonly corners: BufH;
  private readonly ubo: BufH;
  private readonly group: BindGroupH;
  private readonly streams: VertexStreamBinding[];
  private readonly data = new Std140Writer(WATER_LAYOUT);

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    private readonly heights: TerrainHeightResources,
    quality: WaterQuality = 'medium',
  ) {
    const level = heights.desc.waterLevelRaw;
    if (level === null) throw new Error('WaterPass: terrain has no water level');
    this.pipeline = dev.createPipeline({
      label: 'water',
      vertex: WATER_VS,
      fragment: WATER_FS,
      streams: [{ stepMode: 'vertex', stride: 4, attributes: [{ location: 0, format: vf('u8', 2, 'int'), offset: 0 }] }],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'TerrainHeight', slot: SLOT_TERRAIN_HEIGHT },
        { name: 'Water', slot: SLOT_PASS },
      ],
      samplers: [{ name: 'u_heightmap', unit: UNIT_HEIGHTMAP }],
      cullMode: 'none',
      depthTest: true,
      depthWrite: false,
      depthCompare: 'less',
      blend: 'alpha',
    });
    this.corners = dev.createBuffer({
      label: 'water.corners',
      usage: 'vertex',
      size: CORNERS.byteLength,
      restore: (h) => dev.writeBuffer(h, 0, CORNERS),
    });
    dev.writeBuffer(this.corners, 0, CORNERS);
    this.streams = [{ buffer: this.corners, offset: 0 }];

    const size = heights.desc.sizeWu * 4096;
    const border = WATER_BORDER_WU * 4096;
    const w = this.data;
    w.ivec4(WATER_LAYOUT.offsetOf('min'), -border, level, -border, 0);
    w.ivec4(WATER_LAYOUT.offsetOf('max'), size + border, level, size + border, 0);
    w.vec4(WATER_LAYOUT.offsetOf('shallow'), 0.22, 0.62, 0.6, 0.22);
    w.vec4(WATER_LAYOUT.offsetOf('deep'), 0.02, 0.09, 0.16, 0.93);
    this.ubo = dev.createBuffer({
      label: 'water.ubo',
      usage: 'uniform',
      size: WATER_LAYOUT.size,
      restore: (h) => dev.writeBuffer(h, 0, this.data.bytes),
    });
    this.group = dev.createBindGroup({ label: 'water', buffers: [{ slot: SLOT_PASS, buffer: this.ubo }] });
    this.setQuality(quality);
  }

  setQuality(q: WaterQuality): void {
    this.data.vec4(WATER_LAYOUT.offsetOf('params'), 5, WATER_FOAM_DEPTH_WU, WAVES_BY_QUALITY[q], 0.035);
    this.dev.writeBuffer(this.ubo, 0, this.data.bytes);
  }

  draw(enc: PassEncoder): void {
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.heights.group);
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
