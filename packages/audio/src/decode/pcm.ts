/**
 * PCM assembler for the software decode paths (WebCodecs and WASM, audioeng-b2): collects decoded
 * blocks (planar or interleaved Float32), drops the first `skip` frames (Opus pre-skip, across block
 * boundaries), cuts at `maxFrames` (DiscardPadding / expected length) and returns one Float32Array
 * per channel. With an exact size hint the output needs exactly one allocation per channel.
 */

import { expectedOutputSamples, type OpusTrackSampleInfo } from './opus-packet.ts';

/** Options of {@link PcmAssembler}. */
export interface PcmAssemblerOptions {
  /** Frames to drop at the very start of the stream (Opus pre-skip). Default 0. */
  readonly skip?: number;
  /** Hard cap on output frames; frames beyond it are discarded. Default: unlimited. */
  readonly maxFrames?: number;
}

const MIN_CAPACITY = 4096;

/** Accumulates decoded PCM per channel. Not reusable after {@link finish}. */
export class PcmAssembler {
  readonly channels: number;
  private buffers: Float32Array[];
  private capacity: number;
  private frames = 0;
  private toSkip: number;
  private readonly maxFrames: number;
  private droppedFrames = 0;
  private finished = false;

  /**
   * @param channels output channel count (≥ 1)
   * @param totalSamplesHint expected output frames per channel (after skip/trim); sizes the
   *        initial buffers, so an exact hint means a single allocation per channel
   * @param options pre-skip and hard trim
   */
  constructor(channels: number, totalSamplesHint?: number, options?: PcmAssemblerOptions) {
    if (!Number.isInteger(channels) || channels < 1) throw new RangeError(`PcmAssembler: invalid channel count ${channels}`);
    this.channels = channels;
    const skip = options?.skip ?? 0;
    const max = options?.maxFrames ?? Number.POSITIVE_INFINITY;
    if (!(skip >= 0)) throw new RangeError(`PcmAssembler: invalid skip ${skip}`);
    if (!(max >= 0)) throw new RangeError(`PcmAssembler: invalid maxFrames ${max}`);
    this.toSkip = Math.floor(skip);
    this.maxFrames = max;
    let cap = totalSamplesHint !== undefined && totalSamplesHint >= 0 ? Math.floor(totalSamplesHint) : MIN_CAPACITY;
    if (Number.isFinite(max) && cap > max) cap = Math.floor(max);
    this.capacity = cap;
    this.buffers = [];
    for (let c = 0; c < channels; c++) this.buffers.push(new Float32Array(cap));
  }

  /**
   * Assembler for a demuxed Opus track: skip = preSkip, maxFrames = hint = expected output length
   * (Σ packet samples − preSkip − DiscardPadding). Use when the decoder does NOT trim by itself.
   */
  static forTrack(track: OpusTrackSampleInfo & { readonly channels: number }): PcmAssembler {
    const expected = expectedOutputSamples(track);
    return new PcmAssembler(track.channels, expected, { skip: track.preSkip, maxFrames: expected });
  }

  /** Frames per channel collected so far (after skip/trim). */
  get length(): number {
    return this.frames;
  }

  /** Pre-skip frames still to be dropped. */
  get pendingSkip(): number {
    return this.toSkip;
  }

  /** Frames discarded because they exceeded `maxFrames`. */
  get trimmedFrames(): number {
    return this.droppedFrames;
  }

  /**
   * Appends `frames` frames. `data` is either planar (one Float32Array per channel, each ≥ frames
   * long; a mono source is duplicated to all channels, extra source channels are ignored) or
   * interleaved (one Float32Array of frames × srcChannels, srcChannels defaults to `channels`).
   */
  push(data: readonly Float32Array[] | Float32Array, frames: number, srcChannels?: number): void {
    if (this.finished) throw new Error('PcmAssembler: push after finish');
    if (!(frames > 0)) return;
    let first = 0;
    let count = Math.floor(frames);
    if (this.toSkip > 0) {
      const s = Math.min(this.toSkip, count);
      this.toSkip -= s;
      first = s;
      count -= s;
      if (count === 0) return;
    }
    const room = this.maxFrames - this.frames;
    if (count > room) {
      this.droppedFrames += count - room;
      count = room;
      if (count <= 0) return;
    }
    this.ensure(this.frames + count);
    const at = this.frames;
    const ch = this.channels;
    if (data instanceof Float32Array) {
      const src = srcChannels ?? ch;
      if (data.length < (first + count) * src) throw new RangeError('PcmAssembler: interleaved block shorter than frames × channels');
      for (let c = 0; c < ch; c++) {
        const out = this.buffers[c]!;
        const sc = c < src ? c : src - 1;
        let j = first * src + sc;
        for (let i = 0; i < count; i++, j += src) out[at + i] = data[j]!;
      }
    } else {
      if (data.length === 0) throw new RangeError('PcmAssembler: planar block without channels');
      for (let c = 0; c < ch; c++) {
        const plane = data[c < data.length ? c : data.length - 1]!;
        if (plane.length < first + count) throw new RangeError('PcmAssembler: planar channel shorter than frames');
        this.buffers[c]!.set(plane.subarray(first, first + count), at);
      }
    }
    this.frames = at + count;
  }

  /**
   * Returns one Float32Array per channel with exactly the collected frames (zero-padded up to
   * `minFrames`, capped at `maxFrames`). Returns the internal buffers when they already have the
   * exact length, otherwise one trimmed copy per channel.
   */
  finish(minFrames = 0): Float32Array[] {
    if (this.finished) throw new Error('PcmAssembler: finish called twice');
    this.finished = true;
    const target = Math.min(Math.max(this.frames, Math.floor(minFrames)), this.maxFrames);
    const out: Float32Array[] = [];
    for (let c = 0; c < this.channels; c++) {
      const b = this.buffers[c]!;
      if (b.length === target) {
        out.push(b);
      } else if (b.length > target) {
        out.push(b.slice(0, target));
      } else {
        const grown = new Float32Array(target);
        grown.set(b.subarray(0, this.frames));
        out.push(grown);
      }
    }
    this.buffers = [];
    return out;
  }

  private ensure(needed: number): void {
    if (needed <= this.capacity) return;
    let cap = Math.max(this.capacity * 2, MIN_CAPACITY);
    while (cap < needed) cap *= 2;
    if (cap > this.maxFrames) cap = Math.max(needed, Math.floor(this.maxFrames));
    for (let c = 0; c < this.channels; c++) {
      const grown = new Float32Array(cap);
      grown.set(this.buffers[c]!.subarray(0, this.frames));
      this.buffers[c] = grown;
    }
    this.capacity = cap;
  }
}
