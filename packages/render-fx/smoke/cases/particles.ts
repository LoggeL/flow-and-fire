/**
 * Particle smoke case (rfx-p3). Everything renders into a PostChain with the Medium target settings
 * (HDR RGBA16F + bloom + ACES + FXAA; LDR fallback without EXT_color_buffer_float), like fx-lab.
 *
 * Phase 1 – stress (STRESS_FRAMES frames, GPU/CPU measurement): a second ParticleSystem with a
 * 65 536 ring and cap 65 536 receives 2 000 spawns per frame (20 bursts × 100); lifetimes keep the
 * ring saturated at the cap. Timer segments 'stressParticles'/'stressPost'; CPU times of
 * spawn() ×20 and update()+encode() are published on `window.__rfxParticleBench`.
 *
 * Phase 2 – visual (VIS_FRAMES frames, checked and screenshotted): dark ground, Varkan effects
 * (acu_explosion + acu_aftermath, explosion_large, explosion_medium, impact_metal, muzzle_cannon,
 * a smoke_damage plume and a build_stream "Gießstrom") and two marker particles:
 * - a static magenta particle → its centroid must lie at `project()` ±2 px,
 * - a moving cyan particle (drag + gravity) → its centroid must lie at the projection of the JS
 *   mirror of the vertex shader (`mirrorParticle`) ±2 px (GPU/CPU parity of the closed-form motion).
 * The ACU burst and the stream must produce bright, warm pixels; draws per encode ∈ {1, 2}.
 * The harness repeats the checks after a context loss/restore (ring + LUT restored, particles keep
 * flying).
 *
 * Look-dev view (not used by the harness, no checks): `?case=particles&pview=<id,id,…>&page=<s>
 * [&pdist=<camera distance>][&pspacing=<WU>]` shows the listed effects in a row, each at age `page`
 * seconds in the last frame (continuous effects run from the start; streams flow 14 WU sideways).
 */
import { FRAME_BLOCK_GLSL, SLOT_FRAME } from '@faf/render';
import type { BindGroupH, PassEncoder, PipeH } from '@faf/render';
import {
  FX_COMMON_GLSL,
  FX_VIEW_BLOCK_GLSL,
  FxRng,
  PostChain,
  SLOT_FX_VIEW,
  VARKAN_EFFECTS,
  ParticleSystem,
  compileEffectLibrary,
  createMirrorState,
  createParticleRecord,
  defineEffect,
  fxSharedBufferBindings,
  mirrorParticle,
  particleCapForPreset,
  postOptionsForPreset,
  readRecord,
  wuToRaw,
} from '../../src/index.ts';
import type { EffectLibrary, ParticleRecord } from '../../src/index.ts';
import type { SmokeCase, SmokeContext } from '../case.ts';

const WORLD_WU = 512;
const STRESS_FRAMES = 150;
const STRESS_WARMUP = 60;
const VIS_FRAMES = 100;
const T_VIS = STRESS_FRAMES / 60;
const STRESS_BURSTS = 20;
const STRESS_CAPACITY = 65536;
const BG: readonly [number, number, number, number] = [0.05, 0.055, 0.065, 1];

const MARKER_STATIC: readonly [number, number, number] = [190, 4, 300];
const MARKER_MOVING: readonly [number, number, number] = [322, 2, 302];
const MOVING_DIR: readonly [number, number, number] = [0.6, 0.78, 0.18];
const ACU: readonly [number, number, number] = [236, 0, 246];
const STREAM_FROM: readonly [number, number, number] = [298, 4.5, 214];
const STREAM_TO: readonly [number, number, number] = [322, 0.6, 204];

