import { DEFAULT_SETTINGS, validateSettings, type SettingKey, type SettingsValues, type SkirmishConfig } from '@faf/hud';
/**
 * Game session (MS1 + MS2): sim worker + frame transport + renderer + GameClient on a map, the
 * dev-console API and the state behind the E2E test hooks. UI state is exposed as Preact signals.
 *
 * Boot (see main.tsx): the assets arrive from the AssetManager (sim.bin, view.json, the `.rtsmap`,
 * the pipeline's models) → visual table (glTF LOD meshes where `view.mesh` has a model, else
 * placeholders) → renderer with the `?preset=` → GameClient with the ClientMap (terrain, water,
 * spot decals, heightmap picking, terrain-following camera, fullscreen root) → `init` with a
 * transferred copy of the map bytes → on `ready` the start armies are spawned by cheat commands
 * through the normal command pipeline (S8): own cubes around the own map start, the second army
 * around its start (both on land), plus the flight-test units of `?units=` over the whole map.
 * The camera starts at the own start position.
 */
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import {
  ClientMap,
  GameClient,
  RAW_PER_WU,
  commanderVisuals,
  createRenderer,
  strategicZoom,
  type DragBox,
  type IconAtlasMetrics,
  type MetricsSnapshot,
  type ModelLookup,
  type RenderPresetName,
  type Renderer,
} from '@faf/client';
import {
  DEFAULT_FRAME_CAPS,
  Op,
  decodeBatch,
  decodeMove,
  frameCapacityBytes,
  type CtlMessage,
  type HostMessage,
  type TransportKind,
} from '@faf/protocol';
import type { HostInitMessage, HostReadyMsg, HostStatsMsg, HostStatusMsg } from '@faf/sim-host';
import { signal } from '@preact/signals';
import { flightClusters, spawnSpreadWU, startLayout, visualsFromViewJson, type StartLayout } from './content.ts';
import { runConsoleCommand, type ConsoleApi, type ConsoleResult } from './console-commands.ts';
import { FrameHasher, type FrameFingerprint } from './frame-hash.ts';
import { MAX_CUBES_PER_ARMY, chooseTransport, type GameParams } from './params.ts';
import { WorkerSimLink, type WorkerLike } from './worker-link.ts';
import { installGameAudio, GAME_AUDIO_EVENT_TYPES, listenerFromCamera, type GameAudioBridge } from './audio/index.ts';
import { installGameFx, type GameFx } from './fx/index.ts';
import { postOptionsForPreset } from '@faf/render-fx';
import { storedSettings } from './session-settings.ts';
import { FrameVisibility } from './visibility.ts';
import { isReplayStartupCompatibilityNotice } from './replay/startup-failure.ts';

/** Army of the local player. */
export const PLAYER_ARMY = 0;
/** Second (passive) army. */
export const ENEMY_ARMY = 1;
/** Armies in the session: the player and one passive second army. */
export const ARMY_COUNT = 2;
/** Initial camera distance (WU): the whole start army is in view. */
export const START_CAMERA_DISTANCE = 105;

export interface HudCursor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hit: boolean;
}

export interface HudState {
  tick: number;
  paused: boolean;
  speed: number;
  fps: number;
  simP95Ms: number | null;
  mainJsP95Ms: number | null;
  transport: TransportKind;
  simId: number | null;
  buildHash: string;
  units: number;
  selected: number;
  contextLost: boolean;
  ready: boolean;
  /** Map name (META name, or 'testplane'). */
  mapName: string;
  mapSimHash: number | null;
  /** Terrain point under the cursor (WU), null when the pointer is outside. */
  cursor: HudCursor | null;
  preset: RenderPresetName;
  fullscreen: boolean;
  zoom: number;
  tainted: boolean;
  simHash: number | null;
  hmrError: string | null;
}

export interface ConsoleLine {
  readonly id: number;
  readonly kind: 'in' | 'out' | 'err';
  readonly text: string;
}

export interface GameAssets {
  /** sim.bin bytes (a private copy is transferred to the worker). */
  readonly simBin: ArrayBuffer;
  /** view.json text. */
  readonly viewJson: string;
  /** Pipeline models (LOD meshes) by `view.mesh` id. */
  readonly models?: ModelLookup;
  /** `.rtsmap` bytes of the session map (the test plane is a generated map, see loading.ts). */
  readonly mapBytes: Uint8Array;
  readonly iconAtlas?: { readonly pixels: Uint8Array; readonly metrics: IconAtlasMetrics };
}

