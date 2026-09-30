/**
 * Audio demo (TRACK-AUDIOENG, audioeng-c2): a 2 × 150 unit battle with 200 shots/s (configurable)
 * driving the real `createAudioEngine` through sim event batches, a Canvas2D top-down view with an
 * RTS camera (listener), and a DOM HUD with the engine statistics. Exposes the test hook
 * `window.__fafAudioDemo` (contract: ./hook.ts, docs/status/audioeng-c2.md).
 *
 * Frame loop: camera → (sim ticks due at the current speed: scenario.step → engine.handleEvents)
 * → engine.update → render → HUD (4 Hz). The JS time of every engine call is summed per frame
 * (`engineCalls`), the generator separately (`generator`); the engine additionally measures itself
 * (`stats().mainJs`).
 */

import { ArrayEventSource, DECODE_PATHS, SOUND_CATEGORIES, categoryIndex, type PlayRequest, type SoundCategory } from '@faf/audio';
import { createAudioEngine, type FafAudioEngine } from '@faf/audio/engine';
import { audioBaseUrl } from '../shared/assets.ts';
import { Camera, type CameraPose } from './camera.ts';
import { TimingRing, type DemoHook, type DemoLoadState, type DemoStartOptions, type DemoStats } from './hook.ts';
import { Hud } from './hud.ts';
import { MAX_SHOTS, MAX_SPEED, MIN_SPEED, parseDemoParams } from './params.ts';
import { BattleRenderer, type MoveMarker } from './renderer.ts';
import { GefechtScenario, TICK_S, copyScenarioStats, visualName, type ScenarioLoopSink } from './scenario.ts';

const params = parseDemoParams(location.search);
const perf = (): number => performance.now();

/** At most this many sim ticks per frame (avoids a spiral after a stall, e.g. a hidden tab). */
const MAX_TICKS_PER_FRAME = 8;
/** Categories the battle uses (loaded up front besides the MS5 set). */
const BATTLE_CATEGORIES: readonly SoundCategory[] = ['alert', 'ui', 'ack', 'weapon', 'impact', 'explosion', 'signature', 'build'];
const AMBIENCE_KEY = 'ambience';
const AMBIENCE_REQ: PlayRequest = { sound: 'amb_wind_loop', gain: 0.6 };

