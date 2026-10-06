/**
 * Public type contract of @faf/audio (TRACK-AUDIOENG, wave 0).
 *
 * Every module of the package (catalog, loader, unlock, mixer, settings, voices, spatial, alerts,
 * router, engine) builds on these names and semantics; they are binding for all follow-up work
 * packages. Audio is presentation code: nothing here may ever feed back into sim state or hashes.
 *
 * Optional request/option fields are typed `T | undefined` so pooled request objects can be
 * reused on the hot path (reset a field by assigning `undefined`) under
 * `exactOptionalPropertyTypes`.
 */

import type { EventCodec } from './events/codec.ts';
import type { AudioBufferLike, AudioContextLike } from './ports.ts';

// ---------------------------------------------------------------------------------------------
// Categories and buses
// ---------------------------------------------------------------------------------------------

/** Sound category (manifest `category`; prefix convention in docs/design/audio.md §3). */
export type SoundCategory =
  | 'alert'
  | 'music'
  | 'signature'
  | 'ack'
  | 'ui'
  | 'explosion'
  | 'weapon'
  | 'shield'
  | 'impact'
  | 'projectile'
  | 'build'
  | 'intel'
  | 'unit'
  | 'ambience'
  | 'eco';

/**
 * All categories in fixed order (descending manifest priority). The position is the
 * `categoryIndex` used for per-category `Int32Array` counters.
 */
export const SOUND_CATEGORIES: readonly SoundCategory[] = [
  'alert',
  'music',
  'signature',
  'ack',
  'ui',
  'explosion',
  'weapon',
  'shield',
  'impact',
  'projectile',
  'build',
  'intel',
  'unit',
  'ambience',
  'eco',
];

const CATEGORY_INDEX: Readonly<Record<SoundCategory, number>> = {
  alert: 0,
  music: 1,
  signature: 2,
  ack: 3,
  ui: 4,
  explosion: 5,
  weapon: 6,
  shield: 7,
  impact: 8,
  projectile: 9,
  build: 10,
  intel: 11,
  unit: 12,
  ambience: 13,
  eco: 14,
};

/** Index of `c` in {@link SOUND_CATEGORIES} (dense 0..14). */
export function categoryIndex(c: SoundCategory): number {
  return CATEGORY_INDEX[c];
}

/** Type guard for untrusted strings (manifest parsing). */
export function isSoundCategory(s: string): s is SoundCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_INDEX, s);
}

/** Bus names as written in the manifest (`tools/sfx/src/categories.ts`). */
export type ManifestBus = 'sfx' | 'ui' | 'voice' | 'music' | 'ambience';

/** Mixer buses of the engine. */
export type BusId = 'master' | 'sfx' | 'ui' | 'alerts' | 'music' | 'ambience';

/** Buses a voice can be routed to (everything below master). */
export type ChannelBus = Exclude<BusId, 'master'>;

/** All mixer buses; master first. */
export const BUS_IDS: readonly BusId[] = ['master', 'sfx', 'ui', 'alerts', 'music', 'ambience'];

/**
 * Manifest bus → mixer bus. `voice` maps to `alerts`: acknowledgements and alerts share the
 * alerts bus (and its volume slider).
 */
export const MANIFEST_BUS_TO_BUS: Readonly<Record<ManifestBus, ChannelBus>> = {
  sfx: 'sfx',
  ui: 'ui',
  voice: 'alerts',
  music: 'music',
  ambience: 'ambience',
};

/** Type guard for untrusted strings (manifest parsing). */
export function isManifestBus(s: string): s is ManifestBus {
  return Object.prototype.hasOwnProperty.call(MANIFEST_BUS_TO_BUS, s);
}

// ---------------------------------------------------------------------------------------------
// Manifest (content/audio/dist/manifest.json, written by @faf/sfx)
// ---------------------------------------------------------------------------------------------

/** Per-category policy and loudness target. */
export interface ManifestCategory {
  readonly label: string;
  readonly bus: ManifestBus;
  readonly targetLufs: number;
  readonly priority: number;
  readonly cooldownMs: number;
  readonly maxVoices: number;
  readonly channels: 1 | 2;
  readonly maxDurationS: number;
  /** Frequency band hint ('low' | 'mid' | 'high' | 'full'). */
  readonly band: string;
  readonly spatial: boolean;
  readonly opusKbps: number;
}

