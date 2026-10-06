/**
 * Test hooks for E2E (Playwright) and manual debugging: `window.__faf` (alias
 * `window['__flow-and-fire']`). Everything returns plain, structured-clone-safe values.
 * The hooks only read client/renderer state or go through the same paths as player input
 * (commands, ctl messages, camera controller) — they never touch the sim directly.
 *
 * MS2 additions: map/terrain checks (`probeHeights` GPU vs. CPU, `unitHeights`, `pickAt` vs.
 * `pickReference`, `exportMap` roundtrip), camera (`camera`, `project`, `flight`), load timings,
 * the last Move target, fullscreen/pointer-lock state and the rule hash.
 *
 * MS3 additions (contract for the E2E package ms3-p6): selection and control groups, the screen
 * geometry of every unit of the current frame (projected position, icon rectangle exactly as the
 * IconPass draws it, crossfade), strategic zoom and render stats (icons/units draws), watch data,
 * path counters, HMR timings, simHash/tainted, per-unit info (orders, blocked cell via the client's
 * nav-rule replica), waiting for a tick.
 */
import {
  RAW_PER_WU,
  iconScreenRect,
  interpolatedPos,
  isOwnUnit,
  type CameraState,
  type ControlGroupOp,
  type MetricsSnapshot,
  type RenderPresetName,
  type StatSummary,
} from '@faf/client';
import { UnitFlags } from '@faf/protocol';
import { mapSimHash, readRtsMap, writeRtsMap } from '@faf/formats';
import { sampleHeightRaw } from '@faf/rules';
import type { CtlMessage } from '@faf/protocol';
import type { FrameFingerprint } from './frame-hash.ts';
import type { Game, MoveTarget, WatchEntry } from './game.ts';
import type { HmrSnapshot } from './hmr.ts';
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
  readonly drawsByPass: { terrain: number; water: number; units: number; icons: number; overlay: number };
  /** Strategic zoom of the last frame (MS3). */
  readonly zoomLevel: number;
  readonly iconForce: number;
  /** Units whose icon is visible / inside the crossfade band / drawn only as icons. */
  readonly iconCount: number;
  readonly fadedUnits: number;
  readonly iconOnlyUnits: number;
  /** Dynamic terrain decals (selection rings, target discs). */
  readonly dynamicDecals: number;
  readonly decalChunkOverflow: number;
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
  readonly drawsByPassMax: { terrain: number; water: number; units: number; icons: number; overlay: number };
  /** MS3 strategic zoom: rendered frames per zoom level [Z0, Z1, Z2]. */
  readonly framesByZoomLevel: [number, number, number];
  /** Frames with visible units whose IconPass did not draw exactly once (0 = the pass is always one draw). */
  readonly iconPassNot1Frames: number;
  /** Largest UnitPass draw count in a Z2 frame (0 = only icons at whole-map zoom). */
  readonly unitDrawsInZ2Max: number;
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

/** Screen geometry of one unit of the current frame (CSS px), as the renderer draws it. */
export interface ScreenUnit {
  readonly handle: number;
  readonly army: number;
  readonly visual: number;
  /** Projected (interpolated) position; null behind the camera. */
  readonly x: number | null;
  readonly y: number | null;
  /** Projected centre inside the viewport. */
  readonly onScreen: boolean;
  /** Icon coverage 0..1 (render crossfade) and whether hit tests use the icon (≥ 0.5). */
  readonly fade: number;
  readonly icon: boolean;
  /** Icon square [x0, y0, x1, y1] (render `iconScreenRect`); null behind the camera. */
  readonly iconRect: [number, number, number, number] | null;
  /** Projected selection radius (CSS px, mesh-mode hit disc). */
  readonly radiusPx: number;
  readonly selected: boolean;
}

export interface ZoomInfo {
  /** Camera distance (WU) and the strategic zoom it gives on this map (client formula = renderer formula). */
  readonly distance: number;
  readonly maxDistance: number;
  readonly level: number;
  readonly iconForce: number;
  readonly z1: number;
  readonly z2: number;
  /** Level the renderer used in its last frame. */
  readonly renderLevel: number;
}