export interface GameOptions {
  readonly canvas: HTMLCanvasElement;
  readonly params: GameParams;
  readonly buildHash: string;
  readonly assets: GameAssets;
  /** Creates the sim worker. */
  readonly createWorker: () => WorkerLike;
  /** Element that goes fullscreen (contains canvas + UI overlay); omitted = no fullscreen. */
  readonly root?: HTMLElement;
  /** Replay sessions render recorded commands and never spawn or issue new simulation orders. */
  readonly replayMode?: boolean;
  /** Genuine deterministic starting state; omitted for the legacy movement sandbox. */
  readonly initialization?: HostInitMessage['initialization'];
  /** Replay identity comes from the recording, including observer sessions. */
  readonly playerArmy?: number;
  readonly armyCount?: number;
  readonly skirmishConfig?: SkirmishConfig;
}

/** Last Move command target sent to the sim (E2E: right-click target == pick). */
export interface MoveTarget {
  readonly seq: number;
  readonly units: number;
  /** Raw Q20.12. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function hex32(v: number): string {
  return '0x' + (v >>> 0).toString(16).padStart(8, '0');
}

const fmtWU = (raw: number): string => (raw / RAW_PER_WU).toFixed(1);

export class Game {
  readonly params: GameParams;
  readonly replayMode: boolean;
  readonly skirmish: boolean;
  readonly skirmishConfig: SkirmishConfig | undefined;
  readonly playerArmy: number;
  /** Effective simulation capacity; configurable match caps are supplied by recorded setup. */
  readonly unitCap: number;
  readonly buildHash: string;
  readonly transport: TransportKind;
  readonly transportNote: string | null;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly link: WorkerSimLink;
  readonly client: GameClient;
  readonly audio: GameAudioBridge;
  readonly fx: GameFx;
  readonly visibility = new FrameVisibility(true);
  private settings: SettingsValues = DEFAULT_SETTINGS;
  get runtimeSettings(): SettingsValues { return { ...this.settings, ...this.audio.hudSettings() }; }
  readonly result = signal<{ readonly verdict: 'victory' | 'defeat' | 'draw'; readonly durationS: number } | null>(null);
  private readonly audioListener = { focusX: 0, focusZ: 0, height: 1, viewHalfWidth: 1, rightX: 1, rightZ: 0 };
  bp: SimBpTable;
  readonly hmr: { changedAt: number; appliedAt: number | null; elapsedMs: number | null; error: string | null; reloads: number } = { changedAt: 0, appliedAt: null, elapsedMs: null, error: null, reloads: 0 };
  private pendingReload: { bp: SimBpTable; view: string; changedAt: number } | null = null;
  readonly cubeBp: number;
  /** Map of the session (null = flat test plane) and its bytes as loaded. */
  readonly map: ClientMap;
  readonly mapBytes: Uint8Array;
  readonly layout: StartLayout;

  // ---- UI state (signals) ----
  readonly hud = signal<HudState>({
    tick: 0,
    paused: false,
    speed: 1,
    fps: 0,
    simP95Ms: null,
    mainJsP95Ms: null,
    transport: 'transfer',
    simId: null,
    buildHash: '',
    units: 0,
    selected: 0,
    contextLost: false,
    ready: false,
    mapName: 'testplane',
    mapSimHash: null,
    cursor: null,
    preset: 'medium',
    fullscreen: false,
    zoom: 0,
    tainted: false,
    simHash: null,
    hmrError: null,
  });
  readonly consoleOpen = signal(false);
  readonly consoleLines = signal<readonly ConsoleLine[]>([]);
  readonly budgetOpen = signal(false);
  readonly stats = signal<HostStatsMsg | null>(null);
  readonly status = signal<HostStatusMsg | null>(null);
  readonly dragBox = signal<DragBox | null>(null);
  readonly fatal = signal<string | null>(null);