function measureTimerResolution(): number {
  let last = perf();
  const end = last + 40;
  let min = Number.POSITIVE_INFINITY;
  let changes = 0;
  while (changes < 25) {
    const t = perf();
    if (t !== last) {
      if (t - last < min) min = t - last;
      last = t;
      changes++;
    }
    if (t > end) break;
  }
  return Number.isFinite(min) ? min : 0;
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

const camera = new Camera();
camera.set({ height: params.zoom });
const renderer = new BattleRenderer(document.getElementById('view') as HTMLCanvasElement);
const overlay = document.getElementById('unlock-overlay')!;

const loadState: DemoLoadState = {
  phase: 'manifest',
  done: 0,
  total: 0,
  failed: 0,
  ms: 0,
  paths: { native: 0, webcodecs: 0, wasm: 0 },
  error: null,
};
let loadBase = 0;

let hud: Hud | null = null;

const engine: FafAudioEngine = createAudioEngine({
  baseUrl: audioBaseUrl(),
  visualName,
  onJumpTo: (x, z) => camera.flyTo(x, z, perf()),
  onAlert: () => hud?.markAlertsDirty(),
  onLoadProgress: (p) => {
    loadState.done = loadBase + p.done;
    loadState.total = Math.max(loadState.total, loadBase + p.total);
    if (!p.ok) loadState.failed++;
    if (p.path !== null) loadState.paths[p.path]++;
  },
});

const batch = new ArrayEventSource(256);
let scenario: GefechtScenario | null = null;
let running = false;
let started = false;
let shots = params.shots;
let speed = params.speed;
let seed = params.seed;
let seconds: number | null = params.seconds;
let simAccum = 0;
let lastFrame = perf();
let runStart = perf();
let frames = 0;

// Per-frame accounting.
let frameEngineMs = 0;
let frameGenMs = 0;
let frameHadSim = false;
const engineCalls = new TimingRing();
const engineCallsTick = new TimingRing();
const generator = new TimingRing();
let maxVoicesSeen = 0;
let maxTailsSeen = 0;
const maxByCategory = new Int32Array(SOUND_CATEGORIES.length);

const ackInfo = { count: 0, started: 0, lastLatencyMs: null as number | null };
let marker: MoveMarker | null = null;
const timerResolutionMs = measureTimerResolution();

/** Build loops go through the engine; their cost counts as engine time, not generator time. */
const loopSink: ScenarioLoopSink = {
  setLoop(key: string, req: PlayRequest | null): void {
    const t0 = perf();
    engine.setLoop(key, req);
    const dt = perf() - t0;
    frameEngineMs += dt;
    frameGenMs -= dt;
  },
};

function trackPeaks(): void {
  const v = engine.voices;
  if (v === null) return;
  if (v.voiceCount > maxVoicesSeen) maxVoicesSeen = v.voiceCount;
  if (v.tails > maxTailsSeen) maxTailsSeen = v.tails;
  for (let c = 0; c < maxByCategory.length; c++) {
    const n = v.categoryVoices(c);
    if (n > maxByCategory[c]!) maxByCategory[c] = n;
  }
}

// ---------------------------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------------------------

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function resetStats(): void {
  engine.resetStats();
  engineCalls.clear();
  engineCallsTick.clear();
  generator.clear();
  maxVoicesSeen = 0;
  maxTailsSeen = 0;
  maxByCategory.fill(0);
  frames = 0;
  runStart = perf();
}

function start(opts: DemoStartOptions = {}): void {
  if (scenario !== null && running) scenario.stopLoops(loopSink);
  if (opts.shots !== undefined && Number.isFinite(opts.shots)) shots = clampNum(Math.round(opts.shots), 0, MAX_SHOTS);
  if (opts.speed !== undefined && Number.isFinite(opts.speed)) speed = clampNum(opts.speed, MIN_SPEED, MAX_SPEED);
  if (opts.seed !== undefined && Number.isFinite(opts.seed)) seed = Math.trunc(opts.seed) >>> 0;
  if (opts.seconds !== undefined) seconds = opts.seconds !== null && opts.seconds > 0 ? opts.seconds : null;
  scenario = new GefechtScenario({ seed, shotsPerSecond: shots });
  renderer.clearEffects();
  resetStats();
  engine.setSimSpeed(speed);
  engine.setLoop(AMBIENCE_KEY, AMBIENCE_REQ);
  simAccum = 0;
  running = true;
  started = true;
  hud?.setRunning(true);
}

function stop(): void {
  if (!running) return;
  running = false;
  if (scenario !== null) scenario.stopLoops(loopSink);
  engine.setLoop(AMBIENCE_KEY, null);
  hud?.setRunning(false);
}

function setSpeed(v: number): void {
  speed = clampNum(v, MIN_SPEED, MAX_SPEED);
  engine.setSimSpeed(speed);
}

function ack(eventTimeStamp: number | null): boolean {
  const t0 = perf();
  engine.playUi('ui_cmd_move');
  const h = engine.playUi('ack_pip_direct');
  const t1 = perf();
  frameEngineMs += t1 - t0;
  ackInfo.count++;
  if (h !== null) ackInfo.started++;
  ackInfo.lastLatencyMs = eventTimeStamp === null ? t1 - t0 : t1 - eventTimeStamp;
  hud?.showAck(
    h !== null
      ? `Quittung gestartet ${ackInfo.lastLatencyMs.toFixed(2)} ms nach der Eingabe (synchron im Handler)`
      : `Quittung verworfen (${engine.voices?.lastDrop ?? engine.state})`,
  );
  return h !== null;
}

function jumpTo(x: number, z: number): void {
  camera.flyTo(x, z, perf());
}

function jumpToLastAlert(): boolean {
  const t0 = perf();
  const ok = engine.jumpToLastAlert();
  frameEngineMs += perf() - t0;
  return ok;
}

// ---------------------------------------------------------------------------------------------
// Stats / hook
// ---------------------------------------------------------------------------------------------

function categoryLimits(): Record<SoundCategory, number> {
  const out = {} as Record<SoundCategory, number>;
  const m = engine.catalog?.manifest;
  for (const c of SOUND_CATEGORIES) out[c] = m?.categories[c].maxVoices ?? 0;
  return out;
}

function cameraPose(): CameraPose & { viewHalfWidth: number } {
  return { x: camera.x, z: camera.z, height: camera.height, yaw: camera.yaw, viewHalfWidth: camera.viewHalfWidth };
}

const emptyScenario = new GefechtScenario({ seed: 0, shotsPerSecond: 0 }).stats;

function stats(): DemoStats {
  const byCat = {} as Record<SoundCategory, number>;
  for (const c of SOUND_CATEGORIES) byCat[c] = maxByCategory[categoryIndex(c)]!;
  const sc = copyScenarioStats(scenario?.stats ?? emptyScenario);
  const ctx = engine.context;
  return {
    engine: engine.stats(),
    scenario: { ...sc, running, shotsPerSecond: shots, speed, seed },
    generator: generator.stats(),
    engineCalls: engineCalls.stats(),
    engineCallsTickFrames: engineCallsTick.stats(),
    maxVoicesSeen,
    maxTailsSeen,
    maxByCategorySeen: byCat,
    categoryLimits: categoryLimits(),
    voiceLimit: engine.catalog?.manifest.maxVoices ?? 32,
    frames,
    runMs: perf() - runStart,
    camera: cameraPose(),
    load: { ...loadState, paths: { ...loadState.paths } },
    ack: { ...ackInfo },
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    timerResolutionMs,
    contextState: ctx.state,
    sampleRate: ctx.sampleRate,
  };
}

async function loadSounds(): Promise<void> {
  await engine.ready;
  loadState.phase = 'loading';
  const t0 = perf();
  const filters = [{ tags: ['MS5'] }, { categories: BATTLE_CATEGORIES }, { ids: ['common:amb_wind_loop'] }];
  for (const f of filters) {
    await engine.load(f);
    loadBase = loadState.done;
  }
  loadState.ms = perf() - t0;
  loadState.phase = 'done';
  for (const p of DECODE_PATHS) loadState.paths[p] = engine.stats().decodePaths[p];
}

const ready = loadSounds().catch((e: unknown) => {
  loadState.phase = 'error';
  loadState.error = errorText(e);
  throw e;
});
// Observed through the hook / HUD; avoid an unhandled rejection report.
ready.catch(() => undefined);

const hook: DemoHook = {
  ready,
  start,
  stop,
  resetStats,
  get running() {
    return running;
  },
  stats,
  engine,
  setCamera: (p) => camera.set(p),
  camera: cameraPose,
  alerts: () => engine.alertHistory(),
  settings: () => engine.settings.get(),
  ack: () => ack(null),
};
window.__fafAudioDemo = hook;

hud = new Hud(engine, { toggleRun: () => (running ? stop() : start()), restart: (o) => start(o), setSpeed, ack: () => ack(null), jumpTo }, { shots, speed, seed });

// ---------------------------------------------------------------------------------------------
// Unlock overlay
// ---------------------------------------------------------------------------------------------

function refreshOverlay(): void {
  overlay.hidden = engine.state === 'running';
}
engine.onStateChange(() => refreshOverlay());
refreshOverlay();
overlay.addEventListener('click', () => {
  // A real user gesture: resume the context inside it.
  void engine.unlock().then((ok) => {
    refreshOverlay();
    if (ok && !started && !params.autostart) ready.then(() => (started ? undefined : start()), () => undefined);
  });
});

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

const keys = new Set<string>();
const canvas = renderer.canvas;
const worldTmp: [number, number] = [0, 0];

function isFormTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
}

