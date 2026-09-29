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
 * Small hash / value-noise helpers (GLSL ES 3.00, integer hash): `float terrainHash(ivec2)` in
 * [0, 1], `float terrainValueNoise(vec2 p)` in [−1, 1] (one lattice cell per unit of `p`) and
 * `vec3 terrainValueNoiseD(vec2 p)` (value + analytic gradient, for detail normals). Used for macro
 * variation and detail of the terrain, the mottled water depth and the shore foam.
 */
export const NOISE_GLSL = /* glsl */ `
float terrainHash(ivec2 c) {
  uint h = (uint(c.x) * 0x27d4eb2du) ^ (uint(c.y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h ^= h >> 16u;
  return float(h & 0xffffu) / 65535.0;
}

float terrainValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = terrainHash(c);
  float b = terrainHash(c + ivec2(1, 0));
  float d = terrainHash(c + ivec2(0, 1));
  float e = terrainHash(c + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y) * 2.0 - 1.0;
}

// Value noise with its analytic gradient: (value in [−1, 1], d/dp.x, d/dp.y).
vec3 terrainValueNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  ivec2 c = ivec2(i);
  float a = terrainHash(c);
  float b = terrainHash(c + ivec2(1, 0));
  float d = terrainHash(c + ivec2(0, 1));
  float e = terrainHash(c + ivec2(1, 1));
  float k1 = b - a;
  float k2 = d - a;
  float k3 = a - b - d + e;
  float v = a + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
  return vec3(v * 2.0 - 1.0, 2.0 * du * vec2(k1 + k3 * u.y, k2 + k3 * u.x));
}
`;