  // ---- session state ----
  ready: HostReadyMsg | null = null;
  /** performance.now() when `init` was posted / `ready` arrived. */
  readonly initAtMs: number;
  readyAtMs: number | null = null;
  readonly hostErrors: string[] = [];
  readonly consoleApi: ConsoleApi;
  /** Last Move command sent (decoded from the command batch; E2E). */
  lastMove: MoveTarget | null = null;
  private readonly hasher = new FrameHasher();
  private recordHashes = false;
  private readonly hashByTick: (number | undefined)[] = [];
  private lineId = 0;
  private autoPaused = false;
  private hudTimer: ReturnType<typeof setInterval> | null = null;
  private readyWaiters: ((m: HostReadyMsg) => void)[] = [];
  private failWaiters: ((e: Error) => void)[] = [];
  private startupFailure: Error | null = null;
  private logWaiters: { resolve: (bytes: ArrayBuffer) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private readonly onVisibility = (): void => this.handleVisibility();
  private disposed = false;

  constructor(opts: GameOptions) {
    this.params = opts.params;
    this.replayMode = opts.replayMode === true;
    this.skirmishConfig = opts.skirmishConfig;
    this.skirmish = opts.initialization?.kind === 'skirmish';
    this.playerArmy = opts.playerArmy ?? PLAYER_ARMY;
    this.unitCap = opts.initialization?.rules?.unitCap ?? MAX_CUBES_PER_ARMY;
    this.buildHash = opts.buildHash;
    this.canvas = opts.canvas;
    const isolated = globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function';
    const choice = chooseTransport(opts.params.transport, isolated);
    this.transport = choice.kind;
    this.transportNote = choice.note;

    this.bp = decodeSimBin(new Uint8Array(opts.assets.simBin));
    const cube = this.bp.indexOf('core:cube');
    if (cube < 0) throw new Error("sim.bin has no 'core:cube'");
    this.cubeBp = cube;
    const visuals = visualsFromViewJson(opts.assets.viewJson, opts.assets.models);

    const mapBytes = opts.assets.mapBytes;
    this.mapBytes = mapBytes;
    this.map = ClientMap.fromBytes(mapBytes);
    const layout = startLayout(this.map, Math.max(0, this.playerArmy), this.playerArmy === ENEMY_ARMY ? PLAYER_ARMY : ENEMY_ARMY);
    const startIndex = opts.initialization?.slots?.[this.playerArmy]?.start;
    const start = startIndex === undefined ? undefined : this.map.starts[startIndex];
    this.layout = start === undefined ? layout : { ...layout, own: { x: start.x, z: start.z } };

    const capacity = frameCapacityBytes(DEFAULT_FRAME_CAPS);
    this.link = new WorkerSimLink(opts.createWorker(), this.transport, capacity);
    this.link.onCommandBatch = (batch) => this.tapCommands(batch);
    this.renderer = createRenderer(opts.canvas, { clearColor: [0.043, 0.059, 0.078], preset: opts.params.preset });
    if (opts.assets.iconAtlas !== undefined) {
      const { pixels, metrics } = opts.assets.iconAtlas;
      this.renderer.setIconAtlas(pixels, metrics.width, metrics.height, metrics);
    }
    this.client = new GameClient({
      canvas: opts.canvas,
      renderer: this.renderer,
      link: this.link,
      visuals,
      playerArmy: this.playerArmy,
      readOnlyCommands: this.replayMode,
      movePrediction: this.bp,
      map: this.map,
      commanderVisuals: commanderVisuals(this.bp),
      ...(opts.root !== undefined ? { fullscreen: { root: opts.root, doc: document } } : {}),
      callbacks: {
        onToggleConsole: () => this.toggleConsole(),
        onDragBox: (b) => {
          this.dragBox.value = b === null ? null : { ...b };
        },
        onHostMessage: (m) => this.onHostMessage(m),
        onFrame: () => this.onFrame(),
        onPresent: (client, now) => this.audio.update(listenerFromCamera(client.camera, this.audioListener), now),
        onSelectionChange: (count) => this.audio.select(count),
        onFullscreenChange: () => this.refreshHud(),
      },
    });
    this.client.jumpTo(this.layout.own.x, this.layout.own.z, START_CAMERA_DISTANCE);
    this.audio = installGameAudio({ gestureTarget: document, playerArmy: this.playerArmy,
      replayMode: this.replayMode, eventTypes: GAME_AUDIO_EVENT_TYPES, visualName: visual => this.bp.weaponIds[visual] });
    this.fx = installGameFx({ renderer: this.renderer, getFrame: () => this.client.lastFrame,
      weaponIds: this.bp.weaponIds, projectileIds: this.bp.projectileIds,
      groundHeightRaw: (x, z) => this.client.heightAtRaw(x, z) });
    const savedSettings = storedSettings();
    this.settings = { ...DEFAULT_SETTINGS, renderScale: this.renderer.preset.renderScale,
      splatLayers: this.renderer.preset.splatLayers, shadowCascades: opts.params.preset === 'high' || opts.params.preset === 'ultra' ? 2 : 0,
      ...this.audio.hudSettings(), ...(savedSettings ?? {}), preset: opts.params.preset };
    this.settings = { ...this.settings, splatLayers: this.settings.splatLayers === 2 ? 4 : this.settings.splatLayers,
      shadowCascades: this.settings.shadowCascades === 3 ? 2 : this.settings.shadowCascades,
      antialias: this.settings.antialias === 'msaa4' ? 'fxaa' : this.settings.antialias };
    for (const key of ['renderScale', 'splatLayers', 'shadowCascades', 'bloom', 'antialias', 'cameraShake', 'particleCap', 'frameCap'] as const) this.applySetting(key, this.settings[key]);
    if (savedSettings !== null) for (const key of ['volMaster', 'volSfx', 'volVoice', 'volUi', 'volMusic', 'volAmbient', 'alertVoice', 'audibleStall', 'audioInBackground'] as const) this.applySetting(key, this.settings[key]);

    this.consoleApi = this.createConsoleApi();
    this.hud.value = {
      ...this.hud.value,
      transport: this.transport,
      buildHash: this.buildHash,
      mapName: this.map.name,
      preset: this.renderer.preset.name,
    };

    const simBinCopy = opts.assets.simBin.slice(0);
    const transfer: ArrayBuffer[] = [simBinCopy];
    const mapCopy = mapBytes.slice().buffer;
    transfer.push(mapCopy);
    const init: HostInitMessage = {
      t: 'init',
      simBin: simBinCopy,
      seed: opts.params.seed >>> 0,
      armyCount: opts.armyCount ?? ARMY_COUNT,
      playerArmy: this.playerArmy,
      ...(opts.initialization !== undefined ? { initialization: opts.initialization } : {}),
      transport: this.transport,
      ...(this.link.sab !== undefined ? { frameSab: this.link.sab } : {}),
      frameCapacity: capacity,
      buildHash: this.buildHash,
      startPaused: !opts.params.autostart,
      map: mapCopy,
      persistentRecording: this.settings.autoSaveReplays,
    };
    this.initAtMs = performance.now();
    this.link.sendInit(init, transfer);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.hudTimer = setInterval(() => this.refreshHud(), 200);
    this.client.start();
    if (this.transportNote !== null) this.print('err', this.transportNote);
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  /** Resolves with the host's `ready` message; rejects if the host reports an error before it. */
  whenReady(): Promise<HostReadyMsg> {
    if (this.disposed) return Promise.reject(new Error('Game session is closed'));
    if (this.fatal.peek() !== null) return Promise.reject(new Error(this.fatal.peek()!));
    if (this.ready !== null) return Promise.resolve(this.ready);
    if (this.startupFailure !== null) return Promise.reject(this.startupFailure);
    return new Promise((res, rej) => {
      this.readyWaiters.push(res);
      this.failWaiters.push(rej);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('Game session is closed');
    this.readyWaiters.length = 0;
    for (const reject of this.failWaiters.splice(0)) reject(error);
    for (const pending of this.logWaiters.splice(0)) { clearTimeout(pending.timer); pending.reject(error); }
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.hudTimer !== null) clearInterval(this.hudTimer);
    this.fx.dispose();
    this.client.dispose();
    void this.audio.dispose().catch(error => this.print('err', String(error)));
    this.link.close();
    this.renderer.dispose();
  }
  /** Menu/session replacement preserves the final OPFS tail; a crashed worker stays bounded. */
  async close(): Promise<void> {
    if (this.disposed) return;
    try { if (this.ready !== null && !this.replayMode) await this.link.closeGracefully(); }
    finally { this.dispose(); }
  }

  // ---- console --------------------------------------------------------------------------------

  toggleConsole(open?: boolean): void {
    this.consoleOpen.value = open ?? !this.consoleOpen.value;
  }

  /** Runs one console line and appends input and output to the console log. */
  execute(line: string): ConsoleResult {
    this.print('in', `> ${line}`);
    const r = runConsoleCommand(line, this.consoleApi);
    for (const l of r.lines) this.print(r.ok ? 'out' : 'err', l);
    return r;
  }

  print(kind: ConsoleLine['kind'], text: string): void {
    const next = this.consoleLines.value.slice(-199);
    next.push({ id: ++this.lineId, kind, text });
    this.consoleLines.value = next;
  }

  /** Requests the command log; resolves with its bytes (also triggers the download). */
  exportLog(download = true): Promise<ArrayBuffer> {
    if (this.disposed) return Promise.reject(new Error('Game session is closed'));
    return new Promise((resolve, reject) => {
      const pending = { resolve: (bytes: ArrayBuffer) => { if (download) this.download(bytes); resolve(bytes); }, reject,
        timer: setTimeout(() => { this.logWaiters = this.logWaiters.filter(waiter => waiter !== pending); reject(new Error('Command log export timed out')); }, 30000) };
      this.logWaiters.push(pending);
      this.client.sendCtl({ t: 'exportLog' });
    });
  }

  /** Switches the render preset (splat layers, LOD bias, water quality, render scale). */
  setPreset(name: RenderPresetName): void {
    this.renderer.setPreset(name);
    const shadowCascades = name === 'high' || name === 'ultra' ? 2 : 0;
    const bloom = postOptionsForPreset(this.renderer.preset).bloom;
    this.fx.setHudSetting('shadowCascades', shadowCascades);
    this.fx.setHudSetting('bloom', bloom);
    this.settings = { ...this.settings, preset: name, renderScale: this.renderer.preset.renderScale,
      splatLayers: this.renderer.preset.splatLayers, shadowCascades, bloom };
    this.hud.value = { ...this.hud.value, preset: this.renderer.preset.name };
  }

  /** Apply settings to their live owner; unsupported choices leave the runtime unchanged. */
  applySetting<K extends SettingKey>(key: K, value: SettingsValues[K]): boolean {
    const candidate = { ...this.settings, [key]: value };
    if (validateSettings(candidate).length > 0) return false;
    if (key === 'preset') {
      if (value === 'custom') { this.settings = candidate; return true; }
      if (value !== 'low' && value !== 'medium' && value !== 'high' && value !== 'ultra') return false;
      this.setPreset(value);
      return true;
    }
    if (key === 'renderScale' && typeof value === 'number') this.renderer.setPreset({ ...this.renderer.preset, renderScale: value });
    else if (key === 'splatLayers' && (value === 4 || value === 8)) this.renderer.setPreset({ ...this.renderer.preset, splatLayers: value });
    else if (key === 'frameCap' && (value === 30 || value === 60 || value === 120 || value === 'monitor')) this.client.setFrameCap(value);
    else if (key === 'autoSaveReplays' && typeof value === 'boolean') { if (this.ready !== null && !this.replayMode) this.client.sendCtl({ t: 'recording', enabled: value }); }
    else if (key === 'pauseInBackground' && typeof value === 'boolean') { /* Applied by the visibility handler. */ }
    else if (!this.audio.setHudSetting(key, value) && !this.fx.setHudSetting(key, value)) return false;
    this.settings = candidate;
    return true;
  }

  // ---- E2E support ----------------------------------------------------------------------------

  /** Starts/stops recording a frame fingerprint for every received tick. */
  setFrameHashRecording(on: boolean): void {
    this.recordHashes = on;
    if (on) this.hashByTick.length = 0;
  }

  frameHashAt(tick: number): number | null {
    return this.hashByTick[tick] ?? null;
  }

  /** Fingerprint of the newest frame (see frame-hash.ts). */
  lastFrameHash(): FrameFingerprint | null {
    const s = this.client.stream;
    if (!s.hasFrame) return null;
    return this.hasher.hash(s.bytes);
  }

  metricsSnapshot(): MetricsSnapshot {
    return this.client.metricsSnapshot();
  }

  /** Map info lines (console `map`). */
  mapInfo(): string[] {
    const m = this.map;
    const r = this.ready;
    const ident = `mapSimHash ${r === null ? '–' : hex32(r.mapSimHash)}  simId ${r === null ? '–' : hex32(r.simId)}`;
    const mass = m.spots.filter((s) => s.kind === 'mass').length;
    return [
      `Karte: ${m.name} (${m.sizeWu} × ${m.sizeWu} WU, Höhen ${m.minHeightWU.toFixed(1)}–${m.maxHeightWU.toFixed(1)} WU)`,
      `Wasserspiegel: ${m.waterLevelRaw === null ? 'kein Wasser' : `${fmtWU(m.waterLevelRaw)} WU`}`,
      `Starts: ${m.starts.map((s) => `Armee ${s.army} (${fmtWU(s.x)}, ${fmtWU(s.z)})`).join(', ')}`,
      `Spots: ${mass} Mass, ${m.spots.length - mass} Hydro`,
      ident,
    ];
  }

  // ---- internals ------------------------------------------------------------------------------

  private tapCommands(batch: Uint8Array): void {
    this.audio.onCommandBatch(batch);
    const mv = decodeLastMove(batch);
    if (mv !== null) this.lastMove = mv;
  }

  private onFrame(): void {
    const frame = this.client.lastFrame;
    if (frame !== null) {
      this.visibility.accept(frame, this.renderer, performance.now());
      this.audio.onFrame(frame);
      if (frame.matchEndTick > 0 && this.playerArmy >= 0) {
        this.result.value = { verdict: frame.matchWinningMask === 0 ? 'draw' : (frame.matchWinningMask & (1 << this.playerArmy)) !== 0 ? 'victory' : 'defeat', durationS: frame.matchEndTick / 10 };
      } else if (this.replayMode) this.result.value = null;
    }
    if (!this.recordHashes) return;
    const fp = this.hasher.hash(this.client.stream.bytes);
    if (fp.tick >= 0) this.hashByTick[fp.tick] = fp.hash;
  }

  private onHostMessage(m: HostMessage): void {
    switch (m.t) {
      case 'ready': {
        const r = m as HostReadyMsg;
        this.ready = r;
        this.readyAtMs = performance.now();
        this.hud.value = { ...this.hud.value, simId: r.simId, ready: true, mapSimHash: r.mapSimHash };
        document.documentElement.dataset['simId'] = String(r.simId);
        if (!this.replayMode && !this.skirmish) this.spawnStartArmies();
        this.failWaiters.length = 0;
        for (const w of this.readyWaiters.splice(0)) w(r);
        break;
      }
      case 'status': {
        const status = m as HostStatusMsg;
        this.status.value = status;
        if (this.pendingReload !== null && status.simHash === this.pendingReload.bp.simHash && status.devReloads > this.hmr.reloads) {
          this.bp = this.pendingReload.bp;
          this.client.setVisuals(visualsFromViewJson(this.pendingReload.view));
          this.hmr.appliedAt = Date.now();
          this.hmr.elapsedMs = this.hmr.appliedAt - this.pendingReload.changedAt;
          this.hmr.reloads = status.devReloads;
          this.hmr.error = null;
          this.pendingReload = null;
          this.print('out', `Blueprints angewendet: simHash ${hex32(status.simHash)}, tainted (${this.hmr.elapsedMs} ms)`);
        }
        this.refreshHud();
        break;
      }
      case 'stats':
        this.stats.value = m as HostStatsMsg;
        break;
      case 'log': {
        const waiters = this.logWaiters.splice(0);
        if (waiters.length === 0) this.download(m.bytes);
        for (const pending of waiters) { clearTimeout(pending.timer); pending.resolve(m.bytes); }
        this.print('out', `export: ${m.bytes.byteLength} Bytes Command-Log`);
        break;
      }
      case 'error': {
        if (!isReplayStartupCompatibilityNotice(m, this.replayMode, this.ready !== null)) {
          if (this.pendingReload !== null) { this.hmr.error = m.message; this.pendingReload = null; }
          this.hostErrors.push(m.message);
          // The worker itself failed (load error / crash) or init was rejected: no frames will come.
          if (m.message.startsWith('worker:')) this.fatal.value = `Sim-Worker ausgefallen – ${m.message.slice(7).trim()}`;
          else if (this.ready === null) this.fatal.value = `Sim-Start fehlgeschlagen – ${m.message}`;
          this.print('err', `host: ${m.message}`);
          console.error(`[faf] sim host error: ${m.message}`);
        }
        if (this.ready === null) {
          const err = new Error(m.message);
          this.startupFailure = err;
          this.readyWaiters.length = 0;
          for (const w of this.failWaiters.splice(0)) w(err);
        }
        break;
      }
    }
  }

  reloadBlueprints(payload: { simBin: number[]; viewJson: string; changedAt: number }): void {
    if (this.replayMode) return;
    const bytes = Uint8Array.from(payload.simBin);
    const bp = decodeSimBin(bytes);
    this.hmr.changedAt = payload.changedAt;
    this.hmr.appliedAt = null;
    this.hmr.elapsedMs = null;
    this.hmr.error = null;
    this.pendingReload = { bp, view: payload.viewJson, changedAt: payload.changedAt };
    this.client.sendCtl({ t: 'devReload', simBin: bytes.buffer });
  }

  blueprintError(message: string): void {
    this.hmr.error = message;
    this.print('err', `Blueprint: ${message}`);
    this.refreshHud();
  }

  private spawnStartArmies(): void {
    const p = this.params;
    const l = this.layout;
    const tanks = this.bp.ids.map((id, i) => id.startsWith('core:lnd_') ? i : -1).filter((i) => i >= 0);
    const blueprints = p.spawn === 'tanks' && tanks.length > 0 ? tanks : [this.cubeBp];
    const army = (count: number, id: number, x: number, z: number): void => {
      let remaining = count;
      for (let i = 0; i < blueprints.length && remaining > 0; i++) {
        const n = Math.ceil(remaining / (blueprints.length - i));
        this.client.spawn(blueprints[i]!, n, id, x, z, Math.round(spawnSpreadWU(count) * RAW_PER_WU));
        remaining -= n;
      }
    };
    if (p.spawn !== 'none') {
      army(p.cubes, PLAYER_ARMY, l.own.x, l.own.z);
      army(p.enemyCubes, ENEMY_ARMY, l.enemy.x, l.enemy.z);
    }
    if (p.units > 0) {
      for (const c of flightClusters(this.map, p.units, [PLAYER_ARMY, ENEMY_ARMY], p.seed)) {
        this.client.spawn(this.cubeBp, c.count, c.army, c.x, c.z, c.spread);
      }
    }
  }

  private handleVisibility(): void {
    // Singleplayer: a hidden tab pauses the sim; it resumes only if we paused it.
    if (document.visibilityState === 'hidden' && this.settings.pauseInBackground) {
      if (!this.client.paused) {
        this.autoPaused = true;
        this.client.sendCtl({ t: 'pause' });
      }
    } else if (this.autoPaused) {
      this.autoPaused = false;
      this.client.sendCtl({ t: 'resume' });
    }
  }

  private refreshHud(): void {
    const c = this.client;
    const snap = c.metrics;
    const stats = this.stats.value;
    const mainJs = snap.mainJs.count > 0 ? snap.mainJs.percentile(0.95) : null;
    const fps = snap.rafInterval.count > 0 ? 1000 / Math.max(0.001, snap.rafInterval.summary().mean) : 0;
    const hv = c.hover;
    this.hud.value = {
      tick: c.tick,
      paused: c.paused,
      speed: c.speed,
      fps,
      simP95Ms: stats === null ? null : stats.tickP95Us / 1000,
      mainJsP95Ms: mainJs,
      transport: this.transport,
      simId: this.ready?.simId ?? null,
      buildHash: this.buildHash,
      units: c.stream.unitCount,
      selected: c.selection.count,
      contextLost: this.renderer.stats.lost,
      ready: this.ready !== null,
      mapName: this.map.name,
      mapSimHash: this.ready?.mapSimHash ?? null,
      cursor: hv.valid ? { x: hv.x / RAW_PER_WU, y: hv.y / RAW_PER_WU, z: hv.z / RAW_PER_WU, hit: hv.hit } : null,
      preset: this.renderer.preset.name,
      fullscreen: c.fullscreen?.active ?? false,
      zoom: strategicZoom(c.camera.distance, this.map.sizeWu).level,
      simHash: this.status.value?.simHash ?? this.bp.simHash,
      tainted: this.status.value?.tainted ?? false,
      hmrError: this.hmr.error,
    };
  }

  private download(bytes: ArrayBuffer): void {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sim = this.ready === null ? 'nosim' : (this.ready.simId >>> 0).toString(16).padStart(8, '0');
    a.download = `faf-${sim}-t${this.client.tick}.faflog`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private createConsoleApi(): ConsoleApi {
    const c = this.client;
    return {
      obstacle: (x, z, w, h, remove) => c.commands.footprint(x, z, w, h, remove ? -1 : 1, performance.now()),
      paths: () => { const r = c.lastFrame; return [`pending ${r?.pathPending ?? 0}, requestsIssued ${r?.requestsIssued ?? 0}, repathsTriggered ${r?.repathsTriggered ?? 0}, stuckGiveUps ${r?.stuckGiveUps ?? 0}`]; },
      watch: () => { c.showPaths = !c.showPaths; return [`watch ${c.lastFrame?.watchCount ?? 0}, Linien ${c.showPaths ? 'an' : 'aus'}`]; },
      selectBlueprint: (name) => {
        const bp = this.consoleApi.resolveBlueprint(name);
        const r = c.lastFrame; const hs: number[] = [];
        if (r !== null) for (let i = 0; i < r.unitCount; i++) if (r.unitVisual(i) === bp && r.unitArmy(i) === PLAYER_ARMY) hs.push(r.unitHandle(i));
        c.selection.set(hs); c.syncSelection(); return c.selection.count;
      },
      resolveBlueprint: (name) => {
        if (/^\d+$/.test(name)) {
          const id = Number.parseInt(name, 10);
          return id < this.bp.ids.length ? id : null;
        }
        const id = this.bp.indexOf(name.includes(':') ? name : `core:${name}`);
        return id < 0 ? null : id;
      },
      defaultBlueprint: this.cubeBp,
      armyCount: ARMY_COUNT,
      spawn: (bp, count, army) => {
        const cam = c.camera;
        return c.spawn(bp, count, army, Math.round(cam.targetX), Math.round(cam.targetZ), Math.round(spawnSpreadWU(count) * RAW_PER_WU));
      },
      killSelection: () => c.kill(),
      pause: () => c.sendCtl({ t: 'pause' }),
      resume: () => c.sendCtl({ t: 'resume' }),
      get paused() {
        return c.paused;
      },
      step: (n) => c.step(n),
      setSpeed: (x) => c.setSpeed(x),
      hashInfo: () => {
        const r = c.lastFrame;
        const fp = this.lastFrameHash();
        const lines = [`simId ${this.ready === null ? '–' : hex32(this.ready.simId)}  layout ${this.ready === null ? '–' : hex32(this.ready.layoutHash)}`];
        if (r === null) return [...lines, 'noch kein Frame'];
        lines.push(r.hashTick === 0 && r.hash === 0 ? `tick ${r.tick}: noch kein Regel-Hash` : `Regel-Hash @ tick ${r.hashTick}: ${hex32(r.hash)}`);
        if (fp !== null) lines.push(`Frame-Fingerprint @ tick ${fp.tick}: ${hex32(fp.hash)} (${fp.byteLength} B)`);
        return lines;
      },
      toggleBudget: () => {
        this.budgetOpen.value = !this.budgetOpen.value;
        return this.budgetOpen.value;
      },
      exportLog: () => {
        void this.exportLog(true);
      },
      transportInfo: () => {
        const st = this.status.value;
        const lines = [
          `Transport: ${this.transport}${this.transportNote === null ? '' : ` (${this.transportNote})`}`,
          `crossOriginIsolated: ${String(globalThis.crossOriginIsolated === true)}`,
          `Frames empfangen: ${c.stream.frameCount}, übersprungene Ticks: ${c.stream.skippedTicks}`,
        ];
        if (st !== null) lines.push(`Frames verworfen (Host): ${st.framesDropped}, Recorder: ${st.recorder}${st.recorderNote === null ? '' : ` – ${st.recorderNote}`}`);
        return lines;
      },
      mapInfo: () => this.mapInfo(),
      mapSizeWu: () => c.mapBounds.maxX / RAW_PER_WU,
      jumpCamera: (x, z, distance) => {
        c.jumpTo(x * RAW_PER_WU, z * RAW_PER_WU, distance);
        const s = c.cameraState();
        return [`Kamera: Fokus (${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)}) WU, Abstand ${s.distance.toFixed(1)} WU`];
      },
      setPreset: (name) => {
        this.setPreset(name);
        const p = this.renderer.preset;
        return [`preset ${p.name}: Render-Scale ${p.renderScale}, Splat-Layer ${p.splatLayers}, LOD-Bias ${p.lodBias}, Wasser ${p.waterQuality}`];
      },
      presetName: () => this.renderer.preset.name,
    };
  }

  /** Control message passthrough (E2E `ctl`). */
  ctl(msg: CtlMessage): void {
    this.client.sendCtl(msg);
  }
}

/** Decodes the last Move command of a command batch (null if it has none). */
export function decodeLastMove(batch: Uint8Array): MoveTarget | null {
  let last: MoveTarget | null = null;
  for (const e of decodeBatch(batch)) {
    if (e.op !== Op.Move) continue;
    const p = decodeMove(e.payload);
    last = { seq: e.seq, units: e.units.length, x: p.x, y: p.y, z: p.z };
  }
  return last;
}
