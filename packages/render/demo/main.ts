/**
 * Render demo / browser smoke scene: N animated cubes (default 1,000) as synthetic UnitRecords in
 * two armies, a 10 Hz fake sim tick with GPU interpolation in between, click markers and waypoint
 * lines, highlight stream, context-loss hooks. Not part of the game; the smoke script drives it via
 * `window.__renderDemo`.
 *
 * Controls: WASD/arrows pan, Q/E rotate, R/F pitch, wheel zoom, right click = marker + waypoints.
 */
import {
  RAW_PER_WU,
  RtsCamera,
  UNIT_FLAG_NO_INTERP,
  UnitRecordWriter,
  createRay,
  createRenderer,
  intersectGround,
} from '../src/index.ts';
import type { OverlayMarker, OverlaySegment, RenderStats, VisualTable, WebGL2Device } from '../src/index.ts';

const TICK_MS = 100;
const MAP_WU = 512;
const params = new URLSearchParams(location.search);
const N = Math.max(1, Math.min(20000, Number(params.get('n') ?? 1000) | 0));

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const renderer = createRenderer(canvas, { ground: { sizeWU: [MAP_WU, MAP_WU] } });
const device = renderer.device as WebGL2Device;

const visuals: VisualTable = [
  { spec: { hull: 'box', size: [1, 1, 1] } }, // 0: cube in team color
  { spec: { hull: 'cyl', size: [1.3, 1.8, 1.3] }, color: 0xc8c8c8, baseWeight: 0.25 }, // 1: tower
  { spec: { hull: 'box', size: [2.2, 0.8, 1.4] }, color: 0x39424a, baseWeight: 0.35 }, // 2: tank hull
];
renderer.setVisuals(visuals);

// ---- synthetic units ------------------------------------------------------------------------
const units = new UnitRecordWriter(N);
const cx = new Float64Array(N);
const cz = new Float64Array(N);
const radius = new Float64Array(N);
const speed = new Float64Array(N);
const phase = new Float64Array(N);
const highlight = new Uint8Array(N);
const noInterpUntil = new Int32Array(N).fill(-1);
const cols = Math.ceil(Math.sqrt(N));
const spacing = 6;
const origin = MAP_WU / 2 - ((cols - 1) * spacing) / 2;
let tick = 0;

function toAng16(rad: number): number {
  return Math.round((rad / (2 * Math.PI)) * 65536) & 0xffff;
}

function unitPos(i: number, t: number): [number, number, number] {
  const th = phase[i]! + speed[i]! * t;
  const x = Math.round((cx[i]! + Math.cos(th) * radius[i]!) * RAW_PER_WU);
  const z = Math.round((cz[i]! + Math.sin(th) * radius[i]!) * RAW_PER_WU);
  return [x, z, toAng16(th + Math.PI / 2)];
}

for (let i = 0; i < N; i++) {
  const col = i % cols;
  const row = (i / cols) | 0;
  cx[i] = origin + col * spacing;
  cz[i] = origin + row * spacing;
  radius[i] = 1.2 + ((i * 37) % 10) * 0.18;
  speed[i] = (0.05 + ((i * 13) % 7) * 0.012) * (i % 2 === 0 ? 1 : -1) * (radius[i]! > 2 ? 0.8 : 1.2);
  phase[i] = (i * 2.399963) % (2 * Math.PI);
  const [x, z, yaw] = unitPos(i, 0);
  units.write(i, {
    prevX: x,
    prevY: 0,
    prevZ: z,
    x,
    y: 0,
    z,
    prevYaw: yaw,
    yaw,
    visual: i % 7 === 0 ? 1 : i % 5 === 0 ? 2 : 0,
    army: col < cols / 2 ? 0 : 1,
    handle: i + 1,
    flags: UNIT_FLAG_NO_INTERP,
  });
  highlight[i] = i % 10 === 0 ? 1 : 0;
}

function simTick(): void {
  tick++;
  for (let i = 0; i < N; i++) {
    const [x, z, yaw] = unitPos(i, tick);
    units.advance(i, x, 0, z, yaw);
    if (noInterpUntil[i] === tick - 1 || tick === 1) units.setFlags(i, units.flags(i) & ~UNIT_FLAG_NO_INTERP);
  }
  // Every 5 s a few units "respawn" on the opposite side of their circle: noInterp for one tick.
  if (tick % 50 === 0) {
    for (let k = 0; k < Math.max(1, N >> 7); k++) {
      const i = (tick * 7919 + k * 104729) % N;
      phase[i] = phase[i]! + Math.PI;
      const [x, z, yaw] = unitPos(i, tick);
      units.advance(i, x, 0, z, yaw);
      units.setFlags(i, units.flags(i) | UNIT_FLAG_NO_INTERP);
      noInterpUntil[i] = tick;
    }
  }
}