/**
 * Auto-splat + splatmap blending (M1). Pure functions, samplers as parameters:
 * - `vec4 terrainAutoWeights(float heightWU, float slope, vec4 bands)` – weights of the four
 *   procedural layers 0 shore/sand, 1 grass, 2 rock, 3 highland. `bands`: x = top of the shore band
 *   (WU, water level + band), y = highland start (WU), z = highland blend width (WU), w = rock slope
 *   threshold (1 − n.y). `slope` = 1 − n.y.
 * - `void terrainLayerWeights(splat0, splat1, splatUV, n, heightWU, bands, splatLayers, out wA, out wB)`
 *   – final weights of the 8 layers (wA = 0..3, wB = 4..7, sum 1): the auto-splat, then the painted
 *   layers (0, 4 or 8) lerped on top in layer order (FA-style). A painted plane 0 with R = 1 covers
 *   the auto-splat completely.
 * - `vec3 terrainAlbedoTri(albedo, splat0, splat1, tilePos, splatUV, n, heightWU, bands, splatLayers,
 *   mixB, triplanar, sharp)` – samples only layers with a weight > 1/256, each from two tiles (the
 *   second rotated by atan(1/3) and scaled by √10/4, still periodic on world mod 32 WU; `mixB` = share
 *   of the second tile) against visible repetition; with `triplanar` the steep faces are projected
 *   along x and z as well (no stretched texels on cliffs). `tilePos` = (x, height, z) × tiles per WU.
 *   `sharp` = (noise 1, noise 2, strength): world-space noise values (caller-provided, so this block
 *   needs no noise helpers) that sharpen the layer transitions (`terrainSharpenWeights`
 *   in GLSL); strength 0 = plain linear blend.
 * - `vec3 terrainAlbedo(albedo, splat0, splat1, tileUV, splatUV, n, heightWU, bands, splatLayers)` –
 *   top projection only, 50/50 tile mix (kept for tools/render-bench).
 * Derivatives are taken once up front (explicit-gradient sampling), so the per-layer branches are safe.
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

void terrainLayerWeights(highp sampler2D splat0, highp sampler2D splat1, vec2 splatUV, vec3 n,
                         float heightWU, vec4 bands, int splatLayers, out vec4 wA, out vec4 wB) {
  wA = terrainAutoWeights(heightWU, 1.0 - n.y, bands);
  wB = vec4(0.0);
  if (splatLayers >= 4) {
    vec4 s = texture(splat0, splatUV);
    wA *= 1.0 - s.r; wA.x += s.r;
    wA *= 1.0 - s.g; wA.y += s.g;
    wA *= 1.0 - s.b; wA.z += s.b;
    wA *= 1.0 - s.a; wA.w += s.a;
  }
  if (splatLayers >= 8) {
    vec4 s = texture(splat1, splatUV);
    float k = 1.0 - s.r; wA *= k; wB *= k; wB.x += s.r;
    k = 1.0 - s.g; wA *= k; wB *= k; wB.y += s.g;
    k = 1.0 - s.b; wA *= k; wB *= k; wB.z += s.b;
    k = 1.0 - s.a; wA *= k; wB *= k; wB.w += s.a;
  }
}

// Sharpened (height-blend style) transitions: every layer gets its own mix of two noise values
// (fixed per-layer directions in noise space) on top of its weight; only layers within 0.3 of
// the strongest survive. Irregular, crisp borders instead of the round bilinear splat blobs.
void terrainSharpenWeights(inout vec4 wA, inout vec4 wB, vec3 sharp) {
  if (sharp.z <= 0.0) return;
  vec4 hA = wA + sharp.z * (sharp.x * vec4(1.0, -0.6, 0.8, -1.0) + sharp.y * vec4(0.5, 1.0, -0.7, 0.2));
  vec4 hB = wB + sharp.z * (sharp.x * vec4(-0.8, 0.7, -0.3, 0.9) + sharp.y * vec4(-0.6, -0.5, 1.0, -0.8));
  hA = mix(vec4(-4.0), hA, step(vec4(0.004), wA));
  hB = mix(vec4(-4.0), hB, step(vec4(0.004), wB));
  vec4 m4 = max(hA, hB);
  float top = max(max(m4.x, m4.y), max(m4.z, m4.w)) - 0.3;
  wA = max(hA - top, 0.0);
  wB = max(hB - top, 0.0);
  float sum = dot(wA, vec4(1.0)) + dot(wB, vec4(1.0));
  wA /= sum;
  wB /= sum;
}

const mat2 TERRAIN_TILE_B = mat2(0.75, -0.25, 0.25, 0.75);

vec3 terrainPlanar(highp sampler2DArray albedo, vec2 uv, vec4 g, vec4 wA, vec4 wB, float mixB) {
  vec2 uvB = TERRAIN_TILE_B * uv + vec2(0.37, 0.61);
  vec2 gxB = TERRAIN_TILE_B * g.xy;
  vec2 gyB = TERRAIN_TILE_B * g.zw;
  vec3 c = vec3(0.0);
  float sum = 0.0;
  for (int i = 0; i < 8; ++i) {
    float w = i < 4 ? wA[i] : wB[i - 4];
    if (w > 0.004) {
      vec3 a = textureGrad(albedo, vec3(uv, float(i)), g.xy, g.zw).rgb;
      vec3 b = textureGrad(albedo, vec3(uvB, float(i)), gxB, gyB).rgb;
      c += w * mix(a, b, mixB);
      sum += w;
    }
  }
  return c / max(sum, 1e-4);
}

vec3 terrainAlbedoTri(highp sampler2DArray albedo, highp sampler2D splat0, highp sampler2D splat1,
                      vec3 tilePos, vec2 splatUV, vec3 n, float heightWU, vec4 bands, int splatLayers,
                      float mixB, bool triplanar, vec3 sharp) {
  vec4 wA;
  vec4 wB;
  terrainLayerWeights(splat0, splat1, splatUV, n, heightWU, bands, splatLayers, wA, wB);
  terrainSharpenWeights(wA, wB, sharp);
  vec2 uvT = tilePos.xz;
  vec2 uvX = vec2(tilePos.z, -tilePos.y);
  vec2 uvZ = vec2(tilePos.x, -tilePos.y);
  vec4 gT = vec4(dFdx(uvT), dFdy(uvT));
  vec4 gX = vec4(dFdx(uvX), dFdy(uvX));
  vec4 gZ = vec4(dFdx(uvZ), dFdy(uvZ));
  if (!triplanar) return terrainPlanar(albedo, uvT, gT, wA, wB, mixB);
  vec3 b = abs(n);
  b *= b;
  b *= b;
  b /= b.x + b.y + b.z;
  vec3 c = vec3(0.0);
  float sum = 0.0;
  if (b.y > 0.03) { c += b.y * terrainPlanar(albedo, uvT, gT, wA, wB, mixB); sum += b.y; }
  if (b.x > 0.03) { c += b.x * terrainPlanar(albedo, uvX, gX, wA, wB, mixB); sum += b.x; }
  if (b.z > 0.03) { c += b.z * terrainPlanar(albedo, uvZ, gZ, wA, wB, mixB); sum += b.z; }
  return c / max(sum, 1e-4);
}

vec3 terrainAlbedo(highp sampler2DArray albedo, highp sampler2D splat0, highp sampler2D splat1,
                   vec2 tileUV, vec2 splatUV, vec3 n, float heightWU, vec4 bands, int splatLayers) {
  return terrainAlbedoTri(albedo, splat0, splat1, vec3(tileUV.x, 0.0, tileUV.y), splatUV, n, heightWU, bands,
                          splatLayers, 0.5, false, vec3(0.0));
}
`;

/** Base colors (linear 0..1) of the 8 procedural albedo layers. */
export const TERRAIN_LAYER_COLORS: readonly (readonly [number, number, number])[] = [
  [0.62, 0.56, 0.4], // 0 shore / sand
  [0.28, 0.33, 0.16], // 1 grass (olive)
  [0.46, 0.44, 0.4], // 2 rock
  [0.6, 0.58, 0.52], // 3 highland (pale weathered rock)
  [0.37, 0.28, 0.19], // 4 dirt
  [0.46, 0.43, 0.25], // 5 dry grass
  [0.31, 0.3, 0.29], // 6 dark rock
  [0.22, 0.3, 0.17], // 7 moss
];

