/**
 * WebCodecs fake for Node tests: an `AudioDecoder` backed by the real opus-decoder WASM build, so
 * the WebCodecs glue of the decode chain (config, chunks, AudioData.copyTo, pre-skip handling)
 * runs against real Opus data. `trimPreSkip` switches between a decoder that applies the OpusHead
 * pre-skip itself and one that outputs every decoded sample.
 */

import { OpusDecoder } from 'opus-decoder';
import type { AudioDataLike, AudioDecoderLike, OpusDecoderConfigLike, WebCodecsApi } from '../../src/loader/index.ts';

export interface FakeWebCodecsOptions {
  /** Decoder applies the OpusHead pre-skip itself (default false). */
  trimPreSkip?: boolean;
  /** Result of isConfigSupported (default true for codec 'opus'). */
  supported?: boolean;
  /** Report a decode error at this packet index (via the error callback). */
  failAtPacket?: number;
  /** Emit interleaved 'f32' AudioData (copyTo must convert to f32-planar). */
  interleaved?: boolean;
}

export interface FakeWebCodecsStats {
  decoders: number;
  chunks: number;
  audioData: number;
  closedAudioData: number;
  configs: OpusDecoderConfigLike[];
  timestamps: number[];
}

class FakeAudioData implements AudioDataLike {
  readonly sampleRate = 48000;
  readonly format: string;
  private closed = false;

  constructor(
    private readonly planes: Float32Array[],
    readonly numberOfFrames: number,
    readonly timestamp: number,
    interleaved: boolean,
    private readonly stats: FakeWebCodecsStats,
  ) {
    this.format = interleaved ? 'f32' : 'f32-planar';
  }

  get numberOfChannels(): number {
    return this.planes.length;
  }

  copyTo(destination: Float32Array, options: { planeIndex: number; format?: 'f32-planar' }): void {
    if (this.closed) throw new DOMException('AudioData is closed', 'InvalidStateError');
    if (this.format === 'f32' && options.format !== 'f32-planar' && options.planeIndex > 0) {
      throw new RangeError('interleaved AudioData has a single plane');
    }
    const plane = this.planes[options.planeIndex];
    if (plane === undefined) throw new RangeError(`planeIndex ${options.planeIndex}`);
    if (destination.length < this.numberOfFrames) throw new RangeError('destination too small');
    destination.set(plane.subarray(0, this.numberOfFrames));
  }

  close(): void {
    if (!this.closed) this.stats.closedAudioData++;
    this.closed = true;
  }
}

interface FakeChunk {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly data: Uint8Array;
}

export function createFakeWebCodecs(opts: FakeWebCodecsOptions = {}): { api: WebCodecsApi; stats: FakeWebCodecsStats } {
  const stats: FakeWebCodecsStats = { decoders: 0, chunks: 0, audioData: 0, closedAudioData: 0, configs: [], timestamps: [] };

  class FakeAudioDecoder implements AudioDecoderLike {
    state = 'unconfigured';
    private work: Promise<void> = Promise.resolve();
    private decoder: OpusDecoder<48000> | null = null;
    private packets = 0;

    constructor(private readonly init: { output: (data: AudioDataLike) => void; error: (e: unknown) => void }) {
      stats.decoders++;
    }

    static isConfigSupported(config: OpusDecoderConfigLike): Promise<{ supported?: boolean }> {
      return Promise.resolve({ supported: opts.supported ?? config.codec === 'opus' });
    }

    configure(config: OpusDecoderConfigLike): void {
      stats.configs.push(config);
      const head = config.description;
      const preSkip = head[10]! | (head[11]! << 8);
      const d = new OpusDecoder({ channels: config.numberOfChannels, preSkip: opts.trimPreSkip === true ? preSkip : 0, sampleRate: 48000 });
      this.decoder = d;
      this.state = 'configured';
      this.work = this.work.then(() => d.ready);
    }

    decode(chunk: unknown): void {
      const c = chunk as FakeChunk;
      const index = this.packets++;
      stats.timestamps.push(c.timestamp);
      this.work = this.work.then(() => {
        if (this.state === 'closed') return;
        if (opts.failAtPacket === index) {
          this.state = 'closed';
          this.init.error(new DOMException('fake decode error', 'EncodingError'));
          return;
        }
        const r = this.decoder!.decodeFrame(c.data);
        if (r.samplesDecoded === 0) return;
        stats.audioData++;
        this.init.output(new FakeAudioData(r.channelData, r.samplesDecoded, c.timestamp, opts.interleaved === true, stats));
      });
    }

    flush(): Promise<void> {
      return this.work.then(() => {
        if (this.state === 'closed') throw new DOMException('decoder closed after error', 'InvalidStateError');
      });
    }

    close(): void {
      this.state = 'closed';
      this.decoder?.free();
    }
  }

  class FakeEncodedAudioChunk implements FakeChunk {
    readonly type: 'key' | 'delta';
    readonly timestamp: number;
    readonly data: Uint8Array;
    constructor(init: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array }) {
      stats.chunks++;
      this.type = init.type;
      this.timestamp = init.timestamp;
      // Real EncodedAudioChunk copies the data.
      this.data = init.data.slice();
    }
  }

  return { api: { AudioDecoder: FakeAudioDecoder, EncodedAudioChunk: FakeEncodedAudioChunk }, stats };
}
