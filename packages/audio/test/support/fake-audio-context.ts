/**
 * Fake Web Audio implementation for Node tests of @faf/audio.
 *
 * - Manual clocks: `advance(ms)` moves the wall clock `nowMs` always and the audio clock
 *   `currentTime` only while the context is 'running' (like a real, suspended AudioContext).
 * - AudioParam automation (setValueAtTime, linearRampToValueAtTime, setTargetAtTime,
 *   cancelScheduledValues) is evaluated like the Web Audio spec (`valueAt(t)`), plus a call log.
 * - AudioBufferSourceNode start/stop/onended follow buffer duration, offset, playbackRate
 *   (value at start time) and loop; `onended` fires while advancing, in end-time order, with
 *   `currentTime` set to the exact end time.
 * - Graph bookkeeping (connect/disconnect, `graphPathToDestination`) and counters
 *   (`liveSources`, `peakLiveSources`, `createdNodes`).
 * - No audio is rendered: buffers only hold data (allocated lazily), OfflineAudioContext renders
 *   silence of the right shape while running its clock.
 */

import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BaseAudioContextLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OfflineAudioContextLike,
  StereoPannerNodeLike,
} from '../../src/ports.ts';

// ---------------------------------------------------------------------------------------------
// AudioParam
// ---------------------------------------------------------------------------------------------

/** Scheduled automation event (times in context seconds). */
export type AutomationEvent =
  | { readonly type: 'set'; readonly time: number; readonly value: number }
  /** Linear ramp ending at `time`; `scheduledAt` = currentTime when scheduled (start after a setTarget). */
  | { readonly type: 'linear'; readonly time: number; readonly value: number; readonly scheduledAt: number }
  | { readonly type: 'target'; readonly time: number; readonly value: number; readonly timeConstant: number };

/** One logged automation call. */
export interface AutomationCall {
  readonly method: 'value' | 'setValueAtTime' | 'linearRampToValueAtTime' | 'setTargetAtTime' | 'cancelScheduledValues';
  /** Value / target (NaN for cancelScheduledValues). */
  readonly value: number;
  /** startTime / endTime / cancelTime. */
  readonly time: number;
  /** Only for setTargetAtTime. */
  readonly timeConstant: number;
  /** currentTime at the call. */
  readonly at: number;
}

function checkFinite(v: number, what: string): void {
  if (!Number.isFinite(v)) throw new TypeError(`${what} is not a finite number: ${v}`);
}

function checkTime(t: number, what: string): void {
  checkFinite(t, what);
  if (t < 0) throw new RangeError(`${what} must be non-negative: ${t}`);
}

/** Compact the schedule once it holds more events than this (keeps long-lived bus params small). */
const COMPACT_THRESHOLD = 64;

export class FakeAudioParam implements AudioParamLike {
  /** Current schedule, sorted by time (stable for equal times). */
  readonly events: AutomationEvent[] = [];
  /** Call log (only if the context logs automation). */
  readonly calls: AutomationCall[] = [];
  private base: number;

  constructor(
    readonly context: FakeBaseAudioContext,
    readonly defaultValue: number,
    readonly minValue = -3.4028234663852886e38,
    readonly maxValue = 3.4028234663852886e38,
  ) {
    this.base = defaultValue;
  }

  /** Computed value at the current audio time. */
  get value(): number {
    return this.valueAt(this.context.currentTime);
  }

  /** Like the spec: sets the value now (equivalent to setValueAtTime(v, currentTime)). */
  set value(v: number) {
    checkFinite(v, 'value');
    this.log('value', v, this.context.currentTime, 0);
    if (this.events.length === 0) this.base = v;
    else this.insert({ type: 'set', time: this.context.currentTime, value: v });
  }