/** Albedo modulation around the layer color: k = 1 + ALBEDO_CONTRAST · (noise − 0.5) (≈ ±25 %). */
const ALBEDO_CONTRAST = 1.05;

/** Texels per side of every albedo layer. */
export const TERRAIN_ALBEDO_SIZE = 128;

/**
 * Generates the procedural albedo array (RGBA8, `TERRAIN_ALBEDO_LAYERS` layers of
 * `TERRAIN_ALBEDO_SIZE²`, tileable): layer color × domain-warped fractal value noise (5 octaves,
 * weighted towards the 0.25–1 WU grain, ≈ ±25 % around the layer color; no periodic patterns such
 * as ripples or strata that would show as stripes when a steep face stretches the texture); grass
 * gets fine blade speckles, rock ridged cracks. Deterministic.
 */
export function generateTerrainAlbedo(size = TERRAIN_ALBEDO_SIZE): Uint8Array[] {
  const layers: Uint8Array[] = [];
  for (let l = 0; l < TERRAIN_ALBEDO_LAYERS; l++) {
    const base = TERRAIN_LAYER_COLORS[l]!;
    const rocky = l === 2 || l === 3 || l === 6;
    const out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let u = x / size;
        let v = y / size;
        // Domain warp (tileable: the warp noise is periodic as well) breaks up the lattice.
        u += 0.06 * (valueNoise(u, v, 4, l * 11 + 7) - 0.5);
        v += 0.06 * (valueNoise(u, v, 4, l * 11 + 8) - 0.5);
        // Weight on the middle and fine octaves (0.25–1 WU at 8 WU per tile): close-up grain without
        // a strong low-frequency component that would show the tile period from afar.
        let f =
          0.12 * valueNoise(u, v, 4, l * 11 + 1) +
          0.25 * valueNoise(u, v, 8, l * 11 + 2) +
          0.25 * valueNoise(u, v, 16, l * 11 + 3) +
          0.2 * valueNoise(u, v, 32, l * 11 + 4) +
          0.18 * valueNoise(u, v, 64, l * 11 + 5);
        if (l === 1 || l === 5 || l === 7) {
          // Blade speckles: sparse dark and light texels.
          const s = valueNoise(u, v, 64, l * 11 + 6);
          f += s > 0.78 ? 0.18 : s < 0.2 ? -0.14 : 0;
        }
        if (rocky) {
          // Ridged cracks (isotropic, no strata lines).
          const r = 1 - Math.abs(2 * valueNoise(u, v, 16, l * 11 + 9) - 1);
          f -= 0.28 * Math.max(0, r - 0.8) * 5 * 0.5;
        }
        const k = 1 + ALBEDO_CONTRAST * (f - 0.5);
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