/** Loop points of a looping sound (the file carries 40 ms wrap-around padding on both ends). */
export interface ManifestLoop {
  /** Loop start in samples at the manifest sample rate (48 kHz). */
  readonly startSample: number;
  /** Loop end (exclusive) in samples at the manifest sample rate. */
  readonly endSample: number;
  /** Loop start in seconds — use these for `AudioBufferSourceNode.loopStart` (rate independent). */
  readonly startS: number;
  /** Loop end in seconds — use these for `AudioBufferSourceNode.loopEnd`. */
  readonly endS: number;
}

/** One rendered variant of a sound. Further measurement fields may be present. */
export interface ManifestVariant {
  readonly index: number;
  /** Opus/WebM path relative to the dist directory, e.g. 'common/ui_click.v0.webm'. */
  readonly opus: string;
  /** WAV path relative to the dist directory (local build artefact, never shipped). */
  readonly wav: string;
  /** Exact decoded length in samples at the manifest sample rate. */
  readonly samples: number;
  readonly durationS: number;
  readonly lufs: number;
  readonly truePeakDb: number;
  readonly sha1: string;
  readonly lufsIntegrated?: number;
  readonly lufsMomentaryMax?: number;
  readonly limitedDb?: number;
  readonly opusTruePeakDb?: number;
  readonly opusLufs?: number;
  readonly centroidHz?: number;
}

/** One sound (all variants share id, category and policy). */
export interface ManifestSound {
  /** Fully qualified id '<scope>:<name>', e.g. 'varkan:wpn_cannon_t1_fire'. */
  readonly id: string;
  /** 'common' or a faction id ('varkan'). */
  readonly scope: string;
  /** Name without scope; the runtime lookup key. */
  readonly name: string;
  readonly category: SoundCategory;
  readonly bus: ManifestBus;
  readonly description: string;
  readonly channels: 1 | 2;
  readonly spatial: boolean;
  readonly durationS: number;
  readonly loop: ManifestLoop | null;
  /** Priority (category default or per-sound override, e.g. alerts 96–99). */
  readonly priority: number;
  /** Minimum restart interval of this sound in ms (per-sound override of the category value). */
  readonly cooldownMs: number;
  /** Maximum simultaneous voices of THIS sound. */
  readonly maxVoices: number;
  readonly tags: readonly string[];
  readonly variants: readonly ManifestVariant[];
  readonly opusKbps?: number;
  readonly targetLufs?: number;
  readonly loudnessMode?: string;
  readonly warnings?: readonly string[];
}

/** Root of manifest.json. */
export interface AudioManifest {
  readonly version: 1;
  readonly generator: string;
  /** Sample rate of all files (48000). */
  readonly sampleRate: number;
  /** Global voice budget (32). */
  readonly maxVoices: number;
  readonly categories: Readonly<Record<SoundCategory, ManifestCategory>>;
  readonly sounds: readonly ManifestSound[];
}

// ---------------------------------------------------------------------------------------------
// Resolved catalog view
// ---------------------------------------------------------------------------------------------

/** A sound as the runtime sees it (policy merged, bus mapped, dense index). */
export interface ResolvedSound {
  /** Dense index 0..n−1 (stable for one catalog; key for typed-array tables). */
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly category: SoundCategory;
  readonly categoryIndex: number;
  readonly bus: ChannelBus;
  readonly priority: number;
  readonly cooldownMs: number;
  /** Voice limit of this single sound. */
  readonly maxVoices: number;
  /** Voice limit of the whole category. */
  readonly categoryMaxVoices: number;
  readonly spatial: boolean;
  readonly channels: 1 | 2;
  readonly loop: ManifestLoop | null;
  readonly variantCount: number;
  readonly durationS: number;
}

/**
 * Sound lookup and decoded-buffer store.
 *
 * Lookup rule: a name containing ':' is an exact fully qualified id; otherwise
 * `<faction>:<name>` is tried first, then `common:<name>`.
 */
