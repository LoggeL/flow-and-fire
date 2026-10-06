/**
 * GLSL of the stateless particle pass (PLAN §3.7 "f(t − t0) im VS, Kurven-LUT").
 *
 * The vertex shader rebuilds every particle from its spawn record alone: per-particle randoms from
 * the u32 hash (bit-identical to `particleRandoms`), motion in closed form (identical to
 * `evalParticle`), size/color/blend/stretch from the curve LUT. `vs-mirror.ts` is the line-by-line
 * JS mirror of {@link PARTICLE_VS}; the parity test compares it with `evalParticle`.
 *
 * The fragment shader draws procedural shapes and writes premultiplied color with alpha·blend, so
 * additive (blend 0) and alpha particles (blend 1) share one draw with blend 'premultiplied'.
 */
import { FRAME_BLOCK_GLSL } from '@faf/render';
import { FX_COMMON_GLSL, FX_VIEW_BLOCK_GLSL } from '../core/view.ts';
import { LUT_WIDTH } from '../effects/curves.ts';

/** Offset in WU that lifts 'ground' quads above the emitter height (avoids z-fighting with terrain). */
export const GROUND_LIFT_WU = 0.05;
/** Velocity streaks: quad length = size + stretch · |v_screen| · STREAK_SECONDS. */
export const STREAK_SECONDS = 0.05;

/** u32 hash of random.ts (fxFmix32 / fxHash32) in GLSL; needs `precision highp int`. */
export const PARTICLE_HASH_GLSL = /* glsl */ `
uint fxFmix(uint h) {
  h ^= h >> 16u;
  h *= 0x85EBCA6Bu;
  h ^= h >> 13u;
  h *= 0xC2B2AE35u;
  h ^= h >> 16u;
  return h;
}
uint fxHash32(uint a, uint b, uint c) {
  uint h = fxFmix(a + 0x9E3779B9u);
  h = fxFmix(h ^ (b + 0x7F4A7C15u));
  return fxFmix(h ^ (c + 0x94D049BBu));
}
// (lo, hi) 16-bit halves of a hash as uniforms in [0, 1) – particleRandoms' lo()/hi().
vec2 fxLoHi(uint h) {
  return vec2(float(h & 0xFFFFu), float(h >> 16u)) * (1.0 / 65536.0);
}
`;

export const PARTICLE_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${FRAME_BLOCK_GLSL}
${FX_VIEW_BLOCK_GLSL}
${FX_COMMON_GLSL}
${PARTICLE_HASH_GLSL}
uniform highp sampler2D u_fxCurveLut;       // RGBA16F, ${LUT_WIDTH} x 2·layers, linear
uniform highp sampler2D u_fxParticleLayers; // RGBA32F, 8 x layers (LAYER_STRIDE floats per layer)

layout(location = 0) in ivec3 a_origin;
layout(location = 1) in float a_t0;
layout(location = 2) in uvec4 a_vec;       // f16 bits: axis | target delta (xyz), scale (w)
layout(location = 3) in uvec2 a_layerSeed;
layout(location = 4) in vec4 a_tint;

out vec2 v_uv;
out vec4 v_color;   // linear HDR rgb, alpha
out vec4 v_misc;    // x: blend, y: shape id, z: per-particle random, w: normalized age
out float v_streak; // quad length / size (velocity streaks), 1 otherwise
out vec3 v_light;   // sun direction in quad-uv space (xy) and towards the viewer (z), for smoke volume

const float PI = 3.14159265358979;
const float TWO_PI = 6.28318530717959;
const float LUT_W = ${LUT_WIDTH}.0;