/** Smoke-only effects (appended to the Varkan library). */
const SMOKE_EFFECTS = [
  defineEffect({
    id: 'smoke:marker_static',
    boundsWu: 3,
    layers: [
      {
        name: 'dot', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1, lifetime: [30, 30],
        speed: [0, 0], spread: 0, gravity: 0, drag: 0, size: 2.5,
        color: [[0, 3, 0, 3, 1], [1, 3, 0, 3, 1]], blend: 1, priority: 0,
      },
    ],
  }),
  defineEffect({
    id: 'smoke:marker_moving',
    boundsWu: 3,
    layers: [
      {
        name: 'dot', shape: 'flash', orient: 'billboard', motion: 'ballistic', count: 1, lifetime: [20, 20],
        speed: [9, 9], spread: 0, gravity: -4, drag: 0.7, size: 2.5,
        color: [[0, 0, 3, 3, 1], [1, 0, 3, 3, 1]], blend: 1, priority: 0,
      },
    ],
  }),
  defineEffect({
    id: 'smoke:stress',
    boundsWu: 12,
    layers: [
      {
        name: 'glow', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: 30, lifetime: [0.5, 0.7],
        speed: [2, 8], spread: 180, gravity: 1, drag: 1.5, size: [[0, 0.6], [1, 1.6]],
        color: [[0, 3, 1.8, 0.8, 1], [1, 1.2, 0.3, 0.05, 0]], blend: 0, priority: 1,
      },
      {
        name: 'smoke', shape: 'smoke', orient: 'billboard', motion: 'ballistic', count: 30, lifetime: [0.5, 0.7],
        speed: [1, 4], spread: 60, gravity: 2, drag: 1, size: [[0, 1], [1, 2.5]],
        color: [[0, 0.12, 0.11, 0.1, 0.6], [1, 0.1, 0.1, 0.1, 0]], blend: 1, priority: 1,
      },
      {
        name: 'spark', shape: 'spark', orient: 'velocity', motion: 'ballistic', count: 30, lifetime: [0.5, 0.7],
        speed: [8, 20], spread: 90, gravity: -9.8, drag: 0.5, size: 0.25, stretch: 3,
        color: [[0, 5, 3, 1.2, 1], [1, 2, 0.6, 0.1, 0]], blend: 0, priority: 1,
      },
      {
        name: 'debris', shape: 'debris', orient: 'billboard', motion: 'ballistic', count: 10, lifetime: [0.5, 0.7],
        speed: [4, 10], spread: 70, gravity: -12, drag: 0.3, size: 0.6,
        color: [[0, 0.2, 0.18, 0.16, 1], [1, 0.2, 0.18, 0.16, 1]], blend: 1, priority: 1,
      },
    ],
  }),
];

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
  // Mid-bright earth so both dark smoke and glowing fire read against it.
  vec3 albedo = mix(vec3(0.30, 0.27, 0.22), vec3(0.34, 0.31, 0.26), checker);
  vec3 light = u_sunColor.rgb * max(u_sunDir.y, 0.0) + u_skyColor.rgb * 0.4;
  o_color = vec4(albedo * light * 0.8, 1.0);
}
`;

interface BenchResult {
  spawnMsP50: number;
  spawnMsP95: number;
  updateEncodeMsP50: number;
  updateEncodeMsP95: number;
  peakAlive: number;
  aliveMean: number;
  windowMean: number;
  spawnedPerFrame: number;
  uploadBytesPerFrame: number;
  dropped: readonly number[];
  draws2: number;
  frames: number;
}

declare global {
  interface Window {
    __rfxParticleBench?: BenchResult;
  }
}

let lib: EffectLibrary;
let ps: ParticleSystem;
let stress: ParticleSystem | null = null;
let post: PostChain;
let ground: PipeH;
let group: BindGroupH;
let frameNo = 0;
let rng: FxRng;
let streamEmitter = -1;
let smokeEmitter = -1;
const fired = new Set<string>();
const rawPos = new Int32Array(3);
const rawTgt = new Int32Array(3);
const spawnMs: number[] = [];
const updMs: number[] = [];
const aliveSamples: number[] = [];
const windowSamples: number[] = [];
let spawnedSum = 0;
let uploadSum = 0;
let draws2 = 0;
let peakAlive = 0;
let movingSlot = -1;

/** Look-dev view parameters (see the module comment); null = normal smoke run. */
interface ViewParams {
  readonly ids: readonly string[];
  readonly ageS: number;
  readonly spacingWu: number;
}
let view: ViewParams | null = null;
const LAST_T = (STRESS_FRAMES + VIS_FRAMES - 1) / 60;

function readView(): { view: ViewParams | null; distance: number | null } {
  const q = new URLSearchParams(location.search);
  const ids = q.get('pview');
  const dist = q.get('pdist');
  if (ids === null) return { view: null, distance: null };
  return {
    view: {
      ids: ids.split(',').map((id) => (id.includes(':') ? id : `varkan:${id}`)),
      ageS: Math.min(LAST_T, Math.max(0, Number(q.get('page') ?? '1'))),
      spacingWu: Number(q.get('pspacing') ?? '24'),
    },
    distance: dist !== null ? Number(dist) : null,
  };
}

function viewFrame(ctx: SmokeContext, t: number, v: ViewParams): number {
  const n = v.ids.length;
  for (let i = 0; i < n; i++) {
    const id = v.ids[i]!;
    const eff = lib.effects[lib.indexOf(id)]!;
    const x = 256 + (i - (n - 1) / 2) * v.spacingWu;
    if (eff.continuous) {
      once(`view:${i}`, t, 0, () => {
        const stream = eff.def.layers.some((l) => l.motion === 'stream');
        ps.createEmitter(eff.index, raw(rawPos, [x - (stream ? 7 : 0), stream ? 4 : 1, 256]), {
          seed: 100 + i,
          targetRaw: raw(rawTgt, [x + 7, 0.5, 252]),
        });
      });
    } else {
      once(`view:${i}`, t, LAST_T - v.ageS - 1e-6, () => ps.spawn(eff.index, raw(rawPos, [x, 0.5, 256]), { seed: 100 + i }));
    }
  }
  ps.update(t, ctx.camera);
  const enc = drawGround();
  ctx.timer.beginNamed('particles');
  const d = ps.encode(enc);
  enc.end();
  ctx.timer.beginNamed('post');
  return 1 + d + post.resolve();
}
const rec: ParticleRecord = createParticleRecord();
const mirror = createMirrorState();

function raw(out: Int32Array, p: readonly number[]): Int32Array {
  out[0] = wuToRaw(p[0]!);
  out[1] = wuToRaw(p[1]!);
  out[2] = wuToRaw(p[2]!);
  return out;
}

function pct(v: number[], q: number): number {
  if (v.length === 0) return 0;
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** Opens the HDR scene pass and draws the ground (depth write on). */
function drawGround(): PassEncoder {
  const enc = post.beginScene(BG);
  enc.setBindGroup(group);
  enc.setPipeline(ground);
  enc.drawInstanced(4, 1);
  return enc;
}

function stressFrame(ctx: SmokeContext, t: number): number {
  const s = stress!;
  const c0 = performance.now();
  for (let b = 0; b < STRESS_BURSTS; b++) {
    raw(rawPos, [rng.range(190, 322), rng.range(1, 8), rng.range(206, 304)]);
    s.spawn(lib.indexOf('smoke:stress'), rawPos, { seed: rng.next() });
  }
  const c1 = performance.now();
  s.update(t, ctx.camera);
  const enc = drawGround();
  ctx.timer.beginNamed('stressParticles');
  const c2 = performance.now();
  const d = s.encode(enc);
  const c3 = performance.now();
  enc.end();
  ctx.timer.beginNamed('stressPost');
  const pd = post.resolve();
  const st = s.stats;
  peakAlive = Math.max(peakAlive, st.alive);
  if (frameNo >= STRESS_WARMUP) {
    spawnMs.push(c1 - c0);
    updMs.push(c2 - c1 + (c3 - c2));
    aliveSamples.push(st.alive);
    windowSamples.push(st.window);
    spawnedSum += st.spawnedFrame;
    uploadSum += st.uploadBytesFrame;
    if (d === 2) draws2++;
  }
  return 1 + d + pd;
}

function publishBench(): void {
  const n = Math.max(1, aliveSamples.length);
  window.__rfxParticleBench = {
    spawnMsP50: pct(spawnMs, 0.5),
    spawnMsP95: pct(spawnMs, 0.95),
    updateEncodeMsP50: pct(updMs, 0.5),
    updateEncodeMsP95: pct(updMs, 0.95),
    peakAlive,
    aliveMean: aliveSamples.reduce((a, b) => a + b, 0) / n,
    windowMean: windowSamples.reduce((a, b) => a + b, 0) / n,
    spawnedPerFrame: spawnedSum / n,
    uploadBytesPerFrame: uploadSum / n,
    dropped: [...stress!.stats.dropped],
    draws2,
    frames: aliveSamples.length,
  };
}

/** Fires `fn` once when the visual-phase time passes `at`. */
function once(key: string, tv: number, at: number, fn: () => void): void {
  if (tv >= at && !fired.has(key)) {
    fired.add(key);
    fn();
  }
}

function visualFrame(ctx: SmokeContext, t: number): number {
  const tv = t - T_VIS;
  once('start', tv, 0, () => {
    ps.spawn(lib.indexOf('smoke:marker_static'), raw(rawPos, MARKER_STATIC), { seed: 1 });
    ps.spawn(lib.indexOf('varkan:explosion_large'), raw(rawPos, [300, 0, 250]), { seed: 2 });
    smokeEmitter = ps.createEmitter(lib.indexOf('varkan:smoke_damage'), raw(rawPos, [206, 2, 276]), { seed: 3 });
    streamEmitter = ps.createEmitter(lib.indexOf('varkan:build_stream'), raw(rawPos, STREAM_FROM), {
      seed: 4,
      targetRaw: raw(rawTgt, STREAM_TO),
    });
  });
  once('moving', tv, 0.5, () => {
    movingSlot = ps.windowRange.head % ps.capacity;
    ps.spawn(lib.indexOf('smoke:marker_moving'), raw(rawPos, MARKER_MOVING), { seed: 5, dir: MOVING_DIR });
  });
  once('acu', tv, 0.8, () => {
    ps.spawn(lib.indexOf('varkan:acu_explosion'), raw(rawPos, ACU), { seed: 6 });
    ps.spawn(lib.indexOf('varkan:acu_aftermath'), raw(rawPos, ACU), { seed: 7 });
  });
  once('medium', tv, 1.4, () => ps.spawn(lib.indexOf('varkan:explosion_medium'), raw(rawPos, [292, 0, 280]), { seed: 8 }));
  once('metal', tv, 1.5, () => ps.spawn(lib.indexOf('varkan:impact_metal'), raw(rawPos, [262, 1.5, 296]), { seed: 9, dir: [0, 0.7, 0.7] }));
  once('muzzle', tv, 1.55, () => ps.spawn(lib.indexOf('varkan:muzzle_cannon'), raw(rawPos, [214, 2.5, 226]), { seed: 10, dir: [1, 0.1, 0.2] }));
  ps.update(t, ctx.camera);
  const enc = drawGround();
  ctx.timer.beginNamed('particles');
  const d = ps.encode(enc);
  enc.end();
  ctx.timer.beginNamed('post');
  return 1 + d + post.resolve();
}

function lum(px: Uint8Array, i: number): number {
  return 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
}

/** Centroid of pixels matching `match` in a (2r)² window around (cx, cy). */
function centroid(ctx: SmokeContext, cx: number, cy: number, r: number, match: (p: Uint8Array, i: number) => boolean) {
  const x0 = Math.max(0, Math.round(cx) - r);
  const y0 = Math.max(0, Math.round(cy) - r);
  const w = Math.min(ctx.width, Math.round(cx) + r) - x0;
  const h = Math.min(ctx.height, Math.round(cy) + r) - y0;
  const px = ctx.readPixels(x0, y0, w, h);
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!match(px, (y * w + x) * 4)) continue;
      n++;
      sx += x + 0.5;
      sy += y + 0.5;
    }
  }
  return { n, x: x0 + sx / n, y: y0 + sy / n };
}

const isMagenta = (p: Uint8Array, i: number): boolean => p[i]! > 120 && p[i + 2]! > 120 && p[i + 1]! < 0.45 * Math.min(p[i]!, p[i + 2]!);
const isCyan = (p: Uint8Array, i: number): boolean => p[i + 1]! > 120 && p[i + 2]! > 120 && p[i]! < 0.45 * Math.min(p[i + 1]!, p[i + 2]!);

function checkMarker(ctx: SmokeContext, label: string, pos: readonly number[], match: (p: Uint8Array, i: number) => boolean, errors: string[]) {
  const [px, py] = ctx.project(pos[0]!, pos[1]!, pos[2]!);
  if (px < 20 || py < 20 || px > ctx.width - 20 || py > ctx.height - 20) {
    errors.push(`${label}: projected off-screen (${px.toFixed(1)}, ${py.toFixed(1)})`);
    return;
  }
  const c = centroid(ctx, px, py, 24, match);
  if (c.n < 12) errors.push(`${label}: only ${c.n} marker pixels near (${px.toFixed(1)}, ${py.toFixed(1)})`);
  else if (Math.abs(c.x - px) > 2 || Math.abs(c.y - py) > 2) {
    errors.push(`${label}: centroid (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) ≠ expected (${px.toFixed(1)}, ${py.toFixed(1)}) ±2 px`);
  }
}

export const smokeCase: SmokeCase = {
  name: 'particles',
  frames: STRESS_FRAMES + VIS_FRAMES,
  segments: ['stressParticles', 'stressPost', 'particles', 'post'],
  setup(ctx) {
    const dev = ctx.dev;
    ctx.camera.setTargetWU(256, 0, 256);
    const vp = readView();
    view = vp.view;
    ctx.camera.distance = vp.distance ?? 140;
    ctx.camera.pitch = (50 * Math.PI) / 180;
    ctx.camera.yaw = -Math.PI / 2;
    ctx.camera.update();
    lib = compileEffectLibrary([...VARKAN_EFFECTS, ...SMOKE_EFFECTS]);
    ps = new ParticleSystem(dev, ctx.frame.bindings, lib, { cap: particleCapForPreset('medium') });
    stress = new ParticleSystem(dev, ctx.frame.bindings, lib, { capacity: STRESS_CAPACITY, cap: STRESS_CAPACITY });
    post = new PostChain(dev, postOptionsForPreset('medium'));
    post.resize(ctx.width, ctx.height);
    ground = dev.createPipeline({
      label: 'smoke.particles.ground',
      vertex: GROUND_VS,
      fragment: GROUND_FS,
      streams: [],
      uniformBlocks: [
        { name: 'Frame', slot: SLOT_FRAME },
        { name: 'FxView', slot: SLOT_FX_VIEW },
      ],
      primitive: 'triangle-strip',
      cullMode: 'none',
      depthTest: true,
      depthWrite: true,
    });
    group = dev.createBindGroup({ label: 'smoke.particles', buffers: fxSharedBufferBindings(ctx.frame.bindings) });
    rng = new FxRng(20260930);
    frameNo = 0;
    fired.clear();
  },
  frame(ctx, t) {
    if (view !== null) {
      frameNo++;
      return viewFrame(ctx, t, view);
    }
    const draws = frameNo < STRESS_FRAMES ? stressFrame(ctx, t) : visualFrame(ctx, t);
    frameNo++;
    if (frameNo === STRESS_FRAMES && stress !== null) {
      publishBench();
      stress.destroy();
      stress = null;
    }
    return draws;
  },
  check(ctx) {
    if (view !== null) return [];
    const errors: string[] = [];
    const b = window.__rfxParticleBench;
    if (b === undefined) errors.push('stress phase did not publish results');
    else {
      if (b.peakAlive < 0.97 * STRESS_CAPACITY || b.peakAlive > STRESS_CAPACITY) errors.push(`stress: peak alive ${b.peakAlive}, expected ≈ cap ${STRESS_CAPACITY}`);
      if (!(b.dropped[1]! > 0)) errors.push('stress: the cap never dropped priority-1 particles');
      if (b.draws2 === 0) errors.push('stress: the saturated ring never wrapped (expected 2-draw frames)');
    }
    const st = ps.stats;
    if (st.draws < 1 || st.draws > 2) errors.push(`visual: ${st.draws} particle draws, expected 1 or 2`);
    if (st.alive < 500) errors.push(`visual: only ${st.alive} particles alive`);
    // Static marker: GPU position = project(origin).
    checkMarker(ctx, 'static marker', MARKER_STATIC, isMagenta, errors);
    // Moving marker: GPU position = projection of the vertex-shader mirror at the current FX time.
    if (movingSlot < 0) errors.push('moving marker not spawned');
    else {
      readRecord(ps.records, movingSlot, rec);
      if (rec.layer !== lib.effects[lib.indexOf('smoke:marker_moving')]!.firstLayer) errors.push(`moving marker slot ${movingSlot} holds layer ${rec.layer}`);
      mirrorParticle(lib.layers, lib.lut, rec, ctx.frame.fxTime, mirror);
      const p = mirror.posWu;
      const moved = Math.hypot(p[0] - MARKER_MOVING[0], p[1] - MARKER_MOVING[1], p[2] - MARKER_MOVING[2]);
      if (!mirror.alive || moved < 3) errors.push(`moving marker: mirror alive ${mirror.alive}, moved ${moved.toFixed(2)} WU`);
      else checkMarker(ctx, `moving marker (${p.map((v) => v.toFixed(2)).join(', ')})`, p, isCyan, errors);
    }
    // ACU explosion: many bright, warm pixels around the epicentre.
    const [ax, ay] = ctx.project(ACU[0], ACU[1] + 4, ACU[2]);
    const r = 110;
    const x0 = Math.max(0, Math.round(ax) - r);
    const y0 = Math.max(0, Math.round(ay) - r);
    const w = Math.min(ctx.width, Math.round(ax) + r) - x0;
    const h = Math.min(ctx.height, Math.round(ay) + r) - y0;
    const win = ctx.readPixels(x0, y0, w, h);
    // Saturated HDR cores tonemap to white; the fire shows as an orange/red fringe around them.
    let bright = 0;
    let warm = 0;
    for (let i = 0; i < win.length; i += 4) {
      const l = lum(win, i);
      if (l > 190) bright++;
      if (l > 100 && win[i]! > win[i + 2]! + 40) warm++;
    }
    if (bright < 400) errors.push(`ACU explosion: only ${bright} bright pixels`);
    if (warm < 300) errors.push(`ACU explosion: only ${warm} warm (fire-coloured) pixels`);
    // Build stream: glowing along the path (4 of 5 samples).
    let lit = 0;
    for (const a of [0.15, 0.35, 0.5, 0.65, 0.85]) {
      const q = [0, 1, 2].map((k) => STREAM_FROM[k]! + (STREAM_TO[k]! - STREAM_FROM[k]!) * a);
      const [sx, sy] = ctx.project(q[0]!, q[1]!, q[2]!);
      const px = ctx.readPixels(Math.round(sx) - 3, Math.round(sy) - 3, 7, 7);
      let best = 0;
      let bi = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = lum(px, i);
        if (l > best) {
          best = l;
          bi = i;
        }
      }
      if (best > 120 && px[bi]! >= px[bi + 2]!) lit++;
    }
    if (lit < 4) errors.push(`build stream: only ${lit}/5 path samples glow`);
    return errors;
  },
  destroy(ctx) {
    const dev = ctx.dev;
    if (streamEmitter >= 0) ps.destroyEmitter(streamEmitter);
    if (smokeEmitter >= 0) ps.destroyEmitter(smokeEmitter);
    ps.destroy();
    stress?.destroy();
    stress = null;
    post.destroy();
    dev.destroyBindGroup(group);
    dev.destroyPipeline(ground);
  },
};
