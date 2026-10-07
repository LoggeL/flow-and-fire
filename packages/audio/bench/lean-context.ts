/**
 * Minimal-overhead Web Audio stand-in for the Node benchmark. Unlike the test fake
 * (test/support/fake-audio-context.ts) it records nothing: params keep only their last target
 * value, nodes do not track their graph, and ended sources are found by a linear scan over the
 * (≤ 40) active sources. So the measured time is the engine's own JavaScript plus the
 * unavoidable cost of creating three node objects per started voice — the part a browser adds
 * natively (C++ node creation) is not modelled.
 */
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  StereoPannerNodeLike,
} from '../src/ports.ts';

class LeanParam implements AudioParamLike {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
  setTargetAtTime(target: number): void {
    this.value = target;
  }
  cancelScheduledValues(): void {}
}

class LeanNode implements AudioNodeLike {
  connect(dest: AudioNodeLike): AudioNodeLike {
    return dest;
  }
  disconnect(): void {}
}

class LeanGain extends LeanNode implements GainNodeLike {
  readonly gain = new LeanParam(1);
}

class LeanPanner extends LeanNode implements StereoPannerNodeLike {
  readonly pan = new LeanParam(0);
}

class LeanCompressor extends LeanNode implements DynamicsCompressorNodeLike {
  readonly threshold = new LeanParam(-24);
  readonly knee = new LeanParam(30);
  readonly ratio = new LeanParam(12);
  readonly attack = new LeanParam(0.003);
  readonly release = new LeanParam(0.25);
  readonly reduction = 0;
}

/** PCM-less buffer (the engine never reads samples on the hot path). */
export class LeanBuffer implements AudioBufferLike {
  readonly duration: number;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
  }
  getChannelData(): Float32Array {
    return new Float32Array(this.length);
  }
  copyToChannel(): void {}
}

const ENDED_EVENT = { target: null } as unknown as Event;

class LeanSource extends LeanNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new LeanParam(1);
  onended: ((ev: Event) => unknown) | null = null;
  /** Scheduled end (context seconds); Infinity for loops without stop. */
  end = Number.POSITIVE_INFINITY;
  private startAt = -1;

  constructor(private readonly ctx: LeanAudioContext) {
    super();
  }

  start(when = 0, offset = 0): void {
    const t = Math.max(when, this.ctx.currentTime);
    this.startAt = t;
    const b = this.buffer;
    this.end = this.loop || b === null ? Number.POSITIVE_INFINITY : t + Math.max(0, b.duration - offset) / (this.playbackRate.value || 1);
    this.ctx.register(this);
  }

  stop(when = 0): void {
    const t = Math.max(when, this.ctx.currentTime, this.startAt);
    if (t < this.end) this.end = t;
  }
}

/** Realtime-context stand-in: starts 'suspended'; `resume()` switches synchronously-ish (microtask). */
export class LeanAudioContext implements AudioContextLike {
  currentTime = 0;
  /** Wall clock in ms (use as engine clock). */
  nowMs = 0;
  readonly sampleRate = 48000;
  readonly destination: AudioNodeLike = new LeanNode();
  readonly baseLatency = 0.005;
  readonly outputLatency = 0.02;
  onstatechange: ((ev: Event) => unknown) | null = null;
  /** Sources created / currently active. */
  created = 0;
  private readonly active: LeanSource[] = [];
  private stateValue = 'suspended';

  get state(): string {
    return this.stateValue;
  }

  get liveSources(): number {
    return this.active.length;
  }

  createGain(): GainNodeLike {
    return new LeanGain();
  }
  createStereoPanner(): StereoPannerNodeLike {
    return new LeanPanner();
  }
  createBufferSource(): AudioBufferSourceNodeLike {
    this.created++;
    return new LeanSource(this);
  }
  createDynamicsCompressor(): DynamicsCompressorNodeLike {
    return new LeanCompressor();
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return new LeanBuffer(numberOfChannels, length, sampleRate);
  }
  decodeAudioData(): Promise<AudioBufferLike> {
    return Promise.reject(new Error('LeanAudioContext: no decoder (preload buffers instead)'));
  }

  resume(): Promise<void> {
    return Promise.resolve().then(() => this.setState('running'));
  }
  suspend(): Promise<void> {
    return Promise.resolve().then(() => this.setState('suspended'));
  }
  close(): Promise<void> {
    this.active.length = 0;
    return Promise.resolve().then(() => this.setState('closed'));
  }

  /** @internal */
  register(src: LeanSource): void {
    this.active.push(src);
  }

  /** Advances both clocks by `ms` and fires `onended` of sources that ended (in array order). */
  advance(ms: number): void {
    this.nowMs += ms;
    if (this.stateValue !== 'running') return;
    const t = this.currentTime + ms / 1000;
    this.currentTime = t;
    const a = this.active;
    let w = 0;
    // `a.length` is re-read every iteration: sources started by an onended handler are appended
    // and visited (and kept) in the same pass.
    for (let i = 0; i < a.length; i++) {
      const s = a[i]!;
      if (s.end <= t) {
        const h = s.onended;
        if (h !== null) h(ENDED_EVENT);
      } else {
        a[w++] = s;
      }
    }
    a.length = w;
  }

  private setState(s: string): void {
    if (this.stateValue === s) return;
    this.stateValue = s;
    const h = this.onstatechange;
    if (h !== null) h({ type: 'statechange' } as unknown as Event);
  }
}
