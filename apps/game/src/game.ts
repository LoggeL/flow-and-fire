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
  type DragBox,
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
import { chooseTransport, type GameParams } from './params.ts';
import { WorkerSimLink, type WorkerLike } from './worker-link.ts';

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
  readonly buildHash: string;
  readonly transport: TransportKind;
  readonly transportNote: string | null;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly link: WorkerSimLink;
  readonly client: GameClient;
  readonly bp: SimBpTable;
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
  private logWaiters: ((bytes: ArrayBuffer) => void)[] = [];
  private readonly onVisibility = (): void => this.handleVisibility();
  private disposed = false;

  constructor(opts: GameOptions) {
    this.params = opts.params;
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
    this.layout = startLayout(this.map, PLAYER_ARMY, ENEMY_ARMY);

    const capacity = frameCapacityBytes(DEFAULT_FRAME_CAPS);
    this.link = new WorkerSimLink(opts.createWorker(), this.transport, capacity);
    this.link.onCommandBatch = (batch) => this.tapCommands(batch);
    this.renderer = createRenderer(opts.canvas, { clearColor: [0.043, 0.059, 0.078], preset: opts.params.preset });
    this.client = new GameClient({
      canvas: opts.canvas,
      renderer: this.renderer,
      link: this.link,
      visuals,
      playerArmy: PLAYER_ARMY,
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
        onFullscreenChange: () => this.refreshHud(),
      },
    });
    this.client.jumpTo(this.layout.own.x, this.layout.own.z, START_CAMERA_DISTANCE);

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
      armyCount: ARMY_COUNT,
      playerArmy: PLAYER_ARMY,
      transport: this.transport,
      ...(this.link.sab !== undefined ? { frameSab: this.link.sab } : {}),
      frameCapacity: capacity,
      buildHash: this.buildHash,
      startPaused: !opts.params.autostart,
      map: mapCopy,
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
    if (this.ready !== null) return Promise.resolve(this.ready);
    return new Promise((res, rej) => {
      this.readyWaiters.push(res);
      this.failWaiters.push(rej);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.hudTimer !== null) clearInterval(this.hudTimer);
    this.client.dispose();
    this.link.close();
    this.renderer.dispose();
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
    return new Promise((res) => {
      this.logWaiters.push((bytes) => {
        if (download) this.download(bytes);
        res(bytes);
      });
      this.client.sendCtl({ t: 'exportLog' });
    });
  }

  /** Switches the render preset (splat layers, LOD bias, water quality, render scale). */
  setPreset(name: RenderPresetName): void {
    this.renderer.setPreset(name);
    this.hud.value = { ...this.hud.value, preset: this.renderer.preset.name };
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
    const mv = decodeLastMove(batch);
    if (mv !== null) this.lastMove = mv;
  }

  private onFrame(): void {
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
        this.spawnStartArmies();
        this.failWaiters.length = 0;
        for (const w of this.readyWaiters.splice(0)) w(r);
        break;
      }
      case 'status':
        this.status.value = m as HostStatusMsg;
        break;
      case 'stats':
        this.stats.value = m as HostStatsMsg;
        break;
      case 'log': {
        const waiters = this.logWaiters.splice(0);
        if (waiters.length === 0) this.download(m.bytes);
        for (const w of waiters) w(m.bytes);
        this.print('out', `export: ${m.bytes.byteLength} Bytes Command-Log`);
        break;
      }
      case 'error': {
        this.hostErrors.push(m.message);
        // The worker itself failed (load error / crash) or init was rejected: no frames will come.
        if (m.message.startsWith('worker:')) this.fatal.value = `Sim-Worker ausgefallen – ${m.message.slice(7).trim()}`;
        else if (this.ready === null) this.fatal.value = `Sim-Start fehlgeschlagen – ${m.message}`;
        this.print('err', `host: ${m.message}`);
        console.error(`[faf] sim host error: ${m.message}`);
        if (this.ready === null) {
          const err = new Error(m.message);
          this.readyWaiters.length = 0;
          for (const w of this.failWaiters.splice(0)) w(err);
        }
        break;
      }
    }
  }

  private spawnStartArmies(): void {
    const p = this.params;
    const l = this.layout;
    if (p.cubes > 0) {
      this.client.spawn(this.cubeBp, p.cubes, PLAYER_ARMY, l.own.x, l.own.z, Math.round(spawnSpreadWU(p.cubes) * RAW_PER_WU));
    }
    if (p.enemyCubes > 0) {
      this.client.spawn(this.cubeBp, p.enemyCubes, ENEMY_ARMY, l.enemy.x, l.enemy.z, Math.round(spawnSpreadWU(p.enemyCubes) * RAW_PER_WU));
    }
    if (p.units > 0) {
      for (const c of flightClusters(this.map, p.units, [PLAYER_ARMY, ENEMY_ARMY], p.seed)) {
        this.client.spawn(this.cubeBp, c.count, c.army, c.x, c.z, c.spread);
      }
    }
  }

  private handleVisibility(): void {
    // Singleplayer: a hidden tab pauses the sim; it resumes only if we paused it.
    if (document.visibilityState === 'hidden') {
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