  setValueAtTime(value: number, startTime: number): this {
    checkFinite(value, 'value');
    checkTime(startTime, 'startTime');
    this.log('setValueAtTime', value, startTime, 0);
    this.insert({ type: 'set', time: startTime, value });
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): this {
    checkFinite(value, 'value');
    checkTime(endTime, 'endTime');
    this.log('linearRampToValueAtTime', value, endTime, 0);
    this.insert({ type: 'linear', time: endTime, value, scheduledAt: this.context.currentTime });
    return this;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): this {
    checkFinite(target, 'target');
    checkTime(startTime, 'startTime');
    checkTime(timeConstant, 'timeConstant');
    this.log('setTargetAtTime', target, startTime, timeConstant);
    this.insert({ type: 'target', time: startTime, value: target, timeConstant });
    return this;
  }

  cancelScheduledValues(cancelTime: number): this {
    checkTime(cancelTime, 'cancelTime');
    this.log('cancelScheduledValues', Number.NaN, cancelTime, 0);
    let n = this.events.length;
    while (n > 0 && this.events[n - 1]!.time >= cancelTime) n--;
    this.events.length = n;
    return this;
  }

  /** Number of logged calls of `method`. */
  count(method: AutomationCall['method']): number {
    let n = 0;
    for (const c of this.calls) if (c.method === method) n++;
    return n;
  }

  /** Automation value at context time `t` (seconds), clamped to [minValue, maxValue]. */
  valueAt(t: number): number {
    const v = this.rawValueAt(t);
    return v < this.minValue ? this.minValue : v > this.maxValue ? this.maxValue : v;
  }

  private rawValueAt(t: number): number {
    // Current segment: hold `holdV`, or exponential approach (setTarget) starting at segT.
    let holdV = this.base;
    let prevT = 0;
    let target: { t0: number; v0: number; target: number; tc: number } | null = null;
    const seg = (x: number): number => {
      if (target === null) return holdV;
      if (target.tc === 0) return x >= target.t0 ? target.target : target.v0;
      return target.target + (target.v0 - target.target) * Math.exp(-(x - target.t0) / target.tc);
    };
    for (const e of this.events) {
      if (e.type === 'linear') {
        // Ramp start: end of the previous event, or (after a running setTarget) the time it was scheduled.
        let t0 = prevT;
        if (target !== null && e.scheduledAt > t0) t0 = Math.min(e.scheduledAt, e.time);
        const v0 = seg(t0);
        if (t < e.time) {
          if (t < t0) return seg(t);
          return e.time === t0 ? e.value : v0 + ((e.value - v0) * (t - t0)) / (e.time - t0);
        }
        holdV = e.value;
        target = null;
        prevT = e.time;
        continue;
      }
      if (t < e.time) return seg(t);
      if (e.type === 'set') {
        holdV = e.value;
        target = null;
      } else {
        target = { t0: e.time, v0: seg(e.time), target: e.value, tc: e.timeConstant };
      }
      prevT = e.time;
    }
    return seg(t);
  }

  private insert(e: AutomationEvent): void {
    const ev = this.events;
    let i = ev.length;
    while (i > 0 && ev[i - 1]!.time > e.time) i--;
    ev.splice(i, 0, e);
    if (ev.length > COMPACT_THRESHOLD) this.compact();
  }

  /**
   * Drops history that no longer influences values at t ≥ currentTime: everything before the last
   * finished set/linear event, which becomes a plain set. `valueAt` of earlier times changes.
   */
  private compact(): void {
    const now = this.context.currentTime;
    const ev = this.events;
    let k = -1;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]!;
      if (e.time > now) break;
      if (e.type !== 'target') k = i;
    }
    if (k <= 0) return;
    const e = ev[k]!;
    ev.splice(0, k + 1, { type: 'set', time: e.time, value: e.value });
  }

  private log(method: AutomationCall['method'], value: number, time: number, timeConstant: number): void {
    if (this.context.logAutomation) this.calls.push({ method, value, time, timeConstant, at: this.context.currentTime });
  }
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

export type FakeNodeKind = 'destination' | 'gain' | 'panner' | 'compressor' | 'shaper' | 'source';

