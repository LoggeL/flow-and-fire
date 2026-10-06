/**
 * Beams/trails smoke case (rfx-p4): a dark 512-WU ground, a measurement beam across the screen centre,
 * the Varkan beam presets (build/reclaim stream with noise, timed laser/lightning shots) and 200
 * projectile trails (tracers, shells, artillery arcs, missiles, flak, 5 standing heads).
 *
 * Checks: the measurement beam's core pixel is bright at its projected position and its FWHM matches
 * `widthWu · pixels-per-WU / depth` (via the JS mirror `beamProfile`); moving and standing trail heads
 * are visible (standing = collapsed dot, no NaN); both passes issue exactly one draw.
 *
 * GPU stress (timer segments, offscreen 960×540 RGBA8 + depth): 4 096 beams and 8 192 trails per frame.
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME } from '@faf/render';
import type { BindGroupH, PipeH, TexH } from '@faf/render';
import {
  BeamPass,
  FX_COMMON_GLSL,
  FX_VIEW_BLOCK_GLSL,
  FxRng,
  SLOT_FX_VIEW,
  TrailPass,
  VARKAN_BEAM_STYLES,
  VARKAN_TRAIL_STYLES,
  beamProfile,
  fxSharedBufferBindings,
  wuToRaw,
} from '../../src/index.ts';
import type { BeamStyle, TrailStyle } from '../../src/index.ts';
import type { SmokeCase, SmokeContext } from '../case.ts';

const WORLD_WU = 512;
const C: readonly [number, number, number] = [256, 3, 256];
const MEASURE: BeamStyle = { widthWu: 2, core: [0.45, 0.4, 0.3], glow: [0.3, 0.15, 0.05], alpha: 1 };
const HALF_LEN = 18;
const N_TRAILS = 200;
const N_STANDING = 5;
const STRESS_BEAMS = 4096;
const STRESS_TRAILS = 8192;

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
  vec3 albedo = mix(vec3(0.16, 0.15, 0.14), vec3(0.19, 0.18, 0.16), checker);
  vec3 light = u_sunColor.rgb * max(u_sunDir.y, 0.0) + u_skyColor.rgb * 0.4;
  o_color = vec4(albedo * light * 0.55, 1.0);
}
`;

interface Projectile {
  readonly style: TrailStyle;
  readonly origin: readonly [number, number, number];
  readonly vel: readonly [number, number, number];
  readonly gravity: number;
  readonly period: number;
  readonly offset: number;
}

let ground: PipeH;
let group: BindGroupH;
let beams: BeamPass;
let trails: TrailPass;
let stressBeams: BeamPass;
let stressTrails: TrailPass;
let stressColor: TexH;
let stressDepth: TexH;
const projectiles: Projectile[] = [];
const standing: [number, number, number][] = [];
const from = new Int32Array(3);
const to = new Int32Array(3);
const prev = new Int32Array(3);
const cur = new Int32Array(3);
let stressData: Int32Array;
let stressStyles: BeamStyle[] = [];
let stressTrailData: Int32Array;
let lastShot = -1;
let lastBolt = -1;

function setRaw(out: Int32Array, x: number, y: number, z: number): Int32Array {
  out[0] = wuToRaw(x);
  out[1] = wuToRaw(y);
  out[2] = wuToRaw(z);
  return out;
}

/** Camera right/up axes (lookAt with world up +y). */
function axes(ctx: SmokeContext): { right: [number, number, number]; up: [number, number, number] } {
  const f = ctx.camera.forward;
  const l = Math.hypot(f[2]!, f[0]!);
  const right: [number, number, number] = [-f[2]! / l, 0, f[0]! / l];
  const up: [number, number, number] = [
    right[1] * f[2]! - right[2] * f[1]!,
    right[2] * f[0]! - right[0] * f[2]!,
    right[0] * f[1]! - right[1] * f[0]!,
  ];
  return { right, up };
}

function projectilePos(p: Projectile, t: number, out: Int32Array): void {
  const a = (((t + p.offset) % p.period) + p.period) % p.period;
  setRaw(out, p.origin[0] + p.vel[0] * a, p.origin[1] + p.vel[1] * a - 0.5 * p.gravity * a * a, p.origin[2] + p.vel[2] * a);
}

