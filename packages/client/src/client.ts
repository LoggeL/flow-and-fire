/**
 * GameClient: main-thread game loop (MS1: S1, S3, A5, G14, SPK6 chain; MS2: map, C1, G15, G16, C11).
 *
 * Per requestAnimationFrame:
 *   edge scan + keyboard pan + focus-height smoothing → poll the newest frame (ack bookkeeping,
 *   selection/highlight rebuild) → alpha → hover pick → renderer.render (UnitRecords and the
 *   PartStream straight from the frame bytes, highlight, overlays) → metrics.
 *
 * Map (MS2): `setMap(clientMap)` sets the renderer terrain, the spot decals, the camera bounds and
 * terrain following and the heightmap raymarch picking (G15); click markers, waypoint lines and
 * the hover point sit on the terrain height. Without a map the client starts on the generated flat
 * test plane map (`ClientMap.testPlane()`), which takes exactly the same path.
 *
 * Input is handled in the DOM event handlers: a right click picks the ground, sends the Move
 * command and adds the click marker immediately, so the marker is drawn in the very next rAF.
 * A waypoint line from the group's centre to the target stays until the command's seq is
 * confirmed by an applied-sequence host notification or `FrameHeader.ackSeq`.
 *
 * Pause (A5): the sim tick stands still, but camera, input, selection and command sending keep
 * working; alpha is frozen at 1.
 *
 * The steady-state rAF path does not allocate: the render view, overlay arrays and marker objects
 * are reused, the unit bytes are a cached view into the transport's buffer.
 */
import type { CtlMessage, FrameReader, HostMessage } from '@faf/protocol';
import { UNIT_RECORD_BYTES, UNIT_OFF_HANDLE, UNIT_OFF_PREV_POS, UNIT_OFF_CUR_POS, UnitFlags } from '@faf/protocol';
import {
  RtsCamera,
  DynamicDecals,
  DEFAULT_ARMY_COLORS,
  type OverlayMarker,
  type OverlaySegment,
  type RenderStats,
  type RenderView,
  type TerrainDecal,
  type TerrainDesc,
  type UnitPartsView,
  type VisualTable,
} from '@faf/render';
import type { ActionMap } from './actions.ts';
import { RigPoseAdapter } from './rig-pose.ts';
import { MovePredictionAdapter, type MovePredictionMotion } from './move-prediction.ts';
import { CameraController, type CameraState } from './camera-controller.ts';
import { ControlGroups } from './control-groups.ts';
import { CommandBuilder, seqAcked } from './commands.ts';
import { FrameStream, type FrameStreamOptions } from './frames.ts';
import { FullscreenController, PointerConfinement, type FullscreenDocument, type FullscreenRoot, type LockableCanvas } from './fullscreen.ts';
import { InputController, type Action, type DragBox, type InputEventTarget, type InputSurface } from './input.ts';
import { ClientMap } from './map.ts';
import { ClientMetrics, type MetricsSnapshot } from './metrics.ts';
import type { MapBounds } from './picking.ts';
import { TerrainPicker } from './terrain-picker.ts';
import { interpolatedPos, isOwnUnit, Selection, type SelectionMode } from './selection.ts';
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
  setDynamicDecals?(decals: DynamicDecals): unknown;
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
  /** Selection changed by the player. */
  onSelectionChange?(count: number, mode: SelectionMode): void;
  /** Host message (ready, status, stats, log, error). */
  onHostMessage?(m: HostMessage): void;
  /** A new frame was accepted (called inside the rAF, before rendering). */
  onFrame?(client: GameClient): void;
  /** Every presentation frame after camera/frame updates, including a paused simulation. */
  onPresent?(client: GameClient, nowMs: number): void;
  /** Every input action, after the client handled it. */
  onAction?(a: Action): void;
  /** Fullscreen entered/left. */
  onFullscreenChange?(active: boolean): void;
}