export class FakeAudioNode implements AudioNodeLike {
  /** Outgoing connections (no duplicates, like the Web Audio graph). */
  readonly outputs: FakeAudioNode[] = [];
  /** Incoming connections. */
  readonly inputs: FakeAudioNode[] = [];
  /** Free-form label for test diagnostics. */
  label = '';

  constructor(
    readonly context: FakeBaseAudioContext,
    readonly kind: FakeNodeKind,
  ) {}

  connect(dest: AudioNodeLike): AudioNodeLike {
    if (!(dest instanceof FakeAudioNode)) throw new TypeError('connect: destination is not a FakeAudioNode');
    if (dest.context !== this.context) throw new DOMException('connect: nodes belong to different contexts', 'InvalidAccessError');
    if (dest.kind === 'source') throw new DOMException('connect: a source node has no inputs', 'IndexSizeError');
    if (!this.outputs.includes(dest)) {
      this.outputs.push(dest);
      dest.inputs.push(this);
      this.context.connectCalls++;
    }
    return dest;
  }

  disconnect(): void {
    for (const d of this.outputs) {
      const j = d.inputs.indexOf(this);
      if (j >= 0) d.inputs.splice(j, 1);
    }
    this.outputs.length = 0;
    this.context.disconnectCalls++;
  }

  /** Readable identifier: label or kind. */
  describe(): string {
    return this.label === '' ? this.kind : `${this.kind}:${this.label}`;
  }
}

export class FakeGainNode extends FakeAudioNode implements GainNodeLike {
  readonly gain: FakeAudioParam;
  constructor(ctx: FakeBaseAudioContext) {
    super(ctx, 'gain');
    this.gain = new FakeAudioParam(ctx, 1);
  }
}

export class FakeStereoPannerNode extends FakeAudioNode implements StereoPannerNodeLike {
  readonly pan: FakeAudioParam;
  constructor(ctx: FakeBaseAudioContext) {
    super(ctx, 'panner');
    this.pan = new FakeAudioParam(ctx, 0, -1, 1);
  }
}

export class FakeDynamicsCompressorNode extends FakeAudioNode implements DynamicsCompressorNodeLike {
  readonly threshold: FakeAudioParam;
  readonly knee: FakeAudioParam;
  readonly ratio: FakeAudioParam;
  readonly attack: FakeAudioParam;
  readonly release: FakeAudioParam;
  /** Metering value; the fake does not process audio, tests may set it. */
  reduction = 0;
  constructor(ctx: FakeBaseAudioContext) {
    super(ctx, 'compressor');
    this.threshold = new FakeAudioParam(ctx, -24, -100, 0);
    this.knee = new FakeAudioParam(ctx, 30, 0, 40);
    this.ratio = new FakeAudioParam(ctx, 12, 1, 20);
    this.attack = new FakeAudioParam(ctx, 0.003, 0, 1);
    this.release = new FakeAudioParam(ctx, 0.25, 0, 1);
  }
}

/** WaveShaperNode (the mixer's safety clip); stores curve/oversample, processes nothing. */
export class FakeWaveShaperNode extends FakeAudioNode {
  private curveValue: Float32Array | null = null;
  oversample = 'none';
  constructor(ctx: FakeBaseAudioContext) {
    super(ctx, 'shaper');
  }
  get curve(): Float32Array | null {
    return this.curveValue;
  }
  /** Like the browser: a curve needs ≥ 2 points (InvalidStateError otherwise); stored as a copy. */
  set curve(c: Float32Array | null) {
    if (c !== null && c.length < 2) throw new DOMException('WaveShaperNode.curve: length must be ≥ 2', 'InvalidStateError');
    this.curveValue = c === null ? null : new Float32Array(c);
  }
}

// ---------------------------------------------------------------------------------------------
// AudioBuffer
// ---------------------------------------------------------------------------------------------

