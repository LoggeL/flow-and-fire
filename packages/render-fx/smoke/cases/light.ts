/**
 * Light smoke case: CascadedShadows (2 cascades, 2048²) + PostChain (Medium: HDR, bloom, FXAA) + the
 * receiver/lighting GLSL on a 512-WU ground with two boxes:
 * - the left box is a STATIC caster (static layer, cached, together with the ground = "terrain"),
 * - the right box is a DYNAMIC caster (dynamic layer, re-rendered every frame) with an emissive band
 *   (fxEmissive → bloom).
 * Checks: the ground where each box's shadow must fall (analytic from the sun direction) is clearly
 * darker than a lit ground point next to it; the camera rests → the static cache was rendered exactly
 * once (+1 per context restore).
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME, vf } from '@faf/render';
import type { BindGroupH, BufH, PassEncoder, PipeH, VertexStreamBinding } from '@faf/render';
import {
  CascadedShadows,
  DynamicInstanceBuffer,
  PostChain,
  SHADOW_CASTER_GLSL,
  SHADOW_CASTER_PIPELINE,
  SHADOW_CASTER_UNIFORM_BLOCKS,
  SHADOW_RECEIVE_GLSL,
  SHADOW_RECV_SAMPLERS,
  SHADOW_RECV_UNIFORM_BLOCKS,
  fxSharedBufferBindings,
  lightingGlsl,
  postOptionsForPreset,
  wuToRaw,
} from '../../src/index.ts';
import type { ShadowCasterFn } from '../../src/index.ts';
import type { SmokeCase, SmokeContext } from '../case.ts';

const WORLD_WU = 512;
const SUN_RAW: readonly [number, number, number] = [0.6, 0.7, -0.25];
const SUN_LEN = Math.hypot(...SUN_RAW);
const SUN: [number, number, number] = [SUN_RAW[0] / SUN_LEN, SUN_RAW[1] / SUN_LEN, SUN_RAW[2] / SUN_LEN];
const LIGHT = {
  sunColor: [1.05, 0.98, 0.88] as const,
  skyColor: [0.36, 0.4, 0.46] as const,
  groundColor: [0.16, 0.14, 0.12] as const,
};
const CLEAR: readonly [number, number, number, number] = [0.5, 0.58, 0.66, 1];

interface Box {
  readonly base: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  readonly rgb: readonly [number, number, number];
  readonly emissive: number;
}
const STATIC_BOX: Box = { base: [240, 0, 256], half: [4, 14, 4], rgb: [150, 140, 125], emissive: 0 };
/** Far static box: its shadow lies in cascade 1. */
const FAR_BOX: Box = { base: [252, 0, 212], half: [4, 16, 4], rgb: [140, 130, 120], emissive: 0 };
const DYNAMIC_BOX: Box = { base: [272, 0, 256], half: [4, 10, 4], rgb: [120, 125, 135], emissive: 2.5 };
/** Instances 0..1 are static casters, instance 2 is the dynamic caster. */
const BOXES = [STATIC_BOX, FAR_BOX, DYNAMIC_BOX];
const STATIC_BOXES = 2;
const INST_STRIDE = 32; // i32×3 base, f32×3 half size (x, height, z), u8×4 albedo, f32 emissive
const MESH_STRIDE = 24; // f32×3 position (x/z ∈ [-1, 1], y ∈ [0, 1]), f32×3 normal

const GROUND_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
out vec3 v_rel;
void main() {
  ivec2 c = ivec2(gl_VertexID & 1, gl_VertexID >> 1);
  ivec3 posRaw = ivec3(c.x * ${WORLD_WU * 4096}, 0, c.y * ${WORLD_WU * 4096});
  v_rel = vec3(posRaw - u_camPosInt.xyz) / 4096.0;
  gl_Position = u_viewProj * vec4(v_rel, 1.0);
}
`;

const BOX_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in ivec3 a_base;
layout(location = 3) in vec3 a_half;
layout(location = 4) in vec4 a_albedo;
layout(location = 5) in float a_emissive;
out vec3 v_rel;
out vec3 v_normal;
out vec3 v_albedo;
out float v_localY;
out float v_emissive;
void main() {
  v_rel = vec3(a_base - u_camPosInt.xyz) / 4096.0 + a_pos * a_half;
  v_normal = a_normal;
  v_albedo = a_albedo.rgb;
  v_localY = a_pos.y;
  v_emissive = a_emissive;
  gl_Position = u_viewProj * vec4(v_rel, 1.0);
}
`;

