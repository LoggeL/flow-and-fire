/**
 * Game session (MS1): sim worker + frame transport + renderer + GameClient, the dev-console API
 * and the E2E test hooks. UI state is exposed as Preact signals (see ui/).
 *
 * Boot: view.json → visual table; sim.bin → blueprint ids; module worker from
 * `@faf/sim-host/worker`; transport SAB when cross-origin isolated (else transfer, or as requested
 * by `?transport=`); `init` (optionally `startPaused` for `?autostart=0`); on `ready` the start
 * armies are spawned by cheat commands through the normal command pipeline (S8).
 */
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { parseViewJson } from '@faf/blueprints/view';
import {
  createRenderer,
  GameClient,
  RAW_PER_WU,
  type DragBox,
  type MetricsSnapshot,
  type Renderer,
  type VisualTable,
} from '@faf/client';
import {
  DEFAULT_FRAME_CAPS,
  frameCapacityBytes,
  type CtlMessage,
  type HostMessage,
  type TransportKind,
} from '@faf/protocol';
import type { HostInitMessage, HostReadyMsg, HostStatsMsg, HostStatusMsg } from '@faf/sim-host';
import { signal } from '@preact/signals';
import { runConsoleCommand, type ConsoleApi, type ConsoleResult } from './console-commands.ts';
import { FrameHasher, type FrameFingerprint } from './frame-hash.ts';
import { chooseTransport, type GameParams } from './params.ts';
import { WorkerSimLink, type WorkerLike } from './worker-link.ts';

/** Army of the local player. */
export const PLAYER_ARMY = 0;
/** Armies in the MS1 session: the player and one passive second army. */
export const ARMY_COUNT = 2;
/** Start positions (WU) on the 512 WU test plane. */
const OWN_CENTER_WU = { x: 256, z: 256 } as const;
const ENEMY_CENTER_WU = { x: 312, z: 214 } as const;
/** Initial camera distance (WU): the whole start army is in view. */
const START_CAMERA_DISTANCE = 105;

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
}

export interface GameOptions {
  readonly canvas: HTMLCanvasElement;
  readonly params: GameParams;
  readonly buildHash: string;
  readonly assets: GameAssets;
  /** Creates the sim worker. */
  readonly createWorker: () => WorkerLike;
}

/** Spread radius (WU) so that `n` cubes of radius 0.3 have room: ≈ 4.5 WU² per cube. */
export function spawnSpreadWU(n: number): number {
  return Math.max(3, Math.sqrt(n * 1.45));
}

export function visualsFromViewJson(text: string): VisualTable {
  const bundle = parseViewJson(text);
  return bundle.visuals.map((v) => ({
    spec: {
      hull: v.placeholder.hull,
      size: [v.placeholder.size[0], v.placeholder.size[1], v.placeholder.size[2]] as [number, number, number],
      ...(v.placeholder.color !== undefined
        ? { color: [v.placeholder.color[0], v.placeholder.color[1], v.placeholder.color[2]] as [number, number, number] }
        : {}),
    },
  }));
}