// ---- camera + input ---------------------------------------------------------------------------
const camera = new RtsCamera({ distance: 150, pitch: (52 * Math.PI) / 180 });
camera.setTargetWU(MAP_WU / 2, 0, MAP_WU / 2 + 20);
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    camera.zoom(Math.exp(e.deltaY * 0.0015));
  },
  { passive: false },
);

let markers: OverlayMarker[] = [];
let lines: OverlaySegment[] = [];
let linesUntil = 0;
const ray = createRay();
const hit = new Float64Array(2);

function placeOrder(xWU: number, zWU: number, now: number, withLines: boolean): void {
  const x = Math.round(xWU * RAW_PER_WU);
  const z = Math.round(zWU * RAW_PER_WU);
  markers = markers.filter((m) => now - m.startMs < (m.durationMs ?? 700));
  markers.push({ x, y: 0, z, startMs: now, color: withLines ? 0x40ff60 : 0xffd040 });
  if (withLines) {
    lines = [];
    for (let i = 0; i < N && lines.length < 8; i += 10) {
      lines.push({ ax: units.curX(i), ay: 0, az: units.curZ(i), bx: x, by: 0, bz: z });
    }
    linesUntil = now + 3000;
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return;
  camera.screenToRay(e.clientX, e.clientY, ray);
  if (intersectGround(ray, 0, hit)) placeOrder(hit[0]!, hit[1]!, performance.now(), true);
});

function updateCamera(dtMs: number): void {
  const s = (camera.distance * 0.9 * dtMs) / 1000;
  let right = 0;
  let fwd = 0;
  if (keys.has('a') || keys.has('arrowleft')) right -= s;
  if (keys.has('d') || keys.has('arrowright')) right += s;
  if (keys.has('w') || keys.has('arrowup')) fwd += s;
  if (keys.has('s') || keys.has('arrowdown')) fwd -= s;
  if (right !== 0 || fwd !== 0) camera.pan(right, fwd);
  const rot = (1.4 * dtMs) / 1000;
  if (keys.has('q')) camera.rotate(-rot);
  if (keys.has('e')) camera.rotate(rot);
  if (keys.has('r')) camera.rotate(0, rot * 0.6);
  if (keys.has('f')) camera.rotate(0, -rot * 0.6);
}

// ---- metrics ----------------------------------------------------------------------------------
const SAMPLES = 600;
const renderCpu = new Float64Array(SAMPLES);
const frameCpu = new Float64Array(SAMPLES);
const frameTimes = new Float64Array(SAMPLES);
let sampleCount = 0;
let restores = 0;
let glErrors: string[] = [];
device.onRestored(() => {
  restores++;
});

function percentile(src: Float64Array, n: number, p: number): number {
  if (n === 0) return 0;
  const a = Array.from(src.subarray(0, n)).sort((x, y) => x - y);
  return a[Math.min(n - 1, Math.floor((n - 1) * p))]!;
}

/** Smallest positive step of performance.now() (coarsened to 1 ms without cross-origin isolation in Firefox/WebKit). */
function timerResolution(): number {
  let best = Infinity;
  for (let k = 0; k < 20; k++) {
    const a = performance.now();
    let b = a;
    while (b === a) b = performance.now();
    best = Math.min(best, b - a);
  }
  return best;
}

function cpuStats(): {
  n: number;
  renderMean: number;
  renderP50: number;
  renderP95: number;
  renderMax: number;
  frameP50: number;
  frameP95: number;
  fps: number;
  timerResolutionMs: number;
} {
  const n = Math.min(sampleCount, SAMPLES);
  let fps = 0;
  if (n > 1) {
    let newest = -Infinity;
    let oldest = Infinity;
    for (let k = 0; k < n; k++) {
      newest = Math.max(newest, frameTimes[k]!);
      oldest = Math.min(oldest, frameTimes[k]!);
    }
    fps = ((n - 1) * 1000) / Math.max(1, newest - oldest);
  }
  let renderMax = 0;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    renderMax = Math.max(renderMax, renderCpu[k]!);
    sum += renderCpu[k]!;
  }
  return {
    n,
    renderMean: n > 0 ? sum / n : 0,
    timerResolutionMs: timerResolution(),
    renderP50: percentile(renderCpu, n, 0.5),
    renderP95: percentile(renderCpu, n, 0.95),
    renderMax,
    frameP50: percentile(frameCpu, n, 0.5),
    frameP95: percentile(frameCpu, n, 0.95),
    fps,
  };
}

function snapshot(st: Readonly<RenderStats>): RenderStats {
  return { ...st };
}

