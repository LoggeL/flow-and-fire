/**
 * Shields smoke case (rfx-p4): 20 shield bubbles (radii 6–14 WU) on a 5 × 4 grid seen obliquely from
 * above – roughly screen-filling. Shield 7 receives 4 simultaneous hits at t = 0.3 s and a 5th at 0.4 s,
 * other shields get periodic hits; one shield has low HP (red, flickering), one cycles its power state.
 *
 * Checks: exactly one draw; Fresnel (rim pixels brighter than the interior of shield 7); the ripples change
 * the pixels of shield 7 against a snapshot taken right before the first hit; ripplesActive > 0.
 *
 * GPU timing (whole-frame segments, see the trails case): 'scene' = ground + 20 shields, 'ground' = ground
 * only (shield cost = scene − ground), 'fill'/'fillBase' = offscreen close-up where the 20 shields cover
 * the whole 960×540 target (second camera and FxFrameUniforms) minus the clear-only baseline.
 */
import { FRAME_BLOCK_GLSL, RtsCamera, SLOT_FRAME } from '@faf/render';
import type { BindGroupH, PipeH, TexH } from '@faf/render';
import { FX_COMMON_GLSL, FX_VIEW_BLOCK_GLSL, FxFrameUniforms, FxRng, SLOT_FX_VIEW, ShieldPass, fxSharedBufferBindings, wuToRaw } from '../../src/index.ts';
import type { ShieldState } from '../../src/index.ts';
import type { SmokeCase, SmokeContext } from '../case.ts';