function receiverFs(hdr: boolean, ground: boolean): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${SHADOW_RECEIVE_GLSL}
${lightingGlsl(hdr)}
in vec3 v_rel;
${ground ? '' : 'in vec3 v_normal;\nin vec3 v_albedo;\nin float v_localY;\nin float v_emissive;'}
out vec4 o_color;
void main() {
  vec3 n = ${ground ? 'vec3(0.0, 1.0, 0.0)' : 'normalize(v_normal)'};
  vec3 albedo = ${ground ? 'vec3(0.5, 0.47, 0.4)' : 'v_albedo'};
  vec3 c = fxLight(albedo, n, fxShadow(v_rel, n));
  ${ground ? '' : 'if (v_emissive > 0.0 && abs(v_localY - 0.6) < 0.04 && abs(n.y) < 0.5) c += fxEmissive(vec3(1.0, 0.45, 0.1), v_emissive);'}
  o_color = vec4(c, 1.0);
}
`;
}

const GROUND_CASTER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${SHADOW_CASTER_GLSL}
void main() {
  ivec2 c = ivec2(gl_VertexID & 1, gl_VertexID >> 1);
  gl_Position = fxShadowCasterPos(ivec3(c.x * ${WORLD_WU * 4096}, 0, c.y * ${WORLD_WU * 4096}), vec3(0.0));
}
`;