const api = {
  ready: false,
  frames: 0,
  tick: 0,
  units: N,
  visualCount: visuals.length,
  renderer: device.caps.renderer,
  caps: device.caps,
  get lost(): boolean {
    return device.isLost();
  },
  get restores(): number {
    return restores;
  },
  get glErrors(): string[] {
    return glErrors;
  },
  stats: (): RenderStats => snapshot(renderer.stats),
  cpuStats,
  resetSamples: (): void => {
    sampleCount = 0;
  },
  loseContext: (): boolean => device.debugLoseContext(),
  restoreContext: (): boolean => device.debugRestoreContext(),
  checkErrors: (): string[] => device.checkErrors(),
};
(window as unknown as { __renderDemo: typeof api }).__renderDemo = api;

// ---- frame loop -------------------------------------------------------------------------------
const t0 = performance.now();
let lastTickAt = t0;
let lastFrame = t0;
let nextAutoMarker = t0 + 200;
let hudAt = 0;
const unitsView = { bytes: units.bytes, count: N, version: 0 };
const overlays = { markers: markers as readonly OverlayMarker[], lines: lines as readonly OverlaySegment[] };

function frame(now: number): void {
  const f0 = performance.now();
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  let steps = 0;
  while (now - lastTickAt >= TICK_MS && steps < 3) {
    simTick();
    lastTickAt += TICK_MS;
    steps++;
  }
  if (now - lastTickAt >= TICK_MS) lastTickAt = now; // far behind (tab was hidden): resync
  if (steps > 0) unitsView.version = tick;
  const alpha = Math.min(1, Math.max(0, (now - lastTickAt) / TICK_MS));

  if (now >= nextAutoMarker) {
    // Autonomous waypoint pings keep the overlay pass busy for the smoke test.
    const k = (now / 500) | 0;
    placeOrder(MAP_WU / 2 + ((k * 37) % 80) - 40, MAP_WU / 2 + ((k * 53) % 60) - 30, now, false);
    nextAutoMarker = now + 500;
  }
  if (lines.length > 0 && now > linesUntil) lines = [];
  if (lines.length === 0) {
    // Idle route: a fixed patrol square in front of the camera focus.
    const c = MAP_WU / 2;
    const q = (w: number): number => Math.round(w * RAW_PER_WU);
    lines = [
      { ax: q(c - 20), ay: 0, az: q(c - 20), bx: q(c + 20), by: 0, bz: q(c - 20), color: 0x60c0ff },
      { ax: q(c + 20), ay: 0, az: q(c - 20), bx: q(c + 20), by: 0, bz: q(c + 20), color: 0x60c0ff },
      { ax: q(c + 20), ay: 0, az: q(c + 20), bx: q(c - 20), by: 0, bz: q(c + 20), color: 0x60c0ff },
      { ax: q(c - 20), ay: 0, az: q(c + 20), bx: q(c - 20), by: 0, bz: q(c - 20), color: 0x60c0ff },
    ];
    linesUntil = Infinity;
  }
  overlays.markers = markers;
  overlays.lines = lines;

  updateCamera(dt);
  renderer.render({
    camera,
    units: unitsView,
    highlight,
    highlightVersion: 1,
    alpha,
    overlays,
    timeMs: now,
  });

  api.frames++;
  api.tick = tick;
  if (api.frames === 2 || api.frames === 120) {
    const errs = device.checkErrors();
    if (errs.length > 0) {
      glErrors = glErrors.concat(errs);
      console.error(`[render-demo] GL errors after frame ${api.frames}: ${errs.join(', ')}`);
    }
  }
  if (api.frames >= 2) api.ready = true;

  const k = sampleCount % SAMPLES;
  if (!renderer.stats.lost) {
    renderCpu[k] = renderer.stats.cpuMs;
    frameCpu[k] = performance.now() - f0;
    frameTimes[k] = now;
    sampleCount++;
  }

  if (now - hudAt > 250) {
    hudAt = now;
    const s = renderer.stats;
    const c = cpuStats();
    hud.textContent = [
      `Flow & Fire – Render-Demo (${N} Einheiten, ${visuals.length} Visuals)`,
      `${device.caps.renderer}`,
      `FPS ${c.fps.toFixed(1)} | Draws ${s.drawCalls} | Instanzen ${s.instances}`,
      `Render-JS p50 ${c.renderP50.toFixed(3)} ms, p95 ${c.renderP95.toFixed(3)} ms | Frame-JS p95 ${c.frameP95.toFixed(3)} ms`,
      `GPU ${s.gpuMs === undefined ? 'n/a' : `${s.gpuMs.toFixed(2)} ms`} | Tick ${tick} | alpha ${alpha.toFixed(2)}${s.lost ? ' | CONTEXT LOST' : ''}`,
      `WASD/Pfeile, Q/E, R/F, Mausrad, Rechtsklick`,
    ].join('\n');
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
