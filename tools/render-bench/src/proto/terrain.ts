/**
 * Terrain variant of the SPK4 prototype: the CDLOD terrain of @faf/render (one level, 33 × 33-vertex
 * patches per 32-WU chunk, one instanced draw, quadtree chunk culling) re-composed from the exported
 * GLSL building blocks – `TERRAIN_HEIGHT_GLSL` (bit-identical heights), `TERRAIN_SPLAT_GLSL`
 * (auto-splat + 4/8 painted layers) – plus CSM sampling (`SHADOW_RECEIVE_GLSL`) and the spot decals
 * (`DecalBinner`). The game's `TerrainPass` has no shadow input yet; this is the shape MS14 needs.
 */
import {
  DECAL_DATA_HEIGHT,
  DECAL_DATA_WIDTH,
  DECAL_LIST_WIDTH,
  DECALS_PER_ROW,
  DecalBinner,
  FRAME_BLOCK_GLSL,
  PatchCuller,
  SLOT_FRAME,
  SLOT_PASS,
  SLOT_TERRAIN_HEIGHT,
  TERRAIN_ALBEDO_LAYERS,
  TERRAIN_ALBEDO_SIZE,
  TERRAIN_HEIGHT_GLSL,
  TERRAIN_PATCH_VERTS,
  TERRAIN_PATCH_WU,
  TERRAIN_SPLAT_GLSL,
  UNIT_HEIGHTMAP,
  Std140Writer,
  generateTerrainAlbedo,
  std140Layout,
  vf,
} from '@faf/render';
import type {
  BindGroupH,
  BufH,
  Frustum,
  GpuDevice,
  PassEncoder,
  PipeH,
  TerrainDecal,
  TerrainHeightResources,
  TexH,
  VertexStreamBinding,
} from '@faf/render';
import { SHADOW_RECEIVE_GLSL, SHADOW_SAMPLERS, SLOT_SHADOW } from './shadow-glsl.ts';

const PATCH_VERTEX_STRIDE = 4;
const PATCH_INSTANCE_STRIDE = 4;
const RING_REGIONS = 3;
export const PATCH_INDEX_COUNT = TERRAIN_PATCH_WU * TERRAIN_PATCH_WU * 6;

const UNIT_ALBEDO = 1;
const UNIT_SPLAT0 = 2;
const UNIT_SPLAT1 = 3;
const UNIT_DECAL_DATA = 4;
const UNIT_DECAL_CHUNKS = 5;
const UNIT_DECAL_LIST = 6;

/** The 33 × 33 patch (u8 local x/z) shared by the terrain pass and the shadow caster. */
export class TerrainPatchMesh {
  readonly vbo: BufH;
  readonly ibo: BufH;
  constructor(private readonly dev: GpuDevice) {
    const n = TERRAIN_PATCH_VERTS;
    const vertices = new Uint8Array(n * n * PATCH_VERTEX_STRIDE);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        vertices[(z * n + x) * PATCH_VERTEX_STRIDE] = x;
        vertices[(z * n + x) * PATCH_VERTEX_STRIDE + 1] = z;
      }
    }
    const indices = new Uint16Array(PATCH_INDEX_COUNT);
    let k = 0;
    for (let z = 0; z < TERRAIN_PATCH_WU; z++) {
      for (let x = 0; x < TERRAIN_PATCH_WU; x++) {
        const i00 = z * n + x;
        indices[k++] = i00;
        indices[k++] = i00 + n;
        indices[k++] = i00 + 1;
        indices[k++] = i00 + 1;
        indices[k++] = i00 + n;
        indices[k++] = i00 + n + 1;
      }
    }
    this.vbo = dev.createBuffer({ label: 'bench.patch.vbo', usage: 'vertex', size: vertices.byteLength, restore: (h) => dev.writeBuffer(h, 0, vertices) });
    dev.writeBuffer(this.vbo, 0, vertices);
    this.ibo = dev.createBuffer({ label: 'bench.patch.ibo', usage: 'index', size: indices.byteLength, restore: (h) => dev.writeBuffer(h, 0, indices) });
    dev.writeBuffer(this.ibo, 0, indices);
  }

  static readonly vertexStream = {
    stepMode: 'vertex' as const,
    stride: PATCH_VERTEX_STRIDE,
    attributes: [{ location: 0, format: vf('u8', 2, 'int'), offset: 0 }],
  };
  static readonly instanceStream = {
    stepMode: 'instance' as const,
    stride: PATCH_INSTANCE_STRIDE,
    attributes: [{ location: 1, format: vf('u16', 2, 'int'), offset: 0 }],
  };

  dispose(): void {
    this.dev.destroyBuffer(this.vbo);
    this.dev.destroyBuffer(this.ibo);
  }
}