export interface SoundResolver {
  readonly size: number;
  resolve(nameOrId: string, faction: string): ResolvedSound | null;
  /** Sound by dense index; throws RangeError outside 0..size−1. */
  byIndex(index: number): ResolvedSound;
  /** Decoded buffer of one variant, or null if not (yet) loaded. */
  buffer(index: number, variant: number): AudioBufferLike | null;
  /** True once at least one variant is decoded. */
  isLoaded(index: number): boolean;
  /** Asks the loader to fetch/decode this sound (idempotent, never blocks). */
  requestLoad(index: number): void;
}

// ---------------------------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------------------------

/** Why a play request produced no voice. */
export type DropReason =
  | 'cooldown'
  | 'categoryLimit'
  | 'soundLimit'
  | 'globalLimit'
  | 'culled'
  | 'notLoaded'
  | 'unknownSound'
  | 'locked'
  | 'muted';

/** All drop reasons in fixed order (index for `Int32Array` counters). */
export const DROP_REASONS: readonly DropReason[] = [
  'cooldown',
  'categoryLimit',
  'soundLimit',
  'globalLimit',
  'culled',
  'notLoaded',
  'unknownSound',
  'locked',
  'muted',
];

/** A request to start one voice. Designed to be pooled and reused. */
export interface PlayRequest {
  /** Sound name (faction lookup), fully qualified id, or `ResolvedSound.index`. */
  sound: string | number;
  /** Faction scope for the name lookup (default: the engine faction). */
  faction?: string | undefined;
  /**
   * World x in WU; spatial only if x AND z are set, `spatial` is not false and the sound is
   * spatial.
   */
  x?: number | undefined;
  /** World z in WU. */
  z?: number | undefined;
  /** Linear gain factor (default 1). */
  gain?: number | undefined;
  /** Playback-rate factor (default 1). */
  rate?: number | undefined;
  /** AudioContext time to start at (default: immediately). */
  when?: number | undefined;
  /** Added to the sound priority for stealing decisions. */
  priorityBoost?: number | undefined;
  /** Loop the sound (default: `sound.loop !== null`). */
  loop?: boolean | undefined;
  /**
   * false: play unpositioned even if x/z carry numbers (default true). Lets pooled hot-path
   * requests keep x/z permanently numeric: toggling them between a number and `undefined` gives
   * the fields a tagged representation in V8 and every double store then allocates a HeapNumber.
   */
  spatial?: boolean | undefined;
}

/** Handle to a started voice; stays valid (as a no-op) after the voice ended or was stolen. */
export interface VoiceHandle {
  readonly id: number;
  /** False once the voice ended, was stopped or stolen. */
  readonly alive: boolean;
  stop(fadeMs?: number): void;
  setGain(gain: number, rampMs?: number): void;
  setPosition(x: number, z: number): void;
  setRate(rate: number): void;
}

/** Anything that can start voices (the voice manager; fakes in tests). */
export interface SoundSink {
  /** Starts a voice or returns null (reason in `lastDrop`). `nowMs` drives cooldowns. */
  play(req: PlayRequest, nowMs: number): VoiceHandle | null;
  readonly lastDrop: DropReason | null;
}

// ---------------------------------------------------------------------------------------------
// Spatial model
// ---------------------------------------------------------------------------------------------

/** Camera state projected onto the ground plane (world units, WU). */
export interface ListenerState {
  /** Ground focus point (screen centre) x. */
  focusX: number;
  /** Ground focus point (screen centre) z. */
  focusZ: number;
  /** Camera height above ground at the focus. */
  height: number;
  /** Half of the visible ground width at the focus. */
  viewHalfWidth: number;
  /** Unit vector "camera right" on the ground plane, x component. */
  rightX: number;
  /** Unit vector "camera right" on the ground plane, z component. */
  rightZ: number;
}

/** Out-parameter of {@link SpatialModel.spatialize} (reused, never allocated per call). */
export interface SpatialResult {
  /** Linear gain 0..1. */
  gain: number;
  /** Stereo pan −1..1. */
  pan: number;
}

