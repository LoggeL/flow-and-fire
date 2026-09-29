/**
 * Render demo / browser smoke scene (MS2): a procedural 512-WU heightfield (CDLOD terrain, auto-splat,
 * water, mass/hydro spot decals) with N units (default 2,000) as synthetic UnitRecords in two armies
 * standing on the terrain: cubes, towers and a merged-part tank (hull/turret/barrel driven by a
 * synthetic PartStream), 3 LODs each. A 10 Hz fake sim tick moves them; the GPU interpolates. Click
 * markers and waypoint lines, highlight stream, context-loss hooks, GPU height probe. Not part of the
 * game; the smoke script drives it via `window.__renderDemo`.
 *
 * Controls: WASD/arrows pan, Q/E rotate, R/F pitch, wheel zoom, right click = marker + waypoints,
 * T = camera flight on/off. URL: ?n=2000&preset=high
 */
import {
  FIXED_PASS_DRAWS,
  LOD_LEVELS,
  RAW_PER_WU,
  RtsCamera,
  UNIT_FLAG_NO_INTERP,
  UnitRecordWriter,
  combineParts,
  createPlaceholderLods,
  createRay,
  createRenderer,
  parsePresetName,
  sampleTerrainHeightRaw,
} from '../src/index.ts';
import type { MeshData, OverlayMarker, OverlaySegment, RenderStats, VisualTable, WebGL2Device } from '../src/index.ts';
import { DEMO_MAP_WU, generateDemoTerrain, probePoints, referenceHeights } from './terrain-gen.ts';

const TICK_MS = 100;
const MAP_WU = DEMO_MAP_WU;
const params = new URLSearchParams(location.search);
const N = Math.max(1, Math.min(20000, Number(params.get('n') ?? 2000) | 0));
const preset = parsePresetName(params.get('preset')) ?? 'high';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const terrain = generateDemoTerrain();
const T = terrain.desc;
const renderer = createRenderer(canvas, { terrain: T, preset });
renderer.setTerrainDecals(terrain.decals);
const device = renderer.device as WebGL2Device;

const heightAt = (x: number, z: number): number => sampleTerrainHeightRaw(T, x, z);

// ---- visuals: cube, tower, merged-part tank (3 LODs each) --------------------------------------
function tankLods(): MeshData[] {
  const hull = createPlaceholderLods({ hull: 'box', size: [2.2, 0.7, 1.5] });
  const turret = createPlaceholderLods({ hull: 'cyl', size: [1.1, 0.45, 1.1] });
  const barrel = createPlaceholderLods({ hull: 'box', size: [1.3, 0.16, 0.16] });
  return [0, 1, 2].map((l) =>
    combineParts([
      { mesh: hull[l]!, partId: 0 },
      { mesh: turret[l]!, partId: 1, offset: [0, 0.7, 0], pivot: [0, 0.7, 0] },
      { mesh: barrel[l]!, partId: 2, offset: [0.95, 0.9, 0], pivot: [0.35, 0.92, 0], parent: 1 },
    ]),
  );
}

const visuals: VisualTable = [
  { spec: { hull: 'box', size: [1, 1, 1] } }, // 0: cube in team color
  { spec: { hull: 'cyl', size: [1.3, 1.8, 1.3] }, color: 0xc8c8c8, baseWeight: 0.25 }, // 1: tower
  { spec: { hull: 'box', size: [2.2, 0.7, 1.5] }, color: 0x39424a, baseWeight: 0.35, meshes: tankLods() }, // 2: tank
];
renderer.setVisuals(visuals);

// ---- synthetic units on the terrain -----------------------------------------------------------
const units = new UnitRecordWriter(N);
const cx = new Float64Array(N);
const cz = new Float64Array(N);
const radius = new Float64Array(N);
const speed = new Float64Array(N);
const phase = new Float64Array(N);
const highlight = new Uint8Array(N);
const noInterpUntil = new Int32Array(N).fill(-1);
const tankOf = new Int32Array(N).fill(-1);
let tanks = 0;
let tick = 0;
const waterRaw = T.waterLevelRaw ?? -Infinity;

function toAng16(rad: number): number {
  return Math.round((rad / (2 * Math.PI)) * 65536) & 0xffff;
}

function unitPos(i: number, t: number): [number, number, number, number] {
  const th = phase[i]! + speed[i]! * t;
  const x = Math.round((cx[i]! + Math.cos(th) * radius[i]!) * RAW_PER_WU);
  const z = Math.round((cz[i]! + Math.sin(th) * radius[i]!) * RAW_PER_WU);
  return [x, heightAt(x, z), z, toAng16(th + Math.PI / 2)];
}

