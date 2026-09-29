/**
 * SimHost (PLAN §3.4, §3.6): owns the world of one session and connects it to the main thread.
 * Engine-neutral — runs in a dedicated worker (see worker.ts) and in Node (tests, bench).
 *
 * - `init` ⇒ world from sim.bin, frame transport (SAB triple buffer or transfer ping-pong),
 *   command-log recorder (OPFS when available), keyframes, scheduler; replies `ready`.
 * - `cmd` ⇒ LocalSource: applied in the next tick that runs (also while paused).
 * - `ctl` ⇒ pause/resume/speed/step/viewer/watch/debug/devReload/exportLog.
 * - per slice one frame (viewer from ctl.viewer, paused bit, optional debug section with phase
 *   times); `stats` every 10 ticks, `status` on state changes.
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
import { ACTIVE_PHASES, PhaseId, writeFrame, type FrameMeta } from '@faf/sim';
import { performanceClock, type Clock, type Wakeup } from './clock.ts';
import { SimCore } from './core.ts';
import { SIM_BUILD, testPlaneMapSimHash } from './identity.ts';
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
}

/** `ready` with identity details. */
export interface HostReadyMsg extends ReadyMsg {
  readonly simBuild: string;
  readonly bpSimHash: number;
  readonly mapSimHash: number;
  readonly seed: number;
  readonly tick: number;
}

/** `stats` with a few extra percentiles. */
export interface HostStatsMsg extends StatsMsg {
  readonly tick: number;
  readonly tickP99Us: number;
  readonly hashTickP50Us: number;
  readonly frameP95Us: number;
  readonly samples: number;
}

/** InitMessage plus optional host extensions. */
export interface HostInitMessage extends InitMessage {
  /** Start with the scheduler paused (deterministic E2E, `?autostart=0`). */
  readonly startPaused?: boolean;
}

export type HostPost = (msg: HostMessage, transfer: ArrayBuffer[]) => void;

export interface SimHostOptions {
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

  private coreRef: SimCore | null = null;
  private producerRef: FrameProducer | null = null;
  private schedulerRef: Scheduler | null = null;
  private transportKind: TransportKind = 'transfer';
  private readonly writer = new FrameWriter();
  private readonly meta: FrameMeta = { seq: 0, tickTimeUs: 0, speedPermille: 1000, flags: 0 };
  private readonly debugBuf = new Uint8Array(DEBUG_PHASE_TIMES_BYTES);
  private readonly debugDv = new DataView(this.debugBuf.buffer);
  private viewerArmy = -1;
  private debugFlags = 0;
  private readonly watchHandles = new Uint32Array(MAX_WATCH);
  private watchCount = 0;
  private frameSeq = 0;
  private republishPending = false;
  private recorderNote: string | null = null;
  private portListener: ((ev: object) => void) | null = null;
  private disposed = false;
  private lastStatusKey = '';
  private readonly summary = emptySummary();

  constructor(options: SimHostOptions) {
    this.options = options;
    this.post = options.post;
    this.clock = options.clock ?? performanceClock;
    this.stats = new PhaseStats(options.statsWindow ?? 256);
    this.probe = new TimingProbe(this.clock, this.stats);
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
    if (this.disposed || isFrameReturnMsg(data)) return;
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
    const core = new SimCore({
      simBin: new Uint8Array(msg.simBin),
      seed: msg.seed,
      armyCount: msg.armyCount,
      playerArmy: msg.playerArmy,
      buildHash: msg.buildHash,
      keyframes: this.options.keyframes ?? {},
      ...(this.options.logCapacity !== undefined ? { recorder: { initialCapacity: this.options.logCapacity } } : {}),
    });
    const producer = createFrameProducer({
      kind: msg.transport,
      capacity: msg.frameCapacity,
      sab: msg.frameSab,
      port: this.options.port,
    });
    this.coreRef = core;
    this.producerRef = producer;
    this.transportKind = msg.transport;
    this.viewerArmy = msg.playerArmy;
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
    const mapSimHash = testPlaneMapSimHash(core.world.mapSizeWu);
    const ready: HostReadyMsg = {
      t: 'ready',
      simId: core.simId,
      layoutHash: core.world.layoutHash >>> 0,
      transport: msg.transport,
      simBuild: SIM_BUILD,
      bpSimHash: core.world.bp.simHash >>> 0,
      mapSimHash,
      seed: core.world.seed >>> 0,
      tick: core.tick,
    };
    this.post(ready, []);
    this.openPersistence(core);
    this.publishFrame();
    this.postStatus(true);
    if (this.options.autoStart !== false) this.schedulerRef.start();
  }

