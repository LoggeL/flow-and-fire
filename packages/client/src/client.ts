/**
 * GameClient: main-thread game loop (MS1: S1, S3, A5, G14, SPK6 chain; MS2: map, C1, G15, G16, C11;
 * MS3: C3 selection, C7 control groups, Shift queue + waypoint lines from the Watch section, G19
 * decals, C2 strategic zoom).
 *
 * Per requestAnimationFrame:
 *   edge scan + keyboard pan + focus-height smoothing → poll the newest frame (ack bookkeeping,
 *   handle index, selection/highlight rebuild, control-group pruning, watch sync) → alpha → hover
 *   pick → order feedback (selection rings + target discs as dynamic terrain decals, routes as
 *   overlay lines; rebuilt only when frame, alpha, selection or pending commands changed) →
 *   renderer.render (UnitRecords and the PartStream straight from the frame bytes, highlight,
 *   overlays) → metrics.
 *
 * Map (MS2): `setMap(clientMap)` sets the renderer terrain, the spot decals, the camera bounds and
 * terrain following and the heightmap raymarch picking (G15); click markers, waypoint lines and
 * the hover point sit on the terrain height. Without a map the client starts on the generated flat
 * test plane map (`ClientMap.testPlane()`), which takes exactly the same path.
 *
 * Input is handled in the DOM event handlers: a right click picks the ground, sends one Move
 * command for the whole selection (a group command in the sim; Shift = `CmdFlags.Queue`) and adds
 * the click marker immediately, so the marker is drawn in the very next rAF. An optimistic
 * waypoint line + target disc stay until the command's seq is confirmed by `FrameHeader.ackSeq`;
 * from then on the routes come from the frame's Watch section (`ctl.watch` = the first 64
 * selected handles, sent whenever that list changes). Without a selection a right click does
 * nothing.
 *
 * Pause (A5): the sim tick stands still, but camera, input, selection and command sending keep
 * working; alpha is frozen at 1.
 *
 * The steady-state rAF path does not allocate: the render view, overlay arrays and marker objects
 * are reused, the unit bytes are a cached view into the transport's buffer.
 */
import { MAX_WATCH, type CtlMessage, type FrameReader, type HostMessage } from '@faf/protocol';
import {
  ICON_SIZE_PX,
  RtsCamera,
  strategicZoom,
  type DecalBinStats,
  type DynamicDecals,
  type OverlayMarker,
  type OverlaySegment,
  type RenderStats,
  type RenderView,
  type StrategicZoom,
  type TerrainDecal,
  type TerrainDesc,
  type UnitPartsView,
  type VisualTable,
} from '@faf/render';
import type { ActionMap } from './actions.ts';
import { CameraController, type CameraState } from './camera-controller.ts';
import { CommandBuilder } from './commands.ts';
import { ControlGroups, type ControlGroupOp } from './control-groups.ts';
import { OrderFeedback } from './order-feedback.ts';
import { armyColorHex, VisualGeometry } from './visuals.ts';
import { FrameStream, type FrameStreamOptions } from './frames.ts';
import { FullscreenController, PointerConfinement, type FullscreenDocument, type FullscreenRoot, type LockableCanvas } from './fullscreen.ts';
import { InputController, type Action, type DragBox, type InputEventTarget, type InputSurface } from './input.ts';
import { ClientMap } from './map.ts';
import { ClientMetrics, type MetricsSnapshot } from './metrics.ts';
import type { MapBounds } from './picking.ts';
import { TerrainPicker } from './terrain-picker.ts';
import { interpolatedPos, isOwnUnit, Selection } from './selection.ts';
import type { SimLink } from './sim-link.ts';

/** What the client needs from the renderer (render's `Renderer` satisfies it). */
export interface RendererLike {
  render(view: RenderView): void;
  setVisuals(table: VisualTable): void;
  readonly stats?: Readonly<RenderStats>;
  /** Heightmap terrain (MS2); null = flat test plane. */
  setTerrain?(desc: TerrainDesc | null): void;
  /** Terrain decals (spot rings). */
  setTerrainDecals?(decals: readonly TerrainDecal[]): unknown;
  /** Dynamic terrain decals (G19: selection rings, target discs), called every frame. */
  setDynamicDecals?(buf: DynamicDecals | null): DecalBinStats | unknown;
}