export interface GameClientOptions {
  /** Replay clients permit viewing controls, but never emit simulation commands. */
  readonly readOnlyCommands?: boolean;
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
  /** Public compiled motion table enables bounded visual-only first-Move prediction (SPK6). */
  readonly movePrediction?: MovePredictionMotion;
  /** Click marker color (0xRRGGBB). */
  readonly markerColor?: number;
  /** Waypoint line color (0xRRGGBB). */
  readonly lineColor?: number;
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
const MAX_LINES = 32;
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

interface MutableSegment {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  color: number;
  widthWU: number;
}

interface MutableView {
  camera: RtsCamera;
  units: { bytes: Uint8Array; count: number; version: number };
  parts: UnitPartsView & { bytes: Uint8Array; count: number; version: number };
  highlight: Uint8Array;
  highlightVersion: number;
  alpha: number;
  overlays: { markers: OverlayMarker[]; lines: OverlaySegment[] };
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
  readonly readOnlyCommands: boolean;
  private actionInterceptor: ((action: Action) => boolean) | null = null;
  readonly camera: RtsCamera;
  readonly cameraController: CameraController;
  readonly selection: Selection;
  readonly controlGroups = new ControlGroups();
  readonly dynamicDecals = new DynamicDecals();
  showPaths = true;
  private watchVersion = 0;
  private inspectionTick = -1;
  private visuals: VisualTable;
  private readonly watchLines: MutableSegment[] = Array.from({ length: 2048 }, () => ({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, color: 0x40ff60, widthWU: 0.12 }));
  private readonly combinedLines: OverlaySegment[] = [];
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
  private readonly lineColor: number;
  private readonly unsubscribeHost: () => void;
  private readonly unsubscribeAck: () => void;
  private readonly unsubscribeIssued: () => void;
  private readonly movePredictionMotion: MovePredictionMotion | undefined;
  private readonly prediction = new MovePredictionAdapter();

  private readonly markerPool: MutableMarker[] = [];
  private readonly markers: OverlayMarker[] = [];
  private readonly linePool: MutableSegment[] = [];
  private readonly lines: OverlaySegment[] = [];
  private readonly lineSeqs: number[] = [];
  private readonly view: MutableView;
  private readonly emptyUnits = new Uint8Array(0);
  private readonly unsubscribeFullscreen: () => void;
  private readonly tmp = new Float64Array(4);
  private readonly pos = new Float64Array(3);

  private rafId = -1;
  private readonly rig = new RigPoseAdapter();
  private rigDirty = true;
  private running = false;
  private disposed = false;
  private lastNow = Number.NaN;
  private presentationCap: 30 | 60 | 120 | 'monitor' = 'monitor';
  private lastPresentedMs = Number.NaN;
  private presentationRequested = false;
  private pauseWanted: boolean | null = null;
  private pauseWantedAt = 0;
  private readonly loop = (ts: number): void => {
    if (!this.running) return;
    this.rafId = this.raf().request(this.loop);
    this.frame(ts);
  };

  constructor(opts: GameClientOptions) {
    this.readOnlyCommands = opts.readOnlyCommands ?? false;
    this.movePredictionMotion = opts.movePrediction;
    this.canvas = opts.canvas;
    this.renderer = opts.renderer;
    this.link = opts.link;
    this.playerArmy = opts.playerArmy;
    this.callbacks = opts.callbacks ?? {};
    this.rafImpl = opts.raf;
    this.nowFn = opts.now ?? (() => performance.now());
    const team = DEFAULT_ARMY_COLORS[(opts.playerArmy < 0 ? 0 : opts.playerArmy) % DEFAULT_ARMY_COLORS.length]!;
    this.markerColor = opts.markerColor ?? ((Math.round(team[0] * 255) << 16) | (Math.round(team[1] * 255) << 8) | Math.round(team[2] * 255));
    this.lineColor = opts.lineColor ?? 0x40ff60;

    const map = opts.map ?? ClientMap.testPlane();
    this.map = map;
    this.bounds = map.bounds;
    this.terrainPicker = new TerrainPicker(map);
    this.camera = opts.camera ?? new RtsCamera();
    this.cameraController = new CameraController(this.camera, { bounds: map.bounds, terrain: map });
    if (opts.camera === undefined) this.cameraController.centerOnMap();
    this.commanderVisuals = opts.commanderVisuals ?? null;
    this.selection = new Selection(opts.playerArmy);
    this.visuals = opts.visuals;
    this.selection.visuals = opts.visuals;
    this.commands = new CommandBuilder(opts.link, opts.playerArmy, this.readOnlyCommands);
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
    this.unsubscribeIssued = this.commands.onIssued((seq, op, flags, units, payload, now) => {
      this.prediction.issued(op, flags, units, payload, seq, now, this.lastFrame, this.stream.lastAlpha,
        this.playerArmy, this.movePredictionMotion, this.pauseWanted === true || this.paused);
    });

    for (let i = 0; i < MAX_MARKERS; i++) {
      this.markerPool.push({ x: 0, y: 0, z: 0, startMs: 0, color: this.markerColor, radiusWU: MARKER_RADIUS_WU, durationMs: MARKER_DURATION_MS });
    }
    for (let i = 0; i < MAX_LINES; i++) {
      this.linePool.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, color: this.lineColor, widthWU: 0.18 });
    }
    this.view = {
      camera: this.camera,
      units: { bytes: this.emptyUnits, count: 0, version: 0 },
      highlight: this.selection.highlight,
      highlightVersion: 0,
      alpha: 1,
      parts: { bytes: this.emptyUnits, count: 0, version: 0 },
      overlays: { markers: this.markers, lines: this.lines },
      timeMs: 0,
    };

