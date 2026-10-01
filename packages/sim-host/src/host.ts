/**
 * SimHost (PLAN §3.4, §3.6): owns the world of one session and connects it to the main thread.
 * Engine-neutral — runs in a dedicated worker (see worker.ts) and in Node (tests, bench).
 *
 * - `init` ⇒ world from sim.bin and the map (`init.map` .rtsmap bytes, parsed here with
 *   readRtsMap; missing = test plane), frame transport (SAB triple buffer or transfer ping-pong),
 *   command-log recorder (OPFS when available), keyframes, scheduler; replies `ready`.
 * - `cmd` ⇒ LocalSource: applied in the next tick that runs (also while paused).
 * - `ctl` ⇒ pause/resume/speed/step/viewer/watch/debug/devReload/exportLog. MS3: `watch` handles
 *   go into the frame's Watch section; `devReload` may carry a new sim.bin (compatible blueprint
 *   table swapped in, log tainted, new simId) and is answered with `status` (or `error`).
 * - per slice one frame (viewer from ctl.viewer, paused bit, Watch section, path statistics,
 *   optional debug section with phase times); `stats` every 10 ticks (incl. path counters),
 *   `status` on state changes.
 */

import {
  createFrameProducer,
  FH_DEBUG_BYTES,
  FrameFlags,
  FrameWriter,
  isFrameReturnMsg,
  messageData,
  parseMainToHostMessage,
  speedToPermille,
  MAX_WATCH,
  type CtlMessage,
  type FrameProducer,
  type HostMessage,
  type InitMessage,
  type PhaseStat,
  type PortLike,
  type ReadyMsg,
  type StatsMsg,
  type StatusMsg,
  type TransportKind,
} from '@faf/protocol';
import { ACTIVE_PHASES, PhaseId, WH_STUCK_GIVEUPS, WorldInitStage, hasMatchEnded, writeFrame, type FrameMeta, type WorldInitProbe, type PhaseProbe } from '@faf/sim';
import { AiWaitMetrics, createGameAiSources, type GameAiOptions, type GameAiStatus, type AiThinkSample } from './ai/index.ts';
import { performanceClock, type Clock, type Wakeup } from './clock.ts';
import { SimCore } from './core.ts';
import { MatchStats } from './match-stats.ts';
import { SIM_BUILD } from './identity.ts';
import type { KeyframeOptions } from './keyframes.ts';
import { MarkKind } from './log-format.ts';
import { DEFAULT_KEEP_LOGS, openOpfsLogSink, opfsRoot, type DirectoryHandleLike } from './opfs.ts';
import type { RecorderStorage } from './recorder.ts';
import { Scheduler, type SchedulerOptions, type SchedulerTarget } from './scheduler.ts';
import { emptySummary, Metric, METRIC_COUNT, METRIC_NAMES, PhaseStats, TimingProbe } from './stats.ts';

/** Ticks between two `stats` messages. */
export const STATS_EVERY_TICKS = 10;

/** `ctl.debug` flag bits. */
export const DebugFlags = {
  /** Append the phase times of the last tick as the frame's debug section. */
  PhaseTimes: 1 << 0,
} as const;

/** Debug section kinds (first u16 of the section). */
export const DebugSectionKind = {
  PhaseTimes: 1,
} as const;
/**
 * Debug section `PhaseTimes`: u16 kind (1) | u16 count (= METRIC_COUNT) | u32[count] µs of the
 * last tick per metric (0 = whole step, 1..16 sim phases, 17 hash tick, 18 frame, 19 host).
 */
export const DEBUG_PHASE_TIMES_BYTES = 4 + 4 * METRIC_COUNT;

/** `status` with host details (extra fields are structured-clone safe). */
export interface HostStatusMsg extends StatusMsg {
  readonly ai: HostAiMetrics | null;
  /** Where the command log is stored. */
  readonly recorder: RecorderStorage;
  /** Why OPFS is not used / failed (null if fine or still opening). */
  readonly recorderNote: string | null;
  readonly tainted: boolean;
  /** Ticks' worth of wall time dropped by sim lag since start. */
  readonly lostTicks: number;
  /** A command source is 'pending'. */
  readonly waiting: boolean;
  /** Frames the transport dropped (overwritten / no free buffer). */
  readonly framesDropped: number;
  readonly logBytes: number;
  /** simHash of the blueprint table in use (changes with a dev reload). */
  readonly simHash: number;
  /** Session identity (changes with a dev reload). */
  readonly simId: number;
  /** Dev reloads applied so far. */
  readonly devReloads: number;
  /** Host time of the last applied dev reload, from the ctl message to the status (ms; 0 = none). */
  readonly devReloadMs: number;
  /** Nav precompute when the world was created (static passability + derived regions), ms. */
  readonly navPrecomputeMs: number;
}

