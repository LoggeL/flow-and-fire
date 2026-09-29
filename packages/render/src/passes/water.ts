/**
 * WaterPass (M2, PLAN §3.7 "Wasser"): one flat quad at the water level over the map plus a border.
 *
 * FS: depth = waterLevel − terrainHeightRaw (the same GLSL function as terrain and sim) → color and
 * alpha by depth in three stops (turquoise shelf → blue → deep blue from 55 % of the map's deepest
 * point on, ≈ 15.6 WU on Setons), mottled multiplicatively with a slight petrol tint, scrolling
 * procedural normals (analytic sum of 6 directional waves with irregular
 * directions and incommensurate wavelengths on the world position, so the field never repeats;
 * every wave fades out once a pixel covers more than ≈ 1/8 of its wavelength, patchy gusts and a
 * calmer far field from ≈ 200 WU on – no moiré or stripe field at a distance), shore foam below
 * ≈ 0.3 WU depth broken up by drifting noise, Fresnel sky reflection, a soft sun highlight and a
 * broad weak sheen. Dry fragments
 * are discarded; the surface ends exactly at the map edge and darkens towards it like the terrain.
 *
 * Pass order Terrain → Units → Water → Overlay; depth test on, no depth write, alpha blending.
 * No water (`waterLevelRaw === null`) ⇒ the renderer does not create this pass.
 */
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import { Std140Writer, std140Layout } from '../std140.ts';
import { NOISE_GLSL, SLOT_TERRAIN_HEIGHT, TERRAIN_HEIGHT_GLSL, UNIT_HEIGHTMAP } from '../terrain/glsl.ts';
import type { WaterQuality } from '../presets.ts';
import { FRAME_BLOCK_GLSL, SLOT_FRAME, SLOT_PASS } from './shared.ts';
import { TERRAIN_EDGE_DARKEN, TERRAIN_EDGE_FADE_WU, type TerrainHeightResources } from './terrain.ts';

/**
 * Water extends this far beyond the map edges (WU). 0: the surface ends exactly at the map edge
 * (a margin showed as a vertical water lip over the void beside edge lakes, Setons review P2-7).
 */
export const WATER_BORDER_WU = 0;
/** Deepest water on a map that still gets its own full deep color (WU). */
export const WATER_FULL_DEPTH_MAX_WU = 16;
/** Foam below this depth (WU). */
export const WATER_FOAM_DEPTH_WU = 0.3;

const WATER_LAYOUT = std140Layout([
  { name: 'min', type: 'ivec4' },
  { name: 'max', type: 'ivec4' },
  { name: 'shallow', type: 'vec4' },
  { name: 'mid', type: 'vec4' },
  { name: 'deep', type: 'vec4' },
  { name: 'params', type: 'vec4' },
  { name: 'map', type: 'vec4' },
]);