    this.renderer.setVisuals(opts.visuals);
    this.unsubscribeHost = opts.link.onHostMessage((m) => {
      this.lastHostMessage = m;
      if (m.t === 'ready' || m.t === 'error') { this.rig.reset(); this.rigDirty = true; }
      if (m.t === 'ack' && m.army === this.playerArmy) this.onAppliedAck(m.ackSeq, this.nowFn());
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
        const keyboard = (globalThis.navigator as Navigator & { keyboard?: { lock(keys: string[]): Promise<void>; unlock(): void } } | undefined)?.keyboard;
        if (a) void keyboard?.lock(['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']).catch(() => undefined);
        else keyboard?.unlock();
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
    this.prediction.reset();
    this.rig.reset();
    this.rigDirty = true;
    this.map = map;
    this.selection.mapSizeWu = map.sizeWu;
    this.renderer.setTerrain?.(map.toTerrainDesc());
    this.renderer.setTerrainDecals?.(map.spotDecals());
    this.bounds = map.bounds;
    this.terrainPicker = new TerrainPicker(map);
    this.cameraController.setTerrain(map, map.bounds);
    this.hover.valid = false;
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
        if (!isOwnUnit(r, i, this.viewArmy) || cv[r.unitVisual(i)] !== 1) continue;
        interpolatedPos(r, i, this.stream.lastAlpha, this.pos);
        this.jumpTo(this.pos[0]!, this.pos[2]!);
        return { x: this.pos[0]!, z: this.pos[2]! };
      }
    }
    const start = this.map.startOf(this.viewArmy);
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

  /** Replay inspection follows only the accepted perspective; command identity never changes. */
  get viewArmy(): number {
    return this.readOnlyCommands ? this.lastFrame?.viewer ?? this.playerArmy : this.playerArmy;
  }

  /** Sends a control message to the host. */
  sendCtl(msg: CtlMessage): void {
    if (this.readOnlyCommands && !['pause', 'resume', 'step', 'speed', 'watch', 'exportLog'].includes(msg.t)) return;
    if (msg.t === 'pause' || msg.t === 'resume' || msg.t === 'speed') this.prediction.reset();
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
    for (let i = 0; i < r.unitCount; i++) if (isOwnUnit(r, i, this.viewArmy)) out.push(r.unitHandle(i));
    return out;
  }

