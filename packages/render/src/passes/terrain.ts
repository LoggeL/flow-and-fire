/**
 * TerrainPass (M1, PLAN §3.7 "Terrain": CDLOD with one level, "Decals" in the terrain FS).
 *
 * - Heightmap as R16UI texture (dim × dim), heights per `texelFetch` with manual bilinear filtering
 *   bit-identical to the sim ({@link TERRAIN_HEIGHT_GLSL}); patch vertices sit on integer WU so their
 *   height is exactly the sample value.
 * - One 33 × 33-vertex patch mesh (32 × 32 WU, one vertex per sample) instanced over all visible
 *   32 × 32 WU chunks: ONE draw. Chunk frustum culling on the CPU with exact per-chunk min/max
 *   heights (computed once in `setTerrain`); the visible list is rebuilt only on camera changes.
 * - Camera-relative integer positioning: `rel = ivec3(x, h, z) − camPosInt`, then `/ 4096.0`.
 * - Normals from central differences in the VS; auto-splat by height and slope (4 procedural layers:
 *   shore/sand near the water level, grass, rock from a slope threshold, highland) plus optional
 *   painted splat weights (4 or 8 layers, limited by the preset) over a runtime-generated
 *   TEXTURE_2D_ARRAY of procedural layer albedos; only layers with weight are sampled, each from two
 *   differently rotated/scaled tiles mixed by macro noise (no visible repetition), steep faces
 *   triplanar (preset flag). Close up, noise-sharpened splat transitions and a two-octave detail
 *   normal (lighting only) add ground structure; both fade out by pixel footprint. Terrain darkens
 *   towards the map edge ({@link TERRAIN_EDGE_FADE_WU}).
 * - Light: one directional light + hemisphere (Frame block, set from the map's light parameters).
 * - Decals (rings/discs, SDF) from a data texture, binned per chunk ({@link DecalBinner}).
 *
 * Every resource lives in the context-loss registry and restores its content from CPU copies.
 */
import type { Frustum } from '../frustum.ts';
import type { BindGroupH, BufH, GpuDevice, PassEncoder, PipeH, TexH, VertexStreamBinding } from '../rhi/types.ts';
import { vf } from '../rhi/types.ts';
import { Std140Writer, std140Layout } from '../std140.ts';
import type { DecalBinStats, TerrainDecal } from '../terrain/decals.ts';
import { DECAL_DATA_HEIGHT, DECAL_DATA_WIDTH, DECAL_LIST_WIDTH, DECAL_MAX_WIDTH_FRACTION, DECALS_PER_ROW, DecalBinner } from '../terrain/decals.ts';
import {
  SLOT_TERRAIN_HEIGHT,
  TERRAIN_ALBEDO_LAYERS,
  TERRAIN_ALBEDO_SIZE,
  TERRAIN_HEIGHT_GLSL,
  TERRAIN_HEIGHT_LAYOUT,
  TERRAIN_SPLAT_GLSL,
  NOISE_GLSL,
  UNIT_HEIGHTMAP,
  generateTerrainAlbedo,
} from '../terrain/glsl.ts';
import type { ChunkBounds, TerrainDesc } from '../terrain/heightfield.ts';
import { TERRAIN_PATCH_VERTS, TERRAIN_PATCH_WU, computeChunkBounds, validateTerrain } from '../terrain/heightfield.ts';
import { PatchCuller } from '../terrain/patches.ts';
import { FRAME_BLOCK_GLSL, SLOT_FRAME, SLOT_PASS } from './shared.ts';

const RING_REGIONS = 3;
/** Patch vertex: u8 x, u8 z (0..32), 2 bytes padding. */
const PATCH_VERTEX_STRIDE = 4;
/** Instance: u16 chunk x, u16 chunk z. */
const PATCH_INSTANCE_STRIDE = 4;
export const PATCH_INDEX_COUNT = TERRAIN_PATCH_WU * TERRAIN_PATCH_WU * 6;

