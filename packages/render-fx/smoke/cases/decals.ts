/**
 * Decals smoke case: a flat 512-WU ground whose fragment shader evaluates `fxScorch` (SCORCH_GLSL)
 * on the GPU resources of `ScorchTextures` (data rgba32i + cells r32ui, FxScorch UBO) and writes
 * r = 0.8 · albedo multiplier, g = ember / 4 into the canvas. The check compares a grid of ground
 * points (crater across a chunk corner, glowing scorch, rotated scar, overlapping scorch) with the
 * CPU mirror `ScorchDecals.shadeAt` (which the unit tests tie to `scorchShadeReference`). The
 * harness then loses and restores the context: only the restore callbacks of ScorchTextures refill
 * the textures (the pool is not dirty), and the same check runs again.
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME } from '@faf/render';
import type { BindGroupH, PipeH } from '@faf/render';
import {
  FX_COMMON_GLSL,
  FX_VIEW_BLOCK_GLSL,
  SCORCH_GLSL,
  SCORCH_SAMPLERS,
  SCORCH_UNIFORM_BLOCKS,
  SLOT_FX_VIEW,
  ScorchDecals,
  ScorchTextures,
  fxSharedBufferBindings,
} from '../../src/index.ts';
import type { ScorchDecalInput, ScorchShade } from '../../src/index.ts';
import type { SmokeCase, SmokeContext } from '../case.ts';

const WORLD_WU = 512;
/** Base albedo of the ground in the red channel (headroom for crater rims > 1). */
const BASE = 0.8;
/** Tolerance of the comparison in 8-bit steps (after taking the ±0.3 WU neighbourhood into account). */
const TOL = 5;

const GROUND_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${FX_VIEW_BLOCK_GLSL}
${FX_COMMON_GLSL}
out vec3 v_rel;
void main() {
  ivec2 c = ivec2(gl_VertexID & 1, gl_VertexID >> 1);
  ivec3 posRaw = ivec3(c.x * ${WORLD_WU * 4096}, 0, c.y * ${WORLD_WU * 4096});
  v_rel = fxRelPos(posRaw);
  gl_Position = u_viewProj * vec4(v_rel, 1.0);
}
`;

const GROUND_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${SCORCH_GLSL}
in vec3 v_rel;
out vec4 o_color;
void main() {
  vec4 s = fxScorch(v_rel);
  o_color = vec4(${BASE.toFixed(2)} * s.r, s.a * 0.25, 0.0, 1.0);
}
`;

/** Permanent decals (lifetime 0) around the harness camera target (256, 0, 256). */
const DECALS: readonly Omit<ScorchDecalInput, 'tS'>[] = [
  // Crosses the chunk corner at (256, 256): binned into four chunks.
  { xWu: 252, zWu: 251, radiusWu: 10, kind: 'crater', seed: 11, rotation: 0.3, lifetimeS: 0, emberS: 0 },
  { xWu: 272, zWu: 264, radiusWu: 9, kind: 'scorch', seed: 22, rotation: 1.1, lifetimeS: 0, emberS: 60 },
  { xWu: 238, zWu: 271, radiusWu: 9, kind: 'scar', seed: 33, rotation: 0.7, lifetimeS: 0, emberS: 0 },
  { xWu: 263, zWu: 245, radiusWu: 5, kind: 'scorch', seed: 44, rotation: 2.4, lifetimeS: 0, emberS: 0, strength: 0.6 },
];

let pipe: PipeH;
let group: BindGroupH;
let scorch: ScorchDecals;
let tex: ScorchTextures;
let lastT = 0;
const shade: ScorchShade = { mult: 1, ember: 0 };