export class FakeAudioBuffer implements AudioBufferLike {
  readonly duration: number;
  private readonly data: (Float32Array | undefined)[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    if (!Number.isInteger(numberOfChannels) || numberOfChannels < 1 || numberOfChannels > 32) {
      throw new DOMException(`createBuffer: invalid channel count ${numberOfChannels}`, 'NotSupportedError');
    }
    if (!Number.isInteger(length) || length < 1) throw new DOMException(`createBuffer: invalid length ${length}`, 'NotSupportedError');
    if (!(sampleRate >= 3000 && sampleRate <= 768000)) {
      throw new DOMException(`createBuffer: invalid sample rate ${sampleRate}`, 'NotSupportedError');
    }
    this.duration = length / sampleRate;
    this.data = new Array<Float32Array | undefined>(numberOfChannels).fill(undefined);
  }

  /** True once channel data was materialized (buffers stay lazy/cheap until read or written). */
  isMaterialized(channel: number): boolean {
    return this.data[channel] !== undefined;
  }

  getChannelData(channel: number): Float32Array {
    if (!Number.isInteger(channel) || channel < 0 || channel >= this.numberOfChannels) {
      throw new DOMException(`getChannelData: channel ${channel} out of range`, 'IndexSizeError');
    }
    let d = this.data[channel];
    if (d === undefined) {
      d = new Float32Array(this.length);
      this.data[channel] = d;
    }
    return d;
  }

  copyToChannel(source: Float32Array, channel: number, bufferOffset = 0): void {
    const d = this.getChannelData(channel);
    if (bufferOffset >= this.length) return;
    const n = Math.min(source.length, this.length - bufferOffset);
    d.set(n === source.length ? source : source.subarray(0, n), bufferOffset);
  }
}

// ---------------------------------------------------------------------------------------------
// AudioBufferSourceNode
// ---------------------------------------------------------------------------------------------

export class FakeAudioBufferSourceNode extends FakeAudioNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: FakeAudioParam;
  onended: ((ev: Event) => unknown) | null = null;

  /** Arguments of start() (null before start). */
  startWhen: number | null = null;
  startOffset = 0;
  startDuration: number | null = null;
  /** Context time at which output begins: max(when, currentTime at the call). */
  startAt: number | null = null;
  /** Requested stop time (null = none). */
  stopWhen: number | null = null;
  /** True after the source ended (natural end, stop or context close). */
  ended = false;
  /** Context time of the end (set when ended). */
  endedAt: number | null = null;
  private naturalEnd = Number.POSITIVE_INFINITY;

  constructor(ctx: FakeBaseAudioContext) {
    super(ctx, 'source');
    this.playbackRate = new FakeAudioParam(ctx, 1);
  }

  get started(): boolean {
    return this.startAt !== null;
  }

  /** Started, not ended and its start time reached. */
  get playing(): boolean {
    return this.startAt !== null && !this.ended && this.context.currentTime >= this.startAt;
  }

  /** Scheduled end time (Infinity for loops / no buffer without stop; null before start). */
  get endTime(): number | null {
    if (this.startAt === null) return null;
    if (this.endedAt !== null) return this.endedAt;
    const stop = this.stopWhen === null ? Number.POSITIVE_INFINITY : Math.max(this.stopWhen, this.startAt);
    return Math.min(stop, this.naturalEnd);
  }

  start(when = 0, offset = 0, duration?: number): void {
    if (this.startAt !== null) throw new DOMException('start: source already started', 'InvalidStateError');
    checkTime(when, 'when');
    checkTime(offset, 'offset');
    if (duration !== undefined) checkTime(duration, 'duration');
    const now = this.context.currentTime;
    this.startWhen = when;
    this.startOffset = offset;
    this.startDuration = duration ?? null;
    this.startAt = Math.max(when, now);
    const rate = Math.abs(this.playbackRate.valueAt(this.startAt));
    const buf = this.buffer;
    if (buf !== null && rate > 0) {
      if (!this.loop) {
        const remaining = Math.max(0, buf.duration - Math.min(offset, buf.duration));
        const content = duration === undefined ? remaining : Math.min(duration, remaining);
        this.naturalEnd = this.startAt + content / rate;
      } else if (duration !== undefined) {
        this.naturalEnd = this.startAt + duration / rate;
      }
    }
    this.context.registerSource(this);
  }

  stop(when = 0): void {
    if (this.startAt === null) throw new DOMException('stop: source not started', 'InvalidStateError');
    checkTime(when, 'when');
    if (this.ended) return;
    this.stopWhen = Math.max(when, this.context.currentTime);
  }

  /** Called by the context. */
  finish(at: number, fire: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.endedAt = at;
    if (fire && this.onended !== null) this.onended(new Event('ended'));
  }
}

