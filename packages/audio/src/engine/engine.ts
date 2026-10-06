/**
 * AudioEngine facade (PLAN §3.7, docs/design/audio.md): wires the modules of @faf/audio into the
 * single object the game client (MS5) and the demo talk to.
 *
 * Graph of responsibilities:
 * - AudioContext (given, factory, or lazily `new AudioContext({latencyHint, sampleRate: 48000})`
 *   with a fallback without `sampleRate`), Mixer, SettingsController (+ persistence, visibility
 *   mute) and the AutoplayUnlocker exist from construction on — `unlock()` must be callable
 *   synchronously inside the first user gesture, even while the manifest is still being fetched.
 * - Everything that needs the manifest (SoundCatalog, DecodeChain, SoundLoader, VoiceManager,
 *   LoopSet, AlertQueue, EventRouter) is the "core"; it is built synchronously when
 *   `opts.manifest` is given, otherwise once `manifestUrl` was fetched (`engine.ready`).
 * - State gate: while the engine is 'locked' or 'suspended' every event/one-shot play is dropped
 *   with reason 'locked' (no replay of stale battle sounds after the unlock); while the mixer is
 *   muted one-shots are dropped with reason 'muted'. Alerts are still announced (history,
 *   `onAlert`, jump-to) without a voice. Keyed loops are kept and start as soon as the context
 *   runs (LoopSet retry), muted loops keep running silently.
 * - Main-thread cost: the JS time of handleEvents + play + playUi + update is summed per frame
 *   (frame boundary = `update()`) into a Float64Array(1024) ring; percentiles are computed only
 *   in `stats()`.
 *
 * Hot path (handleEvents / play / update per frame) allocates nothing beyond what the voice
 * manager allocates per started voice (three Web Audio nodes + one handle).
 */

import { AlertQueue } from '../alerts/index.ts';
import { SoundCatalog, parseManifest } from '../catalog/index.ts';
import { DEFAULT_EVENT_SOUND_MAP, parseEventSoundMap, withWeaponSounds, type EventSoundMap } from '../events/index.ts';
import {
  SoundLoader,
  createDecodeChain,
  loadManifest,
  type DecodeChain,
  type DecoderLike,
  type FetchLike,
  type LoadProgress,
  type LoadFailure,
  type SoundLoadReport,
} from '../loader/index.ts';
import { Mixer } from '../mixer/index.ts';
import type { AudioBufferLike, AudioContextLike } from '../ports.ts';
import { EventRouter } from '../router/index.ts';
import {
  attachVisibilityMute,
  bindSettingsToMixer,
  createSettingsController,
  localStorageSettingsStore,
  type VisibilityDocument,
} from '../settings/index.ts';
import { CameraSpatialModel } from '../spatial/index.ts';
import {
  DECODE_PATHS,
  DROP_REASONS,
  SOUND_CATEGORIES,
  type AlertRecord,
  type AlertMode,
  type AlertRequest,
  type AudioEngine,
  type AudioEventSource,
  type AudioManifest,
  type AudioSettings,
  type AudioStats,
  type ChannelBus,
  type CreateAudioEngineOptions,
  type DecodePath,
  type DropReason,
  type EngineState,
  type ListenerState,
  type LoadFilter,
  type PlayRequest,
  type ResolvedSound,
  type SettingsController,
  type SoundCategory,
  type SoundResolver,
  type SoundSink,
  type TimingStats,
  type VoiceHandle,
} from '../types.ts';
import { AutoplayUnlocker, type UnlockListener } from '../unlock/index.ts';
import { LoopSet, VoiceManager, createVoiceStats, type VoiceStats } from '../voices/index.ts';

// ---------------------------------------------------------------------------------------------
// Public constants and option extensions
// ---------------------------------------------------------------------------------------------