const WORLD_WU = 512;
const TARGET: readonly [number, number, number] = [256, 0, 256];
const HIT_SHIELD = 7;
const LOW_HP_SHIELD = 15;
const CYCLE_SHIELD = 19;
/** Shields used by the Fresnel check (no periodic hits). */
const FRESNEL_SHIELDS = [6, 8, 11];
const T_HIT = 0.3;
const T_HIT5 = 0.4;

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
  vec2 cell = floor(v_world / 16.0);
  float checker = mod(cell.x + cell.y, 2.0);
  vec3 albedo = mix(vec3(0.24, 0.23, 0.2), vec3(0.28, 0.27, 0.23), checker);
  vec3 light = u_sunColor.rgb * max(u_sunDir.y, 0.0) + u_skyColor.rgb * 0.4;
  o_color = vec4(albedo * light * 0.6, 1.0);
}
`;

interface ShieldDef {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly color: readonly [number, number, number];
}

let ground: PipeH;
let group: BindGroupH;
let pass: ShieldPass;
let fillPass: ShieldPass;
let fillFrame: FxFrameUniforms;
let fillCamera: RtsCamera;
let fillColor: TexH;
let fillDepth: TexH;
const defs: ShieldDef[] = [];
const center = new Int32Array(3);
const point = new Int32Array(3);
const st = { centerRaw: center, radiusWu: 0, color: [0, 0, 0] as [number, number, number], hpFrac: 1, upFrac: 1 };
let snapshot: Uint8Array | null = null;
let snapRect: [number, number, number, number] = [0, 0, 1, 1];
let hitsDone = 0;
let lastPeriodic = -1;
let frameNo = 0;
let lastWasScene = false;
const rng = new FxRng(7);

function stateOf(d: ShieldDef, t: number): ShieldState {
  center[0] = wuToRaw(d.x);
  center[1] = wuToRaw(0.5);
  center[2] = wuToRaw(d.z);
  st.radiusWu = d.r;
  st.color[0] = d.color[0];
  st.color[1] = d.color[1];
  st.color[2] = d.color[2];
  st.hpFrac = d.id === LOW_HP_SHIELD ? 0.18 : 1;
  st.upFrac = d.id === CYCLE_SHIELD ? Math.min(1, Math.max(0, 0.5 + 0.8 * Math.sin(t * 2.2))) : 1;
  return st;
}

/** Surface point of shield d in direction (dx, dy, dz) (normalized here). */
function surface(d: ShieldDef, dx: number, dy: number, dz: number): Int32Array {
  const l = Math.hypot(dx, dy, dz);
  point[0] = wuToRaw(d.x + (dx / l) * d.r);
  point[1] = wuToRaw(0.5 + (dy / l) * d.r);
  point[2] = wuToRaw(d.z + (dz / l) * d.r);
  return point;
}

function cameraAxes(cam: RtsCamera): { right: number[]; up: number[] } {
  const f = cam.forward;
  const l = Math.hypot(f[2]!, f[0]!);
  const right = [-f[2]! / l, 0, f[0]! / l];
  const up = [right[1]! * f[2]! - right[2]! * f[1]!, right[2]! * f[0]! - right[0]! * f[2]!, right[0]! * f[1]! - right[1]! * f[0]!];
  return { right, up };
}

function shieldRect(ctx: SmokeContext, d: ShieldDef): [number, number, number, number] {
  const [cx, cy] = ctx.project(d.x, 0.5, d.z);
  const [, ty] = ctx.project(d.x, 0.5 + d.r, d.z);
  const rPx = Math.max(Math.abs(cy - ty), 8) * 1.1;
  const x0 = Math.max(0, Math.round(cx - rPx));
  const y0 = Math.max(0, Math.round(cy - rPx));
  return [x0, y0, Math.min(ctx.width, Math.round(cx + rPx)) - x0, Math.min(ctx.height, Math.round(cy + rPx)) - y0];
}

function drawScene(ctx: SmokeContext, t: number, withShields: boolean): number {
  for (const d of defs) pass.set(d.id, stateOf(d, t));
  const hit = defs[HIT_SHIELD]!;
  if (hitsDone === 0 && t >= T_HIT) {
    // Four simultaneous hits from different sides (all four ripple slots in one frame).
    pass.hit(hit.id, surface(hit, 1, 0.4, 0.2), t);
    pass.hit(hit.id, surface(hit, -0.6, 0.7, 0.5), t, 0.8);
    pass.hit(hit.id, surface(hit, 0.1, 1, -0.3), t, 1.2);
    pass.hit(hit.id, surface(hit, -0.3, 0.5, -1), t);
    hitsDone = 1;
  }
  if (hitsDone === 1 && t >= T_HIT5) {
    pass.hit(hit.id, surface(hit, 0.3, 0.9, 0.9), t, 1.5); // replaces the oldest
    hitsDone = 2;
  }
  const periodic = Math.floor(t / 0.12);
  if (periodic !== lastPeriodic) {
    lastPeriodic = periodic;
    const d = defs[(periodic * 7 + 3) % defs.length]!;
    if (d.id !== hit.id && !FRESNEL_SHIELDS.includes(d.id)) pass.hit(d.id, surface(d, rng.range(-1, 1), rng.range(0.2, 1), rng.range(-1, 1)), t, rng.range(0.6, 1.4));
  }
  pass.update(t);
  const enc = ctx.dev.beginPass({ label: 'smoke.shields', clearColor: [0.03, 0.035, 0.045, 1], clearDepth: 1 });
  enc.setBindGroup(group);
  enc.setPipeline(ground);
  enc.drawInstanced(4, 1);
  let draws = 1;
  if (withShields) draws += pass.encode(enc);
  enc.end();
  return draws;
}

const fillPoint = new Int32Array(3);
function surfaceFill(k: number, dx: number, dy: number, dz: number): Int32Array {
  const l = Math.hypot(dx, dy, dz);
  fillPoint[0] = wuToRaw(TARGET[0] + ((k % 5) - 2) * 14 + (dx / l) * 16);
  fillPoint[1] = wuToRaw(0.5 + (dy / l) * 16);
  fillPoint[2] = wuToRaw(TARGET[2] + (Math.floor(k / 5) - 1.5) * 12 + (dz / l) * 16);
  return fillPoint;
}

function drawFill(ctx: SmokeContext, t: number, withShields: boolean): number {
  fillFrame.update(fillCamera, { timeS: t, dtS: 1 / 60, viewport: [ctx.width, ctx.height] });
  const enc = ctx.dev.beginPass({
    label: 'smoke.shields.fill',
    clearColor: [0, 0, 0, 1],
    clearDepth: 1,
    colorAttachments: [{ texture: fillColor }],
    depthAttachment: { texture: fillDepth },
  });
  let draws = 0;
  if (withShields) {
    // Worst case: every shield keeps all four ripple slots busy.
    for (let k = 0; k < 20; k++) {
      const a = rng.range(0, Math.PI * 2);
      const e = rng.range(0.1, 1);
      fillPass.hit(k, surfaceFill(k, Math.cos(a), e, Math.sin(a)), t, 1);
    }
    fillPass.update(t);
    draws = fillPass.encode(enc);
  }
  enc.end();
  return draws;
}

const MODES = ['scene', 'ground', 'fill', 'fillBase', 'scene'] as const;

function lumAt(px: Uint8Array, i: number): number {
  return 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
}

function meanLum(ctx: SmokeContext, x: number, y: number): number {
  const px = ctx.readPixels(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  let s = 0;
  for (let i = 0; i < 9; i++) s += lumAt(px, i * 4);
  return s / 9;
}

export const smokeCase: SmokeCase = {
  name: 'shields',
  frames: 40,
  segments: ['scene', 'ground', 'fill', 'fillBase'],
  setup(ctx) {
    const dev = ctx.dev;
    ctx.camera.setTargetWU(TARGET[0], TARGET[1], TARGET[2]);
    ctx.camera.distance = 150;
    ctx.camera.pitch = (50 * Math.PI) / 180;
    ctx.camera.yaw = -Math.PI / 2;
    ctx.camera.update();
    const blocks = [
      { name: 'Frame', slot: SLOT_FRAME },
      { name: 'FxView', slot: SLOT_FX_VIEW },
    ];
    ground = dev.createPipeline({
      label: 'smoke.shields.ground',
      vertex: GROUND_VS,
      fragment: GROUND_FS,
      streams: [],
      uniformBlocks: blocks,
      primitive: 'triangle-strip',
      cullMode: 'none',
      depthTest: true,
      depthWrite: true,
    });
    group = dev.createBindGroup({ label: 'smoke.shields', buffers: fxSharedBufferBindings(ctx.frame.bindings) });
    pass = new ShieldPass(dev, ctx.frame.bindings);
    rng.reseed(7);
    defs.length = 0;
    const palette: readonly (readonly [number, number, number])[] = [
      [0.35, 0.75, 1.3],
      [0.35, 0.75, 1.3],
      [1.2, 0.72, 0.3],
      [0.5, 1.1, 0.7],
    ];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 5; i++) {
        const id = j * 5 + i;
        defs.push({
          id,
          x: TARGET[0] + (i - 2) * 34 + rng.range(-3, 3),
          z: TARGET[2] + (j - 1.5) * 30 + rng.range(-3, 3),
          r: 6 + ((id * 5) % 9),
          color: palette[(i + j) % palette.length]!,
        });
      }
    }
    // Offscreen close-up: 20 large overlapping shields covering the whole target.
    fillCamera = new RtsCamera({ distance: 60, pitch: (40 * Math.PI) / 180, yaw: -Math.PI / 2 });
    fillCamera.setViewport(ctx.width, ctx.height);
    fillCamera.setTargetWU(TARGET[0], 0, TARGET[2]);
    fillCamera.update();
    fillFrame = new FxFrameUniforms(dev);
    fillColor = dev.createTexture({ label: 'smoke.shields.fill', width: ctx.width, height: ctx.height, format: 'rgba8' });
    fillDepth = dev.createTexture({ label: 'smoke.shields.fillDepth', width: ctx.width, height: ctx.height, format: 'depth24' });
    fillPass = new ShieldPass(dev, fillFrame.bindings);
    for (let k = 0; k < 20; k++) {
      const i = k % 5;
      const j = Math.floor(k / 5);
      center[0] = wuToRaw(TARGET[0] + (i - 2) * 14);
      center[1] = wuToRaw(0.5);
      center[2] = wuToRaw(TARGET[2] + (j - 1.5) * 12);
      fillPass.set(k, { centerRaw: center, radiusWu: 16, color: [0.35, 0.75, 1.3], hpFrac: 1, upFrac: 1 });
    }
    snapshot = null;
    hitsDone = 0;
    lastPeriodic = -1;
    frameNo = 0;
    lastWasScene = false;
  },
  frame(ctx, t) {
    const mode = MODES[frameNo++ % MODES.length]!;
    ctx.timer.beginNamed(mode);
    lastWasScene = mode === 'scene';
    let draws: number;
    if (mode === 'scene' || mode === 'ground') draws = drawScene(ctx, t, mode === 'scene');
    else draws = drawFill(ctx, t, mode === 'fill');
    // Snapshot of shield 7 without ripples: the last scene frame before the first hit.
    if (mode === 'scene' && hitsDone === 0) {
      snapRect = shieldRect(ctx, defs[HIT_SHIELD]!);
      snapshot = ctx.readPixels(...snapRect).slice();
    }
    return draws;
  },
  check(ctx) {
    const errors: string[] = [];
    const t = ctx.frame.fxTime;
    if (!lastWasScene) drawScene(ctx, t, true);
    if (pass.stats.draws !== 1) errors.push(`ShieldPass issued ${pass.stats.draws} draws, expected 1`);
    if (pass.stats.shields !== 20) errors.push(`${pass.stats.shields} shields, expected 20`);
    if (pass.stats.ripplesActive === 0) errors.push('no active ripples');
    if (fillPass.stats.draws !== 1) errors.push(`fill ShieldPass issued ${fillPass.stats.draws} draws`);
    // Fresnel on an un-hit shield: rim (top silhouette, 0.93 r along the camera up axis) brighter than the
    // interior (0.25 r) and than the ground next to it.
    const { up } = cameraAxes(ctx.camera);
    for (const idx of FRESNEL_SHIELDS) {
      const d = defs[idx]!;
      const [rx, ry] = ctx.project(d.x + up[0]! * d.r * 0.93, 0.5 + up[1]! * d.r * 0.93, d.z + up[2]! * d.r * 0.93);
      const [ix, iy] = ctx.project(d.x + up[0]! * d.r * 0.25, 0.5 + up[1]! * d.r * 0.25, d.z + up[2]! * d.r * 0.25);
      const rim = meanLum(ctx, rx, ry);
      const inner = meanLum(ctx, ix, iy);
      if (!(rim > inner + 15)) errors.push(`shield ${idx}: rim luma ${rim.toFixed(0)} not brighter than interior ${inner.toFixed(0)} (Fresnel)`);
    }
    // Ripples change shield 7 against the pre-hit snapshot.
    if (snapshot === null) errors.push('no pre-hit snapshot of shield 7');
    else {
      const now = ctx.readPixels(...snapRect);
      // Only pixels inside the projected disc of shield 7.
      const [w, h] = [snapRect[2], snapRect[3]];
      const rr = Math.min(w, h) * 0.45;
      let diff = 0;
      let changed = 0;
      let inside = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (Math.hypot(x - w / 2, y - h / 2) > rr) continue;
          const i = (y * w + x) * 4;
          const dl = Math.abs(lumAt(now, i) - lumAt(snapshot, i));
          inside++;
          diff += dl;
          if (dl > 12) changed++;
        }
      }
      if (changed < inside * 0.03) errors.push(`ripples changed only ${changed}/${inside} pixels of shield 7 (mean Δ ${(diff / inside).toFixed(2)})`);
    }
    return errors;
  },
  destroy(ctx) {
    pass.destroy();
    fillPass.destroy();
    fillFrame.destroy();
    ctx.dev.destroyTexture(fillColor);
    ctx.dev.destroyTexture(fillDepth);
    ctx.dev.destroyBindGroup(group);
    ctx.dev.destroyPipeline(ground);
  },
};