/** Maps world positions to gain/pan for the current listener. */
export interface SpatialModel {
  setListener(l: ListenerState): void;
  /** Writes gain/pan into `out`; returns false if inaudible (the voice is culled). */
  spatialize(categoryIndex: number, x: number, z: number, out: SpatialResult): boolean;
}

// ---------------------------------------------------------------------------------------------
// Sim events (mirror of PLAN §3.6 Event 32 B — no import of @faf/protocol)
// ---------------------------------------------------------------------------------------------

/** 1.0 in the sim's Q20.12 fixed-point positions. */
export const FX_ONE = 4096;

/**
 * One sim event as plain numbers (mirror of the 32-byte EventRecord:
 * type u16 | visual u16 | tick u32 | subTick u8 | flags u8 | pos i32×3 | aux u32 | handle u32).
 */
export interface AudioSimEvent {
  type: number;
  visual: number;
  tick: number;
  /** Position inside the tick, 0..255 (fraction subTick/256 of a tick). */
  subTick: number;
  flags: number;
  /** Raw Q20.12 (divide by FX_ONE for WU). */
  x: number;
  y: number;
  z: number;
  aux: number;
  handle: number;
}

/**
 * Read-only event batch. Structurally identical to the event accessors of `FrameReader`
 * (packages/protocol/src/frame.ts), so a FrameReader can be passed directly.
 */
export interface AudioEventSource {
  readonly eventCount: number;
  eventType(i: number): number;
  eventVisual(i: number): number;
  eventTick(i: number): number;
  eventSubTick(i: number): number;
  eventFlags(i: number): number;
  /** Raw Q20.12 position component: c = 0 → x, 1 → y, 2 → z. */
  eventPos(i: number, c: number): number;
  eventAux(i: number): number;
  eventHandle(i: number): number;
}

/** A zeroed event record. */
export function createAudioSimEvent(): AudioSimEvent {
  return { type: 0, visual: 0, tick: 0, subTick: 0, flags: 0, x: 0, y: 0, z: 0, aux: 0, handle: 0 };
}

/**
 * {@link AudioEventSource} over a reusable array of event records (demo, tests, benchmarks).
 * Reading never allocates; writing allocates only when the capacity grows.
 */
export class ArrayEventSource implements AudioEventSource {
  /** Backing records; entries ≥ `count` are spare capacity. */
  readonly events: AudioSimEvent[] = [];
  /** Number of valid events. */
  count = 0;

  constructor(capacity = 256) {
    for (let i = 0; i < capacity; i++) this.events.push(createAudioSimEvent());
  }

  get eventCount(): number {
    return this.count;
  }

  /** Empties the batch (keeps the records for reuse). */
  clear(): void {
    this.count = 0;
  }

  /** Appends one event (positions raw Q20.12) and returns its index. */
  push(
    type: number,
    visual: number,
    tick: number,
    subTick: number,
    flags: number,
    x: number,
    y: number,
    z: number,
    aux: number,
    handle: number,
  ): number {
    const i = this.count;
    if (i === this.events.length) this.events.push(createAudioSimEvent());
    const e = this.events[i]!;
    e.type = type;
    e.visual = visual;
    e.tick = tick;
    e.subTick = subTick;
    e.flags = flags;
    e.x = x;
    e.y = y;
    e.z = z;
    e.aux = aux;
    e.handle = handle;
    this.count = i + 1;
    return i;
  }

  /** Appends a copy of `e`. */
  pushEvent(e: Readonly<AudioSimEvent>): number {
    return this.push(e.type, e.visual, e.tick, e.subTick, e.flags, e.x, e.y, e.z, e.aux, e.handle);
  }

  private at(i: number): AudioSimEvent {
    if (i < 0 || i >= this.count) throw new RangeError(`event index ${i} outside 0..${this.count - 1}`);
    return this.events[i]!;
  }

  eventType(i: number): number {
    return this.at(i).type;
  }
  eventVisual(i: number): number {
    return this.at(i).visual;
  }
  eventTick(i: number): number {
    return this.at(i).tick;
  }
  eventSubTick(i: number): number {
    return this.at(i).subTick;
  }
  eventFlags(i: number): number {
    return this.at(i).flags;
  }
  eventPos(i: number, c: number): number {
    const e = this.at(i);
    return c === 0 ? e.x : c === 1 ? e.y : e.z;
  }
  eventAux(i: number): number {
    return this.at(i).aux;
  }
  eventHandle(i: number): number {
    return this.at(i).handle;
  }
}