// Circle centers on dry land, spread over the whole map (flight test), deterministic.
{
  let s = 12345;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = 0; i < N; i++) {
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 50; tries++) {
      x = 12 + rnd() * (MAP_WU - 24);
      z = 12 + rnd() * (MAP_WU - 24);
      if (heightAt(Math.round(x * 4096), Math.round(z * 4096)) > waterRaw + 6000) break;
    }
    cx[i] = x;
    cz[i] = z;
    radius[i] = 1.2 + ((i * 37) % 10) * 0.18;
    speed[i] = (0.05 + ((i * 13) % 7) * 0.012) * (i % 2 === 0 ? 1 : -1) * (radius[i]! > 2 ? 0.8 : 1.2);
    phase[i] = (i * 2.399963) % (2 * Math.PI);
    const visual = i % 7 === 0 ? 1 : i % 5 === 0 ? 2 : 0;
    if (visual === 2) tankOf[i] = tanks++;
    const [px, py, pz, yaw] = unitPos(i, 0);
    units.write(i, {
      prevX: px,
      prevY: py,
      prevZ: pz,
      x: px,
      y: py,
      z: pz,
      prevYaw: yaw,
      yaw,
      visual,
      army: x < MAP_WU / 2 ? 0 : 1,
      handle: i + 1,
      flags: UNIT_FLAG_NO_INTERP,
      partBase: visual === 2 ? tankOf[i]! * 2 : 0,
      partCount: visual === 2 ? 2 : 0,
    });
    highlight[i] = i % 10 === 0 ? 1 : 0;
  }
}

// PartStream: 2 parts per tank (turret yaw rotating, barrel pitch nodding), 8 B per part.
const partBytes = new Uint8Array(Math.max(1, tanks * 2) * 8);
const part16 = new Uint16Array(partBytes.buffer);
const partsView = { bytes: partBytes, count: tanks * 2, version: 0 };
function writeParts(t: number): void {
  for (let k = 0; k < tanks; k++) {
    const o = k * 8; // two parts × 4 u16
    const yaw = toAng16(t * 0.12 * (k % 2 === 0 ? 1 : -1) + k);
    part16[o] = part16[o + 1]!;
    part16[o + 1] = yaw;
    const pitch = Math.round(Math.sin(t * 0.2 + k) * 2500) & 0xffff;
    part16[o + 6] = part16[o + 7]!;
    part16[o + 7] = pitch;
  }
  partsView.version++;
}
writeParts(0);
writeParts(0);

function simTick(): void {
  tick++;
  for (let i = 0; i < N; i++) {
    const [x, y, z, yaw] = unitPos(i, tick);
    units.advance(i, x, y, z, yaw);
    if (noInterpUntil[i] === tick - 1 || tick === 1) units.setFlags(i, units.flags(i) & ~UNIT_FLAG_NO_INTERP);
  }
  // Every 5 s a few units "respawn" on the opposite side of their circle: noInterp for one tick.
  if (tick % 50 === 0) {
    for (let k = 0; k < Math.max(1, N >> 7); k++) {
      const i = (tick * 7919 + k * 104729) % N;
      phase[i] = phase[i]! + Math.PI;
      const [x, y, z, yaw] = unitPos(i, tick);
      units.advance(i, x, y, z, yaw);
      units.setFlags(i, units.flags(i) | UNIT_FLAG_NO_INTERP);
      noInterpUntil[i] = tick;
    }
  }
  writeParts(tick);
}

// ---- camera + input ---------------------------------------------------------------------------
const camera = new RtsCamera({ distance: 150, pitch: (52 * Math.PI) / 180, maxDistance: 1400 });
camera.setTargetWU(MAP_WU / 2, 16, MAP_WU / 2 + 20);
let flight = params.get('flight') === '1';
let flightT = 0;
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 't') flight = !flight;
});
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

/** Demo picking: march along the ray until it dips below the terrain (0.25 WU steps). */
function pickTerrain(px: number, py: number): [number, number, number] | null {
  camera.screenToRay(px, py, ray);
  const o = ray.origin;
  const d = ray.dir;
  for (let t = 0; t < 4000; t += 0.25) {
    const x = o[0]! + d[0]! * t;
    const y = o[1]! + d[1]! * t;
    const z = o[2]! + d[2]! * t;
    const hx = Math.round(x * 4096);
    const hz = Math.round(z * 4096);
    const h = heightAt(hx, hz);
    if (y * 4096 <= h) return [hx, h, hz];
  }
  return null;
}

