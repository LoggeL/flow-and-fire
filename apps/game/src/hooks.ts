/**
 * Test hooks for E2E (Playwright) and manual debugging: `window.__faf` (alias
 * `window['__flow-and-fire']`). Everything returns plain, structured-clone-safe values.
 * The hooks only read client/renderer state or go through the same paths as player input
 * (commands, ctl messages, camera controller) — they never touch the sim directly.
 *
 * MS2 additions: map/terrain checks (`probeHeights` GPU vs. CPU, `unitHeights`, `pickAt` vs.
 * `pickReference`, `exportMap` roundtrip), camera (`camera`, `project`, `flight`), load timings,
 * the last Move target, fullscreen/pointer-lock state and the rule hash.
 */
import { strategicZoom, interpolatedPos, RAW_PER_WU, type CameraState, type MetricsSnapshot, type RenderPresetName, type StatSummary } from '@faf/client';
import { mapSimHash, readRtsMap, writeRtsMap } from '@faf/formats';
import { isDeepWaterForLand, sampleHeightRaw } from '@faf/rules';
import { EcoField, type CtlMessage } from '@faf/protocol';
import { SOUND_CATEGORIES, type AudioStats, type ListenerState, type LoadReport } from '@faf/audio';
import type { FrameFingerprint } from './frame-hash.ts';
import type { Game, MoveTarget } from './game.ts';
import type { LoadTimings } from './loading.ts';
import { probePoints, referencePick } from './testing/reference.ts';