  /** On-screen position (CSS px) of `handle` as currently displayed, or null if absent/behind. */
  unitScreenPos(handle: number): ScreenPos | null {
    const r = this.lastFrame;
    if (r === null) return null;
    const h = handle >>> 0;
    for (let i = 0; i < r.unitCount; i++) {
      if (r.unitHandle(i) !== h) continue;
      const drawn = this.prediction.rendered;
      if (drawn.byteLength >= (i + 1) * UNIT_RECORD_BYTES && drawn.getUint32(i * UNIT_RECORD_BYTES + UNIT_OFF_HANDLE, true) === h) {
        const a = (r.unitFlags(i) & UnitFlags.NoInterp) !== 0 ? 1 : this.stream.lastAlpha;
        for (let c = 0; c < 3; c++) {
          const prev = drawn.getInt32(i * UNIT_RECORD_BYTES + UNIT_OFF_PREV_POS + c * 4, true);
          const cur = drawn.getInt32(i * UNIT_RECORD_BYTES + UNIT_OFF_CUR_POS + c * 4, true);
          this.pos[c] = prev + (cur - prev) * a;
        }
      } else interpolatedPos(r, i, this.stream.lastAlpha, this.pos);
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
   * (x, z) raw with the same immediate feedback and measurement as a right click.
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
    return this.commands.stop(this.selection.selected(), this.nowFn());
  }

  /** Dev console: cheat-spawn (bp id, count, army, x/z/spread raw). Returns the seq. */
  spawn(bp: number, count: number, army: number, xRaw: number, zRaw: number, spreadRaw: number): number {
    return this.commands.spawn(bp, count, army, xRaw, zRaw, spreadRaw, this.nowFn());
  }

  /** Dev console: cheat-kill `handles` (default: the selection). Returns the seq or −1. */
  kill(handles?: ArrayLike<number>): number {
    return this.commands.kill(handles ?? this.selection.selected(), this.nowFn());
  }

  /** Limits GPU presentation only; frame polling, acknowledgements and input still run every rAF. */
  setFrameCap(cap: 30 | 60 | 120 | 'monitor'): boolean {
    if (this.disposed || (cap !== 'monitor' && cap !== 30 && cap !== 60 && cap !== 120)) return false;
    this.presentationCap = cap;
    return true;
  }

  get frameCap(): 30 | 60 | 120 | 'monitor' { return this.presentationCap; }

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
    this.prediction.reset();
    this.rig.reset();
    this.rigDirty = true;
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
    this.unsubscribeIssued();
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
    const newFrame = s.poll(now);
    if (newFrame) this.onNewFrame(now);
    const alpha = s.alpha(now);

    this.expireMarkers(now);

    const v = this.view;
    if (s.hasFrame) {
      if (newFrame || this.rigDirty) {
        this.rig.update(s.reader, s.units(), s.parts(), this.visuals);
        this.rigDirty = false;
      }
      v.units.bytes = this.rig.units;
      v.units.count = s.unitCount;
    } else {
      this.prediction.reset();
      this.rig.reset();
      this.rigDirty = true;
      v.units.bytes = this.emptyUnits;
      v.units.count = 0;
    }
    v.units.version = this.rig.version;
    v.parts.bytes = s.hasFrame ? this.rig.parts : this.emptyUnits;
    v.parts.count = s.hasFrame ? this.rig.partCount : 0;
    v.parts.version = this.rig.version;
    this.updateHover();
    v.highlight = this.selection.highlight;
    v.highlightVersion = this.selection.highlightVersion;
    v.alpha = alpha;
    v.timeMs = now;
    this.syncSelection();
    this.updateOrdersAndDecals(alpha);
    this.callbacks.onPresent?.(this, now);
    v.overlays.lines = this.combinedLines;
    const interval = this.presentationCap === 'monitor' ? 0 : 1000 / this.presentationCap;
    if (!newFrame && !this.presentationRequested && Number.isFinite(this.lastPresentedMs) && now - this.lastPresentedMs + 1e-6 < interval) {
      m.endRaf(this.nowFn());
      return;
    }
    this.presentationRequested = false;
    this.lastPresentedMs = now;
    if (s.hasFrame) {
      this.prediction.update(s.reader, this.rig.units, this.rig.parts, alpha, now, newFrame,
        this.movePredictionMotion, this.map, this.visuals, this.pauseWanted === true || s.paused);
      v.units.bytes = this.prediction.units;
      v.parts.bytes = this.prediction.parts;
      v.units.version = v.parts.version = this.rig.version + this.prediction.version;
    }
    this.renderer.render(v);

    const drawn = this.nowFn();
    m.onRendered(drawn, this.lastFrame, alpha, this.camera, this.prediction.rendered);
    m.endRaf(this.nowFn());
  }

  // ---- internals ------------------------------------------------------------------------------