const UNIT_ALBEDO = 1;
const UNIT_SPLAT0 = 2;
const UNIT_SPLAT1 = 3;
const UNIT_DECAL_DATA = 4;
const UNIT_DECAL_CHUNKS = 5;
const UNIT_DECAL_LIST = 6;

/** Water rendering constants shared with the water pass. */
export const NO_WATER_RAW = -0x80000000;
/**
 * Terrain and water darken towards the map edge over this many WU (FA-like border). Short enough to
 * stay out of the playable area: edge spots sit ≥ 12 WU from the border (Setons review R2 P3-1).
 */
export const TERRAIN_EDGE_FADE_WU = 10;
/** Brightness factor right at the map edge. */
export const TERRAIN_EDGE_DARKEN = 0.3;
/** Noise cell (WU) of the splat-transition sharpening (second octave at 0.4 ×). */
export const SPLAT_SHARPEN_CELL_WU = 4;
/** Noise cells (WU) of the two detail-normal octaves (wavelength ≈ 2 cells: ≈ 0.9 and 2.6 WU). */
export const DETAIL_BUMP_CELLS_WU: readonly [number, number] = [0.45, 1.3];
/** Tilt of the detail normal per unit noise gradient (flat ground; steep faces up to 1.6 ×). */
export const DETAIL_BUMP_STRENGTH = 0.18;

// -------------------------------------------------------------------------------------------------
// Shared heightmap resources (terrain, water, probe)
// -------------------------------------------------------------------------------------------------

/**
 * GPU copy of the heightfield: R16UI texture + `TerrainHeight` UBO + bind group (texture unit
 * {@link UNIT_HEIGHTMAP}, UBO slot {@link SLOT_TERRAIN_HEIGHT}). Restored from the CPU heights.
 */
export class TerrainHeightResources {
  readonly texture: TexH;
  readonly ubo: BufH;
  readonly group: BindGroupH;
  readonly bounds: ChunkBounds;
  private readonly data = new Std140Writer(TERRAIN_HEIGHT_LAYOUT);

  constructor(
    private readonly dev: GpuDevice,
    readonly desc: TerrainDesc,
  ) {
    validateTerrain(desc);
    if (desc.dim > dev.caps.maxTextureSize) throw new Error(`terrain: dim ${desc.dim} exceeds MAX_TEXTURE_SIZE ${dev.caps.maxTextureSize}`);
    const dim = desc.dim;
    const heights = desc.heights;
    const rect = { x: 0, y: 0, width: dim, height: dim };
    this.texture = dev.createTexture({
      label: 'terrain.heightmap',
      width: dim,
      height: dim,
      format: 'r16ui',
      restore: (h) => dev.writeTexture(h, rect, heights),
    });
    dev.writeTexture(this.texture, rect, heights);
    this.data.ivec4(TERRAIN_HEIGHT_LAYOUT.offsetOf('heightParams'), desc.sizeWu, dim, desc.heightScaleRaw, 0);
    this.ubo = dev.createBuffer({
      label: 'terrain.height.ubo',
      usage: 'uniform',
      size: TERRAIN_HEIGHT_LAYOUT.size,
      restore: (h) => dev.writeBuffer(h, 0, this.data.bytes),
    });
    dev.writeBuffer(this.ubo, 0, this.data.bytes);
    this.group = dev.createBindGroup({
      label: 'terrain.height',
      buffers: [{ slot: SLOT_TERRAIN_HEIGHT, buffer: this.ubo }],
      textures: [{ unit: UNIT_HEIGHTMAP, texture: this.texture }],
    });
    this.bounds = computeChunkBounds(desc);
  }

  dispose(): void {
    this.dev.destroyBindGroup(this.group);
    this.dev.destroyBuffer(this.ubo);
    this.dev.destroyTexture(this.texture);
  }
}

// -------------------------------------------------------------------------------------------------
// Shaders
// -------------------------------------------------------------------------------------------------

