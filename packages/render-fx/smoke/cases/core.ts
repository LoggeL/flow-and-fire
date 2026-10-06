/**
 * Core smoke case: a sun-lit 512-WU ground plane (Frame block) and three camera-relative billboard
 * markers (Frame + FxView blocks, raw i32 positions, DynamicInstanceBuffer). Checks that every marker
 * lands at `project()` ±2 px, is square (faces the camera) and has the size predicted by
 * `u_fxTime.z` (pixels per WU at distance 1).
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME, vf } from '@faf/render';
import type { BindGroupH, BufH, PipeH, VertexStreamBinding } from '@faf/render';
import { DynamicInstanceBuffer, FX_COMMON_GLSL, FX_VIEW_BLOCK_GLSL, SLOT_FX_VIEW, fxSharedBufferBindings, wuToRaw } from '../../src/index.ts';
import type { SmokeCase, SmokeContext } from '../case.ts';

const WORLD_WU = 512;
const HALF_WU = 2;
/** Marker centres (WU) and colors (RGB 0..255). */
const MARKERS: readonly { pos: readonly [number, number, number]; rgb: readonly [number, number, number] }[] = [
  { pos: [256, 4, 256], rgb: [255, 0, 255] },
  { pos: [236, 4, 268], rgb: [0, 255, 0] },
  { pos: [278, 9, 244], rgb: [0, 160, 255] },
];
const STRIDE = 20; // i32×3 pos, f32 half size, u8×4 color

const GROUND_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${FX_VIEW_BLOCK_GLSL}
${FX_COMMON_GLSL}
out vec2 v_world;
void main() {
  ivec2 c = ivec2(gl_VertexID & 1, gl_VertexID >> 1);
  ivec3 posRaw = ivec3(c.x * ${WORLD_WU * 4096}, 0, c.y * ${WORLD_WU * 4096});
  v_world = vec2(c) * ${WORLD_WU}.0;
  gl_Position = u_viewProj * vec4(fxRelPos(posRaw), 1.0);
}
`;

const GROUND_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
in vec2 v_world;
out vec4 o_color;
void main() {
  vec2 cell = floor(v_world / 32.0);
  float checker = mod(cell.x + cell.y, 2.0);
  vec3 albedo = mix(vec3(0.32, 0.3, 0.26), vec3(0.38, 0.36, 0.31), checker);
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 light = u_sunColor.rgb * max(dot(n, u_sunDir.xyz), 0.0) + u_skyColor.rgb * 0.5;
  o_color = vec4(albedo * light, 1.0);
}
`;

const MARKER_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
${FX_VIEW_BLOCK_GLSL}
${FX_COMMON_GLSL}
layout(location = 0) in ivec3 a_posRaw;
layout(location = 1) in float a_half;
layout(location = 2) in vec4 a_color;
out vec4 v_color;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 rel = fxBillboard(fxRelPos(a_posRaw), corner, vec2(a_half));
  v_color = a_color;
  gl_Position = u_viewProj * vec4(rel, 1.0);
}
`;

const MARKER_FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 o_color;
void main() {
  o_color = vec4(v_color.rgb, 1.0); // premultiplied, opaque
}
`;

let groundPipe: PipeH;
let markerPipe: PipeH;
let group: BindGroupH;
let instances: DynamicInstanceBuffer;
const streams: VertexStreamBinding[] = [{ buffer: 0 as BufH, offset: 0 }];

function writeMarkers(): void {
  for (let i = 0; i < MARKERS.length; i++) {
    const m = MARKERS[i]!;
    const o = i * STRIDE;
    instances.i32[o >> 2] = wuToRaw(m.pos[0]);
    instances.i32[(o >> 2) + 1] = wuToRaw(m.pos[1]);
    instances.i32[(o >> 2) + 2] = wuToRaw(m.pos[2]);
    instances.f32[(o >> 2) + 3] = HALF_WU;
    instances.u8[o + 16] = m.rgb[0];
    instances.u8[o + 17] = m.rgb[1];
    instances.u8[o + 18] = m.rgb[2];
    instances.u8[o + 19] = 255;
  }
  instances.upload(MARKERS.length);
}