/** `ready` with identity details. */
export interface HostReadyMsg extends ReadyMsg {
  readonly simBuild: string;
  readonly bpSimHash: number;
  /** u32 identity of the map (formats mapSimHash). */
  readonly mapSimHash: number;
  /** META name of the map ('testplane' for the generated test plane). */
  readonly mapName: string;
  /** Map edge length in WU. */
  readonly mapSizeWu: number;
  readonly seed: number;
  readonly tick: number;
  /** Nav precompute at load: static passability / derived regions (ms, host clock). */
  readonly navStaticMs: number;
  readonly navDerivedMs: number;
}

/** Sim-wide pathfinding counters (also in every frame header, v2). */
export interface HostPathStats {
  pending: number;
  requestsIssued: number;
  repathsTriggered: number;
  expansionsLastTick: number;
  stuckGiveUps: number;
}

/** `stats` with a few extra percentiles and the command pipeline counters. */
export interface HostStatsMsg extends StatsMsg {
  readonly ai: HostAiMetrics | null;
  readonly tick: number;
  readonly tickP99Us: number;
  readonly hashTickP50Us: number;
  readonly frameP95Us: number;
  readonly samples: number;
  /** Local command batches applied so far (each `cmd` message is one batch). */
  readonly cmdBatchesApplied: number;
  /**
   * Largest number of ticks between a `cmd` arriving at the host and the tick that applied it
   * (pipeline invariant: 1 — applied in the next tick that runs, inputDelay 0; SPK6).
   */
  readonly cmdApplyTicksMax: number;
  /** Pathfinding counters at the stats tick (MS3). */
  readonly path: HostPathStats;
}

