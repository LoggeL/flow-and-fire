/**
 * SPK4 benchmark page (browser). Loads hollow-ridge, builds the deterministic scene once and exposes
 * `window.__spk4.run({ scenario, warmupS, measureS })`, which renders the scenario on a fresh canvas
 * (CSS 1920 × 1080, DPR 1, backbuffer 1536 × 864 = render scale 0.8) along the camera flight and
 * returns a {@link ScenarioResult}. The units advance at 10 Hz outside the measured window (they stand
 * in for the sim worker); Main-JS is the time of the render call: CPU culling/LOD/sorting/uploads
 * plus the WebGL submission.
 *
 * Manual use: open the built page with `?scenario=full` to watch a flight loop (HUD with live numbers).
 */
import { readRtsMap } from '@faf/formats';
import { RtsCamera, backbufferSize } from '@faf/render';
import mapUrl from '../../../content/maps/hollow-ridge.rtsmap?url';
import { FacadeBench, PrototypeBench } from './bench-renderer.ts';
import type { BenchRenderer, PassDrawStats } from './bench-renderer.ts';
import { drawBudget } from './budget.ts';
import { GpuTimer, hideTimerQueryFromDevice } from './gpu-timer.ts';
import type { RunOptions, ScenarioResult } from './report.ts';
import { SCENARIOS, VIEWPORT, parseScenario } from './scenarios.ts';
import { RAW, TICK_MS, buildScene, flightPose } from './scene.ts';
import type { BenchScene, CameraPose } from './scene.ts';
import { Samples } from './stats.ts';

const hud = document.getElementById('hud') as HTMLDivElement;
let scene: BenchScene | null = null;
/** Renderer of the last run: kept alive (last frame stays on screen for the screenshot). */
let lastRenderer: BenchRenderer | null = null;