const TERRAIN_PASS_LAYOUT = std140Layout([
  { name: 'bands', type: 'vec4' },
  { name: 'params', type: 'ivec4' },
  { name: 'misc', type: 'vec4' },
]);

const TERRAIN_PASS_BLOCK = /* glsl */ `
layout(std140) uniform TerrainPass {
  vec4 u_bands;    // shore top WU, highland start WU, highland blend WU, rock slope (1 - n.y)
  ivec4 u_tparams; // x: splat layers (0/4/8), y: has water, z: water level raw, w: decal count
  vec4 u_tmisc;    // x: 1 / sizeWu, y: albedo tiles per WU, z: underwater darkening, w: triplanar (0/1)
};
`;

const TERRAIN_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${TERRAIN_HEIGHT_GLSL}
${TERRAIN_PASS_BLOCK}
uniform highp usampler2D u_decalChunks;
layout(location = 0) in uvec2 a_local; // 0..32 inside the patch
layout(location = 1) in uvec2 a_chunk; // chunk (x, z), per instance
out vec3 v_pos;        // world - camPosInt (WU)
out vec3 v_normal;
out vec2 v_tile;
out vec2 v_splatUV;
out float v_heightWU;
flat out uint v_decals; // (listStart << 6) | count of the chunk

void main() {
  ivec2 cell = ivec2(a_chunk) * ${TERRAIN_PATCH_WU} + ivec2(a_local);
  ivec2 xz = cell * 4096;
  int h = terrainHeightRaw(xz);
  vec3 rel = vec3(ivec3(xz.x, h, xz.y) - u_camPosInt.xyz) / 4096.0;
  v_pos = rel;
  v_normal = terrainNormal(cell);
  // (rel + camPosInt mod 32 WU) == world mod 32 WU: small and exact; tiles divide 32 WU.
  v_tile = (rel.xz + u_camMod.xz) * u_tmisc.y;
  v_splatUV = vec2(cell) * u_tmisc.x;
  v_heightWU = float(h) / 4096.0;
  v_decals = texelFetch(u_decalChunks, ivec2(a_chunk), 0).r;
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;

const TERRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${TERRAIN_PASS_BLOCK}
${NOISE_GLSL}
${TERRAIN_SPLAT_GLSL}
uniform highp sampler2DArray u_albedo;
uniform highp sampler2D u_splat0;
uniform highp sampler2D u_splat1;
uniform highp isampler2D u_decalData;
uniform highp usampler2D u_decalList;
in vec3 v_pos;
in vec3 v_normal;
in vec2 v_tile;
in vec2 v_splatUV;
in float v_heightWU;
flat in uint v_decals;
out vec4 o_color;

void main() {
  vec3 n = normalize(v_normal);
  // World position (WU) for macro variation and the map-edge fade (float is exact enough here).
  vec2 world = v_pos.xz + vec2(u_camPosInt.xz) / 4096.0;
  float macro = terrainValueNoise(world / 37.0) * 0.65 + terrainValueNoise(world / 13.0) * 0.35;
  vec3 tilePos = vec3(v_tile.x, v_heightWU * u_tmisc.y, v_tile.y);
  // WU per pixel: the close-up detail below fades out before it could alias (overview unchanged).
  float px = max(length(fwidth(world)), 1e-4) * 0.70710678;
  // Sharpened splat transitions (${SPLAT_SHARPEN_CELL_WU} WU noise cells): irregular, crisp borders
  // instead of round blobs where the bilinear 4-WU splat blends.
  vec3 sharp = vec3(0.0);
  float sharpKeep = 1.0 - smoothstep(0.15, 0.5, px);
  if (sharpKeep > 0.0) {
    sharp = vec3(terrainValueNoise(world / ${SPLAT_SHARPEN_CELL_WU.toFixed(1)}),
                 0.5 * terrainValueNoise(world / ${(SPLAT_SHARPEN_CELL_WU * 0.4).toFixed(2)} + vec2(13.7, 5.3)),
                 0.25 * sharpKeep);
  }
  vec3 albedo = terrainAlbedoTri(u_albedo, u_splat0, u_splat1, tilePos, v_splatUV, n, v_heightWU, u_bands, u_tparams.x,
                                 0.5 + 0.35 * macro, u_tmisc.w > 0.5, sharp);
  albedo *= 1.0 + 0.08 * terrainValueNoise(world / 61.0);
  // Detail normal (bump, two octaves with ≈ ${DETAIL_BUMP_CELLS_WU[0]}/${DETAIL_BUMP_CELLS_WU[1]} WU cells) for the
  // lighting only; stronger on steep ground. Each octave fades out once a pixel covers ≈ 1/3 cell.
  vec3 nl = n;
  float bumpKeep0 = 1.0 - smoothstep(0.12, 0.35, px / ${DETAIL_BUMP_CELLS_WU[0].toFixed(2)});
  float bumpKeep1 = 1.0 - smoothstep(0.12, 0.35, px / ${DETAIL_BUMP_CELLS_WU[1].toFixed(2)});
  if (bumpKeep1 > 0.0) {
    float k = ${DETAIL_BUMP_STRENGTH.toFixed(2)} * (0.7 + 1.5 * clamp(1.0 - n.y, 0.0, 0.6));
    vec2 g = terrainValueNoiseD(world / ${DETAIL_BUMP_CELLS_WU[1].toFixed(2)}).yz * bumpKeep1 * 0.6;
    if (bumpKeep0 > 0.0) g += terrainValueNoiseD(world / ${DETAIL_BUMP_CELLS_WU[0].toFixed(2)} + vec2(7.1, 3.9)).yz * bumpKeep0 * 0.4;
    nl = normalize(n - k * vec3(g.x, 0.0, g.y));
  }
  float ndl = max(dot(nl, u_sunDir.xyz), 0.0);
  vec3 hemi = mix(u_groundColor.rgb, u_skyColor.rgb, nl.y * 0.5 + 0.5);
  vec3 color = albedo * (hemi + u_sunColor.rgb * ndl);
  if (u_tparams.y != 0) {
    float depth = float(u_tparams.z) / 4096.0 - v_heightWU;
    color *= 1.0 - u_tmisc.z * clamp(depth / 6.0, 0.0, 1.0);
  }

  // Darkened map edge (FA-like): the terrain fades out over the last ${TERRAIN_EDGE_FADE_WU} WU. Before the
  // decals, so spots near the edge keep their full color.
  float sizeWu = 1.0 / u_tmisc.x;
  float edge = min(min(world.x, world.y), min(sizeWu - world.x, sizeWu - world.y));
  color *= mix(${TERRAIN_EDGE_DARKEN.toFixed(2)}, 1.0, smoothstep(0.0, ${TERRAIN_EDGE_FADE_WU.toFixed(1)}, edge));

  // Decals of this chunk (SDF rings/discs), anti-aliased over the pixel footprint.
  float aa = max(length(fwidth(v_pos.xz)), 1e-3);
  uint cnt = v_decals & 63u;
  uint first = v_decals >> 6u;
  for (uint i = 0u; i < cnt; ++i) {
    uint li = first + i;
    uint d = texelFetch(u_decalList, ivec2(int(li % ${DECAL_LIST_WIDTH}u), int(li / ${DECAL_LIST_WIDTH}u)), 0).r;
    ivec2 tc = ivec2(int(d % ${DECALS_PER_ROW}u) * 2, int(d / ${DECALS_PER_ROW}u));
    ivec4 t0 = texelFetch(u_decalData, tc, 0);
    ivec4 t1 = texelFetch(u_decalData, tc + ivec2(1, 0), 0);
    vec2 c = vec2(t0.xy - u_camPosInt.xz) / 4096.0;
    vec2 dv = v_pos.xz - c;
    float r = float(t0.z) / 4096.0;
    float w = float(t0.w) / 4096.0;
    if (t1.z > 0) {
      // Zoomed out: grow to the minimum pixel radius (≤ max radius), line at least 2 px.
      float grow = clamp(float(t1.z) / 16.0 * px / max(r, 1e-3), 1.0, float(t1.w) / 4096.0 / max(r, 1e-3));
      r *= grow;
      w = min(max(w * grow, 2.0 * px), ${DECAL_MAX_WIDTH_FRACTION} * r);
    }
    float cov;
    if (t1.x == 1) {
      cov = 1.0 - smoothstep(r - max(w, aa), r + aa, length(dv));
    } else {
      // Ring: circle line; diamond: line of the L1 "circle" (exact distance on its edges).
      float sd = t1.x == 2 ? abs((abs(dv.x) + abs(dv.y) - r) * 0.70710678) : abs(length(dv) - r);
      cov = 1.0 - smoothstep(-aa, aa, sd - 0.5 * w);
    }
    uint rgba = uint(t1.y);
    vec4 dc = vec4(float(rgba & 255u), float((rgba >> 8u) & 255u), float((rgba >> 16u) & 255u), float(rgba >> 24u)) / 255.0;
    color = mix(color, dc.rgb, cov * dc.a);
  }

  float dist = length(v_pos - u_camFrac.xyz);
  float fog = clamp((dist - u_fog.w) / max(u_fog.w, 1.0), 0.0, 0.85);
  o_color = vec4(mix(color, u_fog.rgb, fog), 1.0);
}
`;

/** Patch mesh: 33 × 33 vertices (u8 local x/z), 32 × 32 quads, CCW seen from above. */
function buildPatch(): { vertices: Uint8Array; indices: Uint16Array } {
  const n = TERRAIN_PATCH_VERTS;
  const vertices = new Uint8Array(n * n * PATCH_VERTEX_STRIDE);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const o = (z * n + x) * PATCH_VERTEX_STRIDE;
      vertices[o] = x;
      vertices[o + 1] = z;
    }
  }
  const indices = new Uint16Array(PATCH_INDEX_COUNT);
  let k = 0;
  for (let z = 0; z < TERRAIN_PATCH_WU; z++) {
    for (let x = 0; x < TERRAIN_PATCH_WU; x++) {
      const i00 = z * n + x;
      const i10 = i00 + 1;
      const i01 = i00 + n;
      const i11 = i01 + 1;
      // (x0,z0) (x0,z1) (x1,z0) and (x1,z0) (x0,z1) (x1,z1): normals point to +y.
      indices[k++] = i00;
      indices[k++] = i01;
      indices[k++] = i10;
      indices[k++] = i10;
      indices[k++] = i01;
      indices[k++] = i11;
    }
  }
  return { vertices, indices };
}

export interface TerrainPassOptions {
  /** Painted splat layers allowed by the preset (4 or 8). */
  readonly maxSplatLayers?: 4 | 8;
  /** Triplanar projection on steep faces (preset flag, default true). */
  readonly triplanar?: boolean;
}

export class TerrainPass {
  readonly pipeline: PipeH;
  readonly culler: PatchCuller;
  readonly decals: DecalBinner;
  private readonly patchVbo: BufH;
  private readonly patchIbo: BufH;
  private readonly instRing: BufH;
  private readonly instStaging: Uint16Array;
  private readonly ubo: BufH;
  private readonly group: BindGroupH;
  private readonly albedoTex: TexH;
  private readonly splatTex: [TexH, TexH];
  private readonly decalDataTex: TexH;
  private readonly decalChunkTex: TexH;
  private readonly decalListTex: TexH;
  private readonly data = new Std140Writer(TERRAIN_PASS_LAYOUT);
  private readonly streams: VertexStreamBinding[];
  private readonly chunks: number;
  private region = 0;
  private visibleCount = 0;
  private lastCamVersion = -1;
  private dirty = true;
  private splatLayers = 0;
  private triplanar = true;
  private readonly offRestored: () => void;

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    readonly heights: TerrainHeightResources,
    opts: TerrainPassOptions = {},
  ) {
    const desc = heights.desc;
    this.chunks = heights.bounds.chunks;
    this.culler = new PatchCuller(heights.bounds);
    this.decals = new DecalBinner(desc.sizeWu);

    this.pipeline = dev.createPipeline({
      label: 'terrain',
      vertex: TERRAIN_VS,
      fragment: TERRAIN_FS,
      streams: [
        { stepMode: 'vertex', stride: PATCH_VERTEX_STRIDE, attributes: [{ location: 0, format: vf('u8', 2, 'int'), offset: 0 }] },
        { stepMode: 'instance', stride: PATCH_INSTANCE_STRIDE, attributes: [{ location: 1, format: vf('u16', 2, 'int'), offset: 0 }] },
      ],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'TerrainHeight', slot: SLOT_TERRAIN_HEIGHT },
        { name: 'TerrainPass', slot: SLOT_PASS },
      ],
      samplers: [
        { name: 'u_heightmap', unit: UNIT_HEIGHTMAP },
        { name: 'u_albedo', unit: UNIT_ALBEDO },
        { name: 'u_splat0', unit: UNIT_SPLAT0 },
        { name: 'u_splat1', unit: UNIT_SPLAT1 },
        { name: 'u_decalData', unit: UNIT_DECAL_DATA },
        { name: 'u_decalChunks', unit: UNIT_DECAL_CHUNKS },
        { name: 'u_decalList', unit: UNIT_DECAL_LIST },
      ],
      cullMode: 'back',
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less',
    });

    const patch = buildPatch();
    this.patchVbo = dev.createBuffer({
      label: 'terrain.patch.vbo',
      usage: 'vertex',
      size: patch.vertices.byteLength,
      restore: (h) => dev.writeBuffer(h, 0, patch.vertices),
    });
    dev.writeBuffer(this.patchVbo, 0, patch.vertices);
    this.patchIbo = dev.createBuffer({
      label: 'terrain.patch.ibo',
      usage: 'index',
      size: patch.indices.byteLength,
      restore: (h) => dev.writeBuffer(h, 0, patch.indices),
    });
    dev.writeBuffer(this.patchIbo, 0, patch.indices);
    const maxPatches = this.chunks * this.chunks;
    this.instStaging = new Uint16Array(maxPatches * 2);
    this.instRing = dev.createBuffer({
      label: 'terrain.patches.ring',
      usage: 'vertex',
      size: maxPatches * PATCH_INSTANCE_STRIDE * RING_REGIONS,
      dynamic: true,
    });
    this.streams = [
      { buffer: this.patchVbo, offset: 0 },
      { buffer: this.instRing, offset: 0 },
    ];

    // Procedural layer albedos as a mipmapped 2D array (tiling).
    const layers = generateTerrainAlbedo();
    const size = TERRAIN_ALBEDO_SIZE;
    const mipLevels = Math.log2(size) + 1;
    const uploadAlbedo = (h: TexH): void => {
      for (let l = 0; l < TERRAIN_ALBEDO_LAYERS; l++) dev.writeTexture(h, { x: 0, y: 0, width: size, height: size }, layers[l]!, l);
      dev.generateMipmaps(h);
    };
    this.albedoTex = dev.createTexture({
      label: 'terrain.albedo',
      width: size,
      height: size,
      format: 'rgba8',
      dimension: '2d-array',
      layers: TERRAIN_ALBEDO_LAYERS,
      mipLevels,
      filter: 'linear',
      wrap: 'repeat',
      restore: uploadAlbedo,
    });
    uploadAlbedo(this.albedoTex);

    // Painted splat weights (or 1×1 zero planes).
    const sp = desc.splat;
    const res = sp?.resolution ?? 1;
    const zero = new Uint8Array(4);
    const mkSplat = (p: number): TexH => {
      const plane = sp?.planes[p] ?? (sp === undefined ? zero : new Uint8Array(res * res * 4));
      const rect = { x: 0, y: 0, width: res, height: res };
      const h = dev.createTexture({
        label: `terrain.splat${p}`,
        width: res,
        height: res,
        format: 'rgba8',
        filter: 'linear',
        restore: (t) => dev.writeTexture(t, rect, plane),
      });
      dev.writeTexture(h, rect, plane);
      return h;
    };
    this.splatTex = [mkSplat(0), mkSplat(1)];

    // Decal textures (content from the binner's CPU arrays).
    const dec = this.decals;
    const dataRect = { x: 0, y: 0, width: DECAL_DATA_WIDTH, height: DECAL_DATA_HEIGHT };
    const chunkRect = { x: 0, y: 0, width: this.chunks, height: this.chunks };
    const listRect = { x: 0, y: 0, width: DECAL_LIST_WIDTH, height: dec.listRows };
    this.decalDataTex = dev.createTexture({
      label: 'terrain.decals.data',
      width: DECAL_DATA_WIDTH,
      height: DECAL_DATA_HEIGHT,
      format: 'rgba32i',
      restore: (h) => dev.writeTexture(h, dataRect, dec.data),
    });
    this.decalChunkTex = dev.createTexture({
      label: 'terrain.decals.chunks',
      width: this.chunks,
      height: this.chunks,
      format: 'r32ui',
      restore: (h) => dev.writeTexture(h, chunkRect, dec.chunkIndex),
    });
    this.decalListTex = dev.createTexture({
      label: 'terrain.decals.list',
      width: DECAL_LIST_WIDTH,
      height: dec.listRows,
      format: 'r32ui',
      restore: (h) => dev.writeTexture(h, listRect, dec.list),
    });
    dec.bin([]);
    this.uploadDecals();

    this.ubo = dev.createBuffer({
      label: 'terrain.pass.ubo',
      usage: 'uniform',
      size: TERRAIN_PASS_LAYOUT.size,
      restore: (h) => dev.writeBuffer(h, 0, this.data.bytes),
    });
    this.group = dev.createBindGroup({
      label: 'terrain.pass',
      buffers: [{ slot: SLOT_PASS, buffer: this.ubo }],
      textures: [
        { unit: UNIT_ALBEDO, texture: this.albedoTex },
        { unit: UNIT_SPLAT0, texture: this.splatTex[0] },
        { unit: UNIT_SPLAT1, texture: this.splatTex[1] },
        { unit: UNIT_DECAL_DATA, texture: this.decalDataTex },
        { unit: UNIT_DECAL_CHUNKS, texture: this.decalChunkTex },
        { unit: UNIT_DECAL_LIST, texture: this.decalListTex },
      ],
    });
    this.triplanar = opts.triplanar ?? true;
    this.setMaxSplatLayers(opts.maxSplatLayers ?? 8);
    this.offRestored = dev.onRestored(() => {
      this.dirty = true;
    });
  }

  /** Terrain bands and flags from the heightfield; `maxSplat` = preset limit. */
  setMaxSplatLayers(maxSplat: 4 | 8): void {
    const desc = this.heights.desc;
    const b = this.heights.bounds;
    const minWU = b.mapMinRaw / 4096;
    const maxWU = b.mapMaxRaw / 4096;
    const range = Math.max(1, maxWU - minWU);
    const water = desc.waterLevelRaw;
    const shoreTop = (water !== null ? water / 4096 : minWU) + 1.2;
    const highland = minWU + range * 0.72;
    this.splatLayers = desc.splat === undefined ? 0 : Math.min(desc.splat.layers, maxSplat);
    const w = this.data;
    w.vec4(TERRAIN_PASS_LAYOUT.offsetOf('bands'), shoreTop, highland, range * 0.08 + 0.5, 0.28);
    w.ivec4(TERRAIN_PASS_LAYOUT.offsetOf('params'), this.splatLayers, water !== null ? 1 : 0, water ?? 0, this.decals.stats.decals);
    w.vec4(TERRAIN_PASS_LAYOUT.offsetOf('misc'), 1 / desc.sizeWu, 1 / 8, 0.45, this.triplanar ? 1 : 0);
    this.dev.writeBuffer(this.ubo, 0, w.bytes);
  }

  /** Triplanar projection on steep faces on/off (preset). */
  setTriplanar(on: boolean): void {
    this.triplanar = on;
    this.data.float(TERRAIN_PASS_LAYOUT.offsetOf('misc') + 12, on ? 1 : 0);
    this.dev.writeBuffer(this.ubo, 0, this.data.bytes);
  }

  /** Triplanar projection active. */
  triplanarEnabled(): boolean {
    return this.triplanar;
  }

  /** Painted splat layers in use (0, 4 or 8). */
  activeSplatLayers(): number {
    return this.splatLayers;
  }

  setDecals(decals: readonly TerrainDecal[]): DecalBinStats {
    const st = this.decals.bin(decals);
    this.uploadDecals();
    this.data.int(TERRAIN_PASS_LAYOUT.offsetOf('params') + 12, st.decals);
    this.dev.writeBuffer(this.ubo, 0, this.data.bytes);
    return st;
  }

  private uploadDecals(): void {
    const dev = this.dev;
    const dec = this.decals;
    dev.writeTexture(this.decalDataTex, { x: 0, y: 0, width: DECAL_DATA_WIDTH, height: DECAL_DATA_HEIGHT }, dec.data);
    dev.writeTexture(this.decalChunkTex, { x: 0, y: 0, width: this.chunks, height: this.chunks }, dec.chunkIndex);
    dev.writeTexture(this.decalListTex, { x: 0, y: 0, width: DECAL_LIST_WIDTH, height: dec.listRows }, dec.list);
  }

  /** Rebuilds the visible patch list on a camera change; returns the number of visible patches. */
  prepare(frustum: Frustum, camPosInt: ArrayLike<number>, cameraVersion: number): number {
    if (!this.dirty && cameraVersion === this.lastCamVersion) return this.visibleCount;
    this.lastCamVersion = cameraVersion;
    this.dirty = false;
    const n = this.culler.cull(frustum, camPosInt);
    const vis = this.culler.visible;
    const st = this.instStaging;
    const chunks = this.chunks;
    for (let i = 0; i < n; i++) {
      const k = vis[i]!;
      st[i * 2] = k % chunks;
      st[i * 2 + 1] = (k / chunks) | 0;
    }
    this.visibleCount = n;
    this.region = (this.region + 1) % RING_REGIONS;
    if (n > 0) this.dev.writeBuffer(this.instRing, this.region * chunks * chunks * PATCH_INSTANCE_STRIDE, st, 0, n * 2);
    return n;
  }

  /** Visible patches of the last `prepare`. */
  get patches(): number {
    return this.visibleCount;
  }

  draw(enc: PassEncoder): void {
    if (this.visibleCount === 0) return;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.heights.group);
    enc.setBindGroup(this.group);
    this.streams[1]!.offset = this.region * this.chunks * this.chunks * PATCH_INSTANCE_STRIDE;
    enc.setVertexStreams(this.streams);
    enc.setIndexBuffer(this.patchIbo, 'uint16');
    enc.drawIndexedInstanced(PATCH_INDEX_COUNT, this.visibleCount);
  }

  dispose(): void {
    this.offRestored();
    const dev = this.dev;
    dev.destroyBindGroup(this.group);
    dev.destroyBuffer(this.ubo);
    dev.destroyBuffer(this.patchVbo);
    dev.destroyBuffer(this.patchIbo);
    dev.destroyBuffer(this.instRing);
    for (const t of [this.albedoTex, this.splatTex[0], this.splatTex[1], this.decalDataTex, this.decalChunkTex, this.decalListTex]) {
      dev.destroyTexture(t);
    }
    dev.destroyPipeline(this.pipeline);
  }
}
