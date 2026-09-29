/**
 * Reusable GLSL ES 3.00 building blocks of the terrain (PLAN §3.7). Exported as strings so other
 * pipelines (water, height probe, tools/render-bench shadow/terrain variants) compose the very same
 * code – in particular the height function, which must be bit-identical to the sim (`@faf/rules`).
 */
import { std140Layout } from '../std140.ts';

/** Uniform-block slot of `TerrainHeight` (Frame = 0, Palette = 1, pass block = 2). */
export const SLOT_TERRAIN_HEIGHT = 3;
/** Texture unit of `u_heightmap` in every pipeline that includes {@link TERRAIN_HEIGHT_GLSL}. */
export const UNIT_HEIGHTMAP = 0;

/** std140 layout of the `TerrainHeight` block: ivec4 (sizeWu, dim, heightScaleRaw, 0). */
export const TERRAIN_HEIGHT_LAYOUT = std140Layout([{ name: 'heightParams', type: 'ivec4' }]);

/**
 * Height function (integer, bit-identical to `rules.sampleHeightRaw` and `sampleTerrainHeightRaw`).
 * Declares `u_heightmap` (R16UI, dim × dim, texel (x, z) = sample z·dim + x) and the `TerrainHeight`
 * block. Provides:
 * - `uint terrainHeightRawU(ivec2 xzRaw)` / `int terrainHeightRaw(ivec2 xzRaw)`: height in Q20.12 raw
 * - `int terrainSampleRaw(ivec2 cell)`: raw height of a grid sample (clamped to the map)
 * - `vec3 terrainNormal(ivec2 cell)`: normal from central differences of the grid samples
 */
export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
uniform highp usampler2D u_heightmap;
layout(std140) uniform TerrainHeight {
  ivec4 u_heightParams; // x: sizeWu, y: dim, z: heightScaleRaw (raw per u16 step), w: 0
};

uint terrainHeightRawU(ivec2 xzRaw) {
  int maxRaw = u_heightParams.x * 4096 - 16;
  int xr = clamp(xzRaw.x, 0, maxRaw);
  int zr = clamp(xzRaw.y, 0, maxRaw);
  int cx = xr >> 12;
  int cz = zr >> 12;
  uint fx = uint((xr >> 4) & 255);
  uint fz = uint((zr >> 4) & 255);
  uint h00 = texelFetch(u_heightmap, ivec2(cx, cz), 0).r;
  uint h10 = texelFetch(u_heightmap, ivec2(cx + 1, cz), 0).r;
  uint h01 = texelFetch(u_heightmap, ivec2(cx, cz + 1), 0).r;
  uint h11 = texelFetch(u_heightmap, ivec2(cx + 1, cz + 1), 0).r;
  uint a = h00 * (256u - fx) + h10 * fx;
  uint b = h01 * (256u - fx) + h11 * fx;
  uint c = a * (256u - fz) + b * fz; // < 2^32
  uint s = uint(u_heightParams.z);
  return (c >> 16u) * s + (((c & 0xffffu) * s) >> 16u);
}

int terrainHeightRaw(ivec2 xzRaw) {
  return int(terrainHeightRawU(xzRaw));
}

int terrainSampleRaw(ivec2 cell) {
  ivec2 c = clamp(cell, ivec2(0), ivec2(u_heightParams.y - 1));
  return int(texelFetch(u_heightmap, c, 0).r) * u_heightParams.z;
}

vec3 terrainNormal(ivec2 cell) {
  float hl = float(terrainSampleRaw(cell - ivec2(1, 0)));
  float hr = float(terrainSampleRaw(cell + ivec2(1, 0)));
  float hd = float(terrainSampleRaw(cell - ivec2(0, 1)));
  float hu = float(terrainSampleRaw(cell + ivec2(0, 1)));
  return normalize(vec3(hl - hr, 2.0 * 4096.0, hd - hu));
}
`;

/** Number of layers of the runtime-generated albedo array (auto-splat uses 0..3, splatmaps 0..7). */
export const TERRAIN_ALBEDO_LAYERS = 8;

/**
 * Auto-splat + splatmap blending (M1). Pure functions, samplers as parameters:
 * - `vec4 terrainAutoWeights(float heightWU, float slope, vec4 bands)` – weights of the four
 *   procedural layers 0 shore/sand, 1 grass, 2 rock, 3 highland. `bands`: x = top of the shore band
 *   (WU, water level + band), y = highland start (WU), z = highland blend width (WU), w = rock slope
 *   threshold (1 − n.y). `slope` = 1 − n.y.
 * - `vec3 terrainAlbedo(albedo, splat0, splat1, tileUV, splatUV, n, heightWU, bands, splatLayers)` –
 *   auto-splat result, then painted splat layers (0, 4 or 8) lerped on top in layer order (FA-style).
 */
export const TERRAIN_SPLAT_GLSL = /* glsl */ `
vec4 terrainAutoWeights(float heightWU, float slope, vec4 bands) {
  float shore = 1.0 - smoothstep(bands.x - 0.6, bands.x + 0.6, heightWU);
  float high = smoothstep(bands.y, bands.y + max(bands.z, 0.001), heightWU);
  float rock = smoothstep(bands.w, bands.w + 0.12, slope);
  float grass = max(0.0, 1.0 - shore - high);
  vec4 w = vec4(shore, grass, rock, high);
  w.xyw *= 1.0 - rock;
  return w / max(w.x + w.y + w.z + w.w, 1e-4);
}