function placeOrder(x: number, z: number, now: number, withLines: boolean): void {
  const y = heightAt(x, z);
  markers = markers.filter((m) => now - m.startMs < (m.durationMs ?? 700));
  markers.push({ x, y, z, startMs: now, color: withLines ? 0x40ff60 : 0xffd040 });
  if (withLines) {
    lines = [];
    for (let i = 0; i < N && lines.length < 8; i += 10) {
      lines.push({ ax: units.curX(i), ay: units.curY(i), az: units.curZ(i), bx: x, by: y, bz: z });
    }
    linesUntil = now + 3000;
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return;
  const hit = pickTerrain(e.clientX, e.clientY);
  if (hit !== null) placeOrder(hit[0], hit[2], performance.now(), true);
});

function updateCamera(dtMs: number): void {
  if (flight) {
    // Scripted flight: orbit over the map, looking along the path.
    flightT += dtMs / 1000;
    const a = flightT * 0.18;
    camera.targetX = (MAP_WU / 2 + Math.cos(a) * 150) * RAW_PER_WU;
    camera.targetZ = (MAP_WU / 2 + Math.sin(a) * 150) * RAW_PER_WU;
    camera.yaw = a + Math.PI / 2;
    camera.distance = 110;
    camera.pitch = (48 * Math.PI) / 180;
  } else {
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
  // Focus follows the terrain; the near plane uses the ground height under the eye.
  camera.targetY = heightAt(Math.round(camera.targetX), Math.round(camera.targetZ));
  camera.groundHeight = heightAt(Math.round(camera.eyeRaw[0]!), Math.round(camera.eyeRaw[2]!)) / RAW_PER_WU;
}

// ---- metrics ----------------------------------------------------------------------------------
const SAMPLES = 600;
const renderCpu = new Float64Array(SAMPLES);
const frameCpu = new Float64Array(SAMPLES);
const frameTimes = new Float64Array(SAMPLES);
const drawSamples = new Float64Array(SAMPLES);
const gpuSamples = new Float64Array(SAMPLES);
let sampleCount = 0;
let gpuCount = 0;
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
  drawsMax: number;
  gpuP50: number | null;
  gpuP95: number | null;
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
  let drawsMax = 0;
  for (let k = 0; k < n; k++) {
    renderMax = Math.max(renderMax, renderCpu[k]!);
    sum += renderCpu[k]!;
    drawsMax = Math.max(drawsMax, drawSamples[k]!);
  }
  const gn = Math.min(gpuCount, SAMPLES);
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
    drawsMax,
    gpuP50: gn > 0 ? percentile(gpuSamples, gn, 0.5) : null,
    gpuP95: gn > 0 ? percentile(gpuSamples, gn, 0.95) : null,
  };
}

function snapshot(st: Readonly<RenderStats>): RenderStats & { lodInstancesArr: number[] } {
  return { ...st, drawsByPass: { ...st.drawsByPass }, lodInstancesArr: Array.from(st.lodInstances) };
}

interface ProbeResult {
  n: number;
  mismatches: number;
  first: { i: number; x: number; z: number; gpu: number; cpu: number } | null;
  ms: number;
}