export interface UnitInfo {
  readonly handle: number;
  readonly army: number;
  readonly visual: number;
  /** cur position (WU). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** UnitRecord flag Idle (no orders, standing). */
  readonly idle: boolean;
  readonly selected: boolean;
  /** In the frame's watch section. */
  readonly watched: boolean;
  /** Order count from the watch section (null if not watched). */
  readonly orders: number | null;
  /** Cell (1 WU) of the unit. */
  readonly cell: { x: number; z: number };
  /** Cell blocked for land: static nav rule replica (slope/deep water/border) or a console footprint. */
  readonly blockedCell: boolean;
  readonly blockedReason: 'static' | 'footprint' | null;
}

export interface PathStatsSnapshot {
  readonly tick: number;
  readonly pending: number;
  readonly requestsIssued: number;
  readonly repathsTriggered: number;
  readonly expansionsLastTick: number;
  readonly stuckGiveUps: number;
  /** `HostStatsMsg.path` (plain) or null before the first stats message. */
  readonly host: unknown;
}

export interface FafTestHooks {
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
  /**
   * Move command for `handles` (null = the selection) to (x, z) in WU, like a right click (marker,
   * optimistic line, measurement); `queue` = Shift (CmdFlags.Queue).
   */
  sendMove(handles: readonly number[] | null, x: number, z: number, queue?: boolean): number;
  /** Last Move command sent to the sim (decoded from the batch; raw coordinates). */
  lastMoveTarget(): MoveTarget | null;
  /** Selects `handles` (empty array = clear; null = all own units, like Ctrl+A); `additive` adds. */
  select(handles: readonly number[] | null, additive?: boolean): number;
  /** Selected handles (frame order). */
  selection(): number[];
  /** Clears the selection (like Esc). */
  clearSelection(): void;
  /** Selects every own unit of blueprint (sim id or `core:…`); returns the count. */
  selectBlueprint(bp: number | string): number;
  /** Members of control groups 0–9. */
  controlGroups(): number[][];
  /** Control-group operation like the hotkeys (store/add/recall/recallAdd); returns the group size. */
  controlGroup(op: ControlGroupOp, group: number): number;
  /** Screen geometry of every unit of the current frame (at the displayed alpha). */
  screenUnits(): ScreenUnit[];
  /** Strategic zoom (camera distance → Z0/Z1/Z2). */
  zoom(): ZoomInfo;
  /** Watch section of the newest frame (WU). */
  watch(): WatchEntry[];
  /** Handles last sent with `ctl.watch`. */
  watchedHandles(): number[];
  /** Path counters (frame header + host stats). */
  pathStats(): PathStatsSnapshot | null;
  /** Order feedback built for the last frame (segments, discs, rings, watched units, optimistic entries). */
  feedback(): { segments: number; discs: number; rings: number; watchedDrawn: number; optimistic: number; pathOverlay: boolean };
  /** Path overlay on/off. */
  setPathOverlay(on: boolean): void;
  /** Hides all units in the renderer (bare-terrain reference frames for pixel checks); returns the state. */
  setUnitsHidden(on: boolean): boolean;
  /** Unit details (null if the handle is not in the newest frame). */
  unitInfo(handle: number): UnitInfo | null;
  /** Resolves with the tick once the client has a frame with tick ≥ n (rejects after `timeoutMs`, default 30 s). */
  waitTick(n: number, timeoutMs?: number): Promise<number>;
  /** Blueprint HMR bookkeeping (dev server). */
  readonly hmr: HmrSnapshot;
  /** Blueprint simHash of the running sim (host status) and whether the command log is tainted. */
  readonly simHash: number | null;
  readonly tainted: boolean;
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
  /** Last host status (plain object) or null. */
  hostStatus(): unknown;
  renderStats(): RenderStatsSnapshot;
  /** Command log bytes (length) via `exportLog`. */
  exportLogBytes(): Promise<number>;
  /** The command log itself (bytes as numbers; E2E parses MARKs such as devReload). */
  exportLogData(): Promise<number[]>;
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
      drawsByPass: { terrain: s.drawsByPass.terrain, water: s.drawsByPass.water, units: s.drawsByPass.units, icons: s.drawsByPass.icons, overlay: s.drawsByPass.overlay },
      zoomLevel: s.zoomLevel,
      iconForce: s.iconForce,
      iconCount: s.iconCount,
      fadedUnits: s.fadedUnits,
      iconOnlyUnits: s.iconOnlyUnits,
      dynamicDecals: s.dynamicDecals,
      decalChunkOverflow: s.decalChunkOverflow,
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
      return game.ready?.simId ?? null;
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
    armyUnitCount: (army) => {
      const r = c.lastFrame;
      if (r === null) return 0;
      let n = 0;
      for (let i = 0; i < r.unitCount; i++) if (r.unitArmy(i) === army) n++;
      return n;
    },
    sendMove: (handles, x, z, queue) => c.moveTo(x * RAW_PER_WU, z * RAW_PER_WU, handles ?? undefined, undefined, queue === true),
    lastMoveTarget: () => game.lastMove,
    select: (handles, additive) => {
      if (handles === null) return c.selectAll();
      if (handles.length === 0 && additive !== true) {
        c.clearSelection();
        return 0;
      }
      return c.select(handles, additive === true);
    },
    selection: () => Array.from(c.selection.selected()),
    clearSelection: () => c.clearSelection(),
    selectBlueprint: (bp) => {
      const id = typeof bp === 'number' ? bp : game.bp.indexOf(bp.includes(':') ? bp : `core:${bp}`);
      return id < 0 ? 0 : c.selectVisual(id);
    },
    controlGroups: () => c.controlGroups.snapshot(),
    controlGroup: (op, group) => c.controlGroup(op, group),
    screenUnits: () => {
      const r = c.lastFrame;
      if (r === null) return [];
      c.camera.update();
      const pr = c.selection.project(c.camera, c.stream.lastAlpha);
      const rect = new Float64Array(4);
      const pos = new Float64Array(3);
      const out: ScreenUnit[] = [];
      for (let i = 0; i < pr.count; i++) {
        const vis = pr.visible[i] === 1;
        let ir: ScreenUnit['iconRect'] = null;
        if (vis) {
          // Same geometry as the IconPass (render iconScreenRect at the displayed position).
          interpolatedPos(r, i, c.stream.lastAlpha, pos);
          if (iconScreenRect(c.camera, pos[0]!, pos[1]!, pos[2]!, rect, c.selection.iconSizePx)) ir = [rect[0]!, rect[1]!, rect[2]!, rect[3]!];
        }
        out.push({
          handle: r.unitHandle(i),
          army: r.unitArmy(i),
          visual: r.unitVisual(i),
          x: vis ? pr.sx[i]! : null,
          y: vis ? pr.sy[i]! : null,
          onScreen: pr.onScreen(i),
          fade: pr.fade[i]!,
          icon: pr.icon[i] === 1,
          iconRect: ir,
          radiusPx: pr.radiusPx[i]!,
          selected: c.selection.highlight[i] === 1,
        });
      }
      return out;
    },
    zoom: () => {
      const z = c.zoom;
      return {
        distance: c.camera.distance,
        maxDistance: c.camera.maxDistance,
        level: z.level,
        iconForce: z.iconForce,
        z1: z.z1,
        z2: z.z2,
        renderLevel: renderer.stats.zoomLevel,
      };
    },
    watch: () => game.watchData(),
    watchedHandles: () => c.watchedHandles(),
    pathStats: () => game.pathStats(),
    feedback: () => {
      const f = c.feedback;
      return { segments: f.segments, discs: f.discs, rings: f.ringCount, watchedDrawn: f.watchedDrawn, optimistic: f.optimisticCount, pathOverlay: f.pathOverlay };
    },
    setPathOverlay: (on) => {
      c.feedback.pathOverlay = on;
      c.feedback.invalidate();
    },
    setUnitsHidden: (on) => {
      c.unitsHidden = on;
      return c.unitsHidden;
    },
    unitInfo: (h) => {
      const r = c.lastFrame;
      if (r === null) return null;
      const i = c.selection.index.get(h);
      if (i < 0) return null;
      const x = r.unitCur(i, 0);
      const z = r.unitCur(i, 2);
      const cx = Math.floor(x / RAW_PER_WU);
      const cz = Math.floor(z / RAW_PER_WU);
      const stat = map.landBlockedAtRaw(x, z);
      const fp = !stat && game.footprintAt(cx, cz);
      let orders: number | null = null;
      for (let w = 0; w < r.watchCount; w++) {
        if (r.watchHandle(w) === h >>> 0) {
          orders = r.watchOrderCount(w);
          break;
        }
      }
      return {
        handle: h >>> 0,
        army: r.unitArmy(i),
        visual: r.unitVisual(i),
        x: x / RAW_PER_WU,
        y: r.unitCur(i, 1) / RAW_PER_WU,
        z: z / RAW_PER_WU,
        idle: (r.unitFlags(i) & UnitFlags.Idle) !== 0,
        selected: c.selection.highlight[i] === 1 && isOwnUnit(r, i, c.playerArmy),
        watched: orders !== null,
        orders,
        cell: { x: cx, z: cz },
        blockedCell: stat || fp,
        blockedReason: stat ? 'static' : fp ? 'footprint' : null,
      };
    },
    waitTick: (n, timeoutMs = 30_000) =>
      new Promise((resolve, reject) => {
        const t0 = performance.now();
        const check = (): void => {
          if (c.tick >= n) resolve(c.tick);
          else if (performance.now() - t0 > timeoutMs) reject(new Error(`waitTick(${n}): still at tick ${c.tick} after ${timeoutMs} ms`));
          else setTimeout(check, 10);
        };
        check();
      }),
    get hmr() {
      return game.hmrSnapshot();
    },
    get simHash() {
      return game.status.value?.simHash ?? game.ready?.bpSimHash ?? null;
    },
    get tainted() {
      return game.status.value?.tainted ?? false;
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
    stats: () => {
      const s = game.stats.value;
      return s === null ? null : (JSON.parse(JSON.stringify(s)) as unknown);
    },
    hostStatus: () => {
      const s = game.status.value;
      return s === null ? null : (JSON.parse(JSON.stringify(s)) as unknown);
    },
    renderStats,
    exportLogBytes: async () => (await game.exportLog(false)).byteLength,
    exportLogData: async () => Array.from(new Uint8Array(await game.exportLog(false))),
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
  const passMax = { terrain: 0, water: 0, units: 0, icons: 0, overlay: 0 };
  let uiMin = Infinity;
  let uiMax = 0;
  let cuMin = Infinity;
  let cuMax = 0;
  let tpMin = Infinity;
  let tpMax = 0;
  const lodMax = [0, 0, 0];
  const byLevel: [number, number, number] = [0, 0, 0];
  let iconNot1 = 0;
  let unitsZ2 = 0;
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
        passMax.units = Math.max(passMax.units, s.drawsByPass.units);
        passMax.overlay = Math.max(passMax.overlay, s.drawsByPass.overlay);
        passMax.icons = Math.max(passMax.icons, s.drawsByPass.icons);
        uiMin = Math.min(uiMin, s.unitInstances);
        uiMax = Math.max(uiMax, s.unitInstances);
        cuMin = Math.min(cuMin, s.culledInstances);
        cuMax = Math.max(cuMax, s.culledInstances);
        tpMin = Math.min(tpMin, s.terrainPatches);
        tpMax = Math.max(tpMax, s.terrainPatches);
        for (let k = 0; k < 3; k++) lodMax[k] = Math.max(lodMax[k]!, s.lodInstances[k]!);
        const lvl = Math.min(2, Math.max(0, s.zoomLevel | 0));
        byLevel[lvl] = byLevel[lvl]! + 1;
        if (lvl === 2) unitsZ2 = Math.max(unitsZ2, s.drawsByPass.units);
        if (s.unitInstances > 0 && s.iconCount > 0 && s.drawsByPass.icons !== 1) iconNot1++;
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
          framesByZoomLevel: byLevel,
          iconPassNot1Frames: iconNot1,
          unitDrawsInZ2Max: unitsZ2,
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