/** Writes the chunk list of a culler into a u16×2 staging array; returns the count. */
export function writeChunkInstances(culler: PatchCuller, chunks: number, out: Uint16Array): number {
  const n = culler.count;
  const vis = culler.visible;
  for (let i = 0; i < n; i++) {
    const k = vis[i]!;
    out[i * 2] = k % chunks;
    out[i * 2 + 1] = (k / chunks) | 0;
  }
  return n;
}

const PASS_LAYOUT = std140Layout([
  { name: 'bands', type: 'vec4' },
  { name: 'params', type: 'ivec4' },
  { name: 'misc', type: 'vec4' },
]);

const PASS_BLOCK = /* glsl */ `
layout(std140) uniform BenchTerrain {
  vec4 u_bands;    // shore top WU, highland start WU, highland blend WU, rock slope (1 - n.y)
  ivec4 u_tparams; // x: splat layers (0/4/8), y: has water, z: water level raw, w: decal count
  vec4 u_tmisc;    // x: 1 / sizeWu, y: albedo tiles per WU, z: underwater darkening, w: 0
};
`;

const VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${TERRAIN_HEIGHT_GLSL}
${PASS_BLOCK}
uniform highp usampler2D u_decalChunks;
layout(location = 0) in uvec2 a_local;
layout(location = 1) in uvec2 a_chunk;
out vec3 v_pos;
out vec3 v_normal;
out vec2 v_tile;
out vec2 v_splatUV;
out float v_heightWU;
flat out uint v_decals;