async function loadScene(): Promise<BenchScene> {
  const res = await fetch(mapUrl);
  if (!res.ok) throw new Error(`map fetch failed: ${res.status}`);
  const map = readRtsMap(new Uint8Array(await res.arrayBuffer()));
  return buildScene(map);
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function newCanvas(): HTMLCanvasElement {
  for (const old of Array.from(document.querySelectorAll('canvas'))) old.remove();
  const canvas = document.createElement('canvas');
  canvas.style.width = `${VIEWPORT.width}px`;
  canvas.style.height = `${VIEWPORT.height}px`;
  const bb = backbufferSize(VIEWPORT.width, VIEWPORT.height, VIEWPORT.dpr, SCENARIOS.full.preset.renderScale);
  canvas.width = bb.width;
  canvas.height = bb.height;
  document.body.prepend(canvas);
  return canvas;
}

function gpuRendererString(gl: WebGL2RenderingContext): string {
  // RENDERER first: Firefox reports a sanitized GPU there and warns about WEBGL_debug_renderer_info.
  const plain: unknown = gl.getParameter(gl.RENDERER);
  if (typeof plain === 'string' && !/^WebKit WebGL$/i.test(plain)) return plain;
  const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
  const v: unknown = ext !== null ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : plain;
  return typeof v === 'string' ? v : 'unknown';
}

/** Smallest non-zero difference of the samples (clock granularity, e.g. 1 ms in WebKit). */
function clockResolution(xs: Samples): number {
  const v = Array.from(xs.data.subarray(0, xs.length)).filter((x) => x > 0).sort((a, b) => a - b);
  let res = Number.POSITIVE_INFINITY;
  for (let i = 0; i < v.length; i++) {
    if (v[i]! > 0 && v[i]! < res) res = v[i]!;
    if (i > 0 && v[i]! - v[i - 1]! > 1e-9 && v[i]! - v[i - 1]! < res) res = v[i]! - v[i - 1]!;
  }
  return Number.isFinite(res) ? res : 0;
}

function applyPose(camera: RtsCamera, p: CameraPose): void {
  camera.targetX = p.x * RAW;
  camera.targetZ = p.z * RAW;
  camera.targetY = p.y * RAW;
  camera.groundHeight = p.y;
  camera.distance = p.distance;
  camera.pitch = p.pitch;
  camera.yaw = p.yaw;
}

const PASS_KEYS: readonly (keyof PassDrawStats)[] = ['shadowStatic', 'shadowUnits', 'terrain', 'props', 'units', 'blob', 'impostors', 'water', 'post', 'overlay'];

async function run(opts: RunOptions): Promise<ScenarioResult> {
  if (scene === null) scene = await loadScene();
  const sc = scene;
  lastRenderer?.dispose();
  lastRenderer = null;
  const cfg = SCENARIOS[opts.scenario];
  const errors: string[] = [];
  const canvas = newCanvas();
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (gl === null) throw new Error('WebGL2 unavailable');
  const timerExt = hideTimerQueryFromDevice(gl)();
  const timer = new GpuTimer(gl, timerExt);
  const gpuRenderer = gpuRendererString(gl);

  let renderer: BenchRenderer;
  try {
    renderer = cfg.facade ? new FacadeBench(canvas, gl, sc, cfg) : new PrototypeBench(canvas, gl, sc, cfg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`renderer setup failed (${opts.scenario}): ${msg}`, { cause: e });
  }
  const budget = drawBudget(cfg);
  const camera = new RtsCamera({ maxDistance: 1500 });
  camera.setViewport(VIEWPORT.width, VIEWPORT.height);
  const pose: CameraPose = { x: 0, z: 0, y: 0, distance: 0, pitch: 0, yaw: 0 };

  const mainJs = new Samples();
  const draws = new Samples();
  const gpu = new Samples();
  const frameMs = new Samples();
  const unitInst = new Samples();
  const propInst = new Samples();
  const impInst = new Samples();
  const patches = new Samples();
  const casters = new Samples();
  const passMax: PassDrawStats = { shadowStatic: 0, shadowUnits: 0, terrain: 0, props: 0, units: 0, blob: 0, impostors: 0, water: 0, post: 0, overlay: 0 };
  let framesOver = 0;
  let gpuSamples = 0;
  const segCount = renderer.segments;
  const gpuSeg = [new Samples(), new Samples(), new Samples()];
  const gpuSegN = new Samples();
  const gpuSink = (frame: number, segment: number, ms: number): void => {
    if (frame < 0 || frame >= gpu.length || segment >= segCount) return;
    gpuSeg[segment]!.set(frame, ms);
    gpuSegN.set(frame, (gpuSegN.data[frame] ?? 0) + 1);
    gpuSamples++;
  };
  const phase = (segment: number): void => timer.begin(measuring ? measured : -1, segment);
  let measuring = false;

  const units = sc.units;
  let start = -1;
  let lastTick = 0;
  let prevNow = -1;
  let measured = 0;
  let refreshStart = 0;
  let ticksAtStart = 0;
  let measureStart = 0;
  let measureEnd: number;
  const totalS = opts.warmupS + opts.measureS;
  for (;;) {
    const now = await nextFrame();
    if (start < 0) {
      start = now;
      lastTick = now;
    }
    const elapsed = (now - start) / 1000;
    if (elapsed >= totalS) {
      measureEnd = now;
      break;
    }
    measuring = elapsed >= opts.warmupS;
    if (measuring && measured === 0) {
      refreshStart = renderer.stats.shadowRefreshes;
      ticksAtStart = units.tickCount;
      measureStart = now;
      prevNow = -1;
    }
    // Synthetic sim ticks (stand-in for the sim worker, not measured).
    while (now - lastTick >= TICK_MS) {
      units.tick();
      lastTick += TICK_MS;
    }
    const alpha = Math.min(1, (now - lastTick) / TICK_MS);
    flightPose(sc.heights, measuring ? elapsed - opts.warmupS : elapsed, pose);
    applyPose(camera, pose);
    timer.poll(gpuSink);

    timer.begin(measuring ? measured : -1, 0);
    const t0 = performance.now();
    renderer.render(camera, alpha, now, phase);
    const t1 = performance.now();
    timer.end();

    if (measuring) {
      const st = renderer.stats;
      mainJs.push(t1 - t0);
      draws.push(st.draws);
      gpu.push(Number.NaN);
      gpuSegN.push(0);
      for (let k = 0; k < segCount; k++) gpuSeg[k]!.push(Number.NaN);
      if (prevNow >= 0) frameMs.push(now - prevNow);
      unitInst.push(st.unitInstances);
      propInst.push(st.propInstances);
      impInst.push(st.impostorInstances);
      patches.push(st.terrainPatches);
      casters.push(st.casterUnits);
      for (const k of PASS_KEYS) if (st.byPass[k] > passMax[k]) passMax[k] = st.byPass[k];
      if (st.draws > cfg.maxDraws || st.draws > budget.worst) framesOver++;
      measured++;
    }
    prevNow = now;
    if (hud !== null && (measured & 15) === 0) {
      hud.textContent = `${opts.scenario} ${measuring ? 'measure' : 'warm-up'} ${elapsed.toFixed(1)} s | draws ${renderer.stats.draws} | js ${(t1 - t0).toFixed(2)} ms`;
    }
  }
  // Drain outstanding timer queries (results arrive a few frames late).
  for (let i = 0; i < 60 && timer.inFlight > 0; i++) {
    await nextFrame();
    timer.poll(gpuSink);
  }
  // Frame GPU time = sum of its segments (only frames with every segment resolved).
  for (let f = 0; f < gpu.length; f++) {
    if (gpuSegN.data[f] !== segCount) continue;
    let sum = 0;
    for (let k = 0; k < segCount; k++) sum += gpuSeg[k]!.data[f]!;
    gpu.set(f, sum);
  }
  const glErrors = renderer.device.checkErrors();
  for (const e of glErrors) errors.push(`GL: ${e}`);
  if (framesOver > 0) errors.push(`draw budget exceeded in ${framesOver} frame(s): max ${draws.summary().max} > ${Math.min(cfg.maxDraws, budget.worst)}`);

  const measuredS = (measureEnd - measureStart) / 1000;
  const result: ScenarioResult = {
    scenario: opts.scenario,
    ok: errors.length === 0,
    errors,
    userAgent: navigator.userAgent,
    gpuRenderer,
    caps: {
      timerQuery: timer.available,
      colorBufferFloat: renderer.device.caps.colorBufferFloat,
      multiDraw: renderer.device.caps.multiDraw,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
    },
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height, dpr: VIEWPORT.dpr },
    backbuffer: { width: canvas.width, height: canvas.height },
    info: renderer.info,
    frames: measured,
    measuredS,
    fps: measuredS > 0 ? measured / measuredS : 0,
    draws: draws.summary(),
    drawsByPassMax: passMax,
    drawBudget: { limit: cfg.maxDraws, bound: budget.worst, framesOver },
    mainJsMs: mainJs.summary(),
    clockResolutionMs: clockResolution(mainJs),
    gpuMs: timer.available ? gpu.summary() : null,
    gpuSegmentsMs: timer.available && segCount > 1 ? gpuSeg.slice(0, segCount).map((x) => x.summary()) : null,
    gpuTimer: { available: timer.available, samples: gpuSamples, disjoint: timer.disjoint, skipped: timer.skipped },
    frameMs: frameMs.summary(),
    unitInstances: unitInst.summary(),
    propInstances: propInst.summary(),
    impostorInstances: impInst.summary(),
    terrainPatches: patches.summary(),
    casterUnits: casters.summary(),
    shadowRefreshes: renderer.stats.shadowRefreshes - refreshStart,
    ticks: units.tickCount - ticksAtStart,
  };
  timer.dispose();
  // Keep the last frame on screen for the screenshot; the next run disposes it.
  lastRenderer = renderer;
  return result;
}

window.__spk4 = { ready: false, error: null, run };

loadScene()
  .then((s) => {
    scene = s;
    window.__spk4!.ready = true;
    if (hud !== null) hud.textContent = 'SPK4 ready';
    const manual = parseScenario(new URLSearchParams(location.search).get('scenario'));
    if (manual !== undefined) {
      const loop = async (): Promise<void> => {
        for (;;) {
          const r = await run({ scenario: manual, warmupS: 1, measureS: 10 });
          console.info('spk4', r);
        }
      };
      void loop();
    }
  })
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    window.__spk4!.error = msg;
    if (hud !== null) hud.textContent = `error: ${msg}`;
    console.error(msg);
  });
