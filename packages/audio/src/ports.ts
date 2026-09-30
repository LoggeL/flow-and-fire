/**
 * Minimal structural subset of the Web Audio API used by @faf/audio.
 *
 * Real `AudioContext` / `OfflineAudioContext` objects (lib.dom) and the test fake
 * (`test/support/fake-audio-context.ts`) both satisfy these interfaces structurally; the
 * compatibility is proven statically in `test/contracts.test.ts`. Keep this surface small: every
 * member added here has to be implemented by the fake as well.
 *
 * Methods use the method shorthand on purpose (bivariant parameters), so the overloaded lib.dom
 * signatures (e.g. `AudioNode.connect`) remain assignable without casts. Return values the engine
 * never uses are typed `unknown`.
 */

/** Subset of `AudioParam`: plain value plus the automation calls the engine uses. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

/** Subset of `AudioNode`: graph wiring only. */
export interface AudioNodeLike {
  /** Connects this node's output to `dest` (lib.dom returns the destination node). */
  connect(dest: AudioNodeLike): unknown;
  /** Disconnects all outgoing connections. */
  disconnect(): void;
}

/** Subset of `GainNode`. */
export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

/** Subset of `StereoPannerNode` (equal-power panning, pan ∈ [−1, 1]). */
export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

/** Subset of `DynamicsCompressorNode` (used as master limiter). */
export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
  /** Current gain reduction in dB (≤ 0), read-only metering value. */
  readonly reduction: number;
}

/** Subset of `AudioBuffer` (planar float PCM at `sampleRate`). */
export interface AudioBufferLike {
  /** Duration in seconds (`length / sampleRate`). */
  readonly duration: number;
  /** Length in sample frames. */
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  /** Live view of one channel's samples (writes go into the buffer). */
  getChannelData(channel: number): Float32Array;
  /** Copies `source` into `channel`, starting at frame `bufferOffset` (default 0). */
  copyToChannel(source: Float32Array, channel: number, bufferOffset?: number): void;
}

/** Subset of `AudioBufferSourceNode`. */
export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  /** Loop start in SECONDS of buffer time (independent of the buffer's sample rate). */
  loopStart: number;
  /** Loop end in SECONDS of buffer time (0 = end of buffer). */
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  onended: ((ev: Event) => unknown) | null;
  /** Schedules playback at context time `when` from buffer offset `offset` (seconds); callable once. */
  start(when?: number, offset?: number, duration?: number): void;
  /** Schedules the end of playback at context time `when` (default: now). */
  stop(when?: number): void;
}

/** Subset shared by `AudioContext` and `OfflineAudioContext`. */
export interface BaseAudioContextLike {
  /** Audio clock in seconds (advances only while running). */
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  /** 'suspended' | 'running' | 'closed' (+ 'interrupted' on some WebKit versions). */
  readonly state: string;
  createGain(): GainNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  /** Decodes a complete encoded file; NOTE: browsers detach `audioData` (pass a copy). */
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>;
}

/** Subset of a realtime `AudioContext`. */
export interface AudioContextLike extends BaseAudioContextLike {
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  onstatechange: ((ev: Event) => unknown) | null;
  /** Processing latency in seconds (not implemented by every browser). */
  readonly baseLatency?: number;
  /** Output (device) latency in seconds (not implemented by every browser). */
  readonly outputLatency?: number;
}

/** Subset of `OfflineAudioContext` (renders `length` frames as fast as possible). */
export interface OfflineAudioContextLike extends BaseAudioContextLike {
  startRendering(): Promise<AudioBufferLike>;
  readonly length: number;
}