export interface UnitPosWU {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RenderStatsSnapshot {
  readonly frames: number;
  readonly drawCalls: number;
  readonly drawsByPass: { terrain: number; water: number; fog: number; units: number; icons: number; overlay: number };
  readonly passDraws: { terrain: number; water: number; fog: number; units: number; icons: number; overlay: number };
  readonly visibilityFog: { enabled: boolean; active: boolean; dim: number; version: number; unknown: number; explored: number; visible: number; uploads: number; uploadBytes: number; draws: number; transition: number };
  readonly zoomLevel: number;
  readonly iconCount: number;
  readonly dynamicDecals: number;
  readonly instances: number;
  readonly unitInstances: number;
  readonly culledInstances: number;
  readonly lodInstances: number[];
  readonly terrainPatches: number;
  readonly decals: number;
  readonly lost: boolean;
  readonly cpuMs: number;
  readonly gpuMs: number | null;
  readonly preset: RenderPresetName;
  /** Drawing buffer vs. CSS size of the canvas (render scale check). */
  readonly backbuffer: { width: number; height: number };
  readonly css: { width: number; height: number };
  readonly devicePixelRatio: number;
}

export interface ProbeReport {
  readonly n: number;
  readonly mismatches: number;
  readonly first: { x: number; z: number; cpu: number; gpu: number } | null;
  readonly ms: number;
}

export interface UnitHeightReport {
  readonly units: number;
  /** Units whose frame y (cur) differs from the CPU terrain height at their frame x/z. */
  readonly mismatches: number;
  /** Same for the prev position. */
  readonly prevMismatches: number;
  readonly maxAbsDiffRaw: number;
  readonly first: { handle: number; x: number; y: number; z: number; cpu: number } | null;
  readonly tick: number;
}

export interface PickResult {
  /** WU (raw / 4096). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly raw: { x: number; y: number; z: number };
  readonly hit: boolean;
}

export interface MapExport {
  readonly bytes: number;
  readonly sha256: string;
  readonly mapSimHash: number;
  /** mapSimHash reported by the sim worker (`ready`). */
  readonly workerMapSimHash: number | null;
  /** The re-written bytes are identical to the loaded ones. */
  readonly identical: boolean;
}

export interface FlightWaypoint {
  readonly x: number;
  readonly z: number;
  /** Camera distance in WU (default: keep). */
  readonly distance?: number;
}

export interface FlightReport {
  readonly ms: number;
  /** Rendered frames during the flight. */
  readonly frames: number;
  readonly fps: number;
  readonly draws: { max: number; min: number; mean: number; over50: number };
  readonly drawsByPassMax: { terrain: number; water: number; fog: number; units: number; icons: number; overlay: number };
  readonly renderCpuMs: { p50: number; p95: number; max: number };
  readonly gpuMs: { p50: number; p95: number; samples: number } | null;
  readonly mainJsMs: StatSummary;
  readonly rafIntervalMs: StatSummary;
  readonly unitInstances: { min: number; max: number };
  readonly culledInstances: { min: number; max: number };
  readonly lodInstancesMax: number[];
  readonly terrainPatches: { min: number; max: number };
  readonly units: number;
}

export interface FullscreenState {
  readonly supported: boolean;
  readonly active: boolean;
  readonly pointerLockSupported: boolean;
  readonly locked: boolean;
  readonly lockRequests: number;
  readonly lockErrors: number;
  readonly virtualCursor: { x: number; y: number; visible: boolean } | null;
}

export interface WatchInfo { handle: number; orders: number; flags: number; points: { x: number; z: number }[]; targets: { type: number; x: number; z: number }[] }
export interface ProjectedUnit { handle: number; army: number; visual: number; x: number; y: number; rect: number[] }
/** Accepted-frame inspection only; no hidden World or authoritative state is exposed. */
export interface InspectionSnapshot {
  viewer: number; viewArmy: number; tick: number; flowTick: number; readOnlyCommands: boolean; sentCommands: number;
  eco: { army: number; massStored: number; massCapacity: number; massOverflow: number; energyStored: number; energyCapacity: number }[];
  watches: { handle: number; typeId: string | null; product: string | null; progress: number; queue: string[]; rally: { x: number; z: number } }[];
}
export interface FafTestHooks {
  /** Exact cheat spawn through the client command pipeline (WU). */
  spawnAt(blueprint: string, x: number, z: number, army?: number): number;
  selected(): number[];
  controlGroups(): number[][];
  projectedUnits(): ProjectedUnit[];
  watch(): WatchInfo[];
  inspection(): InspectionSnapshot | null;
  /** Visible accepted-frame observations and the mesh poses actually submitted to the renderer. */
  rigPose(handle: number): ReturnType<Game['client']['rigPose']>;
  rigPoseStats(): { animatedUnits: number; walkingUnits: number; observedMounts: number; overflowUnits: number };
  pathStats(): { pending: number; requestsIssued: number; repathsTriggered: number; stuckGiveUps: number };
  unitInfo(handle: number): (UnitPosWU & { visual: number; orders: number | null; blocked: boolean; hp: number; hpMax: number; build: number; flags: number }) | null;
  waitTick(tick: number, timeoutMs?: number): Promise<void>;
  readonly zoomLevel: number;
  readonly simHash: number;
  readonly tainted: boolean;
  readonly hmr: Game['hmr'];
  readonly tick: number;
  readonly paused: boolean;
  readonly transport: 'sab' | 'transfer';
  readonly crossOriginIsolated: boolean;
  readonly ready: boolean;
  readonly simId: number | null;
  readonly mapSimHash: number | null;
  readonly mapName: string;
  readonly buildHash: string;
  readonly frames: number;
  readonly unitCount: number;
  readonly hostErrors: readonly string[];
  readonly metrics: { snapshot(): MetricsSnapshot; reset(): void };
  /** Current on-screen position (CSS px) of a unit as displayed, or null. */
  unitScreenPos(handle: number): { x: number; y: number } | null;
  /** `cur` position of a unit in the newest frame (WU), or null. */
  unitPos(handle: number): UnitPosWU | null;
  /** Fingerprint of the newest frame (xxHash32 without wall-clock fields) and its tick. */
  lastFrameHash(): FrameFingerprint | null;
  /** Records a fingerprint per received tick (clears the record when switched on). */
  recordFrameHashes(on: boolean): void;
  frameHashAt(tick: number): number | null;
  /** Rule hash of the newest frame (`hashTick` = tick of the last hash, every 10 ticks). */
  ruleHash(): { tick: number; hashTick: number; hash: number } | null;
  /** Handles of all own units in the newest frame. */
  ownHandles(): number[];
  /** Units of `army` in the newest frame. */
  armyUnitCount(army: number): number;
  /** Move command for `handles` to (x, z) in WU, like a right click (marker, line, measurement). */
  sendMove(handles: readonly number[], x: number, z: number, queue?: boolean): number;
  /** Last Move command sent to the sim (decoded from the batch; raw coordinates). */
  lastMoveTarget(): MoveTarget | null;
  /** Explicit selection (empty array = clear; null = back to "all own units"). */
  select(handles: readonly number[] | null): number;
  ctl(msg: CtlMessage): void;
  cameraState(): CameraState;
  /** Alias of cameraState (MS2 name). */
  camera(): CameraState;
  /** Ground point (WU) under the CSS pixel (x, y), as a right click would pick it; null above the horizon. */
  screenToGround(x: number, y: number): { x: number; z: number } | null;
  /** Heightmap pick (G15) under the CSS pixel, exactly the right-click target; null above the horizon. */
  pickAt(px: number, py: number): PickResult | null;
  /** High-resolution float64 reference pick (1/64 WU march + 40 bisections); null if no terrain hit. */
  pickReference(px: number, py: number): { x: number; y: number; z: number } | null;
  /** Projects a world point (WU) to CSS px; null behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  /** Sim-exact terrain height (WU) at (x, z) WU (`rules.sampleHeightRaw` via ClientMap). */
  heightAt(x: number, z: number): number;
  /** Moves the camera focus to (x, z) WU and optionally sets the distance (WU). */
  setCamera(x: number, z: number, distance?: number): CameraState;
  /** Sets the camera heading (radians) and resets the pitch offset. */
  setYaw(yaw: number): CameraState;
  /** Scripted camera flight through `path` (WU) over `ms` milliseconds; per-frame render stats. */
  flight(path: readonly FlightWaypoint[], ms: number): Promise<FlightReport>;
  /** GPU height probe (renderer.probeTerrainHeights) vs. CPU (rules.sampleHeightRaw) at n points. */
  probeHeights(n: number, seed: number): ProbeReport;
  /** Frame y of every unit vs. the CPU terrain height at its frame position. */
  unitHeights(): UnitHeightReport;
  /** writeRtsMap(readRtsMap(loaded bytes)): size, SHA-256 (hex), mapSimHash. */
  exportMap(): Promise<MapExport | null>;
  /** Map meta for tests (WU). */
  mapInfo(): {
    name: string;
    sizeWu: number;
    waterLevel: number | null;
    starts: { army: number; x: number; z: number }[];
    spots: { kind: 'mass' | 'hydro'; x: number; z: number }[];
  } | null;
  /** Asset/boot timings of this page load. */
  loadTimings(): LoadTimings | null;
  /** Fullscreen / pointer-lock state. */
  fullscreen(): FullscreenState;
  /** Runs a dev-console line; returns its output lines. */
  console(line: string): { ok: boolean; lines: string[] };
  readonly consoleOpen: boolean;
  readonly budgetOpen: boolean;
  /** Last phase-budget stats from the host (plain object) or null. */
  stats(): unknown;
  fxStats(): unknown;
  /** Real GameAudio diagnostics. No playback, synthetic event routing or autoplay bypass. */
  audioStats(): AudioStats;
  resetAudioStats(): void;
  audioLoadReport(): Promise<LoadReport>;
  audioSnapshot(): { listener: ListenerState; contextState: string; muted: boolean; voices: number; maxVoices: number | null; poolSize: number | null };
  soundVoices(name: string): number;
  audioSpatial(name: string, x: number, z: number): { audible: boolean; gain: number; pan: number } | null;
  /** Last host status (plain object) or null. */
  hostStatus(): unknown;
  renderStats(): RenderStatsSnapshot;
  /** Copied visibility already accepted by Game, never a read of hidden World state. */
  visibility(): { viewer: number; tick: number; epoch: number; dim: number; cells: number[] } | null;
  /** Command log bytes (length) via `exportLog`. */
  exportLogBytes(): Promise<number>;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function installTestHooks(game: Game, timings: () => LoadTimings | null): FafTestHooks {
  const c = game.client;
  const map = game.map;
  const renderer = game.renderer;
  const tmp = new Float64Array(4);

  const renderStats = (): RenderStatsSnapshot => {
    const s = renderer.stats;
    const cv = game.canvas;
    return {
      frames: s.frames,
      drawCalls: s.drawCalls,
      drawsByPass: { ...s.drawsByPass },
      passDraws: { ...s.passDraws },
      visibilityFog: { ...s.visibilityFog },
      zoomLevel: s.zoomLevel,
      iconCount: s.iconCount,
      dynamicDecals: s.dynamicDecals,
      instances: s.instances,
      unitInstances: s.unitInstances,
      culledInstances: s.culledInstances,
      lodInstances: [...s.lodInstances],
      terrainPatches: s.terrainPatches,
      decals: s.decals,
      lost: s.lost,
      cpuMs: s.cpuMs,
      gpuMs: s.gpuMs ?? null,
      preset: s.preset,
      backbuffer: { width: cv.width, height: cv.height },
      css: { width: cv.clientWidth, height: cv.clientHeight },
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
    };
  };

  const heightRaw = (xRaw: number, zRaw: number): number => map.heightAtRaw(xRaw, zRaw);

  const hooks: FafTestHooks = {
    spawnAt: (blueprint, x, z, army = 0) => {
      const bp = game.bp.indexOf(blueprint);
      if (bp < 0) throw new Error(`unknown blueprint ${blueprint}`);
      return c.spawn(bp, 1, army, Math.round(x * RAW_PER_WU), Math.round(z * RAW_PER_WU), 0);
    },
    selected: () => Array.from(c.selection.selected()),
    controlGroups: () => c.controlGroups.snapshot(),
    get zoomLevel() { return strategicZoom(c.camera.distance, map.sizeWu).level; },
    get simHash() { return game.status.value?.simHash ?? game.bp.simHash; },
    get tainted() { return game.status.value?.tainted ?? false; },
    get hmr() { return { ...game.hmr }; },
    projectedUnits: () => {
      const r = c.lastFrame; const out: ProjectedUnit[] = [];
      if (r === null) return out;
      const pos = new Float64Array(3); const rect = new Float64Array(4);
      c.camera.update();
      for (let i = 0; i < r.unitCount; i++) {
        interpolatedPos(r, i, c.stream.lastAlpha, pos);
        if (!c.camera.project(pos[0]!, pos[1]!, pos[2]!, tmp) || !c.selection.screenRect(c.camera, i, c.stream.lastAlpha, rect)) continue;
        out.push({ handle: r.unitHandle(i), army: r.unitArmy(i), visual: r.unitVisual(i), x: tmp[0]!, y: tmp[1]!, rect: Array.from(rect) });
      }
      return out;
    },
    watch: () => {
      const r = c.lastFrame; const out: WatchInfo[] = [];
      if (r === null) return out;
      for (let w = 0; w < r.watchCount; w++) {
        const points: WatchInfo['points'] = []; const targets: WatchInfo['targets'] = [];
        for (let k = 0; k < r.watchPointCount(w); k++) points.push({ x: r.watchPointX(w, k) / RAW_PER_WU, z: r.watchPointZ(w, k) / RAW_PER_WU });
        for (let k = 0; k < r.watchTargetCount(w); k++) targets.push({ type: r.watchTargetType(w, k), x: r.watchTargetX(w, k) / RAW_PER_WU, z: r.watchTargetZ(w, k) / RAW_PER_WU });
        out.push({ handle: r.watchHandle(w), orders: r.watchOrderCount(w), flags: r.watchFlags(w), points, targets });
      }
      return out;
    },
    pathStats: () => { const r = c.lastFrame; return { pending: r?.pathPending ?? 0, requestsIssued: r?.requestsIssued ?? 0, repathsTriggered: r?.repathsTriggered ?? 0, stuckGiveUps: r?.stuckGiveUps ?? 0 }; },
    rigPose: handle => c.rigPose(handle),
    rigPoseStats: () => ({ ...c.rigPoseStats }),
    unitInfo: (handle) => {
      const r = c.lastFrame; if (r === null) return null;
      for (let i = 0; i < r.unitCount; i++) {
        if (r.unitHandle(i) !== handle) continue;
        const x = r.unitCur(i, 0); const z = r.unitCur(i, 2); const y = r.unitCur(i, 1);
        const cx = Math.floor(x / RAW_PER_WU); const cz = Math.floor(z / RAW_PER_WU);
        const hf = map.heightfield; const cls = Math.max(1, Math.min(3, game.bp.sizeClass(r.unitVisual(i))));
        let blocked = map.waterLevelRaw !== null && isDeepWaterForLand(hf, map.waterLevelRaw, x, z);
        // Mirrors nav land terrain + Chebyshev clearance. Runtime footprint occupancy is not exported to the client.
        for (let dz = 1 - cls; dz < cls; dz++) for (let dx = 1 - cls; dx < cls; dx++) {
          const xx = cx + dx; const zz = cz + dz;
          if (xx <= 0 || zz <= 0 || xx >= map.sizeWu - 1 || zz >= map.sizeWu - 1) { blocked = true; continue; }
          const k = zz * hf.dim + xx; const hs = [hf.heights[k]!, hf.heights[k + 1]!, hf.heights[k + hf.dim]!, hf.heights[k + hf.dim + 1]!];
          if ((Math.max(...hs) - Math.min(...hs)) * hf.heightScaleRaw > 3072) blocked = true;
          if (map.waterLevelRaw !== null && isDeepWaterForLand(hf, map.waterLevelRaw, xx * RAW_PER_WU + 2048, zz * RAW_PER_WU + 2048)) blocked = true;
        }
        let orders: number | null = null;
        for (let w = 0; w < r.watchCount; w++) if (r.watchHandle(w) === handle) orders = r.watchOrderCount(w);
        const hpMax = game.bp.maxHp(r.unitVisual(i));
        return { x: x / RAW_PER_WU, y: y / RAW_PER_WU, z: z / RAW_PER_WU, visual: r.unitVisual(i), orders, blocked,
          hp: Math.round(r.unitHp(i) / 255 * hpMax), hpMax, build: r.unitBuild(i) / 255, flags: r.unitFlags(i) };
      }
      return null;
    },
    waitTick: (tick, timeoutMs = 10000) => new Promise((resolve, reject) => {
      const start = performance.now();
      const poll = (): void => {
        if (c.tick >= tick) resolve();
        else if (performance.now() - start > timeoutMs) reject(new Error(`tick ${tick} timeout at ${c.tick}`));
        else requestAnimationFrame(poll);
      };
      poll();
    }),
    get tick() {
      return c.tick;
    },
    get paused() {
      return c.paused;
    },
    transport: game.transport,
    get crossOriginIsolated() {
      return globalThis.crossOriginIsolated === true;
    },
    get ready() {
      return game.ready !== null;
    },
    get simId() {
      return game.status.value?.simId ?? game.ready?.simId ?? null;
    },
    get mapSimHash() {
      return game.ready?.mapSimHash ?? null;
    },
    get mapName() {
      return game.ready?.mapName ?? map?.name ?? 'testplane';
    },
    buildHash: game.buildHash,
    get frames() {
      return c.stream.frameCount;
    },
    get unitCount() {
      return c.stream.unitCount;
    },
    get hostErrors() {
      return game.hostErrors.slice();
    },
    metrics: {
      snapshot: () => game.metricsSnapshot(),
      reset: () => c.metrics.reset(),
    },
    unitScreenPos: (h) => {
      const p = c.unitScreenPos(h);
      return p === null ? null : { x: p.x, y: p.y };
    },
    unitPos: (h) => {
      const r = c.lastFrame;
      if (r === null) return null;
      const hh = h >>> 0;
      for (let i = 0; i < r.unitCount; i++) {
        if (r.unitHandle(i) !== hh) continue;
        return { x: r.unitCur(i, 0) / RAW_PER_WU, y: r.unitCur(i, 1) / RAW_PER_WU, z: r.unitCur(i, 2) / RAW_PER_WU };
      }
      return null;
    },
    lastFrameHash: () => game.lastFrameHash(),
    recordFrameHashes: (on) => game.setFrameHashRecording(on),
    frameHashAt: (t) => game.frameHashAt(t),
    ruleHash: () => {
      const r = c.lastFrame;
      return r === null ? null : { tick: r.tick, hashTick: r.hashTick, hash: r.hash >>> 0 };
    },
    ownHandles: () => c.ownHandles(),
    inspection: () => {
      const r = c.lastFrame;
      if (!r) return null;
      const eco = Array.from({ length: r.ecoCount }, (_, i) => ({ army: r.ecoArmy(i),
        massStored: r.ecoValue(i, EcoField.massStored), massCapacity: r.ecoValue(i, EcoField.massCapacity), massOverflow: r.ecoValue(i, EcoField.massOverflow),
        energyStored: r.ecoValue(i, EcoField.energyStored), energyCapacity: r.ecoValue(i, EcoField.energyCapacity) }));
      const watches = Array.from({ length: r.watchCount }, (_, i) => {
        const handle = r.watchHandle(i), product = r.watchFactoryBp(i);
        let typeId: string | null = null;
        for (let j = 0; j < r.unitCount; j++) if (r.unitHandle(j) === handle) { typeId = game.bp.ids[r.unitVisual(j)] ?? null; break; }
        return { handle, typeId, product: game.bp.ids[product] ?? null, progress: r.watchFactoryProgress(i),
          queue: Array.from({ length: r.watchFactoryQueueCount(i) }, (_, j) => game.bp.ids[r.watchFactoryQueueBp(i, j)] ?? ''),
          rally: { x: r.watchRallyX(i) / RAW_PER_WU, z: r.watchRallyZ(i) / RAW_PER_WU } };
      });
      return { viewer: r.viewer, viewArmy: c.viewArmy, tick: r.tick, flowTick: r.flowTick,
        readOnlyCommands: c.readOnlyCommands, sentCommands: c.commands.sent, eco, watches };
    },
    armyUnitCount: (army) => {
      const r = c.lastFrame;
      if (r === null) return 0;
      let n = 0;
      for (let i = 0; i < r.unitCount; i++) if (r.unitArmy(i) === army) n++;
      return n;
    },
    sendMove: (handles, x, z, queue = false) => c.moveTo(x * RAW_PER_WU, z * RAW_PER_WU, handles, undefined, queue),
    lastMoveTarget: () => game.lastMove,
    select: (handles) => {
      if (handles === null) c.selection.selectAll();
      else if (handles.length === 0) c.selection.clear();
      else c.selection.set(handles);
      c.syncSelection();
      return c.selection.count;
    },
    ctl: (msg) => c.sendCtl(msg),
    cameraState: () => c.cameraState(),
    camera: () => c.cameraState(),
    screenToGround: (x, y) => {
      const p = c.pickAt(x, y);
      return p === null ? null : { x: p.x / RAW_PER_WU, z: p.z / RAW_PER_WU };
    },
    pickAt: (px, py) => {
      const p = c.pickAt(px, py);
      if (p === null) return null;
      return { x: p.x / RAW_PER_WU, y: p.y / RAW_PER_WU, z: p.z / RAW_PER_WU, raw: { x: p.x, y: p.y, z: p.z }, hit: p.hit };
    },
    pickReference: (px, py) => {
      const cam = c.camera;
      cam.update();
      const ray = cam.screenToRay(px, py);
      const o = ray.origin;
      const d = ray.dir;
      const t = map ?? { sizeWu: c.mapBounds.maxX / RAW_PER_WU, minHeightWU: 0, maxHeightWU: 0, heightWU: () => 0 };
      return referencePick(t, o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!);
    },
    project: (x, y, z) => {
      const cam = c.camera;
      cam.update();
      if (!cam.project(x * RAW_PER_WU, y * RAW_PER_WU, z * RAW_PER_WU, tmp)) return null;
      return { x: tmp[0]!, y: tmp[1]! };
    },
    heightAt: (x, z) => heightRaw(Math.round(x * RAW_PER_WU), Math.round(z * RAW_PER_WU)) / RAW_PER_WU,
    setCamera: (x, z, distance) => {
      const cam = c.camera;
      const d = distance === undefined ? undefined : Math.min(cam.maxDistance, Math.max(cam.minDistance, distance));
      c.jumpTo(x * RAW_PER_WU, z * RAW_PER_WU, d);
      return c.cameraState();
    },
    setYaw: (yaw) => {
      const cc = c.cameraController;
      cc.resetRotation();
      c.camera.yaw = yaw;
      cc.apply();
      return c.cameraState();
    },
    flight: (path, ms) => runFlight(game, path, ms),
    probeHeights: (n, seed) => {
      const t0 = performance.now();
      const xz = probePoints(n, seed, map.sizeWu);
      const gpu = new Int32Array(n);
      renderer.probeTerrainHeights(xz, gpu);
      let mismatches = 0;
      let first: ProbeReport['first'] = null;
      const hf = map.heightfield;
      for (let i = 0; i < n; i++) {
        const x = xz[2 * i]!;
        const z = xz[2 * i + 1]!;
        const cpu = sampleHeightRaw(hf, x, z);
        if (cpu !== gpu[i]) {
          mismatches++;
          first ??= { x, z, cpu, gpu: gpu[i]! };
        }
      }
      return { n, mismatches, first, ms: performance.now() - t0 };
    },
    unitHeights: () => {
      const r = c.lastFrame;
      if (r === null) return { units: 0, mismatches: 0, prevMismatches: 0, maxAbsDiffRaw: 0, first: null, tick: -1 };
      let mismatches = 0;
      let prevMismatches = 0;
      let maxAbs = 0;
      let first: UnitHeightReport['first'] = null;
      for (let i = 0; i < r.unitCount; i++) {
        const x = r.unitCur(i, 0);
        const y = r.unitCur(i, 1);
        const z = r.unitCur(i, 2);
        const cpu = heightRaw(x, z);
        const d = Math.abs(y - cpu);
        if (d > maxAbs) maxAbs = d;
        if (d !== 0) {
          mismatches++;
          first ??= { handle: r.unitHandle(i), x, y, z, cpu };
        }
        if (r.unitPrev(i, 1) !== heightRaw(r.unitPrev(i, 0), r.unitPrev(i, 2))) prevMismatches++;
      }
      return { units: r.unitCount, mismatches, prevMismatches, maxAbsDiffRaw: maxAbs, first, tick: r.tick };
    },
    exportMap: async () => {
      const bytes = game.mapBytes;
      const out = writeRtsMap(readRtsMap(bytes));
      const digest = await crypto.subtle.digest('SHA-256', out.slice().buffer);
      let identical = out.length === bytes.length;
      for (let i = 0; identical && i < out.length; i++) identical = out[i] === bytes[i];
      return {
        bytes: out.length,
        sha256: hex(digest),
        mapSimHash: mapSimHash(readRtsMap(out)) >>> 0,
        workerMapSimHash: game.ready?.mapSimHash ?? null,
        identical,
      };
    },
    mapInfo: () => {
      return {
        name: map.name,
        sizeWu: map.sizeWu,
        waterLevel: map.waterLevelRaw === null ? null : map.waterLevelRaw / RAW_PER_WU,
        starts: map.starts.map((s) => ({ army: s.army, x: s.x / RAW_PER_WU, z: s.z / RAW_PER_WU })),
        spots: map.spots.map((s) => ({ kind: s.kind, x: s.x / RAW_PER_WU, z: s.z / RAW_PER_WU })),
      };
    },
    loadTimings: () => {
      const t = timings();
      return t === null ? null : (JSON.parse(JSON.stringify(t)) as LoadTimings);
    },
    fullscreen: () => {
      const fs = c.fullscreen;
      const cf = c.confinement;
      const el = document.getElementById('faf-virtual-cursor');
      return {
        supported: fs?.supported ?? false,
        active: fs?.active ?? false,
        pointerLockSupported: cf?.supported ?? false,
        locked: cf?.locked ?? false,
        lockRequests: cf?.requests ?? 0,
        lockErrors: cf?.errors ?? 0,
        virtualCursor: cf === null ? null : { x: cf.x, y: cf.y, visible: el !== null && el.style.display !== 'none' },
      };
    },
    console: (line) => {
      const r = game.execute(line);
      return { ok: r.ok, lines: [...r.lines] };
    },
    get consoleOpen() {
      return game.consoleOpen.value;
    },
    get budgetOpen() {
      return game.budgetOpen.value;
    },
    fxStats: () => ({ ...game.fx.stats }),
    audioStats: () => game.audio.engine.stats(),
    resetAudioStats: () => game.audio.engine.resetStats(),
    audioLoadReport: async () => {
      const report = await game.audio.ready;
      return { ...report, paths: { ...report.paths } };
    },
    audioSnapshot: () => {
      const engine = game.audio.engine;
      return { listener: { ...engine.spatial.listener }, contextState: engine.context.state, voices: engine.voices?.voiceCount ?? 0,
        muted: engine.muted, maxVoices: engine.voices?.maxVoices ?? null, poolSize: engine.voices?.poolSize ?? null };
    },
    soundVoices: name => {
      const engine = game.audio.engine, index = engine.catalog?.resolveIndex(name, engine.faction) ?? -1;
      return index < 0 ? 0 : engine.voices?.soundVoices(index) ?? 0;
    },
    audioSpatial: (name, x, z) => {
      const engine = game.audio.engine, index = engine.catalog?.resolveIndex(name, engine.faction) ?? -1;
      if (index < 0 || engine.catalog === null) return null;
      const sound = engine.catalog.byIndex(index), out = { gain: 0, pan: 0 };
      const audible = engine.spatial.spatialize(SOUND_CATEGORIES.indexOf(sound.category), x, z, out);
      return { audible, ...out };
    },
    stats: () => {
      const s = game.stats.value;
      return s === null ? null : (JSON.parse(JSON.stringify(s)) as unknown);
    },
    hostStatus: () => {
      const s = game.status.value;
      return s === null ? null : (JSON.parse(JSON.stringify(s)) as unknown);
    },
    renderStats,
    visibility: () => {
      const v = game.visibility.snapshot;
      return v === null ? null : { viewer: v.viewer, tick: v.tick, epoch: v.epoch, dim: v.dim, cells: Array.from(v.cells) };
    },
    exportLogBytes: async () => (await game.exportLog(false)).byteLength,
  };
  const w = window as unknown as Record<string, unknown>;
  w['__faf'] = hooks;
  w['__flow-and-fire'] = hooks;
  return hooks;
}

/**
 * Scripted camera flight: every rAF the camera focus is placed on the polyline through `path`
 * (linear in time over the segment lengths), the distance interpolated; the renderer stats of each
 * rendered frame are collected (the GameClient renders before this callback in the same rAF).
 */
function runFlight(game: Game, path: readonly FlightWaypoint[], ms: number): Promise<FlightReport> {
  const c = game.client;
  const r = game.renderer;
  if (path.length === 0) return Promise.reject(new Error('flight: empty path'));
  const seg: number[] = [0];
  for (let i = 1; i < path.length; i++) seg.push(seg[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  const total = seg[seg.length - 1]!;
  const d0 = c.camera.distance;
  const pose = (f: number): { x: number; z: number; d: number } => {
    if (path.length === 1 || total === 0) return { x: path[0]!.x, z: path[0]!.z, d: path[0]!.distance ?? d0 };
    const s = f * total;
    let i = 1;
    while (i < path.length - 1 && seg[i]! < s) i++;
    const a = path[i - 1]!;
    const b = path[i]!;
    const len = seg[i]! - seg[i - 1]!;
    const t = len === 0 ? 1 : Math.min(1, Math.max(0, (s - seg[i - 1]!) / len));
    const da = a.distance ?? d0;
    const db = b.distance ?? da;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, d: da + (db - da) * t };
  };
  const draws: number[] = [];
  const cpu: number[] = [];
  const gpu: number[] = [];
  const passMax = { terrain: 0, water: 0, fog: 0, units: 0, icons: 0, overlay: 0 };
  let uiMin = Infinity;
  let uiMax = 0;
  let cuMin = Infinity;
  let cuMax = 0;
  let tpMin = Infinity;
  let tpMax = 0;
  const lodMax = [0, 0, 0];
  let lastFrame = r.stats.frames;
  return new Promise((resolve) => {
    const p0 = pose(0);
    c.jumpTo(p0.x * RAW_PER_WU, p0.z * RAW_PER_WU, p0.d);
    c.metrics.reset();
    const t0 = performance.now();
    const step = (): void => {
      const s = r.stats;
      if (s.frames !== lastFrame && !s.lost) {
        lastFrame = s.frames;
        draws.push(s.drawCalls);
        cpu.push(s.cpuMs);
        if (s.gpuMs !== undefined) gpu.push(s.gpuMs);
        passMax.terrain = Math.max(passMax.terrain, s.drawsByPass.terrain);
        passMax.water = Math.max(passMax.water, s.drawsByPass.water);
        passMax.fog = Math.max(passMax.fog, s.drawsByPass.fog);
        passMax.units = Math.max(passMax.units, s.drawsByPass.units);
        passMax.icons = Math.max(passMax.icons, s.drawsByPass.icons);
        passMax.overlay = Math.max(passMax.overlay, s.drawsByPass.overlay);
        uiMin = Math.min(uiMin, s.unitInstances);
        uiMax = Math.max(uiMax, s.unitInstances);
        cuMin = Math.min(cuMin, s.culledInstances);
        cuMax = Math.max(cuMax, s.culledInstances);
        tpMin = Math.min(tpMin, s.terrainPatches);
        tpMax = Math.max(tpMax, s.terrainPatches);
        for (let k = 0; k < 3; k++) lodMax[k] = Math.max(lodMax[k]!, s.lodInstances[k]!);
      }
      const el = performance.now() - t0;
      if (el >= ms) {
        const snap = c.metrics.snapshot();
        const sd = [...draws].sort((a, b) => a - b);
        const sc = [...cpu].sort((a, b) => a - b);
        const sg = [...gpu].sort((a, b) => a - b);
        resolve({
          ms: el,
          frames: draws.length,
          fps: (draws.length * 1000) / el,
          draws: {
            max: sd.length === 0 ? 0 : sd[sd.length - 1]!,
            min: sd.length === 0 ? 0 : sd[0]!,
            mean: sd.length === 0 ? 0 : sd.reduce((a, b) => a + b, 0) / sd.length,
            over50: sd.filter((d) => d > 50).length,
          },
          drawsByPassMax: passMax,
          renderCpuMs: { p50: percentile(sc, 0.5), p95: percentile(sc, 0.95), max: sc.length === 0 ? 0 : sc[sc.length - 1]! },
          gpuMs: sg.length === 0 ? null : { p50: percentile(sg, 0.5), p95: percentile(sg, 0.95), samples: sg.length },
          mainJsMs: snap.mainJsMs,
          rafIntervalMs: snap.rafIntervalMs,
          unitInstances: { min: Number.isFinite(uiMin) ? uiMin : 0, max: uiMax },
          culledInstances: { min: Number.isFinite(cuMin) ? cuMin : 0, max: cuMax },
          lodInstancesMax: lodMax,
          terrainPatches: { min: Number.isFinite(tpMin) ? tpMin : 0, max: tpMax },
          units: c.stream.unitCount,
        });
        return;
      }
      const p = pose(el / ms);
      c.jumpTo(p.x * RAW_PER_WU, p.z * RAW_PER_WU, p.d);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