/** [min, max] of the CPU mirror over the point and its ±0.3 WU neighbours (pixel footprint). */
function mirrorRange(x: number, z: number, t: number, pick: (s: ScorchShade) => number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [dx, dz] of [
    [0, 0],
    [0.3, 0],
    [-0.3, 0],
    [0, 0.3],
    [0, -0.3],
  ] as const) {
    const v = pick(scorch.shadeAt(x + dx, z + dz, t, shade));
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

function compare(ctx: SmokeContext): string[] {
  const errors: string[] = [];
  const px = ctx.readPixels(0, 0, ctx.width, ctx.height);
  let samples = 0;
  let darkened = 0;
  let glowing = 0;
  let bad = 0;
  const worst: string[] = [];
  for (let z = 232; z <= 284; z += 1.25) {
    for (let x = 222; x <= 290; x += 1.25) {
      const [sx, sy] = ctx.project(x, 0, z);
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      if (ix < 1 || iy < 1 || ix >= ctx.width - 1 || iy >= ctx.height - 1) continue;
      samples++;
      const i = (iy * ctx.width + ix) * 4;
      const r = px[i]!;
      const g = px[i + 1]!;
      const [mLo, mHi] = mirrorRange(x, z, lastT, (s) => Math.min(1, BASE * s.mult) * 255);
      const [eLo, eHi] = mirrorRange(x, z, lastT, (s) => Math.min(1, s.ember * 0.25) * 255);
      if (mHi < BASE * 255 - 20) darkened++;
      if (eLo > 10) glowing++;
      const dr = r < mLo - TOL ? mLo - TOL - r : r > mHi + TOL ? r - mHi - TOL : 0;
      const dg = g < eLo - TOL ? eLo - TOL - g : g > eHi + TOL ? g - eHi - TOL : 0;
      if (dr > 0 || dg > 0) {
        bad++;
        if (worst.length < 6) worst.push(`(${x}, ${z}): GPU r=${r} g=${g}, mirror r∈[${mLo.toFixed(0)}, ${mHi.toFixed(0)}] g∈[${eLo.toFixed(0)}, ${eHi.toFixed(0)}]`);
      }
    }
  }
  if (samples < 1500) errors.push(`only ${samples} ground samples on screen`);
  if (darkened < 200) errors.push(`only ${darkened} samples darkened by decals – decals missing?`);
  if (glowing < 8) errors.push(`only ${glowing} samples with ember glow`);
  // Anti-aliased pixel footprints at steep rims may deviate slightly more: allow 0.5 %.
  if (bad > samples * 0.005) errors.push(`${bad}/${samples} samples differ from shadeAt: ${worst.join('; ')}`);
  // Far from every decal the ground is untouched.
  const [fx, fy] = ctx.project(298, 0, 236);
  if (fx < 0 || fy < 0 || fx >= ctx.width || fy >= ctx.height) errors.push(`reference point (298, 236) off screen at (${fx.toFixed(0)}, ${fy.toFixed(0)})`);
  const f = ctx.readPixels(Math.floor(fx), Math.floor(fy), 1, 1);
  if (Math.abs(f[0]! - BASE * 255) > 2 || f[1]! > 1) errors.push(`untouched ground at (298, 236) is ${f[0]}/${f[1]}, expected ${(BASE * 255).toFixed(0)}/0`);
  return errors;
}

export const smokeCase: SmokeCase = {
  name: 'decals',
  frames: 20,
  setup(ctx) {
    const dev = ctx.dev;
    ctx.camera.setTargetWU(256, 0, 258);
    ctx.camera.distance = 95;
    ctx.camera.update();
    scorch = new ScorchDecals({ cap: 64, mapSizeWu: WORLD_WU });
    for (const d of DECALS) scorch.add({ ...d, tS: 0 });
    tex = new ScorchTextures(dev, scorch);
    pipe = dev.createPipeline({
      label: 'smoke.decals.ground',
      vertex: GROUND_VS,
      fragment: GROUND_FS,
      streams: [],
      uniformBlocks: [{ name: 'Frame', slot: SLOT_FRAME }, { name: 'FxView', slot: SLOT_FX_VIEW }, ...SCORCH_UNIFORM_BLOCKS],
      samplers: SCORCH_SAMPLERS,
      primitive: 'triangle-strip',
      cullMode: 'none',
      depthTest: true,
      depthWrite: true,
    });
    group = dev.createBindGroup({ label: 'smoke.decals', buffers: fxSharedBufferBindings(ctx.frame.bindings) });
  },
  frame(ctx, t) {
    lastT = t;
    scorch.update(t);
    tex.update(t, false);
    const enc = ctx.dev.beginPass({ label: 'smoke.decals', clearColor: [0, 0, 0.2, 1], clearDepth: 1 });
    enc.setBindGroup(group);
    enc.setBindGroup(tex.group);
    enc.setPipeline(pipe);
    enc.drawInstanced(4, 1);
    enc.end();
    return 1;
  },
  check(ctx) {
    const errors = compare(ctx);
    if (scorch.dirty) errors.push('pool unexpectedly dirty');
    if (tex.uploads !== 0) errors.push(`ScorchTextures re-uploaded ${tex.uploads}× although the pool never changed`);
    return errors;
  },
  destroy(ctx) {
    tex.destroy();
    ctx.dev.destroyBindGroup(group);
    ctx.dev.destroyPipeline(pipe);
  },
};