const BOX_CASTER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${SHADOW_CASTER_GLSL}
layout(location = 0) in vec3 a_pos;
layout(location = 2) in ivec3 a_base;
layout(location = 3) in vec3 a_half;
void main() {
  gl_Position = fxShadowCasterPos(a_base, a_pos * a_half);
}
`;

/** 36 vertices of a box with x/z ∈ [-1, 1], y ∈ [0, 1] and flat normals. */
function boxMesh(): Float32Array {
  const out: number[] = [];
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [n, u, v] of faces) {
    const corner = (su: number, sv: number): void => {
      const p = [0, 1, 2].map((i) => n[i]! + u[i]! * su + v[i]! * sv);
      out.push(p[0]!, (p[1]! + 1) * 0.5, p[2]!, n[0]!, n[1]!, n[2]!);
    };
    corner(-1, -1);
    corner(1, -1);
    corner(1, 1);
    corner(-1, -1);
    corner(1, 1);
    corner(-1, 1);
  }
  return new Float32Array(out);
}

let post: PostChain;
let csm: CascadedShadows;
let groundPipe: PipeH;
let boxPipe: PipeH;
let groundCaster: PipeH;
let boxCaster: PipeH;
let recvGroup: BindGroupH;
let meshVbo: BufH;
let inst: DynamicInstanceBuffer;
const boxStreams: VertexStreamBinding[] = [
  { buffer: 0 as BufH, offset: 0 },
  { buffer: 0 as BufH, offset: 0 },
];

function drawBoxes(enc: PassEncoder, first: number, count: number): void {
  boxStreams[1]!.offset = first * INST_STRIDE;
  enc.setVertexStreams(boxStreams);
  enc.drawInstanced(36, count);
}

const drawStatic: ShadowCasterFn = (enc, _cascade, view) => {
  enc.setPipeline(groundCaster);
  enc.setBindGroup(view.bindGroup);
  enc.drawInstanced(4, 1);
  enc.setPipeline(boxCaster);
  enc.setBindGroup(view.bindGroup);
  drawBoxes(enc, 0, STATIC_BOXES);
  return 2;
};

const drawDynamic: ShadowCasterFn = (enc, _cascade, view) => {
  enc.setPipeline(boxCaster);
  enc.setBindGroup(view.bindGroup);
  drawBoxes(enc, STATIC_BOXES, BOXES.length - STATIC_BOXES);
  return 1;
};

/** Ground point (WU) where the shadow of the box axis at 80 % height lands. */
function shadowPoint(b: Box): [number, number] {
  const h = b.half[1] * 0.8;
  return [b.base[0] - (SUN[0] * h) / SUN[1], b.base[2] - (SUN[2] * h) / SUN[1]];
}

/** Mean luma of the 3×3 pixels around a ground point; -1 when it is not on screen. */
function meanLuma(ctx: SmokeContext, xWu: number, zWu: number): number {
  const [x, y] = ctx.project(xWu, 0, zWu);
  if (!(x >= 2 && y >= 2 && x < ctx.width - 2 && y < ctx.height - 2)) return -1;
  const px = ctx.readPixels(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  let s = 0;
  for (let i = 0; i < px.length; i += 4) s += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
  return s / 9;
}

export const smokeCase: SmokeCase = {
  name: 'light',
  frames: 30,
  segments: ['shadow', 'scene', 'post'],
  setup(ctx) {
    const dev = ctx.dev;
    const cam = ctx.camera;
    cam.setTargetWU(256, 0, 262);
    cam.distance = 70;
    cam.pitch = (50 * Math.PI) / 180;
    cam.yaw = -Math.PI / 2;
    cam.update();
    post = new PostChain(dev, postOptionsForPreset('medium'));
    post.resize(ctx.width, ctx.height);
    csm = new CascadedShadows(dev, { size: 2048, cascades: 2, worldMin: [0, -8, 0], worldMax: [WORLD_WU, 64, WORLD_WU] });

    const mesh = boxMesh();
    meshVbo = dev.createBuffer({ label: 'smoke.light.box', usage: 'vertex', size: mesh.byteLength, restore: (b) => dev.writeBuffer(b, 0, mesh) });
    dev.writeBuffer(meshVbo, 0, mesh);
    inst = new DynamicInstanceBuffer(dev, { label: 'smoke.light.inst', stride: INST_STRIDE, capacity: BOXES.length });
    BOXES.forEach((b, i) => {
      const w = (i * INST_STRIDE) >> 2;
      for (let k = 0; k < 3; k++) {
        inst.i32[w + k] = wuToRaw(b.base[k]!);
        inst.f32[w + 3 + k] = b.half[k]!;
        inst.u8[i * INST_STRIDE + 24 + k] = b.rgb[k]!;
      }
      inst.u8[i * INST_STRIDE + 27] = 255;
      inst.f32[w + 7] = b.emissive;
    });
    inst.upload(BOXES.length);
    boxStreams[0]!.buffer = meshVbo;
    boxStreams[1]!.buffer = inst.buffer;

    const meshStream = {
      stepMode: 'vertex' as const,
      stride: MESH_STRIDE,
      attributes: [
        { location: 0, format: vf('f32', 3, 'float'), offset: 0 },
        { location: 1, format: vf('f32', 3, 'float'), offset: 12 },
      ],
    };
    const instStream = {
      stepMode: 'instance' as const,
      stride: INST_STRIDE,
      attributes: [
        { location: 2, format: vf('i32', 3, 'int'), offset: 0 },
        { location: 3, format: vf('f32', 3, 'float'), offset: 12 },
        { location: 4, format: vf('u8', 4, 'norm'), offset: 24 },
        { location: 5, format: vf('f32', 1, 'float'), offset: 28 },
      ],
    };
    const recvBlocks = [{ name: 'Frame', slot: SLOT_FRAME }, ...SHADOW_RECV_UNIFORM_BLOCKS];
    const opaque = { depthTest: true, depthWrite: true, cullMode: 'none' as const, uniformBlocks: recvBlocks, samplers: SHADOW_RECV_SAMPLERS };
    groundPipe = dev.createPipeline({
      ...opaque,
      label: 'smoke.light.ground',
      vertex: GROUND_VS,
      fragment: receiverFs(post.hdrActive, true),
      streams: [],
      primitive: 'triangle-strip',
    });
    boxPipe = dev.createPipeline({
      ...opaque,
      label: 'smoke.light.boxes',
      vertex: BOX_VS,
      fragment: receiverFs(post.hdrActive, false),
      streams: [meshStream, instStream],
    });
    groundCaster = dev.createPipeline({
      ...SHADOW_CASTER_PIPELINE,
      label: 'smoke.light.caster.ground',
      vertex: GROUND_CASTER_VS,
      streams: [],
      primitive: 'triangle-strip',
      uniformBlocks: SHADOW_CASTER_UNIFORM_BLOCKS,
    });
    boxCaster = dev.createPipeline({
      ...SHADOW_CASTER_PIPELINE,
      label: 'smoke.light.caster.boxes',
      vertex: BOX_CASTER_VS,
      streams: [
        { stepMode: 'vertex', stride: MESH_STRIDE, attributes: [{ location: 0, format: vf('f32', 3, 'float'), offset: 0 }] },
        {
          stepMode: 'instance',
          stride: INST_STRIDE,
          attributes: [
            { location: 2, format: vf('i32', 3, 'int'), offset: 0 },
            { location: 3, format: vf('f32', 3, 'float'), offset: 12 },
          ],
        },
      ],
      uniformBlocks: SHADOW_CASTER_UNIFORM_BLOCKS,
    });
    const rb = csm.receiverBindings();
    recvGroup = dev.createBindGroup({
      label: 'smoke.light.recv',
      buffers: [...fxSharedBufferBindings(ctx.frame.bindings), ...rb.buffers],
      textures: rb.textures,
    });
  },
  frame(ctx, t) {
    ctx.frame.update(ctx.camera, { timeS: t, dtS: 1 / 60, viewport: [ctx.width, ctx.height], sunDir: SUN, ...LIGHT });
    ctx.timer.beginNamed('shadow');
    csm.update(ctx.camera, SUN);
    let draws = csm.renderStatic(drawStatic);
    draws += csm.renderDynamic(drawDynamic);
    ctx.timer.beginNamed('scene');
    const enc = post.beginScene(CLEAR);
    enc.setBindGroup(recvGroup);
    enc.setPipeline(groundPipe);
    enc.drawInstanced(4, 1);
    enc.setPipeline(boxPipe);
    drawBoxes(enc, 0, BOXES.length);
    enc.end();
    draws += 2;
    // One segment for the whole chain: on ANGLE-Metal every extra timer segment adds ~2 ms of
    // command-buffer gaps (measured: bloom/composite/fxaa split ≈ 2.2/2.3/2.7 ms each).
    ctx.timer.beginNamed('post');
    draws += post.resolve();
    return draws;
  },
  check(ctx) {
    const errors: string[] = [];
    const cam = ctx.camera;
    const split = csm.fitter.splits[1]!;
    const cascades = new Set<number>();
    for (const [label, box] of [
      ['static box', STATIC_BOX],
      ['far static box', FAR_BOX],
      ['dynamic box', DYNAMIC_BOX],
    ] as const) {
      const [sx, sz] = shadowPoint(box);
      const shadow = meanLuma(ctx, sx, sz);
      const lit = meanLuma(ctx, sx, sz + 12);
      const depth =
        (sx - cam.eyeRaw[0]! / 4096) * cam.forward[0]! + (0 - cam.eyeRaw[1]! / 4096) * cam.forward[1]! + (sz - cam.eyeRaw[2]! / 4096) * cam.forward[2]!;
      cascades.add(depth < split ? 0 : 1);
      const desc = `${label}: shadow (${sx.toFixed(1)}, ${sz.toFixed(1)}) depth ${depth.toFixed(0)} (split ${split.toFixed(0)}) luma ${shadow.toFixed(1)}, lit neighbour ${lit.toFixed(1)}`;
      if (shadow < 0 || lit < 0) errors.push(`${desc}: probe off screen`);
      else if (lit < 40) errors.push(`${desc}: lit ground too dark`);
      if (!(shadow < lit * 0.75)) errors.push(`${desc}: shadow not clearly darker`);
    }
    if (cascades.size !== 2) errors.push(`shadow probes cover cascades {${[...cascades].join(', ')}} – expected both`);
    const s = csm.stats;
    if (s.staticRefreshes !== 1 + s.restores) {
      errors.push(`static cache rendered ${s.staticRefreshes}× with ${s.restores} restores (resting camera: expected ${1 + s.restores})`);
    }
    if (s.dynamicDraws !== 2) errors.push(`dynamic caster draws ${s.dynamicDraws}, expected 2 (1 per cascade)`);
    if (!post.hdrActive && ctx.dev.caps.colorBufferFloat) errors.push('HDR supported but PostChain is LDR');
    return errors;
  },
  destroy(ctx) {
    const dev = ctx.dev;
    post.destroy();
    csm.destroy();
    inst.destroy();
    dev.destroyBuffer(meshVbo);
    dev.destroyBindGroup(recvGroup);
    for (const p of [groundPipe, boxPipe, groundCaster, boxCaster]) dev.destroyPipeline(p);
  },
};
