/**
 * Decode chain for the Opus/WebM assets: native `decodeAudioData` → WebCodecs `AudioDecoder` →
 * WASM (`opus-decoder`, dynamically imported, so the WASM chunk is only fetched when both browser
 * paths fail). The software paths demux the WebM container themselves (src/decode) and trim the
 * Opus pre-skip and end padding with the PcmAssembler, so every path yields exactly the manifest
 * `samples` at 48 kHz.
 *
 * A one-time capability probe per chain (= per context) remembers whether the native path handles
 * Opus/WebM, so later files do not wait for a native rejection first.
 */

import type { AudioBufferLike, BaseAudioContextLike } from '../ports.ts';
import type { DecodePath } from '../types.ts';
import { OPUS_SAMPLE_RATE, PcmAssembler, demuxWebmOpus, expectedOutputSamples, opusPacketSamples, type WebmOpusTrack } from '../decode/index.ts';

// ---------------------------------------------------------------------------------------------
// Minimal structural types of the optional platform APIs (kept local: not part of ports.ts)
// ---------------------------------------------------------------------------------------------

/** Subset of WebCodecs `AudioData`. */
export interface AudioDataLike {
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly format: string | null;
  readonly timestamp: number;
  copyTo(destination: Float32Array, options: { planeIndex: number; format?: 'f32-planar' }): void;
  close(): void;
}

/** Subset of WebCodecs `AudioDecoderConfig` used here. */
export interface OpusDecoderConfigLike {
  codec: 'opus';
  sampleRate: number;
  numberOfChannels: number;
  /** OpusHead (identification header) — the WebCodecs Opus registration's `description`. */
  description: Uint8Array;
}

/** Subset of WebCodecs `AudioDecoder`. */
export interface AudioDecoderLike {
  readonly state: string;
  configure(config: OpusDecoderConfigLike): void;
  decode(chunk: unknown): void;
  flush(): Promise<void>;
  close(): void;
}

/** The WebCodecs constructors the chain needs (globals in browsers, fakes in tests). */
export interface WebCodecsApi {
  AudioDecoder: {
    new (init: { output: (data: AudioDataLike) => void; error: (e: unknown) => void }): AudioDecoderLike;
    isConfigSupported(config: OpusDecoderConfigLike): Promise<{ supported?: boolean | undefined }>;
  };
  EncodedAudioChunk: new (init: { type: 'key' | 'delta'; timestamp: number; duration?: number; data: Uint8Array }) => unknown;
}

/** Subset of `opus-decoder`'s OpusDecoder (see docs/status/audioeng-a0.md). */
export interface WasmOpusDecoderLike {
  readonly ready: Promise<void>;
  decodeFrames(frames: Uint8Array[]): { channelData: Float32Array[]; samplesDecoded: number; errors: readonly unknown[] };
  reset(): Promise<void>;
  free(): void;
}

/** Subset of the `opus-decoder` module. */
export interface WasmOpusModuleLike {
  OpusDecoder: new (options: { channels: number; preSkip: number; sampleRate: 48000 }) => WasmOpusDecoderLike;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** What the manifest says about the file (`variant.samples`, `sound.channels`). */
export interface DecodeExpect {
  /** Exact decoded length at 48 kHz. */
  readonly samples: number;
  readonly channels: number;
}

export interface DecodeResult {
  readonly buffer: AudioBufferLike;
  readonly path: DecodePath;
  /**
   * Length or channel count differs from the manifest (native: outside ±2 Opus frames; software
   * paths: any deviation). The buffer is accepted anyway; the loader counts it.
   */
  readonly suspicious: boolean;
}

/** Native support as learned by the capability probe. */
export type NativeSupport = 'unknown' | 'yes' | 'no';

/** How the WebCodecs decoder handled the Opus pre-skip (measured per file, last value wins). */
export type WebCodecsTrim = 'unknown' | 'decoder' | 'chain';

export interface DecodeStats {
  /** Successful decodes per path. */
  readonly byPath: Record<DecodePath, number>;
  /** Decode time per path in ms (successful decodes only; WASM without the wait for its decoder). */
  readonly msByPath: Record<DecodePath, number>;
  /** Results accepted despite a length/channel mismatch (see {@link DecodeResult.suspicious}). */
  suspicious: number;
  /** Native rejections (each one costs a fallback). */
  nativeRejects: number;
  /** Files no path could decode. */
  failed: number;
  webcodecsTrim: WebCodecsTrim;
}

export interface DecodeChainOptions {
  /** Only use this path (no fallback) — tests and browser comparisons. */
  forcePath?: DecodePath | undefined;
  /** WebCodecs API (default: the `AudioDecoder`/`EncodedAudioChunk` globals if present; null = off). */
  webCodecs?: WebCodecsApi | null | undefined;
  /** Loads the WASM decoder module (default: `import('opus-decoder')`). */
  loadWasm?: (() => Promise<WasmOpusModuleLike>) | undefined;
  /** Clock in ms for the path timings (default performance.now). */
  clock?: (() => number) | undefined;
}

export interface DecodeChain {
  /**
   * Decodes one complete Opus/WebM file. `bytes` is not detached (the native path gets a copy).
   * @throws {DecodeError} when every allowed path failed
   */
  decode(bytes: ArrayBuffer, expect: DecodeExpect): Promise<DecodeResult>;
  /** Result of the capability probe ('unknown' until a native attempt was conclusive). */
  readonly nativeSupport: NativeSupport;
  readonly stats: DecodeStats;
  /** Frees the WASM decoders (the chain stays usable and re-creates them on demand). */
  dispose(): void;
}

/** One failed attempt inside a {@link DecodeError}. */
export interface DecodeAttempt {
  readonly path: DecodePath;
  readonly error: unknown;
}

/** Every allowed decode path failed; `attempts` holds the cause chain in order. */
export class DecodeError extends Error {
  readonly attempts: readonly DecodeAttempt[];