/** Default faction scope of sound lookups. */
export const DEFAULT_FACTION = 'varkan';
/** Size of the per-frame main-thread timing ring (frames). */
export const MAIN_JS_RING_SIZE = 1024;
/** Ducking of the sfx bus while an alert speaks (dB). */
export const ALERT_DUCK_SFX_DB = -6;
/** Ducking of the music and ambience buses while an alert speaks (dB). */
export const ALERT_DUCK_BED_DB = -8;
/** Attack of the alert ducking (ms). */
export const ALERT_DUCK_ATTACK_MS = 30;
/** Release of the alert ducking after the alert ended (ms). */
export const ALERT_DUCK_RELEASE_MS = 400;

const DUCK_SFX: readonly ChannelBus[] = ['sfx'];
const DROP_NOT_LOADED = DROP_REASONS.indexOf('notLoaded');
const DUCK_BED: readonly ChannelBus[] = ['music', 'ambience'];

/**
 * Engine-specific options beyond the contract in types.ts (all optional; mainly for tests,
 * benchmarks and the demo).
 */
export interface EngineExtraOptions {
  /** Where the tab visibility is observed for "mute when hidden" (default globalThis.document; null = never). */
  visibilityDocument?: VisibilityDocument | null | undefined;
  /** Stopwatch in ms for the main-thread timing (default performance.now, else `clock`). */
  timer?: (() => number) | undefined;
  /** Random source of the voice manager (variants, rate jitter; default Math.random). */
  random?: (() => number) | undefined;
  /** Decoder of the loader (default: `createDecodeChain(ctx)`). */
  decoder?: DecoderLike | undefined;
  /** Loader progress callback. */
  onLoadProgress?: ((p: LoadProgress) => void) | undefined;
  /** Called for every variant that failed to load (the engine never logs by itself). */
  onLoadError?: ((f: LoadFailure) => void) | undefined;
  /** Maximum parallel fetch+decode jobs (default 6). */
  loadConcurrency?: number | undefined;
  /** Initial settings merged under the persisted ones (e.g. from a URL parameter). */
  initialSettings?: Partial<AudioSettings> | undefined;
}

/** Options accepted by {@link createAudioEngine}. */
export type AudioEngineOptions = CreateAudioEngineOptions & EngineExtraOptions;

/**
 * The engine as returned by {@link createAudioEngine}: the {@link AudioEngine} contract plus
 * diagnostics (module instances for the demo HUD and tests) and a readiness promise.
 */
export interface FafAudioEngine extends AudioEngine {
  /** Resolves once the manifest is parsed and all modules exist; rejects on manifest errors. */
  readonly ready: Promise<void>;
  /** The AudioContext in use. */
  readonly context: AudioContextLike;
  readonly mixer: Mixer;
  readonly spatial: CameraSpatialModel;
  /** Null until {@link ready}. */
  readonly catalog: SoundCatalog | null;
  readonly loader: SoundLoader | null;
  readonly voices: VoiceManager | null;
  readonly loops: LoopSet | null;
  readonly alerts: AlertQueue | null;
  readonly router: EventRouter | null;
  /** Faction scope of name lookups. */
  readonly faction: string;
  /** True while any mute source (user, hidden tab, system) is active. */
  readonly muted: boolean;
  /** Subscribes to engine state changes; returns the unsubscribe function. */
  onStateChange(fn: UnlockListener): () => void;
  /** Announced alerts, newest first (allocates; UI only). */
  alertHistory(): AlertRecord[];
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

interface AudioContextCtor {
  new (opts?: { latencyHint?: string; sampleRate?: number }): AudioContextLike;
}

/** `new AudioContext({latencyHint: 'interactive', sampleRate: 48000})`, fallback without sampleRate. */
export function createDefaultAudioContext(): AudioContextLike {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (Ctor === undefined) throw new Error('createAudioEngine: no AudioContext available; pass options.context');
  try {
    return new Ctor({ latencyHint: 'interactive', sampleRate: 48000 });
  } catch {
    // Some engines reject a fixed sample rate that differs from the device rate.
    return new Ctor({ latencyHint: 'interactive' });
  }
}

function defaultTimer(): (() => number) | null {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p !== undefined && typeof p.now === 'function' ? () => p.now() : null;
}

function defaultVisibilityDocument(): VisibilityDocument | null {
  const d = (globalThis as { document?: unknown }).document as Partial<VisibilityDocument> | undefined;
  if (d === undefined || d === null) return null;
  return typeof d.addEventListener === 'function' && typeof d.visibilityState === 'string' ? (d as VisibilityDocument) : null;
}

function defaultUnlockTarget(): EventTarget | null {
  const d = (globalThis as { document?: EventTarget }).document;
  return d !== undefined && d !== null && typeof d.addEventListener === 'function' ? d : null;
}

function latencyMs(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v * 1000 : null;
}

/**
 * Resolver view the voice manager uses: identical to the catalog except that alert sounds have
 * no per-sound cooldown. The alert queue owns the alert repeat interval (manifest `cooldownMs`
 * of the alert sounds, e.g. 15 s) including the location exception; applying the same interval
 * again in the voice manager would silently drop every location-exception announcement
 * (conflict documented in audioeng-b3 §6). The queue already guarantees one alert voice.
 */
class VoiceResolver implements SoundResolver {
  private readonly overrides: (ResolvedSound | null)[];