window.addEventListener('keydown', (ev) => {
  if (isFormTarget(ev.target)) return;
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (!ev.repeat) jumpToLastAlert();
    return;
  }
  keys.add(ev.code);
});
window.addEventListener('keyup', (ev) => keys.delete(ev.code));
window.addEventListener('blur', () => keys.clear());

let dragId = -1;
let dragX = 0;
let dragY = 0;
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  canvas.focus();
  dragId = ev.pointerId;
  dragX = ev.clientX;
  dragY = ev.clientY;
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (ev.pointerId !== dragId) return;
  const s = camera.scale(renderer.width);
  camera.panScreen(-(ev.clientX - dragX) / s, -(ev.clientY - dragY) / s);
  dragX = ev.clientX;
  dragY = ev.clientY;
});
const endDrag = (ev: PointerEvent): void => {
  if (ev.pointerId === dragId) dragId = -1;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    camera.zoomBy(Math.exp(ev.deltaY * 0.0015));
  },
  { passive: false },
);
canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const r = canvas.getBoundingClientRect();
  camera.screenToWorld(ev.clientX - r.left, ev.clientY - r.top, renderer.width, renderer.height, worldTmp);
  ack(ev.timeStamp);
  marker = { x: worldTmp[0], z: worldTmp[1], atMs: perf() };
});