export interface HostAiMetrics {
  readonly distinctWaitingTicks: number;
  readonly waitRetries: number;
  readonly waitIdsDropped: number;
  readonly monotonic: boolean;
  readonly armies: readonly GameAiStatus[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutablePhaseStat = Mutable<PhaseStat>;
type MutableStatsMsg = Omit<Mutable<HostStatsMsg>, 'phases'> & { phases: MutablePhaseStat[] };

const NO_TRANSFER: ArrayBuffer[] = [];

/** InitMessage plus optional host extensions. */
export interface HostInitMessage extends InitMessage {
  /** Start with the scheduler paused (deterministic E2E, `?autostart=0`). */
  readonly startPaused?: boolean;
  readonly initialization?: import('./log-format.ts').LogInitialization;
}

/**
 * Sends a message to the main thread. Must serialize synchronously (like postMessage): the host
 * reuses the `stats` message object for the next report.
 */
export type HostPost = (msg: HostMessage, transfer: ArrayBuffer[]) => void;

export interface SimHostOptions {
  /** Browser workers by default; focused tests may supply the same-brain message port. */
  readonly ai?: Omit<GameAiOptions, 'initialization'>;
  /** Sends a message to the main thread. */
  readonly post: HostPost;
  /** Port to the main thread (required for the transfer transport; frameReturn arrives here). */
  readonly port?: PortLike;
  readonly clock?: Clock;
  readonly wakeup?: Wakeup;
  readonly scheduler?: Omit<SchedulerOptions, 'clock' | 'wakeup' | 'paused'>;
  /** OPFS root provider; null disables persistence (memory-only log). Default: `opfsRoot`. */
  readonly opfs?: (() => Promise<DirectoryHandleLike | null>) | null;
  readonly keepLogs?: number;
  readonly keyframes?: KeyframeOptions | false;
  /** Samples per metric for percentiles (default 256). */
  readonly statsWindow?: number;
  /** Run the scheduler after init (default true). False: drive with `runTicks` (tests, bench). */
  readonly autoStart?: boolean;
  /** Recorder memory buffer size (bytes). */
  readonly logCapacity?: number;
}

const MAX_STEP_TICKS = 1_000_000;

export class SimHost implements SchedulerTarget {
  private readonly options: SimHostOptions;
  private readonly post: HostPost;
  private readonly clock: Clock;
  readonly stats: PhaseStats;
  readonly probe: TimingProbe;
  private readonly tickProbe: PhaseProbe;
  private ackPostFailed = false;
  private ackPostError: unknown;

  private coreRef: SimCore | null = null;
  private aiRef: ReturnType<typeof createGameAiSources> | null = null;
  private readonly aiWaits = new AiWaitMetrics();
  private producerRef: FrameProducer | null = null;
  private schedulerRef: Scheduler | null = null;
  private transportKind: TransportKind = 'transfer';
  private readonly writer = new FrameWriter();
  private readonly meta: FrameMeta = { seq: 0, tickTimeUs: 0, speedPermille: 1000, flags: 0 };
  private readonly debugBuf = new Uint8Array(DEBUG_PHASE_TIMES_BYTES);
  private readonly debugDv = new DataView(this.debugBuf.buffer);
  private viewerArmy = -1;
  private commandArmy = -1;
  private debugFlags = 0;
  private readonly watchHandles = new Uint32Array(MAX_WATCH);
  private watchCount = 0;
  private frameSeq = 0;
  private republishPending = false;
  private recorderNote: string | null = null;
  private persistenceEnabled = true;
  private persistenceEpoch = 0;
  private persistencePending: Promise<void> | null = null;
  private closing = false;
  private portListener: ((ev: object) => void) | null = null;
  private disposed = false;
  private lastStatusKey = '';
  private readonly summary = emptySummary();
  private readonly statsMsg: MutableStatsMsg = {
    ai: null,
    t: 'stats',
    tick: 0,
    tickP50Us: 0,
    tickP95Us: 0,
    tickP99Us: 0,
    hashTickP50Us: 0,
    hashTickP95Us: 0,
    frameP95Us: 0,
    samples: 0,
    cmdBatchesApplied: 0,
    cmdApplyTicksMax: 0,
    path: { pending: 0, requestsIssued: 0, repathsTriggered: 0, expansionsLastTick: 0, stuckGiveUps: 0 },
    phases: [...ACTIVE_PHASES, PhaseId.HashTick, Metric.Frame, Metric.Host].map((id) => ({ id, name: METRIC_NAMES[id]!, p50Us: 0, p95Us: 0 })),
  };
  /** Tick at which the oldest not yet applied `cmd` batch arrived (−1 = none queued). */
  private cmdArrivalTick = -1;
  private matchStats: MatchStats | null = null;
  private matchStatsPosted = false;
  private cmdBatchesApplied = 0;
  private cmdQueued = 0;
  private cmdApplyTicksMax = 0;
  private lastPostedAck = 0;
  private navStaticMs = 0;
  private navDerivedMs = 0;
  private devReloads = 0;
  private devReloadMs = 0;

  constructor(options: SimHostOptions) {
    this.options = options;
    this.post = options.post;
    this.clock = options.clock ?? performanceClock;
    this.stats = new PhaseStats(options.statsWindow ?? 256);
    this.probe = new TimingProbe(this.clock, this.stats);
    // One stable observer, never a per-tick wrapper. Cleanup is the last authoritative phase;
    // Output afterward only reads state and updates the derived hash log.
    this.tickProbe = {
      begin: phase => this.probe.begin(phase),
      end: phase => {
        this.probe.end(phase);
        if (phase === PhaseId.Cleanup && !this.core.replaying) {
          try { this.postCommittedAck(); }
          catch (error) { this.ackPostFailed = true; this.ackPostError = error; }
        }
      },
    };
  }

  // ---- accessors ------------------------------------------------------------------------------

  get initialized(): boolean {
    return this.coreRef !== null;
  }

  /** The session core (world, recorder, keyframes). Throws before init. */
  get core(): SimCore {
    if (this.coreRef === null) throw new Error('sim host not initialized');
    return this.coreRef;
  }

  get scheduler(): Scheduler {
    if (this.schedulerRef === null) throw new Error('sim host not initialized');
    return this.schedulerRef;
  }

  get producer(): FrameProducer {
    if (this.producerRef === null) throw new Error('sim host not initialized');
    return this.producerRef;
  }

  get tick(): number {
    return this.core.tick;
  }

  /** Host-only observations. Raw samples are copied only when qualification requests them. */
  aiDiagnostics(): (HostAiMetrics & {readonly waitingTickIds: readonly number[]; readonly samples: readonly {army:number;samples:readonly AiThinkSample[]}[]}) | null {
    const metrics = this.aiMetrics();
    return metrics === null ? null : {...metrics, waitingTickIds:this.aiWaits.ids(), samples:this.aiRef!.samples};
  }

  private aiMetrics(): HostAiMetrics | null {
    if (this.aiRef === null) return null;
    return {distinctWaitingTicks:this.aiWaits.distinct, waitRetries:this.aiWaits.retries,
      waitIdsDropped:this.aiWaits.dropped, monotonic:this.aiWaits.monotonic, armies:this.aiRef.status};
  }

  get paused(): boolean {
    return this.scheduler.paused;
  }

  get viewer(): number {
    return this.viewerArmy;
  }

  get transport(): TransportKind {
    return this.transportKind;
  }

  /** Handles set via ctl.watch (copy). */
  get watched(): number[] {
    return Array.from(this.watchHandles.subarray(0, this.watchCount));
  }

  /** Frames written so far (header seq of the last frame). */
  get framesWritten(): number {
    return this.frameSeq;
  }

  // ---- messages -------------------------------------------------------------------------------

  /** Entry point for every message from the main thread (worker `message` event data). */
  handleMessage(data: unknown): void {
    if (this.disposed || this.closing || isFrameReturnMsg(data)) return;
    try {
      const msg = parseMainToHostMessage(data);
      if (msg === null) {
        const t = typeof data === 'object' && data !== null ? String((data as { t?: unknown }).t) : typeof data;
        throw new Error(`invalid message to sim host (t=${t})`);
      }
      if (msg.t === 'init') this.init(msg);
      else if (msg.t === 'cmd') this.submit(msg.batch);
      else this.ctl(msg);
    } catch (e) {
      this.postError(e);
    }
  }

  /** Creates the session. Throws if already initialized or the message is inconsistent. */
  init(msg: HostInitMessage): void {
    if (this.coreRef !== null) throw new Error('sim host already initialized');
    if (this.disposed) throw new Error('sim host disposed');
    const writer = this.writer;
    if (msg.frameCapacity < writer.capacityBytes) {
      throw new RangeError(`frameCapacity ${msg.frameCapacity} < required ${writer.capacityBytes} (frameCapacityBytes(DEFAULT_FRAME_CAPS))`);
    }
    if (msg.transport === 'transfer' && this.options.port === undefined) throw new Error("transport 'transfer' needs a port");
    // A broken map (CRC, truncation, bad values) throws FormatError here and becomes an `error`
    // message with the reader's reason; the host stays uninitialized.
    // Nav precompute timing (static passability, derived regions) for the status (MS3).
    const clock = this.clock;
    const t0 = [0, 0, 0];
    const dur = [0, 0, 0];
    const initProbe: WorldInitProbe = {
      begin: (stage) => {
        t0[stage] = clock.now();
      },
      end: (stage) => {
        dur[stage] = clock.now() - t0[stage]!;
      },
    };
    let core: SimCore | undefined;
    const ai = msg.initialization?.slots?.some(slot => slot.controller === 'ai') === true
      ? createGameAiSources({ ...this.options.ai, initialization: msg.initialization,
          onResult: (army, result) => { const active = this.coreRef ?? core; if (result.aborted && active !== undefined && !this.closing && !this.disposed) active.recorder?.mark(active.tick, MarkKind.AiTimeout, army); this.options.ai?.onResult?.(army, result); } }) : null;
    try {
      core = new SimCore({
      simBin: new Uint8Array(msg.simBin),
      ...(msg.map !== undefined ? { map: new Uint8Array(msg.map) } : {}),
      seed: msg.seed,
      armyCount: msg.armyCount,
      playerArmy: msg.playerArmy,
      buildHash: msg.buildHash,
      ...(msg.initialization !== undefined ? { initialization: msg.initialization } : {}),
      ...(ai !== null ? { localSource: ai.local, sources: ai.sources } : {}),
      keyframes: this.options.keyframes ?? {},
      initProbe,
      ...(this.options.logCapacity !== undefined ? { recorder: { initialCapacity: this.options.logCapacity } } : {}),
      });
      ai?.bind(core);
    } catch (error) { ai?.dispose(); throw error; }
    this.aiRef = ai;
    this.navStaticMs = dur[WorldInitStage.NavStatic]!;
    this.navDerivedMs = dur[WorldInitStage.NavDerived]!;
    const producer = createFrameProducer({
      kind: msg.transport,
      capacity: msg.frameCapacity,
      sab: msg.frameSab,
      port: this.options.port,
    });
    this.coreRef = core;
    this.matchStats = new MatchStats(msg.armyCount);
    this.producerRef = producer;
    this.transportKind = msg.transport;
    this.viewerArmy = msg.playerArmy;
    this.commandArmy = msg.playerArmy;
    const port = this.options.port;
    if (msg.transport === 'transfer' && port !== undefined) {
      // Registered after the producer's own listener, so a returned buffer is already pooled.
      this.portListener = (ev: object): void => {
        if (this.republishPending && isFrameReturnMsg(messageData(ev))) this.publishFrame();
      };
      port.addEventListener('message', this.portListener);
    }
    this.schedulerRef = new Scheduler(this, {
      ...(this.options.scheduler ?? {}),
      clock: this.clock,
      ...(this.options.wakeup !== undefined ? { wakeup: this.options.wakeup } : {}),
      paused: msg.startPaused === true,
    });
    const ready: HostReadyMsg = {
      t: 'ready',
      simId: core.simId,
      layoutHash: core.world.layoutHash >>> 0,
      transport: msg.transport,
      simBuild: SIM_BUILD,
      bpSimHash: core.world.bp.simHash >>> 0,
      mapSimHash: core.mapSimHash,
      mapName: core.mapName,
      mapSizeWu: core.world.mapSizeWu,
      seed: core.world.seed >>> 0,
      tick: core.tick,
      navStaticMs: this.navStaticMs,
      navDerivedMs: this.navDerivedMs,
    };
    this.post(ready, []);
    this.persistenceEnabled = msg.persistentRecording !== false;
    if (this.persistenceEnabled) this.openPersistence(core);
    else this.recorderNote = 'persistence disabled';
    this.publishFrame();
    this.postStatus(true);
    if (this.options.autoStart !== false) this.schedulerRef.start();
  }

  private openPersistence(core: SimCore): void {
    const epoch = ++this.persistenceEpoch;
    const rec = core.recorder;
    const provider = this.options.opfs === undefined ? opfsRoot : this.options.opfs;
    if (rec === null) return;
    if (provider === null) {
      this.recorderNote = 'persistence disabled';
      return;
    }
    const pending = provider()
      .then((root) => {
        if (this.disposed || !this.persistenceEnabled || epoch !== this.persistenceEpoch) return null;
        if (root === null) {
          this.recorderNote = 'OPFS unavailable: memory only';
          return null;
        }
        return openOpfsLogSink(root, { simId: core.simId, keep: this.options.keepLogs ?? DEFAULT_KEEP_LOGS });
      })
      .then((sink) => {
        if (sink === null) return;
        if (this.disposed || !this.persistenceEnabled || epoch !== this.persistenceEpoch) {
          sink.close();
          return;
        }
        if (!rec.attachSink(sink)) this.recorderNote = `OPFS write failed: ${rec.sinkError ?? 'unknown'}`;
        else this.recorderNote = null;
      })
      .catch((e: unknown) => {
        if (epoch === this.persistenceEpoch) this.recorderNote = `OPFS unavailable: ${e instanceof Error ? e.message : String(e)}`;
      })
      .finally(() => {
        if (this.persistencePending === pending) this.persistencePending = null;
        if (!this.disposed && !this.closing) this.postStatus(true);
      });
    this.persistencePending = pending;
  }

  /** Queues a command batch (tick 0) for the next tick. Accepted while paused. */
  submit(batch: ArrayBuffer | Uint8Array): void {
    if (this.disposed || this.closing) return;
    const core = this.core;
    if (core.replaying) throw new Error('commands are not accepted while re-simulating recorded ticks');
    if (!core.acceptsLocal) throw new Error('this session takes its commands from custom sources');
    core.local.push(batch instanceof Uint8Array ? batch : new Uint8Array(batch));
    if (this.cmdArrivalTick < 0) this.cmdArrivalTick = core.tick;
    this.cmdQueued++;
  }

  /** Applies a control message. */
  ctl(msg: CtlMessage): void {
    if (this.disposed || this.closing) return;
    const core = this.core;
    const s = this.scheduler;
    const rec = core.replaying ? null : core.recorder;
    const tick = core.tick;
    switch (msg.t) {
      case 'recording': {
        if (core.replaying || msg.enabled === this.persistenceEnabled) break;
        this.persistenceEnabled = msg.enabled;
        if (msg.enabled) this.openPersistence(core);
        else { this.persistenceEpoch++; rec?.detachSink(); this.recorderNote = 'persistence disabled'; }
        this.postStatus(true); break;
      }
      case 'pause':
        if (s.pause()) {
          rec?.mark(tick, MarkKind.Pause);
          rec?.flush();
          this.publishFrame();
        }
        break;
      case 'resume':
        if (s.resume()) {
          rec?.mark(tick, MarkKind.Resume);
          this.publishFrame();
        }
        break;
      case 'speed': {
        const p = speedToPermille(msg.speed);
        if (p !== s.speedPermille) {
          s.setSpeedPermille(p);
          rec?.mark(tick, MarkKind.Speed, s.speedPermille);
          if (s.paused) this.publishFrame();
        }
        break;
      }
      case 'step': {
        const n = Math.min(msg.ticks, MAX_STEP_TICKS);
        if (s.step(n)) rec?.mark(tick, MarkKind.Step, n);
        break;
      }
      case 'viewer':
        this.viewerArmy = msg.army;
        if (s.paused) this.publishFrame();
        break;
      case 'watch': {
        const h = msg.handles;
        const n = Math.min(h.length, MAX_WATCH);
        for (let i = 0; i < n; i++) this.watchHandles[i] = h[i]! >>> 0;
        this.watchCount = n;
        // Paused selection still needs fresh authoritative detail without running a tick.
        if (s.paused) this.publishFrame();
        break;
      }
      case 'debug':
        this.debugFlags = msg.flags >>> 0;
        if (s.paused) this.publishFrame();
        break;
      case 'devReload': {
        const c0 = this.clock.now();
        if (msg.simBin !== undefined) {
          // Throws (⇒ `error` message, nothing changed) if the table is not compatible.
          core.devReload(new Uint8Array(msg.simBin));
        } else {
          rec?.mark(tick, MarkKind.DevReload);
        }
        this.devReloads++;
        this.devReloadMs = this.clock.now() - c0;
        this.postStatus(true);
        if (s.paused) this.publishFrame();
        break;
      }
      case 'exportLog': {
        const r = core.recorder;
        if (r === null) throw new Error('no command log recorded');
        const bytes = r.export(tick);
        this.post({ t: 'log', bytes }, [bytes]);
        break;
      }
      case 'shutdown': {
        void this.closeSession().catch(error => { this.postError(error); this.dispose(); });
        break;
      }
    }
  }

  /** Freeze commands before waiting for an in-flight OPFS open, then persist the final END. */
  private async closeSession(): Promise<void> {
    this.closing = true;
    this.aiRef?.dispose(); this.schedulerRef?.dispose();
    if (this.persistencePending !== null) await this.persistencePending;
    if (this.disposed) return;
    this.coreRef?.recorder?.finish(this.core.tick);
    this.dispose(); this.post({ t: 'closed' }, []);
  }

  // ---- tick loop (SchedulerTarget) -------------------------------------------------------------

  /** Runs one tick (called by the scheduler). False if a source is pending. */
  advance(): boolean {
    const core = this.coreRef!;
    const c = this.clock;
    const h0 = c.now();
    const probe = this.probe;
    probe.lastUs.fill(0);
    this.ackPostFailed = false;
    if (!core.runTick(this.tickProbe)) {
      if (this.aiRef !== null && !core.replaying) this.aiWaits.blocked(core.tick + 1);
      return false;
    }
    if (!core.replaying) this.matchStats?.observe(core.world);
    // Totals leave the worker in the first tick after the match ended (the client may pause the
    // session right then, before trailing projectiles land); the running HUD never sees them.
    if (!this.matchStatsPosted && this.matchStats !== null && !core.replaying && hasMatchEnded(core.world)) {
      this.matchStatsPosted = true; this.matchStats.settle(core.world); this.post({ t: 'matchStats', stats: this.matchStats.snapshot() }, []);
    }
    if (hasMatchEnded(core.world) && core.world.projectiles.liveCount === 0) this.schedulerRef?.pause();
    if (this.cmdArrivalTick >= 0 && core.local.queued === 0) {
      // Every batch that arrived since cmdArrivalTick went into this tick.
      const d = core.tick - this.cmdArrivalTick;
      if (d > this.cmdApplyTicksMax) this.cmdApplyTicksMax = d;
      this.cmdBatchesApplied += this.cmdQueued;
      this.cmdQueued = 0;
      this.cmdArrivalTick = -1;
    }
    const total = (c.now() - h0) * 1000;
    const stepUs = probe.lastUs[Metric.Tick]!;
    const hostUs = total - stepUs;
    probe.lastUs[Metric.Host] = hostUs;
    this.stats.record(Metric.Host, hostUs);
    if (core.tick % STATS_EVERY_TICKS === 0) this.postStats();
    // A failed ACK transport must not interrupt derived Output, recording, keyframes or the
    // actual command-application counters. Surface it after all committed-tick bookkeeping.
    if (this.ackPostFailed) throw this.ackPostError;
    return true;
  }

  /** Observes the sequence actually processed by the completed authoritative phases. */
  private postCommittedAck(): void {
    if (this.commandArmy < 0) return;
    const core = this.core;
    const ackSeq = core.world.armies.col.lastAckSeq[this.commandArmy]!;
    if (ackSeq <= 0 || ackSeq > 0xffff || ackSeq === this.lastPostedAck) return;
    this.post({ t: 'ack', army: this.commandArmy, tick: core.tick, ackSeq }, NO_TRANSFER);
    this.lastPostedAck = ackSeq;
  }

  sliceEnd(_ticksRun: number): void {
    this.publishFrame();
  }

  stateChanged(): void {
    this.postStatus(false);
  }

  failed(error: unknown): void {
    this.postError(error);
    // The scheduler paused itself: show it (paused bit) instead of a silently frozen picture.
    this.publishFrame();
  }

  /**
   * Runs up to `n` ticks immediately (bypassing the scheduler clock, also while paused) and
   * publishes one frame afterwards. For tests, benches and tools. Returns the ticks run.
   */
  runTicks(n: number): number {
    if (this.disposed) return 0;
    let ran = 0;
    while (ran < n && this.advance()) ran++;
    if (ran > 0) this.sliceEnd(ran);
    return ran;
  }

  // ---- output ---------------------------------------------------------------------------------

  /** Writes and publishes the frame of the current state (paused bit, viewer, debug section). */
  publishFrame(): void {
    const core = this.coreRef;
    const producer = this.producerRef;
    if (core === null || producer === null || this.disposed) return;
    const c = this.clock;
    const f0 = c.now();
    const meta = this.meta;
    const s = this.schedulerRef!;
    meta.seq = ++this.frameSeq >>> 0;
    const tickUs = this.probe.lastUs[Metric.Tick]!;
    meta.tickTimeUs = tickUs > 0 ? Math.round(tickUs) : 0;
    meta.speedPermille = s.speedPermille;
    meta.flags = s.paused ? FrameFlags.Paused : 0;
    const target = producer.begin();
    let len = writeFrame(core.world, this.viewerArmy, this.writer, target, meta, this.watchHandles, this.watchCount);
    if ((this.debugFlags & DebugFlags.PhaseTimes) !== 0) len = this.appendPhaseTimes(target, len);
    const dropped = producer.dropped;
    producer.commit(len);
    // A dropped frame while paused would leave the client without the paused state: retry when
    // a transfer buffer comes back.
    this.republishPending = s.paused && producer.dropped !== dropped && this.transportKind === 'transfer';
    const us = (c.now() - f0) * 1000;
    this.probe.lastUs[Metric.Frame] = us;
    this.stats.record(Metric.Frame, us);
  }

  /** Appends the PhaseTimes debug section behind a packed frame; returns the new length. */
  private appendPhaseTimes(target: Uint8Array, len: number): number {
    const dv = this.debugDv;
    dv.setUint16(0, DebugSectionKind.PhaseTimes, true);
    dv.setUint16(2, METRIC_COUNT, true);
    const last = this.probe.lastUs;
    for (let i = 0; i < METRIC_COUNT; i++) {
      const v = last[i]!;
      dv.setUint32(4 + i * 4, v > 0 ? Math.min(0xffffffff, Math.round(v)) : 0, true);
    }
    const b = this.debugBuf;
    for (let i = 0; i < b.length; i++) target[len + i] = b[i]!;
    // The writer left debugOffset = len and debugBytes = 0 (records are 4-byte multiples).
    target[FH_DEBUG_BYTES] = b.length & 0xff;
    target[FH_DEBUG_BYTES + 1] = (b.length >>> 8) & 0xff;
    target[FH_DEBUG_BYTES + 2] = 0;
    target[FH_DEBUG_BYTES + 3] = 0;
    return len + b.length;
  }

  /**
   * Sends `stats` (every STATS_EVERY_TICKS ticks). Allocation-free: the message and its phase
   * entries are one reused object graph — `post` must serialize synchronously (postMessage does;
   * test hosts clone), see HostPost.
   */
  private postStats(): void {
    const st = this.stats;
    const sum = this.summary;
    const msg = this.statsMsg;
    const phases = msg.phases;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i]!;
      st.summarize(p.id, sum);
      p.p50Us = Math.round(sum.p50);
      p.p95Us = Math.round(sum.p95);
    }
    st.summarize(Metric.Tick, sum);
    msg.tick = this.coreRef!.tick;
    msg.ai = this.aiMetrics();
    msg.tickP50Us = Math.round(sum.p50);
    msg.tickP95Us = Math.round(sum.p95);
    msg.tickP99Us = Math.round(sum.p99);
    msg.samples = sum.count;
    st.summarize(Metric.HashTick, sum);
    msg.hashTickP50Us = Math.round(sum.p50);
    msg.hashTickP95Us = Math.round(sum.p95);
    msg.frameP95Us = Math.round(st.percentile(Metric.Frame, 0.95));
    msg.cmdBatchesApplied = this.cmdBatchesApplied;
    msg.cmdApplyTicksMax = this.cmdApplyTicksMax;
    const w = this.coreRef!.world;
    const nav = w.nav;
    const ps = msg.path;
    ps.pending = nav.pendingCount;
    ps.requestsIssued = nav.requestsIssued;
    ps.repathsTriggered = nav.repathsTriggered;
    ps.expansionsLastTick = nav.expansionsLastTick;
    ps.stuckGiveUps = w.header.i32[WH_STUCK_GIVEUPS]!;
    this.post(msg, NO_TRANSFER);
  }