  constructor(private readonly catalog: SoundCatalog) {
    this.overrides = new Array<ResolvedSound | null>(catalog.size).fill(null);
    for (let i = 0; i < catalog.size; i++) {
      const s = catalog.byIndex(i);
      if (s.category === 'alert' && s.cooldownMs !== 0) this.overrides[i] = Object.freeze({ ...s, cooldownMs: 0 });
    }
  }

  get size(): number {
    return this.catalog.size;
  }

  resolve(nameOrId: string, faction: string): ResolvedSound | null {
    const i = this.catalog.resolveIndex(nameOrId, faction);
    return i < 0 ? null : this.byIndex(i);
  }

  byIndex(index: number): ResolvedSound {
    return this.overrides[index] ?? this.catalog.byIndex(index);
  }

  buffer(index: number, variant: number): AudioBufferLike | null {
    return this.catalog.buffer(index, variant);
  }

  isLoaded(index: number): boolean {
    return this.catalog.isLoaded(index);
  }

  requestLoad(index: number): void {
    this.catalog.requestLoad(index);
  }
}

/** Why the gate currently rejects a play (null = open). */
type GateFn = (forLoop: boolean) => DropReason | null;

/**
 * SoundSink in front of the voice manager that applies the engine state gate. `countDrops`
 * decides whether a gated request is counted in the drop statistics (not for loop retries,
 * which would otherwise count 10 times per second and loop).
 */
class GatedSink implements SoundSink {
  lastDrop: DropReason | null = null;

  constructor(
    private readonly voices: VoiceManager,
    private readonly gate: GateFn,
    private readonly forLoops: boolean,
  ) {}