  constructor(attempts: readonly DecodeAttempt[]) {
    const detail = attempts.length === 0 ? 'no decode path available' : attempts.map((a) => `${a.path}: ${errorText(a.error)}`).join('; ');
    super(`decode failed (${detail})`, attempts.length > 0 ? { cause: attempts[attempts.length - 1]!.error } : undefined);
    this.name = 'DecodeError';
    this.attempts = attempts;
  }
}

/** Opus frame length (20 ms) at 48 kHz; the native length tolerance is 2 frames. */
export const NATIVE_TOLERANCE_FRAMES = 2 * 960;

/**
 * Accepted native length window for a context rate: expected ± 2 × 960 × (rate / 48000).
 * Browsers resample to the context rate and some add or drop up to one Opus frame per end.
 */
export function nativeLengthWindow(expectedSamples: number, contextRate: number): { expected: number; tolerance: number } {
  const ratio = contextRate / OPUS_SAMPLE_RATE;
  return { expected: Math.round(expectedSamples * ratio), tolerance: Math.ceil(NATIVE_TOLERANCE_FRAMES * ratio) };
}

/** Creates the decode chain for one context (the chain owns the per-context probe result). */
export function createDecodeChain(ctx: BaseAudioContextLike, opts: DecodeChainOptions = {}): DecodeChain {
  return new DecodeChainImpl(ctx, opts);
}

// ---------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

function defaultWebCodecs(): WebCodecsApi | null {
  const g = globalThis as { AudioDecoder?: unknown; EncodedAudioChunk?: unknown };
  if (typeof g.AudioDecoder !== 'function' || typeof g.EncodedAudioChunk !== 'function') return null;
  return { AudioDecoder: g.AudioDecoder, EncodedAudioChunk: g.EncodedAudioChunk } as WebCodecsApi;
}

async function defaultLoadWasm(): Promise<WasmOpusModuleLike> {
  // Dynamic import → separate chunk, only fetched when the browser paths fail.
  const mod = await import('opus-decoder');
  return mod as unknown as WasmOpusModuleLike;
}

function outputGainFactor(track: WebmOpusTrack): number {
  return track.outputGainQ8 === 0 ? 1 : Math.pow(10, track.outputGainQ8 / (256 * 20));
}

function applyGain(planes: readonly Float32Array[], g: number): void {
  if (g === 1) return;
  for (const p of planes) for (let i = 0; i < p.length; i++) p[i] = p[i]! * g;
}

/** Serializes the uses of one stateful WASM decoder (reset → decode must not interleave). */
interface WasmSlot {
  decoder: Promise<WasmOpusDecoderLike>;
  tail: Promise<unknown>;
}

class DecodeChainImpl implements DecodeChain {
  readonly stats: DecodeStats = {
    byPath: { native: 0, webcodecs: 0, wasm: 0 },
    msByPath: { native: 0, webcodecs: 0, wasm: 0 },
    suspicious: 0,
    nativeRejects: 0,
    failed: 0,
    webcodecsTrim: 'unknown',
  };