// ---------------------------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------------------------

/** Request to announce an alert. */
export interface AlertRequest {
  /** Alert sound name, e.g. 'alt_base_attacked'. */
  kind: string;
  /** World x in WU (position enables jump-to). */
  x?: number | undefined;
  /** World z in WU. */
  z?: number | undefined;
  faction?: string | undefined;
  /**
   * false: the alert has no location even if x/z carry numbers (default true); same purpose as
   * `PlayRequest.spatial` (pooled requests keep x/z numeric).
   */
  located?: boolean | undefined;
}

/** An alert that was announced (history entry). */
export interface AlertRecord {
  readonly kind: string;
  /** Fully qualified id of the sound that played. */
  readonly soundId: string;
  readonly x: number | null;
  readonly z: number | null;
  /** Clock time (ms) of the announcement. */
  readonly atMs: number;
}

/** Moves the camera to a world position (WU). */
export type JumpToCallback = (x: number, z: number) => void;

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/** Volume sliders (0..1, mapped through a perceptual curve by the mixer) and mute flags. */
export interface AudioSettings {
  master: number;
  sfx: number;
  ui: number;
  alerts: number;
  music: number;
  ambience: number;
  muted: boolean;
  /** Mute while the tab is hidden (document.visibilityState). */
  muteWhenHidden: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  master: 0.8,
  sfx: 0.8,
  ui: 0.7,
  alerts: 0.9,
  music: 0.6,
  ambience: 0.5,
  muted: false,
  muteWhenHidden: true,
});

/** Persistence backend (localStorage in the browser). `load` returns untrusted data. */
export interface SettingsStore {
  load(): unknown;
  save(v: AudioSettings): void;
}