const WATER_BLOCK = /* glsl */ `
layout(std140) uniform Water {
  ivec4 u_wMin;     // x, water level, z (raw)
  ivec4 u_wMax;     // x, water level, z (raw)
  vec4 u_shallow;   // rgb, alpha at zero depth
  vec4 u_mid;       // rgb, alpha from half the full depth on
  vec4 u_deep;      // rgb, alpha when deep
  vec4 u_wparams;   // x: depth (WU) of full deep color, y: foam depth (WU), z: wave count, w: wave strength
  vec4 u_wmap;      // x: map size (WU)
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

/** Direction (degrees) and wavelength (WU) of the 6 waves, longest first. */
const WAVE_SPECS: readonly (readonly [number, number])[] = [
  [23, 12.7],
  [137, 8.3],
  [251, 5.9],
  [71, 4.1],
  [199, 2.9],
  [313, 2.1],
];
/** GLSL `vec2(...)` list of the wave vectors (rad per WU). */
const WAVE_VECTORS = WAVE_SPECS.map(([deg, lambda]) => {
  const k = (2 * Math.PI) / lambda;
  const a = (deg * Math.PI) / 180;
  return `vec2(${(k * Math.cos(a)).toFixed(6)}, ${(k * Math.sin(a)).toFixed(6)})`;
}).join(', ');

const WATER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${TERRAIN_HEIGHT_GLSL}
${NOISE_GLSL}
${WATER_BLOCK}
in vec3 v_pos;
in vec2 v_grid;
out vec4 o_color;

const float TAU = 6.283185307179586;
// Wave vectors (rad per WU) with irregular directions and incommensurate wavelengths, evaluated on
// the world position: the wave field never repeats (a common 32-WU period showed as a regular
// diagonal grid at a distance). Float phases stay exact enough (≤ 4,096 WU · 3 rad/WU).
const vec2 WAVES[6] = vec2[6](${WAVE_VECTORS});
const float SPEED[6] = float[6](0.55, 0.47, 0.79, 0.71, 1.03, 1.21);

void main() {
  ivec2 xzRaw = ivec2(floor(v_pos.xz * 4096.0 + 0.5)) + u_camPosInt.xz;
  int h = terrainHeightRaw(xzRaw);
  float depth = float(u_wMin.y - h) / 4096.0;
  if (depth <= 0.0) discard;
  vec2 world = v_pos.xz + vec2(u_camPosInt.xz) / 4096.0;

  // Scrolling analytic wave normals, each wave faded out before it aliases: footprint of one pixel
  // (WU) against the wavelength (32 / |k| WU).
  float t = u_camMod.w;
  float px = max(length(fwidth(v_grid)), 1e-4);
  float camDist = length(v_pos - u_camFrac.xyz);
  // Patchy wind (no uniform stripe field) and a calmer surface far away.
  float gust = (0.55 + 0.45 * terrainValueNoise(world / 70.0 + vec2(t * 0.03, 0.0))) * (1.0 - 0.6 * smoothstep(200.0, 600.0, camDist));
  vec2 grad = vec2(0.0);
  float detail = 0.0;
  int waves = int(u_wparams.z);
  for (int i = 0; i < 6; ++i) {
    if (i >= waves) break;
    vec2 k = WAVES[i];
    float lambda = TAU / length(k);
    float keep = 1.0 - smoothstep(0.06, 0.18, px / lambda);
    float amp = u_wparams.w * (lambda / 10.0) * keep * gust;
    grad += k * amp * cos(dot(k, world) - t * SPEED[i] * 2.0);
    detail += keep / 6.0;
  }
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

  // Depth colour in three stops (wide middle band, deep only in the deepest third), then mottled
  // multiplicatively (noise in [−1, 1]): the mottle stays visible in fully deep water as well, with
  // a slight shift towards petrol.
  float f = clamp(depth / u_wparams.x, 0.0, 1.0);
  vec3 base = mix(u_shallow.rgb, u_mid.rgb, smoothstep(0.05, 0.4, f));
  base = mix(base, u_deep.rgb, smoothstep(0.55, 0.95, f));
  float mottle = terrainValueNoise(world / 45.0) * 0.6 + terrainValueNoise(world / 17.0) * 0.4;
  float tint = terrainValueNoise(world / 83.0 + vec2(3.1, 7.7));
  float deepish = smoothstep(0.2, 0.6, f);
  base *= 1.0 + 0.22 * mottle * deepish;
  base = mix(base, base * vec3(0.85, 1.12, 0.92), (0.5 + 0.5 * tint) * deepish);
  float alpha = mix(u_shallow.a, u_mid.a, smoothstep(0.0, 0.3, f));
  alpha = mix(alpha, u_deep.a, smoothstep(0.3, 0.8, f));

  vec3 toEye = normalize(u_camFrac.xyz - v_pos);
  // Fresnel mostly from the mean surface: at grazing angles the wave normals would turn into stripes.
  float ndv = max(dot(normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.35)), toEye), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 sky = mix(u_fog.rgb, u_skyColor.rgb * 1.35, 0.5);
  float ndl = max(dot(n, u_sunDir.xyz), 0.0);
  vec3 color = base * (0.35 + 0.65 * (u_skyColor.rgb + u_sunColor.rgb * ndl));
  // Ripple shading (sun-facing wave flanks brighter): keeps visible waves at mid distance, where the
  // glint mostly lies outside the view; faded per wave like the normals above (no moiré).
  color *= 1.0 + clamp(dot(grad, normalize(u_sunDir.xz + vec2(1e-4))) * 1.5, -0.05, 0.05);
  color = mix(color, sky, fresnel * 0.6);
  vec3 refl = reflect(-toEye, n);
  color += u_sunColor.rgb * pow(max(dot(refl, u_sunDir.xyz), 0.0), 40.0) * (0.06 + 0.14 * detail) * gust;
  // Broad, weak sheen from the mean surface: the water keeps a highlight where the waves are faded out.
  vec3 reflMean = reflect(-toEye, normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.3)));
  color += u_sunColor.rgb * pow(max(dot(reflMean, u_sunDir.xyz), 0.0), 8.0) * 0.06;
  alpha = max(alpha, fresnel * 0.7);

  // Shore foam in very shallow water, broken up by two drifting noise octaves (no periodic field).
  float foamZone = 1.0 - smoothstep(0.0, u_wparams.y, depth);
  float fn = 0.65 * terrainValueNoise(world / 6.0 + vec2(t * 0.11, -t * 0.07))
           + 0.35 * terrainValueNoise(world / 2.3 + vec2(-t * 0.19, t * 0.13)) + grad.x * 2.0;
  float foam = foamZone * smoothstep(-0.35, 0.45, fn);
  color = mix(color, vec3(0.92, 0.96, 0.98), foam * 0.6);
  alpha = max(alpha, foam * 0.75);
  // Soft waterline.
  alpha *= smoothstep(0.0, 0.04, depth);

  // Darkened map edge, like the terrain.
  float edge = min(min(world.x, world.y), min(u_wmap.x - world.x, u_wmap.x - world.y));
  color *= mix(${TERRAIN_EDGE_DARKEN.toFixed(2)}, 1.0, smoothstep(0.0, ${TERRAIN_EDGE_FADE_WU.toFixed(1)}, edge));

  float fog = clamp((camDist - u_fog.w) / max(u_fog.w, 1.0), 0.0, 0.85);
  o_color = vec4(mix(color, u_fog.rgb, fog), alpha);
}
`;