  setVisuals(visuals: VisualTable): void {
    this.prediction.reset();
    this.rig.reset();
    this.rigDirty = true;
    this.presentationRequested = true;
    this.visuals = visuals;
    this.selection.visuals = visuals;
    this.metrics.setVisualRadii(visualCornerRadii(visuals));
    this.renderer.setVisuals(visuals);
  }

  /** Actual render-pose diagnostics, derived solely from the accepted visible frame. */
  rigPose(handle: number): ReturnType<RigPoseAdapter['inspect']> {
    const f = this.lastFrame;
    return f === null ? null : this.rig.inspect(f, handle, this.stream.lastAlpha);
  }

  get rigPoseStats(): Readonly<RigPoseAdapter['stats']> { return this.rig.stats; }

  /** Updates the worker watch list only when the selection changes. */
  syncSelection(): void {
    if (this.watchVersion === this.selection.version) return;
    this.watchVersion = this.selection.version;
    this.sendCtl({ t: 'watch', handles: Array.from(this.selection.handles.subarray(0, Math.min(64, this.selection.count))) });
    this.callbacks.onSelectionChange?.(this.selection.count, this.selection.mode);
  }

  private updateOrdersAndDecals(alpha: number): void {
    const r = this.lastFrame;
    const d = this.dynamicDecals;
    d.clear();
    this.combinedLines.length = 0;
    for (let i = 0; i < this.lines.length; i++) this.combinedLines.push(this.lines[i]!);
    if (r === null) return;
    const sel = this.selection;
    for (let k = 0; k < sel.count; k++) {
      const i = sel.indices[k]!;
      interpolatedPos(r, i, alpha, this.pos);
      d.ring(this.pos[0]!, this.pos[2]!, this.visuals[r.unitVisual(i)]?.selectionRadius ?? 0.7, this.markerColor);
    }
    let n = 0;
    if (this.showPaths) for (let w = 0; w < r.watchCount; w++) {
      const h = r.watchHandle(w);
      if (!sel.has(h)) continue;
      let index = -1;
      for (let k = 0; k < sel.count; k++) if (sel.handles[k] === h) { index = sel.indices[k]!; break; }
      if (index < 0) continue;
      interpolatedPos(r, index, alpha, this.pos);
      let x = this.pos[0]!; let z = this.pos[2]!;
      const points = r.watchPointCount(w);
      const targets = r.watchTargetCount(w);
      for (let k = 0; k < points + targets; k++) {
        const point = k < points;
        const q = k - points;
        const tx = point ? r.watchPointX(w, k) : r.watchTargetX(w, q);
        const tz = point ? r.watchPointZ(w, k) : r.watchTargetZ(w, q);
        if (n < this.watchLines.length) {
          const line = this.watchLines[n++]!;
          line.ax = x; line.ay = this.heightAtRaw(x, z); line.az = z;
          line.bx = tx; line.by = this.heightAtRaw(tx, tz); line.bz = tz;
          this.combinedLines.push(line);
        }
        if (!point) d.disc(tx, tz, 0.6, this.markerColor, 0.7);
        x = tx; z = tz;
      }
    }
    this.renderer.setDynamicDecals?.(d);
  }

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
    const army = this.viewArmy;
    if (this.readOnlyCommands && (army !== this.selection.playerArmy || s.reader.tick < this.inspectionTick)) {
      this.selection.playerArmy = army;
      this.selection.clear();
    }
    this.inspectionTick = s.reader.tick;
    this.selection.onFrame(s.reader);
    this.controlGroups.prune(s.reader, army);
    this.onAppliedAck(s.ackSeq, now);
    if (this.pauseWanted !== null && (s.paused === this.pauseWanted || now - this.pauseWantedAt > 1000)) {
      this.pauseWanted = null;
    }
    this.callbacks.onFrame?.(this);
  }

  /** Applied sequence from a committed tick, received directly or through the frame fallback. */
  private onAppliedAck(ackSeq: number, now: number): void {
    // Zero means no command; observers use 0xffffffff. Commands reserve sequence zero.
    if (!Number.isInteger(ackSeq) || ackSeq <= 0 || ackSeq > 0xffff) return;
    const last = this.commands.lastAckSeq;
    if (last !== 0 && !seqAcked(ackSeq, last)) return;
    const confirmed = this.commands.acknowledge(ackSeq, now);
    // Waypoint lines disappear once their command is confirmed.
    const ack = ackSeq;
    let w = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const seq = this.lineSeqs[i]!;
      if (seqAcked(ack, seq)) {
        this.linePool.push(this.lines[i] as MutableSegment);
        continue;
      }
      this.lines[w] = this.lines[i]!;
      this.lineSeqs[w] = seq;
      w++;
    }
    this.lines.length = w;
    this.lineSeqs.length = w;
    if (confirmed > 0) this.presentationRequested = true;
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

  private addLine(seq: number, ax: number, ay: number, az: number, bx: number, bz: number): void {
    let l = this.linePool.pop();
    if (l === undefined) {
      l = this.lines.shift() as MutableSegment;
      this.lineSeqs.shift();
    }
    l.ax = ax;
    l.ay = ay;
    l.az = az;
    l.bx = bx;
    l.by = this.heightAtRaw(bx, bz);
    l.bz = bz;
    l.color = this.lineColor;
    this.lines.push(l);
    this.lineSeqs.push(seq);
  }

  private issueMove(units: ArrayLike<number>, fromSelection: boolean, x: number, z: number, queue: boolean, clickMs: number): number {
    if (units.length === 0) return -1;
    this.presentationRequested = true;
    const now = this.nowFn();
    const seq = this.commands.move(units, x, this.heightAtRaw(x, z), z, queue, now);
    if (seq < 0) return seq;
    this.addMarker(x, z, now);
    // Waypoint line from the group's displayed centre.
    const r = this.lastFrame;
    if (r !== null) {
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
        const wanted = new Set<number>();
        for (let k = 0; k < units.length; k++) wanted.add(units[k]! >>> 0);
        for (let i = 0; i < r.unitCount; i++) {
          if (!wanted.has(r.unitHandle(i))) continue;
          interpolatedPos(r, i, alpha, this.pos);
          sx += this.pos[0]!;
          sy += this.pos[1]!;
          sz += this.pos[2]!;
          n++;
        }
      }
      if (n > 0) this.addLine(seq, Math.round(sx / n), Math.round(sy / n), Math.round(sz / n), x, z);
    }
    this.metrics.beginClick(clickMs, seq, units, r, this.stream.lastAlpha, this.prediction.rendered);
    return seq;
  }

  private handleAction(a: Action): void {
    this.presentationRequested = true;
    if (this.actionInterceptor?.(a)) return;
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
        this.callbacks.onSelectionChange?.(this.selection.count, this.selection.mode);
        break;
      case 'clickSelect':
        this.syncViewport();
        this.selection.clickSelect(this.camera, this.stream.lastAlpha, a.x, a.y, a.additive);
        this.callbacks.onSelectionChange?.(this.selection.count, this.selection.mode);
        break;
      case 'doubleClickSelect': {
        const h = this.selection.clickSelect(this.camera, this.stream.lastAlpha, a.x, a.y, false);
        if (h >= 0) this.selection.selectTypeOnScreen(this.camera, this.stream.lastAlpha, h, a.additive);
        break;
      }
      case 'clearSelection':
        this.selection.clear();
        break;
      case 'controlGroup': {
        if (a.save) this.controlGroups.save(a.slot, this.selection.selected(), a.additive);
        else {
          const center = this.controlGroups.recall(a.slot, this.selection, this.lastFrame, a.additive, a.timeStamp);
          if (center !== null) this.jumpTo(center.x, center.z);
        }
        break;
      }
      case 'selectAll':
        this.selection.selectAll();
        this.callbacks.onSelectionChange?.(this.selection.count, this.selection.mode);
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
    this.syncSelection();
    this.callbacks.onAction?.(a);
  }

  /** HUD world modes can consume targeting clicks before selection/movement. */
  setActionInterceptor(interceptor: ((action: Action) => boolean) | null): void {
    this.actionInterceptor = interceptor;
  }

  /** UI selection commands use the same highlight/watch publication as mouse selection. */
  selectHandles(handles: ArrayLike<number>, additive = false): void {
    this.presentationRequested = true;
    this.selection.set(handles, additive);
    this.syncSelection();
    this.callbacks.onSelectionChange?.(this.selection.count, this.selection.mode);
  }
}