/** Observable settings. */
export interface SettingsController {
  get(): Readonly<AudioSettings>;
  /** Merges, clamps and persists; notifies subscribers. */
  set(patch: Partial<AudioSettings>): void;
  /** Returns the unsubscribe function. */
  subscribe(fn: (s: Readonly<AudioSettings>) => void): () => void;
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

/** 'locked' = waiting for the first user gesture (autoplay policy). */
export type EngineState = 'locked' | 'running' | 'suspended' | 'closed';

/** Alert output policy; acknowledgement voices are independent of this setting. */
export type AlertMode = 'voice' | 'gong' | 'off';

/** How a file was decoded: decodeAudioData, WebCodecs AudioDecoder or WASM (opus-decoder). */
export type DecodePath = 'native' | 'webcodecs' | 'wasm';

/** All decode paths in fixed order. */
export const DECODE_PATHS: readonly DecodePath[] = ['native', 'webcodecs', 'wasm'];

/** Which sounds to load (all given criteria must match; omitted = no restriction). */
export interface LoadFilter {
  /** Fully qualified ids. */
  ids?: readonly string[] | undefined;
  /** Manifest tags, e.g. 'MS5' (any tag matches). */
  tags?: readonly string[] | undefined;
  categories?: readonly SoundCategory[] | undefined;
  /** Scopes to load, e.g. ['common', 'varkan']. */
  factions?: readonly string[] | undefined;
}

/** Result of one `load()` call. */
export interface LoadReport {
  /** Sounds matched by the filter. */
  requested: number;
  loaded: number;
  failed: number;
  /** Already loaded or loading before this call. */
  skipped: number;
  /** Σ length × channels × 4 bytes of the buffers decoded by this call. */
  decodedBytes: number;
  /** Wall time in ms. */
  ms: number;
  /** Variants decoded per path. */
  paths: Record<DecodePath, number>;
}

/** Percentiles of a duration series in ms. */
export interface TimingStats {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Engine counters (snapshot). */
export interface AudioStats {
  state: EngineState;
  /** Logical voices currently allocated (≤ maxVoices). */
  voices: number;
  peakVoices: number;
  /** Stolen voices still fading out (not counted in `voices`). */
  tails: number;
  voicesByCategory: Readonly<Record<SoundCategory, number>>;
  played: number;
  stolen: number;
  dropped: Readonly<Record<DropReason, number>>;
  /** Sim events handled. */
  events: number;
  /** Sim events without a mapping. */
  eventsUnmapped: number;
  alertsQueued: number;
  /** Main-thread JS time of the engine per frame (handleEvents + update + play). */
  mainJs: TimingStats;
  loadedSounds: number;
  decodedBytes: number;
  decodePaths: Readonly<Record<DecodePath, number>>;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
}

/** Facade used by the game client (MS5) and the demo. */
export interface AudioEngine {
  readonly state: EngineState;
  readonly settings: SettingsController;
  /** Resumes the context (call from a user gesture); true if running afterwards. */
  unlock(): Promise<boolean>;
  load(filter?: LoadFilter): Promise<LoadReport>;
  setListener(l: ListenerState): void;
  /** Sim speed factor (tick duration = 0.1 s / speed) for subTick scheduling. */
  setSimSpeed(speed: number): void;
  /** Routes one batch of sim events (e.g. a FrameReader) to sounds. */
  handleEvents(src: AudioEventSource): void;
  play(req: PlayRequest): VoiceHandle | null;
  /** UI/acknowledgement sound, started synchronously. */
  playUi(name: string): VoiceHandle | null;
  /** Keyed loop: starts, updates or (null) stops the loop with this key. */
  setLoop(key: string, req: PlayRequest | null): void;
  /** Queues an alert; false if suppressed (interval, unknown). */
  alert(req: AlertRequest): boolean;
  /** Changes only alert playback, preserving history, captions and jump-to targets. */
  setAlertMode(mode: AlertMode): void;
  /** Jumps to the latest alert with a position (repeated calls step back). */
  jumpToLastAlert(): boolean;
  /** Per animation frame: alert queue, loops, tails. */
  update(nowMs?: number): void;
  stats(): AudioStats;
  resetStats(): void;
  dispose(): Promise<void>;
}

/** Options of `createAudioEngine`. */
export interface CreateAudioEngineOptions {
  /** Context or factory (default: lazily `new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })`). */
  context?: AudioContextLike | (() => AudioContextLike) | undefined;
  manifest?: AudioManifest | undefined;
  /** Fetched when `manifest` is not given (default: `${baseUrl}manifest.json`). */
  manifestUrl?: string | undefined;
  /** Base URL of the .webm files, e.g. '/audio/'. */
  baseUrl: string;
  /** Faction scope for lookups (default 'varkan'). */
  faction?: string | undefined;
  /** EventSoundMap JSON (default: built-in map). */
  eventMap?: unknown;
  /**
   * Weapon ref → sound entry (JSON like the map's `weapons`), merged OVER the map's weapons —
   * e.g. collected from the blueprint view data (MS5), so a new weapon needs no event-map edit.
   */
  weaponSounds?: unknown;
  /**
   * Decoders of the kind-specific event fields (flags bits, aux enums, death class from the view
   * data). Default: the provisional encoding of events/kinds.ts. MS5: from @faf/protocol.
   */
  eventCodec?: EventCodec | undefined;
  /** Numeric event type → SimEventKind (default: built-in provisional table). */
  eventTypes?: Readonly<Record<number, string>> | undefined;
  /** Visual id → blueprint ref, e.g. 'core:wpn_cannon_t1'. */
  visualName?: ((visual: number) => string | undefined) | undefined;
  /** Settings persistence (default localStorage; null = none). */
  settingsStore?: SettingsStore | null | undefined;
  onJumpTo?: JumpToCallback | undefined;
  onAlert?: ((a: AlertRecord) => void) | undefined;
  /** Where to listen for the unlocking gesture (default document; null = none). */
  unlockTarget?: EventTarget | null | undefined;
  /** Clock in ms (default performance.now). */
  clock?: (() => number) | undefined;
  /** Logical voice budget (default 32). */
  maxVoices?: number | undefined;
  fetch?: typeof fetch | undefined;
}