// ---------------------------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------------------------

export type FakeDecoder = (data: ArrayBuffer, ctx: FakeBaseAudioContext) => AudioBufferLike | Promise<AudioBufferLike>;

export interface FakeContextOptions {
  /** Default 48000. */
  sampleRate?: number;
  /** Record AudioParam calls in `param.calls` (default true; benches turn it off). */
  logAutomation?: boolean;
  /** Emulate the browser detaching the ArrayBuffer passed to decodeAudioData (default true). */
  detachOnDecode?: boolean;
}

/** Shared implementation of FakeAudioContext and FakeOfflineAudioContext. */
export class FakeBaseAudioContext implements BaseAudioContextLike {
  readonly sampleRate: number;
  readonly destination: FakeAudioNode;
  readonly logAutomation: boolean;
  readonly detachOnDecode: boolean;
  /** Audio clock (seconds). */
  currentTime = 0;
  /** Wall clock (ms), advances regardless of state; usable as engine `clock`. */
  nowMs = 0;
  protected stateValue = 'suspended';
  /** Sources started and not yet ended. */
  liveSources = 0;
  peakLiveSources = 0;
  /** Nodes created through create*() (buffers not counted). */
  createdNodes = 0;
  readonly createdByKind: Record<FakeNodeKind, number> = { destination: 0, gain: 0, panner: 0, compressor: 0, shaper: 0, source: 0 };
  startedSources = 0;
  endedSources = 0;
  connectCalls = 0;
  disconnectCalls = 0;
  decodeCalls = 0;
  private readonly active: FakeAudioBufferSourceNode[] = [];
  private decoder: FakeDecoder | null = null;

  constructor(opts: FakeContextOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.logAutomation = opts.logAutomation ?? true;
    this.detachOnDecode = opts.detachOnDecode ?? true;
    this.destination = new FakeAudioNode(this, 'destination');
  }

  get state(): string {
    return this.stateValue;
  }

  createGain(): FakeGainNode {
    this.count('gain');
    return new FakeGainNode(this);
  }

  createStereoPanner(): FakeStereoPannerNode {
    this.count('panner');
    return new FakeStereoPannerNode(this);
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    this.count('source');
    return new FakeAudioBufferSourceNode(this);
  }

  createDynamicsCompressor(): FakeDynamicsCompressorNode {
    this.count('compressor');
    return new FakeDynamicsCompressorNode(this);
  }