  play(req: PlayRequest, nowMs: number): VoiceHandle | null {
    const reason = this.gate(this.forLoops);
    if (reason !== null) {
      if (!this.forLoops) this.voices.countDrop(reason);
      this.lastDrop = reason;
      return null;
    }
    const h = this.voices.play(req, nowMs);
    this.lastDrop = this.voices.lastDrop;
    return h;
  }
}

function copyRequest(src: PlayRequest): PlayRequest {
  return {
    sound: src.sound,
    faction: src.faction,
    x: src.x,
    z: src.z,
    gain: src.gain,
    rate: src.rate,
    when: src.when,
    priorityBoost: src.priorityBoost,
    loop: src.loop,
    spatial: src.spatial,
  };
}

/** Nearest-rank percentile of the first `n` sorted values. */
function percentile(sorted: Float64Array, n: number, p: number): number {
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[idx]!;
}

/** Percentiles of a duration series (ms). */
export function timingStats(values: Float64Array, n: number, scratch?: Float64Array): TimingStats {
  const buf = scratch !== undefined && scratch.length >= n ? scratch : new Float64Array(n);
  const view = buf.subarray(0, n);
  view.set(values.subarray(0, n));
  view.sort();
  return {
    samples: n,
    p50: percentile(view, n, 0.5),
    p95: percentile(view, n, 0.95),
    p99: percentile(view, n, 0.99),
    max: n === 0 ? 0 : view[n - 1]!,
  };
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

interface Core {
  readonly catalog: SoundCatalog;
  readonly decode: DecodeChain | null;
  readonly loader: SoundLoader;
  readonly voices: VoiceManager;
  readonly loops: LoopSet;
  readonly alerts: AlertQueue;
  readonly router: EventRouter;
  /** Gated sinks: events + play (counted), alerts (counted), loops (not counted). */
  readonly eventSink: GatedSink;
  readonly alertSink: GatedSink;
}

class AudioEngineImpl implements FafAudioEngine {
  readonly settings: SettingsController;
  readonly context: AudioContextLike;
  readonly mixer: Mixer;
  readonly spatial: CameraSpatialModel;
  readonly faction: string;
  readonly ready: Promise<void>;

  private readonly opts: AudioEngineOptions;
  private readonly ownsContext: boolean;
  private readonly clock: () => number;
  private readonly timer: () => number;
  private readonly eventMap: EventSoundMap;
  private readonly unlocker: AutoplayUnlocker;
  private readonly detachers: (() => void)[] = [];
  private core: Core | null = null;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  // Settings applied before the core exists.
  private listenerSet = false;
  private simSpeed = 1;
  private alertMode: AlertMode = 'voice';
  private readonly pendingLoops = new Map<string, PlayRequest | null>();
  private preReadyEvents = 0;
  private readonly preReadyDrops = new Int32Array(DROP_REASONS.length);

  // Pooled requests / stats buffers.
  private readonly uiReq: PlayRequest = {
    sound: '',
    faction: undefined,
    x: undefined,
    z: undefined,
    gain: undefined,
    rate: undefined,
    when: undefined,
    priorityBoost: undefined,
    loop: undefined,
  };
  private readonly voiceStats: VoiceStats = createVoiceStats();

  // Main-thread timing ring.
  private readonly ring = new Float64Array(MAIN_JS_RING_SIZE);
  private readonly ringScratch = new Float64Array(MAIN_JS_RING_SIZE);
  private ringPos = 0;
  private ringCount = 0;
  private frameAccum = 0;
  private frameTouched = false;

  constructor(opts: AudioEngineOptions) {
    this.opts = opts;
    this.faction = opts.faction ?? DEFAULT_FACTION;
    const perf = defaultTimer();
    this.clock = opts.clock ?? perf ?? (() => Date.now());
    this.timer = opts.timer ?? perf ?? this.clock;
    const baseMap = opts.eventMap === undefined ? DEFAULT_EVENT_SOUND_MAP : parseEventSoundMap(opts.eventMap);
    this.eventMap = opts.weaponSounds === undefined ? baseMap : withWeaponSounds(baseMap, opts.weaponSounds);

    // Settings first: they exist even if the context cannot be created.
    const store = opts.settingsStore === undefined ? localStorageSettingsStore() : opts.settingsStore;
    this.settings = createSettingsController(store, opts.initialSettings);

    const c = opts.context;
    this.context = c === undefined ? createDefaultAudioContext() : typeof c === 'function' ? c() : c;
    this.ownsContext = c === undefined || typeof c === 'function';

    this.mixer = new Mixer(this.context);
    this.detachers.push(bindSettingsToMixer(this.settings, this.mixer));
    const visDoc = opts.visibilityDocument === undefined ? defaultVisibilityDocument() : opts.visibilityDocument;
    if (visDoc !== null) this.detachers.push(attachVisibilityMute(visDoc, this.settings, this.mixer));

    this.spatial = new CameraSpatialModel();

    const target = opts.unlockTarget === undefined ? defaultUnlockTarget() : opts.unlockTarget;
    this.unlocker = new AutoplayUnlocker(this.context, target);
    this.detachers.push(this.unlocker.onChange((s) => this.onEngineState(s)));

    if (opts.manifest !== undefined) {
      this.buildCore(parseManifest(opts.manifest));
      this.ready = Promise.resolve();
    } else {
      const url = opts.manifestUrl ?? `${opts.baseUrl}manifest.json`;
      const fetchFn = opts.fetch as FetchLike | undefined;
      this.ready = (fetchFn !== undefined ? loadManifest(url, fetchFn) : loadManifest(url)).then((m) => {
        if (!this.disposed) this.buildCore(m);
      });
      // Mark as handled; callers observe failures through `ready` / `load()`.
      this.ready.catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Construction of the manifest-dependent part
  // -------------------------------------------------------------------------------------------

  private buildCore(manifest: AudioManifest): void {
    const opts = this.opts;
    const ctx = this.context;
    const catalog = new SoundCatalog(manifest);
    const decode = opts.decoder === undefined ? createDecodeChain(ctx, { clock: this.clock }) : null;
    const loader = new SoundLoader({
      catalog,
      decode: opts.decoder ?? decode!,
      fetch: opts.fetch as FetchLike | undefined,
      baseUrl: opts.baseUrl,
      concurrency: opts.loadConcurrency,
      onProgress: opts.onLoadProgress,
      onError: opts.onLoadError,
    });
    const voices = new VoiceManager({
      ctx,
      mixer: this.mixer,
      resolver: new VoiceResolver(catalog),
      spatial: this.spatial,
      faction: this.faction,
      maxVoices: opts.maxVoices ?? manifest.maxVoices,
      clockMs: this.clock,
      random: opts.random,
    });
    const gate: GateFn = (forLoop) => this.gateReason(forLoop);
    const eventSink = new GatedSink(voices, gate, false);
    const alertSink = new GatedSink(voices, gate, false);
    const loopSink = new GatedSink(voices, gate, true);
    const loops = new LoopSet(loopSink);
    const mixer = this.mixer;
    const alerts = new AlertQueue({
      resolver: catalog,
      faction: this.faction,
      clockMs: this.clock,
      rules: this.eventMap.alerts,
      onJumpTo: opts.onJumpTo,
      onAlert: opts.onAlert,
      onAlertStart: (durationS: number) => {
        const holdMs = durationS * 1000;
        mixer.duck(DUCK_SFX, ALERT_DUCK_SFX_DB, ALERT_DUCK_ATTACK_MS, holdMs, ALERT_DUCK_RELEASE_MS);
        mixer.duck(DUCK_BED, ALERT_DUCK_BED_DB, ALERT_DUCK_ATTACK_MS, holdMs, ALERT_DUCK_RELEASE_MS);
      },
    });
    const router = new EventRouter({
      map: this.eventMap,
      eventTypes: opts.eventTypes,
      resolver: catalog,
      faction: this.faction,
      visualName: opts.visualName,
      codec: opts.eventCodec,
      alerts,
      spatial: this.spatial,
    });
    alerts.setMode(this.alertMode);
    router.setSimSpeed(this.simSpeed);
    this.core = { catalog, decode, loader, voices, loops, alerts, router, eventSink, alertSink };

    const now = this.clock();
    for (const [key, req] of this.pendingLoops) loops.set(key, req, now);
    this.pendingLoops.clear();
  }

  // -------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------

  get state(): EngineState {
    return this.disposed ? 'closed' : this.unlocker.state;
  }

  get muted(): boolean {
    return this.mixer.muted;
  }

  get catalog(): SoundCatalog | null {
    return this.core?.catalog ?? null;
  }
  get loader(): SoundLoader | null {
    return this.core?.loader ?? null;
  }
  get voices(): VoiceManager | null {
    return this.core?.voices ?? null;
  }
  get loops(): LoopSet | null {
    return this.core?.loops ?? null;
  }
  get alerts(): AlertQueue | null {
    return this.core?.alerts ?? null;
  }
  get router(): EventRouter | null {
    return this.core?.router ?? null;
  }

  onStateChange(fn: UnlockListener): () => void {
    return this.unlocker.onChange(fn);
  }

  /** Null = open. Loops are only gated by the context state (muted loops keep running). */
  private gateReason(forLoop: boolean): DropReason | null {
    if (this.disposed || this.unlocker.state !== 'running') return 'locked';
    if (!forLoop && this.mixer.muted) return 'muted';
    return null;
  }

  private onEngineState(s: EngineState): void {
    // Start keyed loops right away instead of waiting for their retry slot.
    if (s === 'running' && this.core !== null) this.core.loops.update(Number.POSITIVE_INFINITY);
  }

  // -------------------------------------------------------------------------------------------
  // AudioEngine API
  // -------------------------------------------------------------------------------------------

  unlock(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    return this.unlocker.unlock();
  }

  async load(filter?: LoadFilter): Promise<SoundLoadReport> {
    await this.ready;
    const core = this.core;
    if (core === null) throw new Error('AudioEngine.load: engine disposed');
    return core.loader.load(filter);
  }

  setListener(l: ListenerState): void {
    if (this.disposed) return;
    const t0 = this.timer();
    this.spatial.setListener(l);
    this.listenerSet = true;
    if (this.core !== null) this.core.voices.refreshSpatial();
    this.account(t0);
  }

  setSimSpeed(speed: number): void {
    if (!(speed > 0 && speed < Number.POSITIVE_INFINITY)) return;
    this.simSpeed = speed;
    if (this.core !== null) this.core.router.setSimSpeed(speed);
  }

  handleEvents(src: AudioEventSource): void {
    if (this.disposed) return;
    const t0 = this.timer();
    const core = this.core;
    if (core === null) {
      const n = src.eventCount;
      this.preReadyEvents += n;
      this.preReadyDrops[DROP_NOT_LOADED]! += n;
    } else {
      core.router.handle(src, core.eventSink, this.context.currentTime, this.clock());
    }
    this.account(t0);
  }

  play(req: PlayRequest): VoiceHandle | null {
    if (this.disposed) return null;
    const t0 = this.timer();
    const h = this.playInternal(req);
    this.account(t0);
    return h;
  }

  playUi(name: string): VoiceHandle | null {
    if (this.disposed) return null;
    const t0 = this.timer();
    const req = this.uiReq;
    req.sound = name;
    const h = this.playInternal(req);
    this.account(t0);
    return h;
  }

  private playInternal(req: PlayRequest): VoiceHandle | null {
    const core = this.core;
    if (core === null) {
      this.preReadyDrops[DROP_NOT_LOADED]!++;
      return null;
    }
    return core.eventSink.play(req, this.clock());
  }

  setLoop(key: string, req: PlayRequest | null): void {
    if (this.disposed) return;
    const t0 = this.timer();
    const core = this.core;
    if (core === null) {
      this.pendingLoops.set(key, req === null ? null : copyRequest(req));
    } else {
      core.loops.set(key, req, this.clock());
    }
    this.account(t0);
  }

  alert(req: AlertRequest): boolean {
    if (this.disposed || this.core === null) return false;
    return this.core.alerts.push(req);
  }

  setAlertMode(mode: AlertMode): void {
    if (this.disposed) return;
    this.alertMode = mode;
    this.core?.alerts.setMode(mode);
  }

  jumpToLastAlert(): boolean {
    if (this.disposed || this.core === null) return false;
    return this.core.alerts.jumpToLast();
  }

  alertHistory(): AlertRecord[] {
    return this.core === null ? [] : this.core.alerts.historyList();
  }

  update(nowMs?: number): void {
    if (this.disposed) return;
    const t0 = this.timer();
    const core = this.core;
    if (core !== null) {
      const now = nowMs ?? this.clock();
      core.voices.update(now);
      core.alerts.update(now, core.alertSink);
      core.loops.update(now);
    }
    this.frameAccum += this.timer() - t0;
    this.frameTouched = true;
    this.endFrame();
  }

  // -------------------------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------------------------

  private account(t0: number): void {
    this.frameAccum += this.timer() - t0;
    this.frameTouched = true;
  }

  private endFrame(): void {
    if (!this.frameTouched) return;
    this.ring[this.ringPos] = this.frameAccum;
    this.ringPos = (this.ringPos + 1) % MAIN_JS_RING_SIZE;
    if (this.ringCount < MAIN_JS_RING_SIZE) this.ringCount++;
    this.frameAccum = 0;
    this.frameTouched = false;
  }

  stats(): AudioStats {
    const core = this.core;
    const vs = this.voiceStats;
    if (core !== null) core.voices.snapshotStats(vs);
    const voicesByCategory = {} as Record<SoundCategory, number>;
    for (let i = 0; i < SOUND_CATEGORIES.length; i++) voicesByCategory[SOUND_CATEGORIES[i]!] = core === null ? 0 : vs.byCategory[i]!;
    const dropped = {} as Record<DropReason, number>;
    for (let i = 0; i < DROP_REASONS.length; i++) {
      dropped[DROP_REASONS[i]!] = (core === null ? 0 : vs.dropped[i]!) + this.preReadyDrops[i]!;
    }
    const decodePaths = {} as Record<DecodePath, number>;
    const paths = core?.loader.paths;
    for (const p of DECODE_PATHS) decodePaths[p] = paths?.[p] ?? 0;
    const ctx = this.context;
    return {
      state: this.state,
      voices: core === null ? 0 : vs.voices,
      peakVoices: core === null ? 0 : vs.peakVoices,
      tails: core === null ? 0 : vs.tails,
      voicesByCategory,
      played: core === null ? 0 : vs.played,
      stolen: core === null ? 0 : vs.stolen,
      dropped,
      events: this.preReadyEvents + (core?.router.stats.events ?? 0),
      eventsUnmapped: core?.router.stats.eventsUnmapped ?? 0,
      alertsQueued: core?.alerts.stats.queued ?? 0,
      mainJs: timingStats(this.ring, this.ringCount, this.ringScratch),
      loadedSounds: core?.catalog.loadedSounds ?? 0,
      decodedBytes: core?.catalog.decodedBytes ?? 0,
      decodePaths,
      baseLatencyMs: latencyMs(ctx.baseLatency),
      outputLatencyMs: latencyMs(ctx.outputLatency),
    };
  }

  resetStats(): void {
    const core = this.core;
    if (core !== null) {
      core.voices.resetStats();
      core.router.resetStats();
      core.alerts.resetStats();
    }
    this.preReadyEvents = 0;
    this.preReadyDrops.fill(0);
    this.ringPos = 0;
    this.ringCount = 0;
    this.frameAccum = 0;
    this.frameTouched = false;
  }

  // -------------------------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------------------------

  dispose(): Promise<void> {
    if (this.disposePromise !== null) return this.disposePromise;
    this.disposePromise = this.doDispose();
    return this.disposePromise;
  }

  private async doDispose(): Promise<void> {
    const core = this.core;
    if (core !== null) {
      core.loops.clear(0);
      core.voices.dispose();
      core.loader.dispose();
      core.decode?.dispose();
      core.alerts.clear();
      core.catalog.clearBuffers();
    }
    this.pendingLoops.clear();
    // Listeners first (settings → mixer, visibility), then the unlocker (gesture listeners and
    // the statechange hook); the unlocker's onChange subscription is part of the detachers.
    for (let i = this.detachers.length - 1; i >= 0; i--) this.detachers[i]!();
    this.detachers.length = 0;
    this.unlocker.dispose();
    this.disposed = true;
    this.mixer.dispose();
    this.core = null;
    if (this.ownsContext && this.context.state !== 'closed') {
      try {
        await this.context.close();
      } catch {
        // Already closed by someone else; nothing to release.
      }
    }
  }
}

/**
 * Creates the audio engine. Throws synchronously on an invalid `manifest`, `eventMap` or
 * `weaponSounds`; a
 * failing `manifestUrl` fetch rejects `engine.ready` and every `load()`.
 */
export function createAudioEngine(opts: AudioEngineOptions): FafAudioEngine {
  return new AudioEngineImpl(opts);
}