const projectOut = new Float64Array(4);
const api = {
  /** The renderer itself (profiling/debug from the console or scripts). */
  debugRenderer: renderer,
  terrainDesc: T,
  ready: false,
  frames: 0,
  tick: 0,
  units: N,
  tanks,
  visualCount: visuals.length,
  /** Upper bound of unit draws: one per (visual, LOD). */
  maxUnitDraws: visuals.length * LOD_LEVELS,
  fixedPassDraws: FIXED_PASS_DRAWS,
  preset,
  renderer: device.caps.renderer,
  caps: device.caps,
  spots: terrain.spots,
  deepWater: terrain.deepWater,
  waterLevelRaw: T.waterLevelRaw,
  get lost(): boolean {
    return device.isLost();
  },
  get restores(): number {
    return restores;
  },
  get glErrors(): string[] {
    return glErrors;
  },
  stats: () => snapshot(renderer.stats),
  cpuStats,
  resetSamples: (): void => {
    sampleCount = 0;
    gpuCount = 0;
  },
  loseContext: (): boolean => device.debugLoseContext(),
  restoreContext: (): boolean => device.debugRestoreContext(),
  checkErrors: (): string[] => device.checkErrors(),
  heightAt,
  /** GPU height probe vs. the JS reference of the formula in `n` pseudo-random points. */
  probe: (n: number, seed: number): ProbeResult => {
    const xz = probePoints(n, seed, T.sizeWu);
    const gpu = new Int32Array(n);
    const t0 = performance.now();
    renderer.probeTerrainHeights(xz, gpu);
    const ms = performance.now() - t0;
    const cpu = referenceHeights(T, xz);
    let mismatches = 0;
    let first: ProbeResult['first'] = null;
    for (let i = 0; i < n; i++) {
      if (gpu[i] !== cpu[i]) {
        mismatches++;
        first ??= { i, x: xz[i * 2]!, z: xz[i * 2 + 1]!, gpu: gpu[i]!, cpu: cpu[i]! };
      }
    }
    return { n, mismatches, first, ms };
  },
  /** Fixed camera pose (disables the flight). */
  setPose: (xWU: number, zWU: number, distance: number, pitchDeg: number, yawDeg: number): void => {
    flight = false;
    camera.targetX = xWU * RAW_PER_WU;
    camera.targetZ = zWU * RAW_PER_WU;
    camera.distance = distance;
    camera.pitch = (pitchDeg * Math.PI) / 180;
    camera.yaw = (yawDeg * Math.PI) / 180;
  },
  setFlight: (on: boolean): void => {
    flight = on;
  },
  /** World (raw) → CSS pixels of the last rendered camera, or null when behind the camera. */
  project: (x: number, y: number, z: number): [number, number] | null =>
    camera.project(x, y, z, projectOut) ? [projectOut[0]!, projectOut[1]!] : null,
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

  const c = MAP_WU / 2;
  const q = (w: number): number => Math.round(w * RAW_PER_WU);
  if (now >= nextAutoMarker) {
    // Autonomous waypoint pings keep the overlay pass busy for the smoke test.
    const k = (now / 500) | 0;
    placeOrder(q(c + ((k * 37) % 80) - 40), q(c + ((k * 53) % 60) - 30), now, false);
    nextAutoMarker = now + 500;
  }
  if (lines.length > 0 && now > linesUntil) lines = [];
  if (lines.length === 0) {
    // Idle route: a fixed patrol square around the map center (on the terrain).
    const corner = (x: number, z: number): [number, number, number] => [q(x), heightAt(q(x), q(z)), q(z)];
    const pts = [corner(c - 20, c - 20), corner(c + 20, c - 20), corner(c + 20, c + 20), corner(c - 20, c + 20)];
    lines = pts.map((a, i) => {
      const b = pts[(i + 1) % 4]!;
      return { ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], color: 0x60c0ff };
    });
    linesUntil = Infinity;
  }
  overlays.markers = markers;
  overlays.lines = lines;

  updateCamera(dt);
  renderer.render({
    camera,
    units: unitsView,
    parts: partsView,
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

  const st = renderer.stats;
  if (!st.lost) {
    const k = sampleCount % SAMPLES;
    renderCpu[k] = st.cpuMs;
    frameCpu[k] = performance.now() - f0;
    frameTimes[k] = now;
    drawSamples[k] = st.drawCalls;
    sampleCount++;
    if (st.gpuMs !== undefined) gpuSamples[gpuCount++ % SAMPLES] = st.gpuMs;
  }

  if (now - hudAt > 250) {
    hudAt = now;
    const cs = cpuStats();
    const p = st.drawsByPass;
    hud.textContent = [
      `Flow & Fire – Render-Demo MS2 (${N} Einheiten, ${visuals.length} Visuals × 3 LODs, Preset ${preset})`,
      `${device.caps.renderer}`,
      `FPS ${cs.fps.toFixed(1)} | Draws ${st.drawCalls} (Terrain ${p.terrain}, Units ${p.units}, Wasser ${p.water}, Overlay ${p.overlay})`,
      `Patches ${st.terrainPatches} | Units sichtbar ${st.unitInstances}, gecullt ${st.culledInstances} | LOD ${Array.from(st.lodInstances).join('/')}`,
      `Render-JS p50 ${cs.renderP50.toFixed(3)} ms, p95 ${cs.renderP95.toFixed(3)} ms | Frame-JS p95 ${cs.frameP95.toFixed(3)} ms`,
      `GPU ${st.gpuMs === undefined ? 'n/a' : `${st.gpuMs.toFixed(2)} ms`} | Tick ${tick} | alpha ${alpha.toFixed(2)}${st.lost ? ' | CONTEXT LOST' : ''}`,
      `WASD/Pfeile, Q/E, R/F, Mausrad, Rechtsklick, T = Kameraflug ${flight ? 'an' : 'aus'}`,
    ].join('\n');
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