  createWaveShaper(): FakeWaveShaperNode {
    this.count('shaper');
    return new FakeWaveShaperNode(this);
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  /**
   * Replaces the decoder. Default (null): reject with an EncodingError DOMException, like a
   * browser without Opus/WebM support.
   */
  setDecoder(fn: FakeDecoder | null): void {
    this.decoder = fn;
  }

  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike> {
    this.decodeCalls++;
    if ('detached' in audioData && audioData.detached === true) {
      return Promise.reject(new TypeError('decodeAudioData: ArrayBuffer is detached'));
    }
    let data = audioData;
    if (this.detachOnDecode) data = structuredClone(audioData, { transfer: [audioData] });
    const decoder = this.decoder;
    if (decoder === null) {
      return Promise.reject(new DOMException('Unable to decode audio data (fake: no decoder configured)', 'EncodingError'));
    }
    return Promise.resolve().then(() => decoder(data, this));
  }

  /**
   * Advances both clocks by `ms` (the audio clock only while running). Sources that end on the
   * way fire `onended` in end-time order with `currentTime` at their exact end time.
   */
  advance(ms: number): void {
    if (!(ms >= 0)) throw new RangeError(`advance: ms must be ≥ 0: ${ms}`);
    this.nowMs += ms;
    if (this.stateValue === 'running') this.runAudioClockTo(this.currentTime + ms / 1000);
  }

  /** Advances until `currentTime` reaches `seconds` (running contexts only). */
  advanceTo(seconds: number): void {
    const dt = seconds - this.currentTime;
    if (dt > 0) this.advance(dt * 1000);
  }

  /** Path of nodes from `node` to the destination (BFS over outputs), or null if not connected. */
  graphPathToDestination(node: AudioNodeLike): FakeAudioNode[] | null {
    if (!(node instanceof FakeAudioNode)) return null;
    const prev = new Map<FakeAudioNode, FakeAudioNode | null>([[node, null]]);
    const queue: FakeAudioNode[] = [node];
    while (queue.length > 0) {
      const n = queue.shift()!;
      if (n === this.destination) {
        const path: FakeAudioNode[] = [];
        for (let p: FakeAudioNode | null = n; p !== null; p = prev.get(p) ?? null) path.push(p);
        return path.reverse();
      }
      for (const o of n.outputs) {
        if (!prev.has(o)) {
          prev.set(o, n);
          queue.push(o);
        }
      }
    }
    return null;
  }

  /** Path as a string, e.g. 'source > gain > panner > gain:sfx > gain:master > destination'. */
  describePath(node: AudioNodeLike): string | null {
    const p = this.graphPathToDestination(node);
    return p === null ? null : p.map((n) => n.describe()).join(' > ');
  }

  /** Active (started, not ended) sources, in start order. */
  activeSources(): readonly FakeAudioBufferSourceNode[] {
    return this.active;
  }

  /** @internal called by FakeAudioBufferSourceNode.start */
  registerSource(src: FakeAudioBufferSourceNode): void {
    this.active.push(src);
    this.startedSources++;
    this.liveSources++;
    if (this.liveSources > this.peakLiveSources) this.peakLiveSources = this.liveSources;
    // Like a browser, onended never fires synchronously inside start(): even zero-length content
    // ends on the next advance().
  }

  protected setState(next: string): void {
    if (this.stateValue === next) return;
    this.stateValue = next;
    this.onStateChanged();
  }

  protected onStateChanged(): void {}

  /** Ends all active sources without firing onended (context closed). */
  protected killSources(): void {
    for (const s of this.active) s.finish(this.currentTime, false);
    this.endedSources += this.active.length;
    this.liveSources = 0;
    this.active.length = 0;
  }

  protected runAudioClockTo(target: number): void {
    for (;;) {
      let best = -1;
      let bestT = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.active.length; i++) {
        const t = this.active[i]!.endTime!;
        if (t < bestT) {
          bestT = t;
          best = i;
        }
      }
      if (best < 0 || bestT > target) break;
      const src = this.active[best]!;
      this.active.splice(best, 1);
      this.liveSources--;
      this.endedSources++;
      if (bestT > this.currentTime) this.currentTime = bestT;
      src.finish(this.currentTime, true);
    }
    if (target > this.currentTime) this.currentTime = target;
  }

  private count(kind: FakeNodeKind): void {
    this.createdNodes++;
    this.createdByKind[kind]++;
  }
}