function lum(px: Uint8Array, i: number): number {
  return 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
}

function drawScene(ctx: SmokeContext, t: number): number {
  const { right } = axes(ctx);
  beams.update(t);
  beams.begin();
  beams.add(
    setRaw(from, C[0] - right[0] * HALF_LEN, C[1], C[2] - right[2] * HALF_LEN),
    setRaw(to, C[0] + right[0] * HALF_LEN, C[1], C[2] + right[2] * HALF_LEN),
    MEASURE,
  );
  // Build stream from an "engineer" to a structure, reclaim stream from a wreck.
  beams.add(setRaw(from, 226, 2.5, 236), setRaw(to, 246, 5, 226), VARKAN_BEAM_STYLES.buildStream);
  beams.add(setRaw(from, 283, 1, 280), setRaw(to, 268, 2, 290), VARKAN_BEAM_STYLES.reclaimStream);
  beams.add(setRaw(from, 290, 1, 232), setRaw(to, 290, 11, 232), VARKAN_BEAM_STYLES.shieldArc);
  // Timed shots (fired from the scene, fade by themselves).
  const shot = Math.floor(t / 0.2);
  if (shot !== lastShot) {
    lastShot = shot;
    const k = shot % 4;
    beams.addTimed(setRaw(from, 222, 3, 262 + k * 3), setRaw(to, 250, 2, 280 + k * 2), VARKAN_BEAM_STYLES.laser, t, 0.18);
  }
  const bolt = Math.floor(t / 0.35);
  if (bolt !== lastBolt) {
    lastBolt = bolt;
    beams.addTimed(setRaw(from, 300, 14, 250), setRaw(to, 292 - (bolt % 3) * 2, 0.5, 262), VARKAN_BEAM_STYLES.lightning, t, 0.3);
  }
  trails.begin();
  for (const p of projectiles) {
    projectilePos(p, t - 0.1, prev);
    projectilePos(p, t, cur);
    trails.add(prev, cur, p.style);
  }
  for (const s of standing) {
    setRaw(cur, s[0], s[1], s[2]);
    trails.add(cur, cur, VARKAN_TRAIL_STYLES.missile);
  }
  const enc = ctx.dev.beginPass({ label: 'smoke.trails', clearColor: [0.02, 0.025, 0.03, 1], clearDepth: 1 });
  enc.setBindGroup(group);
  enc.setPipeline(ground);
  enc.drawInstanced(4, 1);
  let draws = 1;
  draws += trails.encode(enc);
  draws += beams.encode(enc);
  enc.end();
  return draws;
}

/** Offscreen stress pass: `what` = 0 clear only (baseline), 1 = 4 096 beams, 2 = 8 192 trails. */
function drawStress(ctx: SmokeContext, t: number, what: 0 | 1 | 2): number {
  const enc = ctx.dev.beginPass({
    label: 'smoke.trails.stress',
    clearColor: [0, 0, 0, 1],
    clearDepth: 1,
    colorAttachments: [{ texture: stressColor }],
    depthAttachment: { texture: stressDepth },
  });
  let draws = 0;
  if (what === 1) {
    stressBeams.begin();
    for (let i = 0; i < STRESS_BEAMS; i++) {
      const o = i * 6;
      from[0] = stressData[o]!;
      from[1] = stressData[o + 1]!;
      from[2] = stressData[o + 2]!;
      to[0] = stressData[o + 3]!;
      to[1] = stressData[o + 4]!;
      to[2] = stressData[o + 5]!;
      stressBeams.add(from, to, stressStyles[i & 7]!);
    }
    draws += stressBeams.encode(enc);
  } else if (what === 2) {
    stressTrails.begin();
    const dt = Math.round(t * 60) % 60;
    const d = stressTrailData;
    for (let i = 0; i < STRESS_TRAILS; i++) {
      const o = i * 6;
      prev[0] = d[o]! + d[o + 3]! * dt;
      prev[1] = d[o + 1]!;
      prev[2] = d[o + 2]! + d[o + 5]! * dt;
      cur[0] = prev[0] + d[o + 3]!;
      cur[1] = prev[1] + d[o + 4]!;
      cur[2] = prev[2] + d[o + 5]!;
      stressTrails.add(prev, cur, i % 3 === 0 ? VARKAN_TRAIL_STYLES.cannon : VARKAN_TRAIL_STYLES.tracer);
    }
    draws += stressTrails.encode(enc);
  }
  enc.end();
  return draws;
}