  private support: NativeSupport = 'unknown';
  /** Pending native probe: concurrent decodes wait for it instead of all probing natively. */
  private probe: Promise<void> | null = null;
  private readonly webCodecs: WebCodecsApi | null;
  private readonly loadWasm: () => Promise<WasmOpusModuleLike>;
  private readonly clock: () => number;
  private readonly forcePath: DecodePath | undefined;
  private readonly configSupport = new Map<number, Promise<boolean>>();
  private wasmModule: Promise<WasmOpusModuleLike> | null = null;
  private readonly wasmSlots = new Map<number, WasmSlot>();
  /** Reusable per-channel copy targets for AudioData (grown on demand). */
  private scratch: Float32Array[] = [];
  private readonly ctx: BaseAudioContextLike;

  constructor(ctx: BaseAudioContextLike, opts: DecodeChainOptions) {
    this.ctx = ctx;
    this.webCodecs = opts.webCodecs === undefined ? defaultWebCodecs() : opts.webCodecs;
    this.loadWasm = opts.loadWasm ?? defaultLoadWasm;
    this.clock = opts.clock ?? (() => performance.now());
    this.forcePath = opts.forcePath;
  }

  get nativeSupport(): NativeSupport {
    return this.support;
  }

  async decode(bytes: ArrayBuffer, expect: DecodeExpect): Promise<DecodeResult> {
    if (!(expect.samples > 0) || !(expect.channels >= 1)) throw new RangeError(`decode: invalid expectation ${expect.samples} samples × ${expect.channels} ch`);
    const attempts: DecodeAttempt[] = [];
    const force = this.forcePath;

    if (force === undefined || force === 'native') {
      // Wait for a running probe first; the first caller becomes the probe itself.
      while (force === undefined && this.support === 'unknown' && this.probe !== null) await this.probe;
      if (force === 'native' || this.support !== 'no') {
        const isProbe = force === undefined && this.support === 'unknown';
        let release: () => void = () => {};
        if (isProbe) this.probe = new Promise<void>((r) => (release = r));
        try {
          const r = await this.tryNative(bytes, expect, attempts);
          if (r !== null) {
            if (isProbe) this.support = 'yes';
            return r;
          }
          if (force === 'native') throw this.fail(attempts);
          // The native rejection only proves "unsupported" if a software path decodes the file.
          const soft = await this.software(bytes, expect, attempts);
          if (isProbe) this.support = 'no';
          return soft;
        } catch (e) {
          if (e instanceof DecodeError) throw e;
          throw this.fail(attempts.length > 0 ? attempts : [{ path: 'native', error: e }]);
        } finally {
          if (isProbe) {
            this.probe = null;
            release();
          }
        }
      }
    }
    return this.software(bytes, expect, attempts);
  }

  dispose(): void {
    for (const slot of this.wasmSlots.values()) {
      // Free only after the decodes already queued on this decoder have finished.
      void slot.tail
        .then(() => slot.decoder)
        .then(
          (d) => d.free(),
          () => undefined,
        );
    }
    this.wasmSlots.clear();
    this.scratch = [];
  }

  // -------------------------------------------------------------------------------------------

  private fail(attempts: readonly DecodeAttempt[]): DecodeError {
    this.stats.failed++;
    return new DecodeError(attempts);
  }

  private record(path: DecodePath, t0: number): void {
    this.stats.byPath[path]++;
    this.stats.msByPath[path] += this.clock() - t0;
  }

  private async tryNative(bytes: ArrayBuffer, expect: DecodeExpect, attempts: DecodeAttempt[]): Promise<DecodeResult | null> {
    const t0 = this.clock();
    let buffer: AudioBufferLike;
    try {
      // Browsers detach the buffer passed to decodeAudioData: decode a copy, keep the original.
      buffer = await this.ctx.decodeAudioData(bytes.slice(0));
    } catch (e) {
      this.stats.nativeRejects++;
      attempts.push({ path: 'native', error: e });
      return null;
    }
    if (!(buffer.length > 0)) {
      this.stats.nativeRejects++;
      attempts.push({ path: 'native', error: new Error('decodeAudioData returned an empty buffer') });
      return null;
    }
    const w = nativeLengthWindow(expect.samples, buffer.sampleRate > 0 ? buffer.sampleRate : this.ctx.sampleRate);
    const suspicious = Math.abs(buffer.length - w.expected) > w.tolerance || buffer.numberOfChannels !== expect.channels;
    if (suspicious) this.stats.suspicious++;
    this.record('native', t0);
    return { buffer, path: 'native', suspicious };
  }

