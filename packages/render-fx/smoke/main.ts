/**
 * render-fx smoke page: `index.html?case=<name>` loads smoke/cases/<name>.ts, renders its frames on a
 * 960×540 canvas and publishes the result on `window.__smoke` (see case.ts) for scripts/smoke.ts.
 */
import { RtsCamera, createWebGL2Device } from '@faf/render';
import type { WebGL2Device } from '@faf/render';
import { FxFrameUniforms, GpuSpanTimer, hideTimerQueryFromDevice } from '../src/index.ts';
import type { SmokeCase, SmokeContext, SmokeState } from './case.ts';

const WIDTH = 960;
const HEIGHT = 540;
const DT = 1 / 60;
const READ_FRAMEBUFFER = 0x8ca8;
const READ_FRAMEBUFFER_BINDING = 0x8caa;

const cases = import.meta.glob<{ smokeCase: SmokeCase }>('./cases/*.ts');
const logEl = document.getElementById('log');

function log(s: string): void {
  if (logEl !== null) logEl.textContent += s + '\n';
}

function median(v: number[]): number | null {
  if (v.length === 0) return null;
  const s = v.slice().sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

const nextFrame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

const state: SmokeState = {
  done: false,
  error: null,
  case: '',
  draws: 0,
  frames: 0,
  checks: [],
  gpuMs: {},
  jsMs: 0,
  renderer: '',
  caps: { colorBufferFloat: false, timerQuery: false, loseContext: false },
  loseAndRestore: () => Promise.reject(new Error('smoke case not loaded')),
  finish: () => [],
};
window.__smoke = state;

function fail(e: unknown): void {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  state.error = state.error ?? msg;
  state.done = true;
  log(`ERROR ${msg}`);
}
window.addEventListener('error', (ev) => fail(ev.error ?? ev.message));
window.addEventListener('unhandledrejection', (ev) => fail(ev.reason));

function makeContext(canvas: HTMLCanvasElement, dev: WebGL2Device, timer: GpuSpanTimer): SmokeContext {
  const camera = new RtsCamera({ distance: 120, pitch: (50 * Math.PI) / 180, yaw: -Math.PI / 2 });
  camera.setViewport(WIDTH, HEIGHT);
  camera.setTargetWU(256, 0, 256);
  camera.update();
  const frame = new FxFrameUniforms(dev);
  const proj = new Float64Array(4);
  return {
    dev,
    canvas,
    camera,
    frame,
    width: WIDTH,
    height: HEIGHT,
    timer,
    readPixels(x, y, w, h) {
      const gl = dev.gl;
      const prev = gl.getParameter(READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(READ_FRAMEBUFFER, null);
      const raw = new Uint8Array(w * h * 4);
      gl.readPixels(x, HEIGHT - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      gl.bindFramebuffer(READ_FRAMEBUFFER, prev);
      // GL rows are bottom-up: flip to top-down.
      const out = new Uint8Array(raw.length);
      const row = w * 4;
      for (let r = 0; r < h; r++) out.set(raw.subarray((h - 1 - r) * row, (h - r) * row), r * row);
      return out;
    },
    project(xWu, yWu, zWu) {
      camera.update();
      camera.project(xWu * 4096, yWu * 4096, zWu * 4096, proj);
      const sx = WIDTH / camera.viewportWidth;
      const sy = HEIGHT / camera.viewportHeight;
      return [proj[0]! * sx, proj[1]! * sy];
    },
  };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const name = params.get('case') ?? 'core';
  state.case = name;
  const loader = cases[`./cases/${name}.ts`];
  if (loader === undefined) throw new Error(`unknown smoke case '${name}' (have: ${Object.keys(cases).join(', ')})`);
  const sc = (await loader()).smokeCase;

  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  if (gl === null) throw new Error('WebGL2 unavailable');
  const timerExt = hideTimerQueryFromDevice(gl);
  const dev = createWebGL2Device(canvas, { context: gl });
  const segments = ['frame', ...(sc.segments ?? [])];
  const timer = new GpuSpanTimer(gl, timerExt, segments);
  const ctx = makeContext(canvas, dev, timer);
  state.renderer = dev.caps.renderer;
  state.caps = {
    colorBufferFloat: dev.caps.colorBufferFloat,
    timerQuery: timer.available,
    loseContext: gl.getExtension('WEBGL_lose_context') !== null,
  };
  const gpuSamples: number[][] = segments.map(() => []);
  const jsSamples: number[] = [];
  const sink = (_f: number, s: number, ms: number): void => {
    gpuSamples[s]!.push(ms);
  };

  let t = 0;
  const renderFrame = (): number => {
    const t0 = performance.now();
    ctx.frame.update(ctx.camera, { timeS: t, dtS: DT, viewport: [WIDTH, HEIGHT] });
    timer.beginFrame();
    timer.begin(0);
    const draws = sc.frame(ctx, t);
    timer.endFrame();
    jsSamples.push(performance.now() - t0);
    timer.poll(sink);
    state.draws = draws;
    state.frames++;
    t += DT;
    return draws;
  };

  sc.setup(ctx);
  const frames = sc.frames ?? 30;
  for (let i = 0; i < frames; i++) {
    await nextFrame();
    renderFrame();
    if (i === frames - 1) state.checks = sc.check?.(ctx) ?? [];
  }
  // Let outstanding timer queries resolve (a few frames later).
  for (let i = 0; i < 6 && timer.inFlight > 0; i++) {
    await nextFrame();
    timer.poll(sink);
  }
  const glErrors = dev.checkErrors();
  for (const e of glErrors) state.checks.push(`GL error: ${e}`);
  state.jsMs = median(jsSamples) ?? 0;
  for (let s = 0; s < segments.length; s++) state.gpuMs[segments[s]!] = median(gpuSamples[s]!);

  state.loseAndRestore = async () => {
    if (!dev.debugLoseContext()) return { supported: false, checks: [], draws: 0 };
    const restored = new Promise<void>((resolve) => {
      const off = dev.onRestored(() => {
        off();
        resolve();
      });
    });
    for (let i = 0; i < 120 && !dev.isLost(); i++) await nextFrame();
    if (!dev.isLost()) throw new Error('context did not report loss');
    timer.reset();
    // Frames while lost must be harmless no-ops.
    renderFrame();
    if (!dev.debugRestoreContext()) throw new Error('debugRestoreContext failed');
    await Promise.race([
      restored,
      new Promise<never>((_r, reject) => setTimeout(() => reject(new Error('context restore timed out')), 10_000)),
    ]);
    timer.reset();
    const n = Math.max(3, Math.min(frames, 10));
    let checks: string[] = [];
    for (let i = 0; i < n; i++) {
      await nextFrame();
      renderFrame();
      if (i === n - 1) checks = sc.check?.(ctx) ?? [];
    }
    for (const e of dev.checkErrors()) checks.push(`GL error after restore: ${e}`);
    return { supported: true, checks, draws: state.draws };
  };

  state.finish = () => {
    sc.destroy(ctx);
    ctx.frame.destroy();
    timer.dispose();
    return dev.checkErrors();
  };

  log(`${name}: ${state.frames} frames, ${state.draws} draws, checks: ${state.checks.length === 0 ? 'ok' : state.checks.join('; ')}`);
  state.done = true;
}

main().catch(fail);