/**
 * Frame schedule (cycle of 5, the last smoke frame 149 is a scene frame): every GPU timer segment spans
 * whole passes of one workload only (ANGLE/Metal splits render passes at query boundaries, so segment
 * switches inside a pass would distort the numbers). Stress cost = stressBeams/stressTrails − stressBase.
 */
const MODES = ['scene', 'stressBeams', 'stressTrails', 'stressBase', 'scene'] as const;
let frameNo = 0;
let lastWasScene = false;

export const smokeCase: SmokeCase = {
  name: 'trails',
  frames: 150,
  segments: ['scene', 'stressBeams', 'stressTrails', 'stressBase'],
  setup(ctx) {
    const dev = ctx.dev;
    ctx.camera.setTargetWU(C[0], 0, C[2]);
    ctx.camera.distance = 90;
    ctx.camera.yaw = -1.2;
    ctx.camera.update();
    const blocks = [
      { name: 'Frame', slot: SLOT_FRAME },
      { name: 'FxView', slot: SLOT_FX_VIEW },
    ];
    ground = dev.createPipeline({
      label: 'smoke.trails.ground',
      vertex: GROUND_VS,
      fragment: GROUND_FS,
      streams: [],
      uniformBlocks: blocks,
      primitive: 'triangle-strip',
      cullMode: 'none',
      depthTest: true,
      depthWrite: true,
    });
    group = dev.createBindGroup({ label: 'smoke.trails', buffers: fxSharedBufferBindings(ctx.frame.bindings) });
    beams = new BeamPass(dev, ctx.frame.bindings, { capacity: 64 });
    trails = new TrailPass(dev, ctx.frame.bindings, { capacity: 256 });
    const rng = new FxRng(4);
    const kinds: TrailStyle[] = [
      VARKAN_TRAIL_STYLES.tracer,
      VARKAN_TRAIL_STYLES.cannon,
      VARKAN_TRAIL_STYLES.artillery,
      VARKAN_TRAIL_STYLES.missile,
      VARKAN_TRAIL_STYLES.aa,
    ];
    projectiles.length = 0;
    for (let i = 0; i < N_TRAILS - N_STANDING; i++) {
      const style = kinds[i % kinds.length]!;
      const ang = rng.range(0, Math.PI * 2);
      const speed = style === VARKAN_TRAIL_STYLES.artillery ? 30 : style === VARKAN_TRAIL_STYLES.aa ? 70 : rng.range(40, 60);
      const up = style === VARKAN_TRAIL_STYLES.artillery ? 22 : style === VARKAN_TRAIL_STYLES.aa ? 35 : rng.range(-1, 2);
      projectiles.push({
        style,
        origin: [C[0] + rng.range(-45, 45), rng.range(1.5, 4), C[2] + rng.range(-35, 35)],
        vel: [Math.cos(ang) * speed, up, Math.sin(ang) * speed],
        gravity: style === VARKAN_TRAIL_STYLES.artillery ? 18 : 0,
        period: rng.range(0.9, 1.6),
        offset: rng.range(0, 2),
      });
    }
    standing.length = 0;
    for (let i = 0; i < N_STANDING; i++) standing.push([C[0] - 30 + i * 12, 6, C[2] + 22]);

    // Stress data (offscreen, GPU timing only).
    const size = dev.drawingBufferSize();
    stressColor = dev.createTexture({ label: 'smoke.trails.stress', width: size.width, height: size.height, format: 'rgba8' });
    stressDepth = dev.createTexture({ label: 'smoke.trails.stressDepth', width: size.width, height: size.height, format: 'depth24' });
    stressBeams = new BeamPass(dev, ctx.frame.bindings, { capacity: STRESS_BEAMS });
    stressTrails = new TrailPass(dev, ctx.frame.bindings, { capacity: STRESS_TRAILS });
    stressData = new Int32Array(STRESS_BEAMS * 6);
    for (let i = 0; i < STRESS_BEAMS; i++) {
      const x = C[0] + rng.range(-60, 60);
      const z = C[2] + rng.range(-45, 45);
      const a = rng.range(0, Math.PI * 2);
      const l = rng.range(6, 30);
      stressData.set([wuToRaw(x), wuToRaw(rng.range(1, 6)), wuToRaw(z), wuToRaw(x + Math.cos(a) * l), wuToRaw(rng.range(1, 6)), wuToRaw(z + Math.sin(a) * l)], i * 6);
    }
    stressStyles = [];
    for (let k = 0; k < 8; k++) {
      const base = [VARKAN_BEAM_STYLES.laser, VARKAN_BEAM_STYLES.buildStream, VARKAN_BEAM_STYLES.reclaimStream, VARKAN_BEAM_STYLES.lightning][k & 3]!;
      stressStyles.push({ ...base, widthWu: base.widthWu * (0.8 + 0.1 * k) });
    }
    stressTrailData = new Int32Array(STRESS_TRAILS * 6);
    for (let i = 0; i < STRESS_TRAILS; i++) {
      const a = rng.range(0, Math.PI * 2);
      const v = rng.range(0.4, 0.9); // WU per frame
      stressTrailData.set(
        [wuToRaw(C[0] + rng.range(-80, 80)), wuToRaw(rng.range(1, 8)), wuToRaw(C[2] + rng.range(-50, 50)), wuToRaw(Math.cos(a) * v), 0, wuToRaw(Math.sin(a) * v)],
        i * 6,
      );
    }
    lastShot = -1;
    lastBolt = -1;
    frameNo = 0;
    lastWasScene = false;
  },
  frame(ctx, t) {
    const mode = MODES[frameNo++ % MODES.length]!;
    ctx.timer.beginNamed(mode);
    lastWasScene = mode === 'scene';
    if (mode === 'scene') return drawScene(ctx, t);
    return drawStress(ctx, t, mode === 'stressBeams' ? 1 : mode === 'stressTrails' ? 2 : 0);
  },
  check(ctx) {
    const errors: string[] = [];
    // After a stress frame (e.g. following the context restore) redraw the scene at the same time.
    if (!lastWasScene) drawScene(ctx, ctx.frame.fxTime);
    if (beams.stats.draws !== 1) errors.push(`BeamPass issued ${beams.stats.draws} draws, expected 1`);
    if (trails.stats.draws !== 1) errors.push(`TrailPass issued ${trails.stats.draws} draws, expected 1`);
    if (trails.stats.trails !== N_TRAILS) errors.push(`${trails.stats.trails} trails drawn, expected ${N_TRAILS}`);
    if (stressBeams.stats.beams !== STRESS_BEAMS || stressTrails.stats.trails !== STRESS_TRAILS) {
      errors.push(`stress: ${stressBeams.stats.beams} beams / ${stressTrails.stats.trails} trails`);
    }
    // Measurement beam: core pixel on the projected axis, FWHM ≈ expected. Sampled across the beam at
    // five points along it; the median is robust against a trail crossing one sample line.
    const { right } = axes(ctx);
    const [ax, ay] = ctx.project(C[0] - right[0] * HALF_LEN, C[1], C[2] - right[2] * HALF_LEN);
    const [bx, by] = ctx.project(C[0] + right[0] * HALF_LEN, C[1], C[2] + right[2] * HALF_LEN);
    let nx = -(by - ay);
    let ny = bx - ax;
    const nl = Math.hypot(nx, ny);
    nx /= nl;
    ny /= nl;
    const R = 30;
    const samples: { peak: number; peakAt: number; bg: number; fwhm: number }[] = [];
    for (const u of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const [cx, cy] = ctx.project(C[0] + right[0] * HALF_LEN * u, C[1], C[2] + right[2] * HALF_LEN * u);
      const prof: number[] = [];
      for (let s = -R; s <= R; s++) prof.push(lum(ctx.readPixels(Math.round(cx + nx * s), Math.round(cy + ny * s), 1, 1), 0));
      const bg = (prof[0]! + prof[1]! + prof[prof.length - 1]! + prof[prof.length - 2]!) / 4;
      let peak = 0;
      let peakAt = 0;
      prof.forEach((v, i) => {
        if (v > peak) {
          peak = v;
          peakAt = i - R;
        }
      });
      const halfMax = bg + (peak - bg) / 2;
      samples.push({ peak, peakAt, bg, fwhm: prof.filter((v) => v >= halfMax).length });
    }
    const med = (f: (x: (typeof samples)[number]) => number): number => samples.map(f).sort((a, b) => a - b)[2]!;
    const peak = med((x) => x.peak);
    const bg = med((x) => x.bg);
    const peakAt = med((x) => x.peakAt);
    const fwhmPx = med((x) => x.fwhm);
    const [cx, cy] = ctx.project(C[0], C[1], C[2]);
    if (peak < bg + 60) errors.push(`beam core not bright at (${cx.toFixed(0)}, ${cy.toFixed(0)}): peak ${peak.toFixed(0)}, bg ${bg.toFixed(0)}`);
    if (Math.abs(peakAt) > 2) errors.push(`beam core off by ${peakAt} px from the projected axis`);
    // Expected: FWHM of the JS profile (core/glow luminance) × half width in pixels.
    const lc = 0.299 * MEASURE.core[0] + 0.587 * MEASURE.core[1] + 0.114 * MEASURE.core[2];
    const lg = 0.299 * MEASURE.glow[0] + 0.587 * MEASURE.glow[1] + 0.114 * MEASURE.glow[2];
    const p0 = beamProfile(0, lc, lg);
    let rHalf = 0;
    while (rHalf < 1 && beamProfile(rHalf, lc, lg) > p0 / 2) rHalf += 0.001;
    const cam = ctx.camera;
    const depth =
      (C[0] - cam.eyeRaw[0]! / 4096) * cam.forward[0]! + (C[1] - cam.eyeRaw[1]! / 4096) * cam.forward[1]! + (C[2] - cam.eyeRaw[2]! / 4096) * cam.forward[2]!;
    const halfPx = (0.5 * MEASURE.widthWu * ctx.frame.pixelsPerWuAt1) / depth;
    // The beam runs along the camera's right axis (perpendicular to the view), no foreshortening.
    const expected = 2 * rHalf * halfPx;
    if (Math.abs(fwhmPx - expected) > 1.5 + 0.2 * expected) {
      errors.push(`beam FWHM ${fwhmPx} px, expected ${expected.toFixed(1)} px (width ${MEASURE.widthWu} WU = ${(2 * halfPx).toFixed(1)} px)`);
    }
    // Standing trail heads (prev == cur) render as bright dots (no NaN collapse).
    for (const s of standing) {
      const [sx, sy] = ctx.project(s[0], s[1], s[2]);
      const px = ctx.readPixels(Math.round(sx) - 1, Math.round(sy) - 1, 3, 3);
      let m = 0;
      for (let i = 0; i < 9; i++) m = Math.max(m, lum(px, i * 4));
      if (m < 150) errors.push(`standing trail head at (${sx.toFixed(0)}, ${sy.toFixed(0)}) not visible (max luma ${m.toFixed(0)})`);
    }
    // Moving heads: most projected heads are brighter than the ground.
    const t = ctx.frame.fxTime;
    let lit = 0;
    let onScreen = 0;
    for (const p of projectiles) {
      projectilePos(p, t, cur);
      const [hx, hy] = ctx.project(cur[0]! / 4096, cur[1]! / 4096, cur[2]! / 4096);
      if (hx < 2 || hy < 2 || hx > ctx.width - 3 || hy > ctx.height - 3) continue;
      onScreen++;
      const px = ctx.readPixels(Math.round(hx) - 1, Math.round(hy) - 1, 3, 3);
      let m = 0;
      for (let i = 0; i < 9; i++) m = Math.max(m, lum(px, i * 4));
      if (m > bg + 40) lit++;
    }
    if (onScreen < 50 || lit < onScreen * 0.8) errors.push(`only ${lit}/${onScreen} on-screen trail heads visible`);
    return errors;
  },
  destroy(ctx) {
    beams.destroy();
    trails.destroy();
    stressBeams.destroy();
    stressTrails.destroy();
    ctx.dev.destroyTexture(stressColor);
    ctx.dev.destroyTexture(stressDepth);
    ctx.dev.destroyBindGroup(group);
    ctx.dev.destroyPipeline(ground);
  },
};