vec3 terrainLayer(highp sampler2DArray albedo, vec2 tileUV, int layer) {
  return texture(albedo, vec3(tileUV, float(layer))).rgb;
}

vec3 terrainAlbedo(highp sampler2DArray albedo, highp sampler2D splat0, highp sampler2D splat1,
                   vec2 tileUV, vec2 splatUV, vec3 n, float heightWU, vec4 bands, int splatLayers) {
  vec4 w = terrainAutoWeights(heightWU, 1.0 - n.y, bands);
  vec3 col = terrainLayer(albedo, tileUV, 0) * w.x + terrainLayer(albedo, tileUV, 1) * w.y
           + terrainLayer(albedo, tileUV, 2) * w.z + terrainLayer(albedo, tileUV, 3) * w.w;
  if (splatLayers >= 4) {
    vec4 s0 = texture(splat0, splatUV);
    col = mix(col, terrainLayer(albedo, tileUV, 0), s0.r);
    col = mix(col, terrainLayer(albedo, tileUV, 1), s0.g);
    col = mix(col, terrainLayer(albedo, tileUV, 2), s0.b);
    col = mix(col, terrainLayer(albedo, tileUV, 3), s0.a);
  }
  if (splatLayers >= 8) {
    vec4 s1 = texture(splat1, splatUV);
    col = mix(col, terrainLayer(albedo, tileUV, 4), s1.r);
    col = mix(col, terrainLayer(albedo, tileUV, 5), s1.g);
    col = mix(col, terrainLayer(albedo, tileUV, 6), s1.b);
    col = mix(col, terrainLayer(albedo, tileUV, 7), s1.a);
  }
  return col;
}
`;

/** Base colors (linear 0..1) of the 8 procedural albedo layers. */
export const TERRAIN_LAYER_COLORS: readonly (readonly [number, number, number])[] = [
  [0.62, 0.56, 0.4], // 0 shore / sand
  [0.25, 0.38, 0.15], // 1 grass
  [0.38, 0.36, 0.33], // 2 rock
  [0.56, 0.54, 0.48], // 3 highland (pale weathered rock)
  [0.36, 0.27, 0.18], // 4 dirt
  [0.5, 0.47, 0.25], // 5 dry grass
  [0.2, 0.2, 0.21], // 6 dark rock
  [0.18, 0.3, 0.2], // 7 moss
];

/** Texels per side of every albedo layer. */
export const TERRAIN_ALBEDO_SIZE = 128;

/**
 * Generates the procedural albedo array (RGBA8, `TERRAIN_ALBEDO_LAYERS` layers of
 * `TERRAIN_ALBEDO_SIZE²`, tileable): layer color × tileable value noise (two octaves) with a
 * per-layer pattern (sand ripples, grass speckles, rock strata). Deterministic.
 */
export function generateTerrainAlbedo(size = TERRAIN_ALBEDO_SIZE): Uint8Array[] {
  const layers: Uint8Array[] = [];
  for (let l = 0; l < TERRAIN_ALBEDO_LAYERS; l++) {
    const base = TERRAIN_LAYER_COLORS[l]!;
    const out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        let f = 0.55 * valueNoise(u, v, 8, l * 7 + 1) + 0.3 * valueNoise(u, v, 32, l * 7 + 2) + 0.15 * valueNoise(u, v, 64, l * 7 + 3);
        if (l === 0) f = f * 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((u * 6 + v * 2) * Math.PI * 2 + f * 3)); // ripples
        if (l === 2 || l === 6) f = f * 0.6 + 0.4 * (0.5 + 0.5 * Math.sin((v * 5 + f * 0.8) * Math.PI * 2)); // strata
        const k = 0.72 + 0.56 * f;
        const o = (y * size + x) * 4;
        out[o] = clamp255(base[0] * k * 255);
        out[o + 1] = clamp255(base[1] * k * 255);
        out[o + 2] = clamp255(base[2] * k * 255);
        out[o + 3] = 255;
      }
    }
    layers.push(out);
  }
  return layers;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Tileable value noise on a `cells`-periodic lattice, 0..1. */
function valueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const h = (i: number, j: number): number => hash01(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const c = h(x0, y0 + 1);
  const d = h(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function hash01(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