/** Bounding box and centroid of the pixels close to `rgb` inside a window around (cx, cy). */
function findMarker(ctx: SmokeContext, cx: number, cy: number, rgb: readonly [number, number, number]) {
  const r = 60;
  const x0 = Math.max(0, Math.round(cx) - r);
  const y0 = Math.max(0, Math.round(cy) - r);
  const w = Math.min(ctx.width, Math.round(cx) + r) - x0;
  const h = Math.min(ctx.height, Math.round(cy) + r) - y0;
  const px = ctx.readPixels(x0, y0, w, h);
  let n = 0;
  let sx = 0;
  let sy = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.abs(px[i]! - rgb[0]) + Math.abs(px[i + 1]! - rgb[1]) + Math.abs(px[i + 2]! - rgb[2]) > 24) continue;
      n++;
      sx += x + 0.5;
      sy += y + 0.5;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { n, cx: x0 + sx / n, cy: y0 + sy / n, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export const smokeCase: SmokeCase = {
  name: 'core',
  frames: 30,
  setup(ctx) {
    const dev = ctx.dev;
    ctx.camera.setTargetWU(256, 0, 256);
    ctx.camera.distance = 90;
    ctx.camera.yaw = -1.2;
    ctx.camera.update();
    const blocks = [
      { name: 'Frame', slot: SLOT_FRAME },
      { name: 'FxView', slot: SLOT_FX_VIEW },
    ];
    groundPipe = dev.createPipeline({
      label: 'smoke.core.ground',
      vertex: GROUND_VS,
      fragment: GROUND_FS,
      streams: [],
      uniformBlocks: blocks,
      primitive: 'triangle-strip',
      cullMode: 'none',
      depthTest: true,
      depthWrite: true,
    });
    markerPipe = dev.createPipeline({
      label: 'smoke.core.markers',
      vertex: MARKER_VS,
      fragment: MARKER_FS,
      streams: [
        {
          stepMode: 'instance',
          stride: STRIDE,
          attributes: [
            { location: 0, format: vf('i32', 3, 'int'), offset: 0 },
            { location: 1, format: vf('f32', 1, 'float'), offset: 12 },
            { location: 2, format: vf('u8', 4, 'norm'), offset: 16 },
          ],
        },
      ],
      uniformBlocks: blocks,
      primitive: 'triangle-strip',
      cullMode: 'none',
      depthTest: true,
      depthWrite: false,
      blend: 'premultiplied',
    });
    group = dev.createBindGroup({ label: 'smoke.core', buffers: fxSharedBufferBindings(ctx.frame.bindings) });
    instances = new DynamicInstanceBuffer(dev, { label: 'smoke.core.markers', stride: STRIDE, capacity: 16 });
    streams[0]!.buffer = instances.buffer;
    writeMarkers();
  },
  frame(ctx) {
    const enc = ctx.dev.beginPass({ label: 'smoke.core', clearColor: [0.05, 0.06, 0.08, 1], clearDepth: 1 });
    enc.setBindGroup(group);
    enc.setPipeline(groundPipe);
    enc.drawInstanced(4, 1);
    enc.setPipeline(markerPipe);
    enc.setVertexStreams(streams);
    enc.drawInstanced(4, instances.count);
    enc.end();
    return 2;
  },
  check(ctx) {
    const errors: string[] = [];
    const cam = ctx.camera;
    const ppw = ctx.frame.pixelsPerWuAt1;
    for (const m of MARKERS) {
      const [px, py] = ctx.project(m.pos[0], m.pos[1], m.pos[2]);
      const found = findMarker(ctx, px, py, m.rgb);
      const label = `marker (${m.pos.join(', ')})`;
      if (found.n === 0) {
        errors.push(`${label}: not visible near projected (${px.toFixed(1)}, ${py.toFixed(1)})`);
        continue;
      }
      if (Math.abs(found.cx - px) > 2 || Math.abs(found.cy - py) > 2) {
        errors.push(`${label}: centroid (${found.cx.toFixed(1)}, ${found.cy.toFixed(1)}) ≠ project (${px.toFixed(1)}, ${py.toFixed(1)}) ±2 px`);
      }
      // Camera-facing quad ⇒ square on screen with side 2·half·ppw / viewDepth.
      const dx = m.pos[0] - cam.eyeRaw[0]! / 4096;
      const dy = m.pos[1] - cam.eyeRaw[1]! / 4096;
      const dz = m.pos[2] - cam.eyeRaw[2]! / 4096;
      const depth = dx * cam.forward[0]! + dy * cam.forward[1]! + dz * cam.forward[2]!;
      const side = (2 * HALF_WU * ppw) / depth;
      if (Math.abs(found.w - found.h) > 2) errors.push(`${label}: not camera-facing (${found.w}×${found.h} px)`);
      if (Math.abs(found.w - side) > 2 || Math.abs(found.h - side) > 2) {
        errors.push(`${label}: size ${found.w}×${found.h} px, expected ${side.toFixed(1)} px`);
      }
    }
    // The sun-lit ground (Frame block: sun/sky colors) covers the screen centre around the target.
    const [gx, gy] = ctx.project(262, 0, 250);
    const g = ctx.readPixels(Math.round(gx), Math.round(gy), 1, 1);
    if (g[0]! < 60 || g[0]! < g[2]!) errors.push(`ground pixel at (${gx.toFixed(0)}, ${gy.toFixed(0)}) not lit: ${[...g].join(',')}`);
    return errors;
  },
  destroy(ctx) {
    const dev = ctx.dev;
    instances.destroy();
    dev.destroyBindGroup(group);
    dev.destroyPipeline(groundPipe);
    dev.destroyPipeline(markerPipe);
  },
};