  /** WebCodecs, then WASM (or only the forced one). */
  private async software(bytes: ArrayBuffer, expect: DecodeExpect, attempts: DecodeAttempt[]): Promise<DecodeResult> {
    const force = this.forcePath;
    let track: WebmOpusTrack;
    try {
      track = demuxWebmOpus(bytes);
    } catch (e) {
      // A container the demuxer rejects cannot be decoded by either software path.
      attempts.push({ path: force === 'wasm' ? 'wasm' : 'webcodecs', error: e });
      throw this.fail(attempts);
    }
    if (force === undefined || force === 'webcodecs') {
      const t0 = this.clock();
      try {
        const buffer = await this.decodeWebCodecs(track);
        if (buffer !== null) {
          this.record('webcodecs', t0);
          return { buffer, path: 'webcodecs', suspicious: this.softSuspicious(buffer, expect) };
        }
        attempts.push({ path: 'webcodecs', error: new Error('WebCodecs AudioDecoder unavailable or Opus config unsupported') });
      } catch (e) {
        attempts.push({ path: 'webcodecs', error: e });
      }
      if (force === 'webcodecs') throw this.fail(attempts);
    }
    try {
      const { buffer, t0 } = await this.decodeWasm(track);
      this.record('wasm', t0);
      return { buffer, path: 'wasm', suspicious: this.softSuspicious(buffer, expect) };
    } catch (e) {
      attempts.push({ path: 'wasm', error: e });
      throw this.fail(attempts);
    }
  }

  /** Software paths are sample exact: any deviation from the manifest is suspicious. */
  private softSuspicious(buffer: AudioBufferLike, expect: DecodeExpect): boolean {
    const bad = buffer.length !== expect.samples || buffer.numberOfChannels !== expect.channels;
    if (bad) this.stats.suspicious++;
    return bad;
  }

  private toBuffer(planes: readonly Float32Array[], frames: number, offset: number): AudioBufferLike {
    const buffer = this.ctx.createBuffer(planes.length, frames, OPUS_SAMPLE_RATE);
    for (let c = 0; c < planes.length; c++) {
      const p = planes[c]!;
      buffer.copyToChannel(offset === 0 && p.length === frames ? p : p.subarray(offset, offset + frames), c);
    }
    return buffer;
  }

  private supportsConfig(api: WebCodecsApi, track: WebmOpusTrack): Promise<boolean> {
    let p = this.configSupport.get(track.channels);
    if (p === undefined) {
      p = api.AudioDecoder.isConfigSupported(this.config(track)).then(
        (r) => r.supported === true,
        () => false,
      );
      this.configSupport.set(track.channels, p);
    }
    return p;
  }

  private config(track: WebmOpusTrack): OpusDecoderConfigLike {
    return { codec: 'opus', sampleRate: OPUS_SAMPLE_RATE, numberOfChannels: track.channels, description: track.opusHead };
  }

  /** null = WebCodecs not usable here (no API or config unsupported). */
  private async decodeWebCodecs(track: WebmOpusTrack): Promise<AudioBufferLike | null> {
    const api = this.webCodecs;
    if (api === null) return null;
    if (!(await this.supportsConfig(api, track))) return null;

    const expected = expectedOutputSamples(track);
    let raw = 0;
    for (const p of track.packets) raw += opusPacketSamples(p);
    // Collect untrimmed: whether the decoder applies the pre-skip itself differs between
    // implementations, so the trim is decided after flush from the decoded frame count.
    const asm = new PcmAssembler(track.channels, raw);
    let failure: unknown = null;
    let rate = OPUS_SAMPLE_RATE;
    const planes: Float32Array[] = [];
    const decoder = new api.AudioDecoder({
      output: (data) => {
        try {
          if (failure === null) {
            rate = data.sampleRate;
            this.pushAudioData(asm, data, planes);
          }
        } catch (e) {
          failure = e;
        } finally {
          data.close();
        }
      },
      error: (e) => {
        if (failure === null) failure = e;
      },
    });
    try {
      decoder.configure(this.config(track));
      for (let i = 0; i < track.packets.length; i++) {
        const packet = track.packets[i]!;
        decoder.decode(
          new api.EncodedAudioChunk({
            type: 'key',
            timestamp: Math.round(track.timestampsUs[i]!),
            duration: Math.round((opusPacketSamples(packet) * 1e6) / OPUS_SAMPLE_RATE),
            data: packet,
          }),
        );
      }
      await decoder.flush();
    } finally {
      if (decoder.state !== 'closed') decoder.close();
    }
    if (failure !== null) throw failure;
    if (rate !== OPUS_SAMPLE_RATE) throw new Error(`WebCodecs decoded at ${rate} Hz, expected ${OPUS_SAMPLE_RATE}`);

    const got = asm.length;
    const pcm = asm.finish();
    // Decoder kept the pre-skip (≈ raw) → trim it here; decoder trimmed it (≈ raw − preSkip) → keep.
    const tol = NATIVE_TOLERANCE_FRAMES;
    let offset: number;
    if (track.preSkip > 0 && Math.abs(got - raw) <= Math.abs(got - (raw - track.preSkip))) {
      offset = track.preSkip;
      this.stats.webcodecsTrim = 'chain';
    } else {
      offset = 0;
      this.stats.webcodecsTrim = track.preSkip > 0 ? 'decoder' : this.stats.webcodecsTrim;
    }
    const available = got - offset;
    if (available < expected - tol) throw new Error(`WebCodecs produced ${got} frames, expected ${expected} (+ pre-skip ${track.preSkip})`);
    const frames = Math.min(expected, available);
    if (!(frames > 0)) throw new Error('WebCodecs produced no audio');
    return this.toBuffer(pcm, frames, offset);
  }