  /** Current status (also sent as `status`). */
  status(): HostStatusMsg {
    const core = this.core;
    const s = this.scheduler;
    const rec = core.recorder;
    return {
      t: 'status',
      ai: this.aiMetrics(),
      tick: core.tick,
      paused: s.paused,
      speed: s.speedFactor,
      ticksBehind: s.ticksBehind,
      recorder: rec === null ? 'memory' : rec.storage,
      recorderNote: rec === null ? 'recording disabled' : (rec.sinkError !== null ? `OPFS write failed: ${rec.sinkError}` : this.recorderNote),
      tainted: rec?.tainted ?? false,
      lostTicks: s.lostTicks,
      waiting: s.waitingForSource,
      framesDropped: this.producerRef?.dropped ?? 0,
      logBytes: rec?.byteLength ?? 0,
      simHash: core.world.bp.simHash >>> 0,
      simId: core.simId >>> 0,
      devReloads: this.devReloads,
      devReloadMs: this.devReloadMs,
      navPrecomputeMs: this.navStaticMs + this.navDerivedMs,
    };
  }

  /** Sends `status` if something relevant changed (or always with `force`). */
  private postStatus(force: boolean): void {
    if (this.coreRef === null || this.disposed) return;
    const st = this.status();
    const key = `${st.paused}|${st.speed}|${st.ticksBehind}|${st.recorder}|${st.recorderNote}|${st.tainted}|${st.waiting}|${this.scheduler.queuedSteps}|${st.tick}|${st.simId}|${st.devReloads}`;
    if (!force && key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    this.post(st, []);
  }

  private postError(e: unknown): void {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    try {
      this.post({ t: 'error', message }, []);
    } catch {
      // the port is gone; nothing left to report to
    }
  }

  /** Stops the loop, closes the transport and flushes/closes the log. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.persistenceEpoch++;
    this.schedulerRef?.dispose();
    this.aiRef?.dispose();
    this.producerRef?.close();
    if (this.portListener !== null) this.options.port?.removeEventListener('message', this.portListener);
    this.coreRef?.recorder?.close();
  }
}