  private openPersistence(core: SimCore): void {
    const rec = core.recorder;
    const provider = this.options.opfs === undefined ? opfsRoot : this.options.opfs;
    if (rec === null) return;
    if (provider === null) {
      this.recorderNote = 'persistence disabled';
      return;
    }
    provider()
      .then((root) => {
        if (root === null) {
          this.recorderNote = 'OPFS unavailable: memory only';
          return null;
        }
        return openOpfsLogSink(root, { simId: core.simId, keep: this.options.keepLogs ?? DEFAULT_KEEP_LOGS });
      })
      .then((sink) => {
        if (sink === null) return;
        if (this.disposed) {
          sink.close();
          return;
        }
        if (!rec.attachSink(sink)) this.recorderNote = `OPFS write failed: ${rec.sinkError ?? 'unknown'}`;
        else this.recorderNote = null;
      })
      .catch((e: unknown) => {
        this.recorderNote = `OPFS unavailable: ${e instanceof Error ? e.message : String(e)}`;
      })
      .finally(() => {
        if (!this.disposed) this.postStatus(true);
      });
  }

  /** Queues a command batch (tick 0) for the next tick. Accepted while paused. */
  submit(batch: ArrayBuffer | Uint8Array): void {
    const core = this.core;
    if (core.replaying) throw new Error('commands are not accepted while re-simulating recorded ticks');
    if (!core.acceptsLocal) throw new Error('this session takes its commands from custom sources');
    core.local.push(batch instanceof Uint8Array ? batch : new Uint8Array(batch));
  }

  /** Applies a control message. */
  ctl(msg: CtlMessage): void {
    const core = this.core;
    const s = this.scheduler;
    const rec = core.replaying ? null : core.recorder;
    const tick = core.tick;
    switch (msg.t) {
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
        break;
      }
      case 'debug':
        this.debugFlags = msg.flags >>> 0;
        if (s.paused) this.publishFrame();
        break;
      case 'devReload':
        rec?.mark(tick, MarkKind.DevReload);
        this.postStatus(true);
        break;
      case 'exportLog': {
        const r = core.recorder;
        if (r === null) throw new Error('no command log recorded');
        const bytes = r.export(tick);
        this.post({ t: 'log', bytes }, [bytes]);
        break;
      }
    }
  }

  // ---- tick loop (SchedulerTarget) -------------------------------------------------------------

  /** Runs one tick (called by the scheduler). False if a source is pending. */
  advance(): boolean {
    const core = this.coreRef!;
    const c = this.clock;
    const h0 = c.now();
    const probe = this.probe;
    probe.lastUs.fill(0);
    if (!core.runTick(probe)) return false;
    const total = (c.now() - h0) * 1000;
    const stepUs = probe.lastUs[Metric.Tick]!;
    const hostUs = total - stepUs;
    probe.lastUs[Metric.Host] = hostUs;
    this.stats.record(Metric.Host, hostUs);
    if (core.tick % STATS_EVERY_TICKS === 0) this.postStats();
    return true;
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
    let len = writeFrame(core.world, this.viewerArmy, this.writer, target, meta);
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

  private postStats(): void {
    const st = this.stats;
    const sum = this.summary;
    const phases: PhaseStat[] = [];
    const ids = ACTIVE_PHASES;
    for (let i = 0; i < ids.length; i++) phases.push(this.phaseStat(ids[i]!));
    phases.push(this.phaseStat(PhaseId.HashTick));
    phases.push(this.phaseStat(Metric.Frame));
    phases.push(this.phaseStat(Metric.Host));
    st.summarize(Metric.Tick, sum);
    const tickP50 = Math.round(sum.p50);
    const tickP95 = Math.round(sum.p95);
    const tickP99 = Math.round(sum.p99);
    const samples = sum.count;
    st.summarize(Metric.HashTick, sum);
    const msg: HostStatsMsg = {
      t: 'stats',
      tick: this.coreRef!.tick,
      tickP50Us: tickP50,
      tickP95Us: tickP95,
      tickP99Us: tickP99,
      hashTickP50Us: Math.round(sum.p50),
      hashTickP95Us: Math.round(sum.p95),
      frameP95Us: Math.round(st.percentile(Metric.Frame, 0.95)),
      samples,
      phases,
    };
    this.post(msg, []);
  }

  private phaseStat(id: number): PhaseStat {
    const sum = this.stats.summarize(id, this.summary);
    return { id, name: METRIC_NAMES[id]!, p50Us: Math.round(sum.p50), p95Us: Math.round(sum.p95) };
  }

  /** Current status (also sent as `status`). */
  status(): HostStatusMsg {
    const core = this.core;
    const s = this.scheduler;
    const rec = core.recorder;
    return {
      t: 'status',
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
    };
  }

  /** Sends `status` if something relevant changed (or always with `force`). */
  private postStatus(force: boolean): void {
    if (this.coreRef === null || this.disposed) return;
    const st = this.status();
    const key = `${st.paused}|${st.speed}|${st.ticksBehind}|${st.recorder}|${st.recorderNote}|${st.tainted}|${st.waiting}|${this.scheduler.queuedSteps}|${st.tick}`;
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
    this.schedulerRef?.dispose();
    this.producerRef?.close();
    if (this.portListener !== null) this.options.port?.removeEventListener('message', this.portListener);
    this.coreRef?.recorder?.close();
  }
}