function hex32(v: number): string {
  return '0x' + (v >>> 0).toString(16).padStart(8, '0');
}

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
  readonly hostErrors: string[] = [];
  readonly consoleApi: ConsoleApi;
  private readonly hasher = new FrameHasher();
  private recordHashes = false;
  private readonly hashByTick: (number | undefined)[] = [];
  private lineId = 0;
  private autoPaused = false;
  private hudTimer: ReturnType<typeof setInterval> | null = null;
  private readyWaiters: ((m: HostReadyMsg) => void)[] = [];
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
    const visuals = visualsFromViewJson(opts.assets.viewJson);

    const capacity = frameCapacityBytes(DEFAULT_FRAME_CAPS);
    this.link = new WorkerSimLink(opts.createWorker(), this.transport, capacity);
    this.renderer = createRenderer(opts.canvas, { clearColor: [0.043, 0.059, 0.078] });
    this.client = new GameClient({
      canvas: opts.canvas,
      renderer: this.renderer,
      link: this.link,
      visuals,
      playerArmy: PLAYER_ARMY,
      callbacks: {
        onToggleConsole: () => this.toggleConsole(),
        onDragBox: (b) => {
          this.dragBox.value = b === null ? null : { ...b };
        },
        onHostMessage: (m) => this.onHostMessage(m),
        onFrame: () => this.onFrame(),
      },
    });
    this.client.camera.distance = START_CAMERA_DISTANCE;
    this.client.cameraController.focusRaw(OWN_CENTER_WU.x * RAW_PER_WU, OWN_CENTER_WU.z * RAW_PER_WU);

    this.consoleApi = this.createConsoleApi();
    this.hud.value = { ...this.hud.value, transport: this.transport, buildHash: this.buildHash };

    const simBinCopy = opts.assets.simBin.slice(0);
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
    };
    this.link.sendInit(init, [simBinCopy]);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.hudTimer = setInterval(() => this.refreshHud(), 200);
    this.client.start();
    if (this.transportNote !== null) this.print('err', this.transportNote);
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  /** Resolves with the host's `ready` message. */
  whenReady(): Promise<HostReadyMsg> {
    if (this.ready !== null) return Promise.resolve(this.ready);
    return new Promise((res) => this.readyWaiters.push(res));
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

  // ---- internals ------------------------------------------------------------------------------

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
        this.hud.value = { ...this.hud.value, simId: r.simId, ready: true };
        document.documentElement.dataset['simId'] = String(r.simId);
        this.spawnStartArmies();
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
      case 'error':
        this.hostErrors.push(m.message);
        this.print('err', `host: ${m.message}`);
        console.error(`[faf] sim host error: ${m.message}`);
        break;
    }
  }

  private spawnStartArmies(): void {
    const p = this.params;
    if (p.cubes > 0) {
      this.client.spawn(
        this.cubeBp,
        p.cubes,
        PLAYER_ARMY,
        OWN_CENTER_WU.x * RAW_PER_WU,
        OWN_CENTER_WU.z * RAW_PER_WU,
        Math.round(spawnSpreadWU(p.cubes) * RAW_PER_WU),
      );
    }
    if (p.enemyCubes > 0) {
      this.client.spawn(
        this.cubeBp,
        p.enemyCubes,
        1,
        ENEMY_CENTER_WU.x * RAW_PER_WU,
        ENEMY_CENTER_WU.z * RAW_PER_WU,
        Math.round(spawnSpreadWU(p.enemyCubes) * RAW_PER_WU),
      );
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
    const game = this;
    const c = this.client;
    return {
      resolveBlueprint: (name) => {
        if (/^\d+$/.test(name)) {
          const id = Number.parseInt(name, 10);
          return id < game.bp.ids.length ? id : null;
        }
        const id = game.bp.indexOf(name.includes(':') ? name : `core:${name}`);
        return id < 0 ? null : id;
      },
      get defaultBlueprint() {
        return game.cubeBp;
      },
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
        const fp = game.lastFrameHash();
        const lines = [`simId ${game.ready === null ? '–' : hex32(game.ready.simId)}  layout ${game.ready === null ? '–' : hex32(game.ready.layoutHash)}`];
        if (r === null) return [...lines, 'noch kein Frame'];
        lines.push(r.hashTick === 0 && r.hash === 0 ? `tick ${r.tick}: noch kein Regel-Hash` : `Regel-Hash @ tick ${r.hashTick}: ${hex32(r.hash)}`);
        if (fp !== null) lines.push(`Frame-Fingerprint @ tick ${fp.tick}: ${hex32(fp.hash)} (${fp.byteLength} B)`);
        return lines;
      },
      toggleBudget: () => {
        game.budgetOpen.value = !game.budgetOpen.value;
        return game.budgetOpen.value;
      },
      exportLog: () => {
        void game.exportLog(true);
      },
      transportInfo: () => {
        const st = game.status.value;
        const lines = [
          `Transport: ${game.transport}${game.transportNote === null ? '' : ` (${game.transportNote})`}`,
          `crossOriginIsolated: ${String(globalThis.crossOriginIsolated === true)}`,
          `Frames empfangen: ${c.stream.frameCount}, übersprungene Ticks: ${c.stream.skippedTicks}`,
        ];
        if (st !== null) lines.push(`Frames verworfen (Host): ${st.framesDropped}, Recorder: ${st.recorder}${st.recorderNote === null ? '' : ` – ${st.recorderNote}`}`);
        return lines;
      },
    };
  }

  /** Control message passthrough (E2E `ctl`). */
  ctl(msg: CtlMessage): void {
    this.client.sendCtl(msg);
  }
}