// Orthonormal basis around a unit vector (Duff et al.), identical to random.ts orthonormalBasis.
void fxOnb(vec3 n, out vec3 b1, out vec3 b2) {
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float b = n.x * n.y * a;
  b1 = vec3(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  b2 = vec3(b, s + n.y * n.y * a, -n.y);
}

vec4 layerTexel(int layer, int i) {
  return texelFetch(u_fxParticleLayers, ivec2(i, layer), 0);
}

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  v_uv = corner;
  v_streak = 1.0;
  int layer = int(a_layerSeed.x);
  uint seed = a_layerSeed.y;
  uint ul = uint(layer);
  vec4 L0 = layerTexel(layer, 0); // lifeMin lifeMax speedMin speedMax
  vec4 L2 = layerTexel(layer, 2); // delayMin delayMax spinMin spinMax
  vec2 r0 = fxLoHi(fxHash32(seed, ul, 0u)); // uLife uSpeed
  vec2 r4 = fxLoHi(fxHash32(seed, ul, 4u)); // uDelay uPhase
  float life = L0.x + (L0.y - L0.x) * r0.x;
  float delay = L2.x + (L2.y - L2.x) * r4.x;
  float age = u_fxTime.x - a_t0;
  if (age < 0.0) age += FX_TIME_WRAP;
  float t = age - delay;
  if (!(t >= 0.0 && t < life)) {
    // Dead or not started yet: degenerate quad outside the clip volume.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_color = vec4(0.0);
    v_misc = vec4(0.0);
    v_light = vec3(0.0, 0.0, 1.0);
    return;
  }
  vec4 L1 = layerTexel(layer, 1); // cosSpread gravity drag emitRadius
  vec4 L3 = layerTexel(layer, 3); // sizeJitter stretch shape orient
  vec4 L4 = layerTexel(layer, 4); // motion priority tint lutRow
  vec2 r1 = fxLoHi(fxHash32(seed, ul, 1u)); // uCos uPhi
  vec2 r2 = fxLoHi(fxHash32(seed, ul, 2u)); // uSpin uAngle
  vec2 r3 = fxLoHi(fxHash32(seed, ul, 3u)); // uSize uRad
  float a = t / life;
  vec2 v01 = unpackHalf2x16(a_vec.x | (a_vec.y << 16u));
  vec2 v23 = unpackHalf2x16(a_vec.z | (a_vec.w << 16u));
  vec3 vec = vec3(v01, v23.x);
  float scale = v23.y;
  float emitR = L1.w * scale * r3.y;
  float g = L1.y;
  vec3 p;
  vec3 vel;
  if (L4.x > 0.5) {
    // Stream: origin -> origin + D over the lifetime, lateral wave, sagging arc.
    vec4 L5 = layerTexel(layer, 5); // streamWave streamWaves
    float len = length(vec);
    vec3 axisS = len > 1e-6 ? vec / len : vec3(0.0, 1.0, 0.0);
    vec3 c1;
    vec3 c2;
    fxOnb(axisS, c1, c2);
    float psi = TWO_PI * r1.y;
    vec3 n = c1 * cos(psi) + c2 * sin(psi);
    float wave = L5.x * scale;
    float waves = L5.y;
    float pa = PI * a;
    float wArg = TWO_PI * (waves * a + r4.y);
    float lat = emitR * (1.0 - a) + wave * sin(pa) * sin(wArg);
    float latDa = -emitR + wave * (PI * cos(pa) * sin(wArg) + sin(pa) * TWO_PI * waves * cos(wArg));
    p = vec * a + n * lat + vec3(0.0, 0.5 * g * t * (t - life), 0.0);
    vel = (vec + n * latDa) / life + vec3(0.0, 0.5 * g * (2.0 * t - life), 0.0);
  } else {
    // Ballistic: cone direction, closed-form drag + gravity.
    vec4 L7 = layerTexel(layer, 7); // cosSpreadInner
    vec3 axis = dot(vec, vec) > 1e-12 ? normalize(vec) : vec3(0.0, 1.0, 0.0);
    float cosIn = L7.x;
    float cosT = cosIn - r1.x * (cosIn - L1.x);
    float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    float phi = TWO_PI * r1.y;
    vec3 b1;
    vec3 b2;
    fxOnb(axis, b1, b2);
    vec3 d = b1 * (sinT * cos(phi)) + b2 * (sinT * sin(phi)) + axis * cosT;
    float speed = (L0.z + (L0.w - L0.z) * r0.y) * scale;
    vec3 v0 = d * speed;
    vec3 p0 = d * emitR;
    float k = L1.z;
    if (k <= 1e-6) {
      p = p0 + v0 * t + vec3(0.0, 0.5 * g * t * t, 0.0);
      vel = v0 + vec3(0.0, g * t, 0.0);
    } else {
      float e = exp(-k * t);
      float f = (1.0 - e) / k;
      float gk = g / k;
      p = p0 + v0 * f + vec3(0.0, gk * t - gk * f, 0.0);
      vel = v0 * e + vec3(0.0, gk - gk * e, 0.0);
    }
  }
  // Curves (linear filtering at the baked sample positions, like sampleBaked on the CPU).
  float lutH = float(textureSize(u_fxCurveLut, 0).y);
  float u = (a * (LUT_W - 1.0) + 0.5) / LUT_W;
  float row = L4.w;
  vec4 col = texture(u_fxCurveLut, vec2(u, (row + 0.5) / lutH));
  vec4 sz = texture(u_fxCurveLut, vec2(u, (row + 1.5) / lutH));
  float size = sz.x * scale * (1.0 + L3.x * (2.0 * r3.x - 1.0));
  if (L4.z > 0.5) col.rgb *= a_tint.rgb;
  float rot = TWO_PI * r2.y + (L2.z + (L2.w - L2.z) * r2.x) * t;

  vec3 center = fxRelPos(a_origin) + p;
  float hs = 0.5 * size;
  float cr = cos(rot);
  float sr = sin(rot);
  vec2 rc = vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);
  int orient = int(L3.w + 0.5);
  // Sun in the quad's uv frame (screen axes rotated back by the particle rotation).
  vec3 sun = u_sunDir.xyz;
  vec2 ls = orient == 2 ? vec2(sun.x, sun.z) : vec2(dot(sun, u_fxRight.xyz), dot(sun, u_fxUp.xyz));
  vec2 lq = orient == 1 ? ls : vec2(cr * ls.x + sr * ls.y, -sr * ls.x + cr * ls.y);
  float lz = orient == 2 ? sun.y : -dot(sun, u_fxFwd.xyz);
  v_light = normalize(vec3(lq, max(lz, 0.0) + 0.35));
  vec3 world;
  if (orient == 1) {
    // Streak along the screen-plane velocity, head at the particle position.
    vec3 fwd = u_fxFwd.xyz;
    vec3 vp = vel - fwd * dot(vel, fwd);
    float sp = length(vp);
    vec3 along = sp > 1e-4 ? vp / sp : u_fxRight.xyz;
    vec3 across = cross(fwd, along);
    float qlen = size + sz.z * sp * ${STREAK_SECONDS};
    v_streak = qlen / max(size, 1e-6);
    vec3 c = center - along * (0.5 * (qlen - size));
    world = c + along * (corner.x * 0.5 * qlen) + across * (corner.y * hs);
  } else if (orient == 2) {
    // Flat on the XZ plane (shock-wave rings, ground fire).
    world = center + vec3(rc.x * hs, ${GROUND_LIFT_WU}, rc.y * hs);
  } else {
    world = center + u_fxRight.xyz * (rc.x * hs) + u_fxUp.xyz * (rc.y * hs);
  }
  v_color = col;
  v_misc = vec4(sz.y, L3.z, r2.y, a);
  gl_Position = u_viewProj * vec4(world, 1.0);
}
`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
in vec4 v_color;
in vec4 v_misc;
in float v_streak;
in vec3 v_light;
out vec4 o_color;

float fxHash2(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + ivec2(32768));
  uint h = q.x * 0x9E3779B1u ^ (q.y * 0x85EBCA77u + 0x165667B1u);
  h ^= h >> 15u;
  h *= 0x2C1B3C6Du;
  h ^= h >> 12u;
  h *= 0x297A2D39u;
  h ^= h >> 15u;
  return float(h >> 8u) * (1.0 / 16777216.0);
}
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = fxHash2(i);
  float b = fxHash2(i + vec2(1.0, 0.0));
  float c = fxHash2(i + vec2(0.0, 1.0));
  float d = fxHash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
float fxFbm(vec2 p) {
  return 0.5 * fxNoise(p) + 0.3 * fxNoise(p * 2.03 + 7.1) + 0.2 * fxNoise(p * 4.07 + 3.7);
}

void main() {
  vec2 uv = v_uv;
  float r = length(uv);
  int shape = int(v_misc.y + 0.5);
  float rnd = v_misc.z;
  float age = v_misc.w;
  float blend = clamp(v_misc.x, 0.0, 1.0);
  float m;
  vec3 shade = vec3(1.0);
  if (shape == 0) {
    // glow: turbulent hot blob (fbm-eroded silhouette); the emissive part cools towards deep red
    // at its fringe, so stacked fireballs keep an orange rim instead of a flat white disc.
    float n = fxFbm(uv * 1.6 + vec2(rnd * 53.0, rnd * 17.0) + vec2(0.0, -age * 1.3));
    float e = r + (n - 0.5) * 0.55;
    m = exp(-e * e * 3.0) * (1.0 - smoothstep(0.62, 0.98, e));
    float heat = smoothstep(0.05, 0.85, m);
    shade = mix(mix(vec3(1.0, 0.38, 0.14), vec3(1.0), heat), vec3(1.0), blend);
  } else if (shape == 1) {
    // spark: thin hot line, bright head (+x), fading tail; round dot when not stretched
    float across = exp(-uv.y * uv.y * 7.0);
    float x = uv.x * 0.5 + 0.5;
    float streak = smoothstep(0.0, 0.85, x) * (1.0 - smoothstep(0.93, 1.0, x));
    float dot0 = exp(-r * r * 5.0);
    m = mix(dot0, across * streak, clamp((v_streak - 1.0) * 2.0, 0.0, 1.0));
  } else if (shape == 2) {
    // smoke: fbm-eroded puff with pseudo-volume lighting (sphere normal perturbed by the noise,
    // lit by the sun): bright tops, dark bellies – reads against both dark and mid-bright ground.
    vec2 q = uv * 1.7 + vec2(rnd * 37.0, rnd * 91.0) + vec2(0.0, -age * 0.7);
    float n = fxFbm(q);
    float e = r + (n - 0.5) * 0.75;
    m = 1.0 - smoothstep(0.3, 0.92, e);
    m *= 0.55 + 0.65 * n;
    vec3 nrm = normalize(vec3(uv * 0.85 + (n - 0.5) * 0.9, max(0.2, 1.0 - r * r)));
    float diff = clamp(dot(nrm, v_light) * 0.6 + 0.4, 0.0, 1.0);
    shade = vec3((0.45 + 0.9 * diff) * (0.8 + 0.4 * n));
  } else if (shape == 3) {
    // ring: shock front – sharp ragged outer edge, trailing fade towards the centre (wider with age)
    float ang = atan(uv.y, uv.x);
    float rag = 0.7 + 0.6 * fxNoise(vec2(ang * 6.0 + rnd * 40.0, age * 3.0));
    float front = 0.9 - 0.05 * fxNoise(vec2(ang * 3.0 + rnd * 13.0, 1.7));
    float d = front - r;
    float lead = 1.0 - smoothstep(0.0, 0.035, -d);
    float k = 0.03 + 0.05 * age;
    float trail = exp(-max(d, 0.0) / k) * (1.0 - smoothstep(2.0 * k, 4.0 * k, d));
    m = lead * trail * rag * (1.0 - smoothstep(0.96, 1.0, r));
  } else if (shape == 4) {
    // debris: hard irregular chunk, lit from one side
    float ang = atan(uv.y, uv.x);
    float rr = 0.58 + 0.13 * sin(3.0 * ang + rnd * 20.0) + 0.08 * sin(5.0 * ang + rnd * 7.0);
    m = 1.0 - smoothstep(rr - 0.12, rr, r);
    shade = vec3(0.55 + 0.6 * clamp(dot(uv, v_light.xy) + 0.5, 0.0, 1.0));
  } else if (shape == 5) {
    // flash: white-hot core plus a four-ray star
    float core = exp(-r * r * 5.0);
    float rays = exp(-abs(uv.x) * 16.0) + exp(-abs(uv.y) * 16.0);
    m = min(1.0, core + 0.55 * rays * (1.0 - smoothstep(0.15, 1.0, r)));
  } else {
    // stream: soft elongated glow blob that overlaps its neighbours into a continuous pour
    float x = abs(uv.x);
    m = exp(-uv.y * uv.y * 3.5) * (1.0 - smoothstep(0.45, 1.0, x));
    m *= 0.8 + 0.4 * fxNoise(vec2(uv.x * 2.0 + rnd * 23.0, age * 6.0));
  }
  float alpha = clamp(v_color.a * m, 0.0, 1.0);
  // Premultiplied: rgb·alpha, alpha·blend (blend 0 = additive, 1 = alpha blended).
  o_color = vec4(v_color.rgb * shade * alpha, alpha * clamp(v_misc.x, 0.0, 1.0));
}
`;