  private pushAudioData(asm: PcmAssembler, data: AudioDataLike, planes: Float32Array[]): void {
    const frames = data.numberOfFrames;
    if (frames <= 0) return;
    const ch = data.numberOfChannels;
    if (!(ch >= 1)) throw new Error(`WebCodecs AudioData without channels`);
    // Copy targets: exactly `ch` planes (the assembler maps mono → all, ignores extra channels).
    const size = Math.max(frames, this.scratch[0]?.length ?? 0);
    while (this.scratch.length < ch) this.scratch.push(new Float32Array(size));
    for (let c = 0; c < this.scratch.length; c++) if (this.scratch[c]!.length < frames) this.scratch[c] = new Float32Array(size);
    planes.length = ch;
    for (let c = 0; c < ch; c++) {
      planes[c] = this.scratch[c]!;
      data.copyTo(planes[c]!, { planeIndex: c, format: 'f32-planar' });
    }
    asm.push(planes, frames);
  }

  private wasmSlot(channels: number): WasmSlot {
    let slot = this.wasmSlots.get(channels);
    if (slot === undefined) {
      if (this.wasmModule === null) {
        this.wasmModule = this.loadWasm();
        // A failed module load may be retried by the next decode.
        this.wasmModule.catch(() => (this.wasmModule = null));
      }
      const mod = this.wasmModule;
      const decoder = mod.then(async (m) => {
        // preSkip 0: the decoder must not trim; the PcmAssembler trims (same as WebCodecs path).
        const d = new m.OpusDecoder({ channels, preSkip: 0, sampleRate: OPUS_SAMPLE_RATE });
        await d.ready;
        return d;
      });
      slot = { decoder, tail: Promise.resolve() };
      this.wasmSlots.set(channels, slot);
      decoder.catch(() => {
        if (this.wasmSlots.get(channels) === slot) this.wasmSlots.delete(channels);
      });
    }
    return slot;
  }

  /** Resolves with the buffer and the start time of the actual decode (queue wait excluded). */
  private decodeWasm(track: WebmOpusTrack): Promise<{ buffer: AudioBufferLike; t0: number }> {
    if (track.channelMappingFamily !== 0 || track.channels > 2) {
      return Promise.reject(new Error(`WASM path supports mono/stereo mapping family 0 only (got ${track.channels} ch, family ${track.channelMappingFamily})`));
    }
    const slot = this.wasmSlot(track.channels);
    const run = slot.tail.then(async () => {
      const d = await slot.decoder;
      const t0 = this.clock();
      await d.reset();
      const r = d.decodeFrames(track.packets as Uint8Array[]);
      if (r.errors.length > 0) throw new Error(`opus-decoder reported ${r.errors.length} corrupt packet(s): ${errorText(r.errors[0])}`);
      const asm = PcmAssembler.forTrack(track);
      if (r.samplesDecoded > 0) asm.push(r.channelData, r.samplesDecoded);
      const frames = asm.length;
      if (!(frames > 0)) throw new Error('opus-decoder produced no audio');
      const planes = asm.finish();
      applyGain(planes, outputGainFactor(track));
      return { buffer: this.toBuffer(planes, frames, 0), t0 };
    });
    slot.tail = run.catch(() => undefined);
    return run;
  }
}