/** Two triangles over the (0|1, 0|1) corners, u8×2 padded to 4 bytes (like the ground pass). */
const CORNERS = Uint8Array.of(0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0);

const WAVES_BY_QUALITY: { readonly [K in WaterQuality]: number } = { low: 3, medium: 6, high: 6 };

/**
 * Depth of the full deep color (WU) for a map: its deepest point, at least 3 WU and at most
 * {@link WATER_FULL_DEPTH_MAX_WU} (Setons: deepest ≈ 15.6 WU; hollow-ridge: 3.5 WU). The deep stop
 * is only mixed in from 55 % of it on, so only the deepest water turns fully deep.
 */
export function waterFullDepthWu(waterLevelRaw: number, mapMinRaw: number): number {
  const deepest = Math.max(0, waterLevelRaw - mapMinRaw) / 4096;
  return Math.min(WATER_FULL_DEPTH_MAX_WU, Math.max(3, deepest));
}

export class WaterPass {
  readonly pipeline: PipeH;
  private readonly corners: BufH;
  private readonly ubo: BufH;
  private readonly group: BindGroupH;
  private readonly streams: VertexStreamBinding[];
  private readonly data = new Std140Writer(WATER_LAYOUT);
  /** Depth (WU) of the full deep color on this map. */
  readonly fullDepthWu: number;

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
    w.vec4(WATER_LAYOUT.offsetOf('shallow'), 0.35, 0.75, 0.8, 0.55);
    w.vec4(WATER_LAYOUT.offsetOf('mid'), 0.1, 0.4, 0.65, 0.86);
    w.vec4(WATER_LAYOUT.offsetOf('deep'), 0.055, 0.19, 0.36, 0.96);
    w.vec4(WATER_LAYOUT.offsetOf('map'), heights.desc.sizeWu, 0, 0, 0);
    this.fullDepthWu = waterFullDepthWu(level, heights.bounds.mapMinRaw);
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
    this.data.vec4(WATER_LAYOUT.offsetOf('params'), this.fullDepthWu, WATER_FOAM_DEPTH_WU, WAVES_BY_QUALITY[q], 0.03);
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
