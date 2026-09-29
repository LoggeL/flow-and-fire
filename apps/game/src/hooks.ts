/**
 * Test hooks for E2E (Playwright) and manual debugging: `window.__faf` (alias
 * `window['__flow-and-fire']`). Everything returns plain, structured-clone-safe values.
 * The hooks only read client state or go through the same paths as player input (commands,
 * ctl messages) — they never touch the sim directly.
 */
import { GroundPicker, RAW_PER_WU, mapBoundsWU, type CameraState, type MetricsSnapshot } from '@faf/client';
import type { CtlMessage } from '@faf/protocol';
import type { FrameFingerprint } from './frame-hash.ts';
import type { Game } from './game.ts';

export interface UnitPosWU {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FafTestHooks {
  readonly tick: number;
  readonly paused: boolean;
  readonly transport: 'sab' | 'transfer';
  readonly crossOriginIsolated: boolean;
  readonly ready: boolean;
  readonly simId: number | null;
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
  /** Handles of all own units in the newest frame. */
  ownHandles(): number[];
  /** Units of `army` in the newest frame. */
  armyUnitCount(army: number): number;
  /** Move command for `handles` to (x, z) in WU, like a right click (marker, line, measurement). */
  sendMove(handles: readonly number[], x: number, z: number): number;
  /** Explicit selection (empty array = clear; null = back to "all own units"). */
  select(handles: readonly number[] | null): number;
  ctl(msg: CtlMessage): void;
  cameraState(): CameraState;
  /** Ground point (WU) under the CSS pixel (x, y), as a right click would pick it; null above the horizon. */
  screenToGround(x: number, y: number): { x: number; z: number } | null;
  /** Moves the camera focus to (x, z) WU and optionally sets the distance (WU). */
  setCamera(x: number, z: number, distance?: number): CameraState;
  /** Runs a dev-console line; returns its output lines. */
  console(line: string): { ok: boolean; lines: string[] };
  readonly consoleOpen: boolean;
  readonly budgetOpen: boolean;
  /** Last phase-budget stats from the host (plain object) or null. */
  stats(): unknown;
  /** Last host status (plain object) or null. */
  hostStatus(): unknown;
  renderStats(): { frames: number; drawCalls: number; instances: number; lost: boolean; cpuMs: number };
  /** Command log bytes (length) via `exportLog`. */
  exportLogBytes(): Promise<number>;
}

export function installTestHooks(game: Game): FafTestHooks {
  const c = game.client;
  const picker = new GroundPicker(mapBoundsWU());
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
    ownHandles: () => c.ownHandles(),
    armyUnitCount: (army) => {
      const r = c.lastFrame;
      if (r === null) return 0;
      let n = 0;
      for (let i = 0; i < r.unitCount; i++) if (r.unitArmy(i) === army) n++;
      return n;
    },
    sendMove: (handles, x, z) => c.moveTo(x * RAW_PER_WU, z * RAW_PER_WU, handles),
    select: (handles) => {
      if (handles === null) c.selection.selectAll();
      else if (handles.length === 0) c.selection.clear();
      else c.selection.set(handles);
      return c.selection.count;
    },
    ctl: (msg) => c.sendCtl(msg),
    cameraState: () => c.cameraState(),
    screenToGround: (x, y) => {
      c.camera.update();
      if (!picker.pick(c.camera, x, y)) return null;
      return { x: picker.x / RAW_PER_WU, z: picker.z / RAW_PER_WU };
    },
    setCamera: (x, z, distance) => {
      if (distance !== undefined) c.camera.distance = Math.min(c.camera.maxDistance, Math.max(c.camera.minDistance, distance));
      c.cameraController.focusRaw(x * RAW_PER_WU, z * RAW_PER_WU);
      return c.cameraState();
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
      return s === null ? null : JSON.parse(JSON.stringify(s)) as unknown;
    },
    hostStatus: () => {
      const s = game.status.value;
      return s === null ? null : JSON.parse(JSON.stringify(s)) as unknown;
    },
    renderStats: () => {
      const s = game.renderer.stats;
      return { frames: s.frames, drawCalls: s.drawCalls, instances: s.instances, lost: s.lost, cpuMs: s.cpuMs };
    },
    exportLogBytes: async () => (await game.exportLog(false)).byteLength,
  };
  const w = window as unknown as Record<string, unknown>;
  w['__faf'] = hooks;
  w['__flow-and-fire'] = hooks;
  return hooks;
}