function applyKeys(dt: number): void {
  const pan = camera.viewHalfWidth * 1.2 * dt;
  let dx = 0;
  let dy = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= pan;
  if (keys.has('KeyS') || keys.has('ArrowDown')) dy += pan;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= pan;
  if (keys.has('KeyD') || keys.has('ArrowRight')) dx += pan;
  if (dx !== 0 || dy !== 0) camera.panScreen(dx, dy);
  if (keys.has('KeyQ')) camera.rotateBy(-1.5 * dt);
  if (keys.has('KeyE')) camera.rotateBy(1.5 * dt);
  if (keys.has('Equal') || keys.has('NumpadAdd')) camera.zoomBy(Math.exp(-1.2 * dt));
  if (keys.has('Minus') || keys.has('NumpadSubtract')) camera.zoomBy(Math.exp(1.2 * dt));
}

// ---------------------------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------------------------

let lastHud = 0;

function frame(): void {
  const now = perf();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  renderer.resize();
  applyKeys(dt);
  camera.tick(now);

  if (camera.dirty) {
    camera.dirty = false;
    const t0 = perf();
    engine.setListener(camera.toListener());
    frameEngineMs += perf() - t0;
  }

  if (running && scenario !== null) {
    simAccum += dt * speed;
    let ticks = 0;
    while (simAccum >= TICK_S && ticks < MAX_TICKS_PER_FRAME) {
      const g0 = perf();
      scenario.step(batch, loopSink);
      frameGenMs += perf() - g0;
      const e0 = perf();
      engine.handleEvents(batch);
      frameEngineMs += perf() - e0;
      trackPeaks();
      renderer.addEvents(batch);
      simAccum -= TICK_S;
      ticks++;
      frameHadSim = true;
    }
    if (ticks === MAX_TICKS_PER_FRAME) simAccum = 0;
    if (seconds !== null && scenario.simTimeS >= seconds) stop();
  }

  const u0 = perf();
  engine.update();
  frameEngineMs += perf() - u0;
  trackPeaks();

  if (running) {
    frames++;
    engineCalls.push(frameEngineMs);
    if (frameHadSim) {
      engineCallsTick.push(frameEngineMs);
      generator.push(Math.max(0, frameGenMs));
    }
  }
  frameEngineMs = 0;
  frameGenMs = 0;
  frameHadSim = false;

  const simNow = scenario === null ? 0 : scenario.simTimeS + simAccum;
  renderer.draw(scenario, camera, simNow, marker, now);

  if (now - lastHud > 250 && hud !== null) {
    lastHud = now;
    hud.update(stats(), now);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

void ready.then(() => {
  if (params.autostart && !started) start();
});