void main() {
  ivec2 cell = ivec2(a_chunk) * ${TERRAIN_PATCH_WU} + ivec2(a_local);
  ivec2 xz = cell * 4096;
  int h = terrainHeightRaw(xz);
  vec3 rel = vec3(ivec3(xz.x, h, xz.y) - u_camPosInt.xyz) / 4096.0;
  v_pos = rel;
  v_normal = terrainNormal(cell);
  v_tile = (rel.xz + u_camMod.xz) * u_tmisc.y;
  v_splatUV = vec2(cell) * u_tmisc.x;
  v_heightWU = float(h) / 4096.0;
  v_decals = texelFetch(u_decalChunks, ivec2(a_chunk), 0).r;
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;

function fragment(csm: boolean): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${PASS_BLOCK}
${TERRAIN_SPLAT_GLSL}
${csm ? SHADOW_RECEIVE_GLSL : ''}
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
  vec3 albedo = terrainAlbedo(u_albedo, u_splat0, u_splat1, v_tile, v_splatUV, n, v_heightWU, u_bands, u_tparams.x);
  float ndl = max(dot(n, u_sunDir.xyz), 0.0);
  ${csm ? 'ndl *= shadowFactor(v_pos, n);' : ''}
  vec3 hemi = mix(u_groundColor.rgb, u_skyColor.rgb, n.y * 0.5 + 0.5);
  vec3 color = albedo * (hemi + u_sunColor.rgb * ndl);
  if (u_tparams.y != 0) {
    float depth = float(u_tparams.z) / 4096.0 - v_heightWU;
    color *= 1.0 - u_tmisc.z * clamp(depth / 6.0, 0.0, 1.0);
  }
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
    float dist = length(v_pos.xz - c);
    float r = float(t0.z) / 4096.0;
    float w = float(t0.w) / 4096.0;
    float cov;
    if (t1.x == 0) {
      cov = 1.0 - smoothstep(-aa, aa, abs(dist - r) - 0.5 * w);
    } else {
      cov = 1.0 - smoothstep(r - max(w, aa), r + aa, dist);
    }
    uint rgba = uint(t1.y);
    vec4 dc = vec4(float(rgba & 255u), float((rgba >> 8u) & 255u), float((rgba >> 16u) & 255u), float(rgba >> 24u)) / 255.0;
    color = mix(color, dc.rgb * (1.0 + 0.6 * u_tmisc.w), cov * dc.a);
  }
  float dist = length(v_pos - u_camFrac.xyz);
  float fog = clamp((dist - u_fog.w) / max(u_fog.w, 1.0), 0.0, 0.85);
  o_color = vec4(mix(color, u_fog.rgb, fog), 1.0);
}
`;
}

export interface BenchTerrainOptions {
  readonly splatLayers: 0 | 4 | 8;
  /** CSM receive (needs the shadow bind group at draw time). */
  readonly csm: boolean;
  /** Emissive boost of the decals in HDR (bloom picks the spot rings up). */
  readonly decalGlow: number;
}

export class BenchTerrainPass {
  readonly pipeline: PipeH;
  readonly culler: PatchCuller;
  readonly decals: DecalBinner;
  readonly chunks: number;
  private readonly instRing: BufH;
  private readonly instStaging: Uint16Array;
  private readonly ubo: BufH;
  private readonly group: BindGroupH;
  private readonly textures: TexH[] = [];
  private readonly data = new Std140Writer(PASS_LAYOUT);
  private readonly streams: VertexStreamBinding[];
  private readonly shadow: BindGroupH | null;
  private region = 0;
  private visibleCount = 0;
  private lastCamVersion = -1;

  constructor(
    private readonly dev: GpuDevice,
    private readonly frameGroup: BindGroupH,
    readonly heights: TerrainHeightResources,
    readonly patch: TerrainPatchMesh,
    shadowGroup: BindGroupH | null,
    opts: BenchTerrainOptions,
  ) {
    const desc = heights.desc;
    this.chunks = heights.bounds.chunks;
    this.culler = new PatchCuller(heights.bounds);
    this.decals = new DecalBinner(desc.sizeWu);
    const csm = opts.csm && shadowGroup !== null;
    this.pipeline = dev.createPipeline({
      label: `bench.terrain${csm ? '.csm' : ''}`,
      vertex: VS,
      fragment: fragment(csm),
      streams: [TerrainPatchMesh.vertexStream, TerrainPatchMesh.instanceStream],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'TerrainHeight', slot: SLOT_TERRAIN_HEIGHT },
        { name: 'BenchTerrain', slot: SLOT_PASS },
        ...(csm ? [{ name: 'ShadowRecv', slot: SLOT_SHADOW }] : []),
      ],
      samplers: [
        { name: 'u_heightmap', unit: UNIT_HEIGHTMAP },
        { name: 'u_albedo', unit: UNIT_ALBEDO },
        { name: 'u_splat0', unit: UNIT_SPLAT0 },
        { name: 'u_splat1', unit: UNIT_SPLAT1 },
        { name: 'u_decalData', unit: UNIT_DECAL_DATA },
        { name: 'u_decalChunks', unit: UNIT_DECAL_CHUNKS },
        { name: 'u_decalList', unit: UNIT_DECAL_LIST },
        ...(csm ? SHADOW_SAMPLERS : []),
      ],
      cullMode: 'back',
      depthTest: true,
      depthWrite: true,
      depthCompare: 'less',
    });
    this.shadow = csm ? shadowGroup : null;

    const maxPatches = this.chunks * this.chunks;
    this.instStaging = new Uint16Array(maxPatches * 2);
    this.instRing = dev.createBuffer({ label: 'bench.terrain.ring', usage: 'vertex', size: maxPatches * PATCH_INSTANCE_STRIDE * RING_REGIONS, dynamic: true });
    this.streams = [
      { buffer: patch.vbo, offset: 0 },
      { buffer: this.instRing, offset: 0 },
    ];

    // Albedo array (8 procedural layers, mipmapped).
    const layers = generateTerrainAlbedo();
    const size = TERRAIN_ALBEDO_SIZE;
    const uploadAlbedo = (h: TexH): void => {
      for (let l = 0; l < TERRAIN_ALBEDO_LAYERS; l++) dev.writeTexture(h, { x: 0, y: 0, width: size, height: size }, layers[l]!, l);
      dev.generateMipmaps(h);
    };
    const albedo = dev.createTexture({
      label: 'bench.terrain.albedo',
      width: size,
      height: size,
      format: 'rgba8',
      dimension: '2d-array',
      layers: TERRAIN_ALBEDO_LAYERS,
      mipLevels: Math.log2(size) + 1,
      filter: 'linear',
      wrap: 'repeat',
      restore: uploadAlbedo,
    });
    uploadAlbedo(albedo);
    this.textures.push(albedo);

    const sp = desc.splat;
    const res = sp?.resolution ?? 1;
    const zero = new Uint8Array(4);
    const splat: TexH[] = [0, 1].map((p) => {
      const plane = sp?.planes[p] ?? (sp === undefined ? zero : new Uint8Array(res * res * 4));
      const rect = { x: 0, y: 0, width: res, height: res };
      const h = dev.createTexture({ label: `bench.terrain.splat${p}`, width: res, height: res, format: 'rgba8', filter: 'linear', restore: (t) => dev.writeTexture(t, rect, plane) });
      dev.writeTexture(h, rect, plane);
      return h;
    });
    this.textures.push(...splat);

    const dec = this.decals;
    const dataRect = { x: 0, y: 0, width: DECAL_DATA_WIDTH, height: DECAL_DATA_HEIGHT };
    const chunkRect = { x: 0, y: 0, width: this.chunks, height: this.chunks };
    const listRect = { x: 0, y: 0, width: DECAL_LIST_WIDTH, height: dec.listRows };
    const decalData = dev.createTexture({ label: 'bench.decals.data', width: DECAL_DATA_WIDTH, height: DECAL_DATA_HEIGHT, format: 'rgba32i', restore: (h) => dev.writeTexture(h, dataRect, dec.data) });
    const decalChunks = dev.createTexture({ label: 'bench.decals.chunks', width: this.chunks, height: this.chunks, format: 'r32ui', restore: (h) => dev.writeTexture(h, chunkRect, dec.chunkIndex) });
    const decalList = dev.createTexture({ label: 'bench.decals.list', width: DECAL_LIST_WIDTH, height: dec.listRows, format: 'r32ui', restore: (h) => dev.writeTexture(h, listRect, dec.list) });
    this.textures.push(decalData, decalChunks, decalList);
    dec.bin([]);
    this.uploadDecals();

    this.ubo = dev.createBuffer({ label: 'bench.terrain.ubo', usage: 'uniform', size: PASS_LAYOUT.size, restore: (h) => dev.writeBuffer(h, 0, this.data.bytes) });
    this.group = dev.createBindGroup({
      label: 'bench.terrain',
      buffers: [{ slot: SLOT_PASS, buffer: this.ubo }],
      textures: [
        { unit: UNIT_ALBEDO, texture: albedo },
        { unit: UNIT_SPLAT0, texture: splat[0]! },
        { unit: UNIT_SPLAT1, texture: splat[1]! },
        { unit: UNIT_DECAL_DATA, texture: decalData },
        { unit: UNIT_DECAL_CHUNKS, texture: decalChunks },
        { unit: UNIT_DECAL_LIST, texture: decalList },
      ],
    });

    const b = heights.bounds;
    const minWU = b.mapMinRaw / 4096;
    const maxWU = b.mapMaxRaw / 4096;
    const range = Math.max(1, maxWU - minWU);
    const water = desc.waterLevelRaw;
    const layersUsed = sp === undefined ? 0 : Math.min(sp.layers, opts.splatLayers);
    const w = this.data;
    w.vec4(PASS_LAYOUT.offsetOf('bands'), (water !== null ? water / 4096 : minWU) + 1.2, minWU + range * 0.72, range * 0.08 + 0.5, 0.28);
    w.ivec4(PASS_LAYOUT.offsetOf('params'), layersUsed, water !== null ? 1 : 0, water ?? 0, 0);
    w.vec4(PASS_LAYOUT.offsetOf('misc'), 1 / desc.sizeWu, 1 / 8, 0.45, opts.decalGlow);
    dev.writeBuffer(this.ubo, 0, w.bytes);
  }

  setDecals(decals: readonly TerrainDecal[]): void {
    const st = this.decals.bin(decals);
    this.uploadDecals();
    this.data.int(PASS_LAYOUT.offsetOf('params') + 12, st.decals);
    this.dev.writeBuffer(this.ubo, 0, this.data.bytes);
  }

  private uploadDecals(): void {
    const dev = this.dev;
    const dec = this.decals;
    dev.writeTexture(this.textures[3]!, { x: 0, y: 0, width: DECAL_DATA_WIDTH, height: DECAL_DATA_HEIGHT }, dec.data);
    dev.writeTexture(this.textures[4]!, { x: 0, y: 0, width: this.chunks, height: this.chunks }, dec.chunkIndex);
    dev.writeTexture(this.textures[5]!, { x: 0, y: 0, width: DECAL_LIST_WIDTH, height: dec.listRows }, dec.list);
  }

  /** Visible patch list (only on camera changes). */
  prepare(frustum: Frustum, camPosInt: ArrayLike<number>, cameraVersion: number): number {
    if (cameraVersion === this.lastCamVersion) return this.visibleCount;
    this.lastCamVersion = cameraVersion;
    this.culler.cull(frustum, camPosInt);
    const n = writeChunkInstances(this.culler, this.chunks, this.instStaging);
    this.visibleCount = n;
    this.region = (this.region + 1) % RING_REGIONS;
    if (n > 0) this.dev.writeBuffer(this.instRing, this.region * this.chunks * this.chunks * PATCH_INSTANCE_STRIDE, this.instStaging, 0, n * 2);
    return n;
  }

  /** Forces a new patch list on the next prepare (context restore). */
  invalidate(): void {
    this.lastCamVersion = -1;
  }

  draw(enc: PassEncoder): void {
    if (this.visibleCount === 0) return;
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(this.frameGroup);
    enc.setBindGroup(this.heights.group);
    enc.setBindGroup(this.group);
    if (this.shadow !== null) enc.setBindGroup(this.shadow);
    this.streams[1]!.offset = this.region * this.chunks * this.chunks * PATCH_INSTANCE_STRIDE;
    enc.setVertexStreams(this.streams);
    enc.setIndexBuffer(this.patch.ibo, 'uint16');
    enc.drawIndexedInstanced(PATCH_INDEX_COUNT, this.visibleCount);
  }

  dispose(): void {
    const dev = this.dev;
    dev.destroyBindGroup(this.group);
    dev.destroyBuffer(this.ubo);
    dev.destroyBuffer(this.instRing);
    for (const t of this.textures) dev.destroyTexture(t);
    dev.destroyPipeline(this.pipeline);
  }
}