/** `navigator.keyboard` (Keyboard Lock API, Chromium): lets fullscreen games keep Ctrl+digit etc. */
export interface KeyboardLockLike {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

/** requestAnimationFrame abstraction (tests drive frames manually). */
export interface RafLike {
  request(cb: (ts: number) => void): number;
  cancel(id: number): void;
}

/** The canvas: mouse input surface plus its CSS size. */
export type ClientCanvas = InputSurface & { readonly clientWidth?: number; readonly clientHeight?: number };

/** UI hooks (apps/game). */
export interface GameClientCallbacks {
  /** ^ / ` / F1 pressed (also while a text field has focus). */
  onToggleConsole?(): void;
  /** Selection rectangle while left-dragging (null when done). */
  onDragBox?(box: DragBox | null): void;
  /** Selection changed (player input, control group, console, hooks). */
  onSelectionChange?(count: number): void;
  /** A control group was stored/extended/recalled (after the selection was updated). */
  onControlGroup?(op: ControlGroupOp, group: number, size: number, centered: boolean): void;
  /** Host message (ready, status, stats, log, error). */
  onHostMessage?(m: HostMessage): void;
  /** A new frame was accepted (called inside the rAF, before rendering). */
  onFrame?(client: GameClient): void;
  /** Every input action, after the client handled it. */
  onAction?(a: Action): void;
  /** Fullscreen entered/left. */
  onFullscreenChange?(active: boolean): void;
}

export interface GameClientOptions {
  readonly canvas: ClientCanvas;
  readonly renderer: RendererLike;
  readonly link: SimLink;
  /** Visual table (index = UnitRecord.visual); apps/game builds it from view.json. */
  readonly visuals: VisualTable;
  /** Army of the local player (selection, commands). */
  readonly playerArmy: number;
  /** Keyboard event target; default `globalThis` (window). */
  readonly keyTarget?: InputEventTarget;
  readonly camera?: RtsCamera;
  /** Initial map (MS2); omitted = the generated 512 WU test plane map until `setMap`. */
  readonly map?: ClientMap;
  /** Key bindings (default: DEFAULT_ACTION_MAP). */
  readonly actionMap?: ActionMap;
  /** Edge pan at the canvas border (default true). */
  readonly edgePan?: boolean;
  /**
   * Fullscreen + pointer confinement (C11): the element that goes fullscreen (game root, also the
   * parent of the virtual cursor) and the document. Omitted ⇒ no fullscreen support.
   */
  readonly fullscreen?: { readonly root: FullscreenRoot; readonly doc: FullscreenDocument; readonly confine?: boolean };
  /** Flag per visual (1 = COMMAND category, `commanderVisuals`) for `jumpToCommander`. */
  readonly commanderVisuals?: Uint8Array;
  readonly callbacks?: GameClientCallbacks;
  /** Default: window.requestAnimationFrame. */
  readonly raf?: RafLike;
  /** Clock in ms; default performance.now. */
  readonly now?: () => number;
  /** Focused-element probe for the focus rule; default document.activeElement. */
  readonly focusProbe?: () => unknown;
  readonly frameStream?: FrameStreamOptions;
  /** Click marker color (0xRRGGBB). */
  readonly markerColor?: number;
  /** @deprecated Route colors live in order-feedback.ts (kept for source compatibility). */
  readonly lineColor?: number;
  /** Icon edge length in CSS px (must match the renderer's `setIconSize`; default 20). */
  readonly iconSizePx?: number;
  /**
   * Keyboard Lock API used while in fullscreen (default `navigator.keyboard` where available;
   * null disables it).
   */
  readonly keyboardLock?: KeyboardLockLike | null;
}

/** Plain screen position (CSS pixels). */
export interface ScreenPos {
  readonly x: number;
  readonly y: number;
}

/** A picked world point (raw Q20.12); `hit` = on the terrain (false = clamped edge fallback). */
export interface WorldPick {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hit: boolean;
}

const MAX_MARKERS = 32;
const MARKER_DURATION_MS = 700;
const MARKER_RADIUS_WU = 1.5;

interface MutableMarker {
  x: number;
  y: number;
  z: number;
  startMs: number;
  color: number;
  radiusWU: number;
  durationMs: number;
}

interface MutableView {
  camera: RtsCamera;
  units: { bytes: Uint8Array; count: number; version: number };
  parts: UnitPartsView & { bytes: Uint8Array; count: number; version: number };
  highlight: Uint8Array;
  highlightVersion: number;
  alpha: number;
  overlays: { markers: OverlayMarker[]; lines: readonly OverlaySegment[] };
  timeMs: number;
}

/**
 * Hull corner radius (WU) per visual for the rotation part of the "first moved pixel" metric:
 * boxes change their silhouette when turning, cylinders do not (0). Holes are drawn by the renderer
 * as a 1 WU fallback cube.
 */
export function visualCornerRadii(visuals: VisualTable): Float64Array {
  const out = new Float64Array(visuals.length);
  for (let i = 0; i < visuals.length; i++) {
    const spec = visuals[i]?.spec;
    if (spec === undefined) out[i] = Math.SQRT2 / 2;
    else out[i] = spec.hull === 'box' ? Math.hypot(spec.size[0], spec.size[2]) / 2 : 0;
  }
  return out;
}

function defaultKeyboardLock(): KeyboardLockLike | null {
  const nav = (globalThis as { navigator?: { keyboard?: Partial<KeyboardLockLike> } }).navigator;
  const kb = nav?.keyboard;
  if (kb === undefined || typeof kb.lock !== 'function' || typeof kb.unlock !== 'function') return null;
  return { lock: (codes) => kb.lock!.call(kb, codes), unlock: () => kb.unlock!.call(kb) };
}

function defaultRaf(): RafLike {
  const g = globalThis as {
    requestAnimationFrame?: (cb: (ts: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  if (g.requestAnimationFrame === undefined || g.cancelAnimationFrame === undefined) {
    throw new Error('GameClient: requestAnimationFrame unavailable (pass options.raf)');
  }
  const req = g.requestAnimationFrame.bind(globalThis);
  const cancel = g.cancelAnimationFrame.bind(globalThis);
  return { request: req, cancel };
}

export class GameClient {
  readonly camera: RtsCamera;
  readonly cameraController: CameraController;
  readonly selection: Selection;
  /** Control groups 0–9 (C7). */
  readonly controlGroups = new ControlGroups();
  /** Selection rings, target discs and routes (C3/G7/G19). */
  readonly feedback: OrderFeedback;
  /** Per-visual selection radius / icon threshold (renderer numbers, from the visual table). */
  geometry: VisualGeometry;
  readonly commands: CommandBuilder;
  readonly stream: FrameStream;
  readonly metrics: ClientMetrics;
  readonly input: InputController;
  readonly link: SimLink;
  readonly renderer: RendererLike;
  readonly playerArmy: number;
  /** Fullscreen toggle (null without `options.fullscreen`). */
  readonly fullscreen: FullscreenController | null;
  /** Pointer confinement in fullscreen (null without fullscreen or when disabled). */
  readonly confinement: PointerConfinement | null;
  /** Last host `status` / `stats` / `ready` message. */
  lastHostMessage: HostMessage | null = null;
  /** Current map (the generated test plane until `setMap`). */
  map: ClientMap;
  /** Terrain point under the cursor (raw), updated every frame while the pointer is known. */
  readonly hover = { x: 0, y: 0, z: 0, valid: false, hit: false };
  /** Flag per visual for `jumpToCommander` (COMMAND category). */
  commanderVisuals: Uint8Array | null;

  private readonly canvas: ClientCanvas;
  private readonly callbacks: GameClientCallbacks;
  private readonly rafImpl: RafLike | undefined;
  private readonly nowFn: () => number;
  private terrainPicker: TerrainPicker;
  private bounds: MapBounds;
  private readonly markerColor: number;
  private readonly keyboardLock: KeyboardLockLike | null;
  private keyboardLocked = false;
  private readonly unsubscribeHost: () => void;
  private readonly unsubscribeAck: () => void;

  private readonly markerPool: MutableMarker[] = [];
  private readonly markers: OverlayMarker[] = [];
  private readonly view: MutableView;
  /** Handles last sent with `ctl.watch` (first `watchSentN` entries). */
  private readonly watchSent = new Uint32Array(MAX_WATCH);
  private watchSentN = -1;
  /** Watch messages sent (hooks). */
  watchMessages = 0;
  private readonly zoomState: StrategicZoom = { level: 0, iconForce: 0, z1: 0, z2: 0 };
  private readonly isOwnRecord = (i: number): boolean => {
    const r = this.lastFrame;
    return r !== null && isOwnUnit(r, i, this.playerArmy);
  };
  private readonly tmp2 = new Float64Array(2);
  private readonly emptyUnits = new Uint8Array(0);
  /**
   * Debug/test switch: when true the renderer gets no unit records (no meshes, icons, HP bars) while
   * the sim, selection and feedback keep running – reference frames of the bare terrain for pixel
   * checks (E2E strategic-zoom crossfade).
   */
  unitsHidden = false;
  private readonly unsubscribeFullscreen: () => void;
  private readonly tmp = new Float64Array(4);
  private readonly pos = new Float64Array(3);

  private rafId = -1;
  private running = false;
  private disposed = false;
  private lastNow = Number.NaN;
  private pauseWanted: boolean | null = null;
  private pauseWantedAt = 0;
  private readonly loop = (ts: number): void => {
    if (!this.running) return;
    this.rafId = this.raf().request(this.loop);
    this.frame(ts);
  };

  constructor(opts: GameClientOptions) {
    this.canvas = opts.canvas;
    this.renderer = opts.renderer;
    this.link = opts.link;
    this.playerArmy = opts.playerArmy;
    this.callbacks = opts.callbacks ?? {};
    this.rafImpl = opts.raf;
    this.nowFn = opts.now ?? (() => performance.now());
    this.markerColor = opts.markerColor ?? 0x40ff60;
    this.keyboardLock = opts.keyboardLock === undefined ? defaultKeyboardLock() : opts.keyboardLock;

    const map = opts.map ?? ClientMap.testPlane();
    this.map = map;
    this.bounds = map.bounds;
    this.terrainPicker = new TerrainPicker(map);
    this.camera = opts.camera ?? new RtsCamera();
    this.cameraController = new CameraController(this.camera, { bounds: map.bounds, terrain: map });
    if (opts.camera === undefined) this.cameraController.centerOnMap();
    this.commanderVisuals = opts.commanderVisuals ?? null;
    this.selection = new Selection(opts.playerArmy);
    this.selection.iconSizePx = opts.iconSizePx ?? ICON_SIZE_PX;
    this.selection.mapSizeWU = map.sizeWu;
    this.geometry = new VisualGeometry(opts.visuals);
    this.selection.geometry = this.geometry;
    this.feedback = new OrderFeedback(map);
    this.feedback.ringColor = armyColorHex(opts.playerArmy);
    this.commands = new CommandBuilder(opts.link, opts.playerArmy);
    this.stream = new FrameStream(opts.link.frames, opts.frameStream);
    this.metrics = new ClientMetrics();
    this.metrics.sources = {
      frame: () => ({
        tick: this.stream.tick,
        paused: this.stream.paused,
        speed: this.stream.speedPermille / 1000,
        frames: this.stream.frameCount,
        skippedTicks: this.stream.skippedTicks,
        invalidFrames: this.stream.invalidFrames,
        renderDelayMs: this.stream.renderDelayMs,
        jitterMs: this.stream.jitterMs,
        alpha: this.stream.lastAlpha,
        clockSnaps: this.stream.snaps,
        units: this.stream.unitCount,
        pendingCommands: this.commands.pendingCount,
        lastSeq: this.commands.lastSeq,
        ackSeq: this.stream.ackSeq,
      }),
    };
    this.metrics.setVisualRadii(visualCornerRadii(opts.visuals));
    this.unsubscribeAck = this.commands.onAck((seq, _op, _lat, ackMs) => this.metrics.onAck(seq, ackMs));

    for (let i = 0; i < MAX_MARKERS; i++) {
      this.markerPool.push({ x: 0, y: 0, z: 0, startMs: 0, color: this.markerColor, radiusWU: MARKER_RADIUS_WU, durationMs: MARKER_DURATION_MS });
    }
    this.view = {
      camera: this.camera,
      units: { bytes: this.emptyUnits, count: 0, version: 0 },
      highlight: this.selection.highlight,
      highlightVersion: 0,
      alpha: 1,
      parts: { bytes: this.emptyUnits, count: 0, version: 0 },
      overlays: { markers: this.markers, lines: this.feedback.lines },
      timeMs: 0,
    };

    this.renderer.setVisuals(opts.visuals);
    this.unsubscribeHost = opts.link.onHostMessage((m) => {
      this.lastHostMessage = m;
      this.callbacks.onHostMessage?.(m);
    });
    const keyTarget = opts.keyTarget ?? (globalThis as unknown as InputEventTarget);
    const fs = opts.fullscreen;
    if (fs !== undefined) {
      this.fullscreen = new FullscreenController(fs.root, fs.doc);
      const lockable = opts.canvas as unknown as LockableCanvas;
      this.confinement =
        fs.confine === false
          ? null
          : new PointerConfinement({
              canvas: lockable,
              doc: fs.doc,
              fullscreen: this.fullscreen,
              viewport: () => ({ width: this.camera.viewportWidth, height: this.camera.viewportHeight }),
              container: fs.root,
            });
      this.unsubscribeFullscreen = this.fullscreen.onChange((a) => {
        this.setKeyboardLock(a);
        this.callbacks.onFullscreenChange?.(a);
      });
    } else {
      this.fullscreen = null;
      this.confinement = null;
      this.unsubscribeFullscreen = () => undefined;
    }
    this.input = new InputController(opts.canvas, keyTarget, {
      onAction: (a) => this.handleAction(a),
      onDragBox: (b) => this.callbacks.onDragBox?.(b),
      confinement: this.confinement,
      ...(opts.focusProbe !== undefined ? { focusProbe: opts.focusProbe } : {}),
      ...(opts.actionMap !== undefined ? { actionMap: opts.actionMap } : {}),
      ...(opts.edgePan !== undefined ? { edgePan: opts.edgePan } : {}),
    });
    this.syncViewport();
    this.setMap(map);
  }

  // ---- map (MS2) ------------------------------------------------------------------------------

  /**
   * Sets the map: renderer terrain (heightmap, water, light) + spot decals, camera bounds and
   * terrain following, heightmap picking.
   */
  setMap(map: ClientMap): void {
    this.map = map;
    this.renderer.setTerrain?.(map.toTerrainDesc());
    this.renderer.setTerrainDecals?.(map.spotDecals());
    this.bounds = map.bounds;
    this.terrainPicker = new TerrainPicker(map);
    this.cameraController.setTerrain(map, map.bounds);
    this.hover.valid = false;
    this.selection.mapSizeWU = map.sizeWu;
    this.selection.projection.invalidate();
    this.feedback.setHeightSource(map);
  }

  /**
   * Replaces the visual table (Blueprint HMR): renderer visuals, hit-test geometry, metric radii.
   */
  setVisuals(visuals: VisualTable): void {
    this.renderer.setVisuals(visuals);
    this.geometry = new VisualGeometry(visuals);
    this.selection.geometry = this.geometry;
    this.metrics.setVisualRadii(visualCornerRadii(visuals));
    this.feedback.invalidate();
  }

  /** Strategic zoom of the current camera on the current map (same formula as the renderer). */
  get zoom(): Readonly<StrategicZoom> {
    return strategicZoom(this.camera.distance, this.map.sizeWu, this.zoomState);
  }

  /** Map rectangle (raw) used for clamping. */
  get mapBounds(): MapBounds {
    return this.bounds;
  }

  /** Sim-exact terrain height (raw) at (x, z) raw. */
  heightAtRaw(xRaw: number, zRaw: number): number {
    return this.map.heightAtRaw(xRaw, zRaw);
  }

  /**
   * World point under the CSS pixel (x, y) like a right click picks it (terrain raymarch); null
   * above the horizon.
   */
  pickAt(cssX: number, cssY: number): WorldPick | null {
    this.syncViewport();
    return this.pick(cssX, cssY) ? { x: this.pickX, y: this.pickY, z: this.pickZ, hit: this.pickHit } : null;
  }

  /** Moves the camera focus to (x, z) raw (clamped), optionally with a zoom distance (WU). */
  jumpTo(xRaw: number, zRaw: number, distance?: number): void {
    this.cameraController.jumpTo(xRaw, zRaw, distance);
  }

  /**
   * `jumpToCommander` (KeyH): to the own unit with category COMMAND (MS5 ACU); until then to the
   * own start position of the map, else the map centre. Returns the target (raw).
   */
  jumpToCommander(): { x: number; z: number } {
    const r = this.lastFrame;
    const cv = this.commanderVisuals;
    if (r !== null && cv !== null) {
      for (let i = 0; i < r.unitCount; i++) {
        if (!isOwnUnit(r, i, this.playerArmy) || cv[r.unitVisual(i)] !== 1) continue;
        interpolatedPos(r, i, this.stream.lastAlpha, this.pos);
        this.jumpTo(this.pos[0]!, this.pos[2]!);
        return { x: this.pos[0]!, z: this.pos[2]! };
      }
    }
    const start = this.map.startOf(this.playerArmy);
    const b = this.bounds;
    const x = start !== null ? start.x : (b.minX + b.maxX) / 2;
    const z = start !== null ? start.z : (b.minZ + b.maxZ) / 2;
    this.jumpTo(x, z);
    return { x, z };
  }

  /** Toggles fullscreen (UI button / Alt+Enter). Resolves with the new state. */
  toggleFullscreen(): Promise<boolean> {
    return this.fullscreen === null ? Promise.resolve(false) : this.fullscreen.toggle();
  }

  private pickX = 0;
  private pickY = 0;
  private pickZ = 0;
  private pickHit = false;

  /** Picks into pickX/Y/Z (raw); false above the horizon. Allocation-free. */
  private pick(cssX: number, cssY: number): boolean {
    const tp = this.terrainPicker;
    if (!tp.pick(this.camera, cssX, cssY)) return false;
    this.pickX = tp.x;
    this.pickY = tp.y;
    this.pickZ = tp.z;
    this.pickHit = tp.hit;
    return true;
  }

  // ---- UI accessors ---------------------------------------------------------------------------

  /** Tick of the newest frame. */
  get tick(): number {
    return this.stream.tick;
  }

  /** Pause state as reported by the newest frame. */
  get paused(): boolean {
    return this.stream.paused;
  }

  /** Game speed multiplier from the newest frame (0.25–3). */
  get speed(): number {
    return this.stream.speedPermille / 1000;
  }

  /** Reader over the newest frame, or null before the first frame. */
  get lastFrame(): FrameReader | null {
    return this.stream.hasFrame ? this.stream.reader : null;
  }

  /** Sends a control message to the host. */
  sendCtl(msg: CtlMessage): void {
    if (msg.t === 'pause' || msg.t === 'resume') {
      this.pauseWanted = msg.t === 'pause';
      this.pauseWantedAt = this.nowFn();
    }
    this.link.sendCtl(msg);
  }

  /** Toggles pause (based on the requested state if a request is still in flight). */
  togglePause(): void {
    const cur = this.pauseWanted ?? this.stream.paused;
    this.sendCtl(cur ? { t: 'resume' } : { t: 'pause' });
  }

  /** Advances `ticks` ticks while paused; ignored when running. Returns true if sent. */
  step(ticks = 1): boolean {
    const paused = this.pauseWanted ?? this.stream.paused;
    if (!paused) return false;
    this.link.sendCtl({ t: 'step', ticks: Math.max(1, Math.floor(ticks)) });
    return true;
  }

  /** Sets the game speed (clamped by the host to 0.25–3). */
  setSpeed(speed: number): void {
    this.link.sendCtl({ t: 'speed', speed });
  }

  /** Handles of all own units in the newest frame (plain array, for UI/E2E). */
  ownHandles(): number[] {
    const out: number[] = [];
    const r = this.lastFrame;
    if (r === null) return out;
    for (let i = 0; i < r.unitCount; i++) if (isOwnUnit(r, i, this.playerArmy)) out.push(r.unitHandle(i));
    return out;
  }

  /** On-screen position (CSS px) of `handle` as currently displayed, or null if absent/behind. */
  unitScreenPos(handle: number): ScreenPos | null {
    const r = this.lastFrame;
    if (r === null) return null;
    const h = handle >>> 0;
    for (let i = 0; i < r.unitCount; i++) {
      if (r.unitHandle(i) !== h) continue;
      interpolatedPos(r, i, this.stream.lastAlpha, this.pos);
      this.syncViewport();
      if (!this.camera.project(this.pos[0]!, this.pos[1]!, this.pos[2]!, this.tmp)) return null;
      return { x: this.tmp[0]!, y: this.tmp[1]! };
    }
    return null;
  }

  /** Camera focus/zoom snapshot. */
  cameraState(): CameraState {
    return this.cameraController.state();
  }

  /** Metrics snapshot (plain object). */
  metricsSnapshot(): MetricsSnapshot {
    return this.metrics.snapshot();
  }

  /**
   * Programmatic move (E2E hooks, console): sends Move for `handles` (default: the selection) to
   * (x, z) raw with the same immediate feedback and measurement as a right click; `queue` = Shift.
   */
  moveTo(xRaw: number, zRaw: number, handles?: ArrayLike<number>, clickMs?: number, queue = false): number {
    const b = this.bounds;
    const x = Math.min(b.maxX, Math.max(b.minX, Math.round(xRaw)));
    const z = Math.min(b.maxZ, Math.max(b.minZ, Math.round(zRaw)));
    const units = handles ?? this.selection.selected();
    return this.issueMove(units, handles === undefined, x, z, queue, clickMs ?? this.nowFn());
  }

  /** Stop for the current selection. Returns the seq or −1. */
  stopSelected(): number {
    const units = this.selection.selected();
    this.feedback.targets.forget(units);
    this.feedback.invalidate();
    return this.commands.stop(units, this.nowFn());
  }

  /** Dev console: stamps (+1) / removes (−1) a footprint rectangle (cells = WU). Returns the seq. */
  footprint(cellX: number, cellZ: number, w: number, h: number, delta: 1 | -1): number {
    return this.commands.footprint(cellX, cellZ, w, h, delta, this.nowFn());
  }

  // ---- selection / control groups (C3, C7) ---------------------------------------------------

  /** Selects `handles` (replace or add); returns the new selection size. */
  select(handles: ArrayLike<number>, additive = false): number {
    this.selection.set(handles, additive);
    this.selectionChanged();
    return this.selection.count;
  }

  /** Selects every own unit. */
  selectAll(): number {
    this.selection.selectAll();
    this.selectionChanged();
    return this.selection.count;
  }

  /** Clears the selection. */
  clearSelection(): void {
    this.selection.clear();
    this.selectionChanged();
  }

  /** Selects every own unit of visual (= blueprint sim id) `visual`; returns the count. */
  selectVisual(visual: number, additive = false): number {
    this.selection.selectVisual(visual, additive);
    this.selectionChanged();
    return this.selection.count;
  }

  /**
   * Control group operation (C7): store / add the selection, recall (replace) / recallAdd (add to
   * the selection). A second recall of the same group within 350 ms centers the camera on the
   * group's centroid. Returns the group size after the operation.
   */
  controlGroup(op: ControlGroupOp, group: number, nowMs = this.nowFn()): number {
    const cg = this.controlGroups;
    let centered = false;
    switch (op) {
      case 'store':
        cg.store(group, this.selection.selected());
        break;
      case 'add':
        cg.add(group, this.selection.selected());
        break;
      case 'recall':
      case 'recallAdd': {
        const members = cg.get(group);
        if (members.length === 0) break;
        this.selection.set(members, op === 'recallAdd');
        this.selectionChanged();
        if (cg.tap(group, nowMs)) centered = this.centerOnGroup(group);
        break;
      }
    }
    const size = cg.size(group);
    this.callbacks.onControlGroup?.(op, group, size, centered);
    return size;
  }

  /** Moves the camera focus to the centroid (displayed positions) of control group `g`. */
  centerOnGroup(g: number): boolean {
    const r = this.lastFrame;
    if (r === null) return false;
    const members = this.controlGroups.get(g);
    const idx = this.selection.index;
    const alpha = this.stream.lastAlpha;
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let k = 0; k < members.length; k++) {
      const i = idx.get(members[k]!);
      if (i < 0) continue;
      interpolatedPos(r, i, alpha, this.pos);
      sx += this.pos[0]!;
      sz += this.pos[2]!;
      n++;
    }
    if (n === 0) return false;
    this.jumpTo(sx / n, sz / n);
    return true;
  }

  /** Handles currently sent as `ctl.watch` (plain array). */
  watchedHandles(): number[] {
    return this.watchSentN <= 0 ? [] : Array.from(this.watchSent.subarray(0, this.watchSentN));
  }

  /** Dev console: cheat-spawn (bp id, count, army, x/z/spread raw). Returns the seq. */
  spawn(bp: number, count: number, army: number, xRaw: number, zRaw: number, spreadRaw: number): number {
    return this.commands.spawn(bp, count, army, xRaw, zRaw, spreadRaw, this.nowFn());
  }

  /** Dev console: cheat-kill `handles` (default: the selection). Returns the seq or −1. */
  kill(handles?: ArrayLike<number>): number {
    return this.commands.kill(handles ?? this.selection.selected(), this.nowFn());
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  /** Starts the rAF loop. */
  start(): void {
    if (this.disposed) throw new Error('GameClient disposed');
    if (this.running) return;
    this.running = true;
    this.rafId = this.raf().request(this.loop);
  }

  /** Stops the loop (the client stays usable; `start()` resumes). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafId >= 0) this.raf().cancel(this.rafId);
    this.rafId = -1;
  }

  /** Stops the loop and detaches all listeners. The renderer and link are owned by the caller. */
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.input.dispose();
    this.confinement?.dispose();
    this.unsubscribeFullscreen();
    this.fullscreen?.dispose();
    this.unsubscribeHost();
    this.unsubscribeAck();
    this.setKeyboardLock(false);
  }

  /**
   * One rAF step (public for tests and custom loops). `rafTs` is the rAF timestamp.
   */
  frame(rafTs: number): void {
    const now = this.nowFn();
    const m = this.metrics;
    m.beginRaf(rafTs, now);
    const dt = Number.isNaN(this.lastNow) ? 0 : now - this.lastNow;
    this.lastNow = now;

    // Camera (independent of sim and pause): edge scan, keys, focus-height smoothing.
    this.syncViewport(false);
    const inp = this.input;
    inp.updateEdge(this.camera.viewportWidth, this.camera.viewportHeight);
    this.cameraController.update(dt, inp.panAxisX(now), inp.panAxisY(now), inp.edgeX, inp.edgeY);

    // Newest frame.
    const s = this.stream;
    if (s.poll(now)) this.onNewFrame(now);
    const alpha = s.alpha(now);

    this.expireMarkers(now);
    this.camera.update();
    this.feedback.update(s.hasFrame ? s.reader : null, s.frameCount, this.selection, this.geometry, alpha, this.camera, this.map.sizeWu);
    this.renderer.setDynamicDecals?.(this.feedback.decals);

    const v = this.view;
    if (s.hasFrame && !this.unitsHidden) {
      v.units.bytes = s.units();
      v.units.count = s.unitCount;
    } else {
      v.units.bytes = this.emptyUnits;
      v.units.count = 0;
    }
    v.units.version = s.frameCount;
    v.parts.bytes = s.parts();
    v.parts.count = s.partCount;
    v.parts.version = s.frameCount;
    this.updateHover();
    v.highlight = this.selection.highlight;
    v.highlightVersion = this.selection.highlightVersion;
    v.alpha = alpha;
    v.timeMs = now;
    this.renderer.render(v);

    const drawn = this.nowFn();
    m.onRendered(drawn, this.lastFrame, alpha, this.camera);
    m.endRaf(this.nowFn());
  }

  // ---- internals ------------------------------------------------------------------------------

  private raf(): RafLike {
    return this.rafImpl ?? defaultRaf();
  }

  /** Copies the canvas CSS size into the camera; `force` also recomputes the camera matrices. */
  private syncViewport(force = true): void {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    let changed = false;
    if (w !== undefined && h !== undefined && w > 0 && h > 0) {
      if (this.camera.viewportWidth !== w || this.camera.viewportHeight !== h) {
        this.camera.setViewport(w, h);
        changed = true;
      }
    }
    if (force || changed) this.camera.update();
  }

  private hoverPx = Number.NaN;
  private hoverPy = Number.NaN;
  private hoverCam = -1;
  private hoverMap: ClientMap | null = null;

  /** Terrain point under the cursor; re-picked only when the pointer, camera or map changed. */
  private updateHover(): void {
    const inp = this.input;
    const hv = this.hover;
    if (!inp.pointerInside && !inp.confined) {
      hv.valid = false;
      return;
    }
    const px = inp.pointerX;
    const py = inp.pointerY;
    const cam = this.camera;
    if (px === this.hoverPx && py === this.hoverPy && cam.version === this.hoverCam && this.map === this.hoverMap) return;
    this.hoverPx = px;
    this.hoverPy = py;
    this.hoverCam = cam.version;
    this.hoverMap = this.map;
    hv.valid = this.pick(px, py);
    if (hv.valid) {
      hv.x = this.pickX;
      hv.y = this.pickY;
      hv.z = this.pickZ;
      hv.hit = this.pickHit;
    }
  }

  private onNewFrame(now: number): void {
    const s = this.stream;
    const selVersion = this.selection.version;
    this.selection.onFrame(s.reader, s.frameCount);
    this.controlGroups.prune(this.selection.index, this.isOwnRecord);
    this.commands.acknowledge(s.ackSeq, now);
    // Optimistic lines/discs disappear once their command is confirmed (watch lines take over).
    this.feedback.acknowledge(s.ackSeq);
    if (this.selection.version !== selVersion) this.syncWatch();
    if (this.pauseWanted !== null && (s.paused === this.pauseWanted || now - this.pauseWantedAt > 1000)) {
      this.pauseWanted = null;
    }
    this.callbacks.onFrame?.(this);
  }

  private expireMarkers(now: number): void {
    const mk = this.markers;
    let w = 0;
    for (let i = 0; i < mk.length; i++) {
      const m = mk[i] as MutableMarker;
      if (now - m.startMs >= m.durationMs) {
        this.markerPool.push(m);
        continue;
      }
      mk[w++] = m;
    }
    mk.length = w;
  }

  private addMarker(x: number, z: number, now: number): void {
    let m = this.markerPool.pop();
    if (m === undefined) {
      // All markers alive: recycle the oldest.
      m = this.markers.shift() as MutableMarker;
    }
    m.x = x;
    m.y = this.heightAtRaw(x, z);
    m.z = z;
    m.startMs = now;
    m.color = this.markerColor;
    this.markers.push(m);
  }

  private issueMove(units: ArrayLike<number>, fromSelection: boolean, x: number, z: number, queue: boolean, clickMs: number): number {
    if (units.length === 0) return -1;
    const now = this.nowFn();
    const seq = this.commands.move(units, x, this.heightAtRaw(x, z), z, queue, now);
    this.addMarker(x, z, now);
    const fb = this.feedback;
    // Optimistic waypoint line: from the previous command target of the first unit (Shift queue) or
    // from the group's displayed centroid.
    const r = this.lastFrame;
    let started = false;
    if (queue && fb.targets.lastTargetOf(units[0]!, this.tmp2)) {
      const ax = this.tmp2[0]!;
      const az = this.tmp2[1]!;
      fb.addOptimistic(seq, ax, this.heightAtRaw(ax, az), az, x, z);
      started = true;
    }
    if (!started && r !== null) {
      const alpha = this.stream.lastAlpha;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let n = 0;
      if (fromSelection) {
        const sel = this.selection;
        for (let k = 0; k < sel.count; k++) {
          interpolatedPos(r, sel.indices[k]!, alpha, this.pos);
          sx += this.pos[0]!;
          sy += this.pos[1]!;
          sz += this.pos[2]!;
          n++;
        }
      } else {
        const idx = this.selection.index;
        for (let k = 0; k < units.length; k++) {
          const i = idx.get(units[k]!);
          if (i < 0) continue;
          interpolatedPos(r, i, alpha, this.pos);
          sx += this.pos[0]!;
          sy += this.pos[1]!;
          sz += this.pos[2]!;
          n++;
        }
      }
      if (n > 0) fb.addOptimistic(seq, sx / n, sy / n, sz / n, x, z);
    }
    fb.targets.add(seq, units, x, z, queue);
    this.metrics.beginClick(clickMs, seq, units, r, this.stream.lastAlpha);
    return seq;
  }

  /** Sends `ctl.watch` with the first 64 selected handles if that list changed. */
  private syncWatch(): void {
    const sel = this.selection;
    const n = Math.min(MAX_WATCH, sel.count);
    let same = n === this.watchSentN;
    for (let k = 0; same && k < n; k++) same = this.watchSent[k] === sel.handles[k];
    if (same) return;
    for (let k = 0; k < n; k++) this.watchSent[k] = sel.handles[k]!;
    this.watchSentN = n;
    this.watchMessages++;
    this.link.sendCtl({ t: 'watch', handles: Array.from(sel.handles.subarray(0, n)) });
  }

  /** After any selection change: watch list, UI callback. */
  private selectionChanged(): void {
    this.syncWatch();
    this.feedback.invalidate();
    this.callbacks.onSelectionChange?.(this.selection.count);
  }

  private setKeyboardLock(on: boolean): void {
    const kb = this.keyboardLock;
    if (kb === null || on === this.keyboardLocked) return;
    this.keyboardLocked = on;
    if (on) {
      kb.lock().catch(() => {
        this.keyboardLocked = false;
      });
    } else {
      try {
        kb.unlock();
      } catch {
        // not locked
      }
    }
  }

  private handleAction(a: Action): void {
    switch (a.type) {
      case 'grabStart':
        this.syncViewport();
        this.cameraController.grabStart(a.x, a.y);
        break;
      case 'pan':
        this.syncViewport();
        this.cameraController.grabMove(a.x, a.y, a.dxPx, a.dyPx);
        break;
      case 'grabEnd':
        this.cameraController.grabEnd();
        break;
      case 'rotate':
        this.cameraController.rotate(a.dxPx, a.dyPx);
        break;
      case 'resetCamera':
        this.cameraController.resetRotation();
        break;
      case 'jumpToCommander':
        this.jumpToCommander();
        break;
      case 'toggleFullscreen':
        void this.toggleFullscreen();
        break;
      case 'zoom':
        this.syncViewport();
        this.cameraController.zoomAt(a.steps, a.x, a.y);
        break;
      case 'boxSelect':
        this.syncViewport();
        this.selection.boxSelect(this.camera, this.stream.lastAlpha, a.x0, a.y0, a.x1, a.y1, a.additive);
        this.selectionChanged();
        break;
      case 'clickSelect':
        this.syncViewport();
        if (a.double) {
          // Double click: all own units of the clicked unit's type on screen (Shift adds).
          if (this.selection.selectSameType(this.camera, this.stream.lastAlpha, a.x, a.y, a.additive) < 0 && !a.additive) {
            this.selection.clickSelect(this.camera, this.stream.lastAlpha, a.x, a.y, false);
          }
        } else {
          this.selection.clickSelect(this.camera, this.stream.lastAlpha, a.x, a.y, a.additive);
        }
        this.selectionChanged();
        break;
      case 'selectAll':
        this.selectAll();
        break;
      case 'deselect':
        this.clearSelection();
        break;
      case 'controlGroup':
        this.controlGroup(a.op, a.group, a.timeStamp > 0 ? a.timeStamp : this.nowFn());
        break;
      case 'moveCommand': {
        this.syncViewport();
        if (!this.pick(a.x, a.y)) break;
        const clickMs = a.timeStamp > 0 ? a.timeStamp : this.nowFn();
        this.issueMove(this.selection.selected(), true, this.pickX, this.pickZ, a.queue, clickMs);
        break;
      }
      case 'stop':
        this.stopSelected();
        break;
      case 'togglePause':
        this.togglePause();
        break;
      case 'stepOnce':
        this.step(1);
        break;
      case 'toggleConsole':
        this.callbacks.onToggleConsole?.();
        break;
    }
    this.callbacks.onAction?.(a);
  }
}