export interface FakeAudioContextOptions extends FakeContextOptions {
  /** 'blocked' = resume() stays pending until `grantAutoplay()` (browser autoplay policy). */
  autoplay?: 'allowed' | 'blocked';
  /** Reported baseLatency in seconds (default 0.005). */
  baseLatency?: number;
  /** Reported outputLatency in seconds (default 0.02). */
  outputLatency?: number;
}

/** Realtime AudioContext fake. Starts 'suspended' (autoplay policy). */
export class FakeAudioContext extends FakeBaseAudioContext implements AudioContextLike {
  onstatechange: ((ev: Event) => unknown) | null = null;
  readonly baseLatency: number;
  readonly outputLatency: number;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  /** Every state the context went through (starting with 'suspended'). */
  readonly stateLog: string[] = ['suspended'];
  private autoplayAllowed: boolean;
  private readonly pendingResumes: (() => void)[] = [];

  constructor(opts: FakeAudioContextOptions = {}) {
    super(opts);
    this.autoplayAllowed = (opts.autoplay ?? 'allowed') === 'allowed';
    this.baseLatency = opts.baseLatency ?? 0.005;
    this.outputLatency = opts.outputLatency ?? 0.02;
  }

  /** Resolves on the next microtask with state 'running' (pending while autoplay is blocked). */
  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.stateValue === 'closed') return Promise.reject(new DOMException('resume: context is closed', 'InvalidStateError'));
    return new Promise<void>((resolve) => {
      const run = (): void => {
        queueMicrotask(() => {
          if (this.stateValue !== 'closed') this.setState('running');
          resolve();
        });
      };
      if (this.autoplayAllowed) run();
      else this.pendingResumes.push(run);
    });
  }

  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.stateValue === 'closed') return Promise.reject(new DOMException('suspend: context is closed', 'InvalidStateError'));
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        if (this.stateValue !== 'closed') this.setState('suspended');
        resolve();
      });
    });
  }

  close(): Promise<void> {
    this.closeCalls++;
    if (this.stateValue === 'closed') return Promise.reject(new DOMException('close: context is already closed', 'InvalidStateError'));
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        this.killSources();
        this.setState('closed');
        resolve();
      });
    });
  }

  /** Simulates the first user gesture: pending (and future) resume() calls go through. */
  grantAutoplay(): void {
    this.autoplayAllowed = true;
    const pending = this.pendingResumes.splice(0);
    for (const run of pending) run();
  }

  /** Forces a state change from outside (OS interruption, 'interrupted' on iOS, device loss). */
  simulateStateChange(state: 'suspended' | 'interrupted' | 'running'): void {
    if (this.stateValue === 'closed') return;
    this.setState(state);
  }

  protected override onStateChanged(): void {
    this.stateLog.push(this.stateValue);
    if (this.onstatechange !== null) this.onstatechange(new Event('statechange'));
  }
}

/** OfflineAudioContext fake: `startRendering()` runs the clock to `length` and returns silence. */
export class FakeOfflineAudioContext extends FakeBaseAudioContext implements OfflineAudioContextLike {
  readonly length: number;
  readonly numberOfChannels: number;
  private rendering = false;

  constructor(numberOfChannels: number, length: number, sampleRate: number, opts: Omit<FakeContextOptions, 'sampleRate'> = {}) {
    super({ ...opts, sampleRate });
    if (!Number.isInteger(length) || length < 1) throw new DOMException(`OfflineAudioContext: invalid length ${length}`, 'NotSupportedError');
    this.length = length;
    this.numberOfChannels = numberOfChannels;
  }

  startRendering(): Promise<AudioBufferLike> {
    if (this.rendering || this.stateValue === 'closed') {
      return Promise.reject(new DOMException('startRendering: already started', 'InvalidStateError'));
    }
    this.rendering = true;
    const out = new FakeAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
    return Promise.resolve().then(() => {
      this.setState('running');
      const endS = this.length / this.sampleRate;
      this.nowMs += (endS - this.currentTime) * 1000;
      this.runAudioClockTo(endS);
      this.setState('closed');
      return out;
    });
  }
}
