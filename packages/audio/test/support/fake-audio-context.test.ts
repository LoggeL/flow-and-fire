import { describe, expect, it } from 'vitest';
import {
  FakeAudioBuffer,
  FakeAudioContext,
  FakeOfflineAudioContext,
  type FakeAudioBufferSourceNode,
} from './fake-audio-context.ts';

/** Running context (resume resolves on a microtask). */
async function running(opts: ConstructorParameters<typeof FakeAudioContext>[0] = {}): Promise<FakeAudioContext> {
  const ctx = new FakeAudioContext(opts);
  await ctx.resume();
  return ctx;
}

function source(ctx: FakeAudioContext, seconds: number, sampleRate = 48000): FakeAudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, Math.round(seconds * sampleRate), sampleRate);
  src.connect(ctx.destination);
  return src;
}

describe('FakeAudioParam automation', () => {
  it('holds the default and plain value assignments', () => {
    const ctx = new FakeAudioContext();
    const g = ctx.createGain();
    expect(g.gain.value).toBe(1);
    g.gain.value = 0.25;
    expect(g.gain.value).toBe(0.25);
    expect(g.gain.calls).toHaveLength(1);
  });

  it('evaluates setValueAtTime + linearRampToValueAtTime by hand calculation', () => {
    const g = new FakeAudioContext().createGain();
    g.gain.setValueAtTime(0.2, 1);
    g.gain.linearRampToValueAtTime(1, 3);
    expect(g.gain.valueAt(0)).toBe(1); // default before the first event
    expect(g.gain.valueAt(1)).toBe(0.2);
    expect(g.gain.valueAt(2)).toBeCloseTo(0.6, 12); // 0.2 + 0.8 · (2−1)/(3−1)
    expect(g.gain.valueAt(2.5)).toBeCloseTo(0.8, 12);
    expect(g.gain.valueAt(3)).toBe(1);
    expect(g.gain.valueAt(10)).toBe(1);
  });

  it('ramps from the previous event end (no explicit start)', () => {
    const g = new FakeAudioContext().createGain();
    g.gain.linearRampToValueAtTime(0, 2); // from default 1 at t=0
    expect(g.gain.valueAt(0.5)).toBeCloseTo(0.75, 12);
    expect(g.gain.valueAt(2)).toBe(0);
  });

  it('evaluates setTargetAtTime as exponential approach', () => {
    const g = new FakeAudioContext().createGain();
    g.gain.setValueAtTime(1, 0);
    g.gain.setTargetAtTime(0, 1, 0.5);
    expect(g.gain.valueAt(0.99)).toBe(1);
    expect(g.gain.valueAt(1)).toBe(1);
    expect(g.gain.valueAt(1.5)).toBeCloseTo(Math.exp(-1), 12);
    expect(g.gain.valueAt(2)).toBeCloseTo(Math.exp(-2), 12);
    // target 0.5 from 0.1
    const h = new FakeAudioContext().createGain();
    h.gain.setValueAtTime(0.1, 0);
    h.gain.setTargetAtTime(0.5, 0, 0.1);
    expect(h.gain.valueAt(0.1)).toBeCloseTo(0.5 + (0.1 - 0.5) * Math.exp(-1), 12);
    // timeConstant 0 jumps
    const j = new FakeAudioContext().createGain();
    j.gain.setTargetAtTime(0.3, 1, 0);
    expect(j.gain.valueAt(0.5)).toBe(1);
    expect(j.gain.valueAt(1)).toBe(0.3);
  });

  it('a set event ends a running setTarget', () => {
    const g = new FakeAudioContext().createGain();
    g.gain.setTargetAtTime(0, 0, 1);
    g.gain.setValueAtTime(0.7, 2);
    expect(g.gain.valueAt(1)).toBeCloseTo(Math.exp(-1), 12);
    expect(g.gain.valueAt(2.5)).toBe(0.7);
  });

  it('a linear ramp after a running setTarget starts at the scheduling time', async () => {
    const ctx = await running();
    const g = ctx.createGain();
    g.gain.setTargetAtTime(0, 0, 1);
    ctx.advance(1000);
    const v1 = Math.exp(-1);
    expect(g.gain.value).toBeCloseTo(v1, 12);
    g.gain.linearRampToValueAtTime(1, 2);
    expect(g.gain.valueAt(1)).toBeCloseTo(v1, 12);
    expect(g.gain.valueAt(1.5)).toBeCloseTo(v1 + (1 - v1) * 0.5, 12);
    expect(g.gain.valueAt(2)).toBe(1);
  });

  it('cancelScheduledValues removes events at or after the cancel time', () => {
    const g = new FakeAudioContext().createGain();
    g.gain.setValueAtTime(0.5, 1);
    g.gain.linearRampToValueAtTime(0, 2);
    g.gain.setValueAtTime(0.9, 3);
    g.gain.cancelScheduledValues(2);
    expect(g.gain.events.map((e) => e.type)).toEqual(['set']);
    expect(g.gain.valueAt(5)).toBe(0.5);
    expect(g.gain.count('cancelScheduledValues')).toBe(1);
  });

  it('value follows the audio clock and panner values are clamped', async () => {
    const ctx = await running();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(1, 1);
    ctx.advance(250);
    expect(g.gain.value).toBeCloseTo(0.25, 12);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(3, 0);
    expect(p.pan.value).toBe(1);
  });

  it('rejects invalid arguments like the browser', () => {
    const g = new FakeAudioContext().createGain();
    expect(() => g.gain.setValueAtTime(1, -1)).toThrow(RangeError);
    expect(() => g.gain.setValueAtTime(Number.NaN, 1)).toThrow(TypeError);
    expect(() => g.gain.setTargetAtTime(0, 0, -1)).toThrow(RangeError);
  });

  it('keeps the schedule small on long-lived params without changing current values', async () => {
    const ctx = await running({ logAutomation: false });
    const g = ctx.createGain();
    for (let i = 0; i < 500; i++) {
      g.gain.setValueAtTime(i / 500, ctx.currentTime);
      g.gain.linearRampToValueAtTime((i + 1) / 500, ctx.currentTime + 0.01);
      ctx.advance(20);
    }
    expect(g.gain.events.length).toBeLessThanOrEqual(65);
    expect(g.gain.value).toBe(1);
    expect(g.gain.calls).toHaveLength(0);
  });
});

describe('FakeAudioBufferSourceNode', () => {
  it('fires onended at start + duration / playbackRate', async () => {
    const ctx = await running();
    const ends: number[] = [];
    const a = source(ctx, 1);
    a.onended = () => ends.push(ctx.currentTime);
    a.start(0.5);
    const b = source(ctx, 1);
    b.playbackRate.value = 2;
    b.onended = () => ends.push(ctx.currentTime);
    b.start(0);
    const c = source(ctx, 1);
    c.onended = () => ends.push(ctx.currentTime);
    c.start(0, 0.75); // offset: 0.25 s left
    expect(ctx.liveSources).toBe(3);
    ctx.advance(2000);
    expect(ends).toEqual([0.25, 0.5, 1.5]);
    expect(ctx.liveSources).toBe(0);
    expect(ctx.peakLiveSources).toBe(3);
    expect(ctx.currentTime).toBe(2);
  });

  it('uses the buffer duration for any sample rate and honours the duration argument', async () => {
    const ctx = await running();
    const a = source(ctx, 0.5, 44100);
    a.start(0);
    expect(a.endTime).toBeCloseTo(0.5, 12);
    const b = source(ctx, 2);
    b.start(0, 0, 0.3);
    expect(b.endTime).toBeCloseTo(0.3, 12);
  });

  it('does not end on its own time while the context is suspended', () => {
    const ctx = new FakeAudioContext();
    const a = source(ctx, 0.1);
    a.start();
    ctx.advance(1000);
    expect(ctx.currentTime).toBe(0);
    expect(ctx.nowMs).toBe(1000);
    expect(a.ended).toBe(false);
    expect(ctx.liveSources).toBe(1);
  });

  it('loops until stop and fires onended exactly once', async () => {
    const ctx = await running();
    const a = source(ctx, 0.2);
    a.loop = true;
    a.loopStart = 0.04;
    a.loopEnd = 0.16;
    let ended = 0;
    a.onended = () => ended++;
    a.start(0);
    ctx.advance(10_000);
    expect(a.ended).toBe(false);
    expect(a.playing).toBe(true);
    a.stop(ctx.currentTime + 0.05);
    ctx.advance(40);
    expect(a.ended).toBe(false);
    ctx.advance(20);
    expect(a.ended).toBe(true);
    expect(a.endedAt).toBeCloseTo(10.05, 9);
    a.stop(); // stopping an ended source is a no-op
    ctx.advance(100);
    expect(ended).toBe(1);
  });

  it('stop before the scheduled start ends at the start time; stop in the past means now', async () => {
    const ctx = await running();
    const a = source(ctx, 1);
    a.start(1);
    a.stop(0.5);
    expect(a.endTime).toBe(1);
    ctx.advance(500);
    const b = source(ctx, 1);
    b.start(0);
    b.stop(0.1);
    expect(b.stopWhen).toBe(0.5);
  });

  it('throws on double start and on stop before start', async () => {
    const ctx = await running();
    const a = source(ctx, 1);
    expect(() => a.stop()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    a.start();
    expect(() => a.start()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => source(ctx, 1).start(-1)).toThrow(RangeError);
  });

  it('onended handlers can start new sources inside the same advance()', async () => {
    const ctx = await running();
    const starts: number[] = [];
    const chain = (n: number): void => {
      const s = source(ctx, 0.1);
      s.onended = () => {
        if (n > 0) chain(n - 1);
      };
      starts.push(ctx.currentTime);
      s.start(ctx.currentTime);
    };
    chain(3);
    ctx.advance(1000);
    expect(starts.map((t) => Math.round(t * 1000))).toEqual([0, 100, 200, 300]);
    expect(ctx.liveSources).toBe(0);
    expect(ctx.peakLiveSources).toBe(1);
  });

  it('a source without buffer plays silence until stopped', async () => {
    const ctx = await running();
    const a = ctx.createBufferSource();
    a.start();
    ctx.advance(5000);
    expect(a.ended).toBe(false);
    a.stop();
    ctx.advance(0);
    expect(a.ended).toBe(true);
  });
});

describe('FakeAudioContext state machine', () => {
  it('starts suspended, resume → running asynchronously, statechange fires', async () => {
    const ctx = new FakeAudioContext();
    const seen: string[] = [];
    ctx.onstatechange = () => seen.push(ctx.state);
    expect(ctx.state).toBe('suspended');
    const p = ctx.resume();
    expect(ctx.state).toBe('suspended');
    await p;
    expect(ctx.state).toBe('running');
    await ctx.suspend();
    expect(ctx.state).toBe('suspended');
    await ctx.resume();
    await ctx.close();
    expect(ctx.state).toBe('closed');
    expect(seen).toEqual(['running', 'suspended', 'running', 'closed']);
    expect(ctx.stateLog).toEqual(['suspended', 'running', 'suspended', 'running', 'closed']);
    await expect(ctx.resume()).rejects.toMatchObject({ name: 'InvalidStateError' });
    await expect(ctx.close()).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  it('blocked autoplay keeps resume() pending until a gesture', async () => {
    const ctx = new FakeAudioContext({ autoplay: 'blocked' });
    let resolved = false;
    const p = ctx.resume().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(ctx.state).toBe('suspended');
    ctx.grantAutoplay();
    await p;
    expect(ctx.state).toBe('running');
    expect(ctx.resumeCalls).toBe(1);
  });

  it('simulated interruptions change state and close kills live sources silently', async () => {
    const ctx = await running();
    ctx.simulateStateChange('interrupted');
    expect(ctx.state).toBe('interrupted');
    await ctx.resume();
    const a = source(ctx, 5);
    let fired = false;
    a.onended = () => {
      fired = true;
    };
    a.start();
    expect(ctx.liveSources).toBe(1);
    await ctx.close();
    expect(ctx.liveSources).toBe(0);
    expect(a.ended).toBe(true);
    expect(fired).toBe(false);
  });

  it('reports latencies', () => {
    const ctx = new FakeAudioContext({ baseLatency: 0.01, outputLatency: 0.03 });
    expect(ctx.baseLatency).toBe(0.01);
    expect(ctx.outputLatency).toBe(0.03);
  });
});

describe('graph bookkeeping', () => {
  it('finds the path to the destination and forgets it after disconnect', () => {
    const ctx = new FakeAudioContext();
    const master = ctx.createGain();
    master.label = 'master';
    const limiter = ctx.createDynamicsCompressor();
    const sfx = ctx.createGain();
    sfx.label = 'sfx';
    const src = ctx.createBufferSource();
    const vg = ctx.createGain();
    const pan = ctx.createStereoPanner();
    src.connect(vg);
    vg.connect(pan);
    pan.connect(sfx);
    sfx.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);
    expect(ctx.describePath(src)).toBe('source > gain > panner > gain:sfx > gain:master > compressor > destination');
    expect(ctx.graphPathToDestination(src)).toContain(sfx);
    expect(ctx.createdNodes).toBe(6);
    expect(ctx.createdByKind).toMatchObject({ gain: 3, panner: 1, compressor: 1, source: 1 });
    pan.disconnect();
    expect(ctx.graphPathToDestination(src)).toBeNull();
    expect(sfx.inputs).toHaveLength(0);
  });

  it('connect is idempotent and rejects foreign nodes', () => {
    const ctx = new FakeAudioContext();
    const other = new FakeAudioContext();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    g.connect(ctx.destination);
    expect(g.outputs).toHaveLength(1);
    expect(() => g.connect(other.createGain())).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(() => g.connect(ctx.createBufferSource())).toThrow();
  });

  it('compressor defaults match the Web Audio spec', () => {
    const c = new FakeAudioContext().createDynamicsCompressor();
    expect([c.threshold.value, c.knee.value, c.ratio.value, c.attack.value, c.release.value, c.reduction]).toEqual([
      -24, 30, 12, 0.003, 0.25, 0,
    ]);
  });
});

describe('FakeAudioBuffer and decodeAudioData', () => {
  it('allocates lazily and copies into channels', () => {
    const b = new FakeAudioBuffer(2, 4, 44100);
    expect(b.duration).toBeCloseTo(4 / 44100, 15);
    expect(b.isMaterialized(0)).toBe(false);
    b.copyToChannel(new Float32Array([1, 2, 3]), 1, 2);
    expect(Array.from(b.getChannelData(1))).toEqual([0, 0, 1, 2]);
    expect(b.isMaterialized(0)).toBe(false);
    expect(() => b.getChannelData(2)).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    expect(() => new FakeAudioBuffer(0, 1, 48000)).toThrow(expect.objectContaining({ name: 'NotSupportedError' }));
    expect(() => new FakeAudioBuffer(1, 0, 48000)).toThrow();
    expect(() => new FakeAudioBuffer(1, 1, 1000)).toThrow();
  });

  it('rejects with EncodingError by default and detaches the input', async () => {
    const ctx = new FakeAudioContext();
    const bytes = new ArrayBuffer(16);
    await expect(ctx.decodeAudioData(bytes)).rejects.toMatchObject({ name: 'EncodingError' });
    expect(bytes.byteLength).toBe(0);
    await expect(ctx.decodeAudioData(bytes)).rejects.toBeInstanceOf(TypeError);
    expect(ctx.decodeCalls).toBe(2);
  });

  it('uses a configured decoder', async () => {
    const ctx = new FakeAudioContext({ sampleRate: 44100 });
    ctx.setDecoder((data, c) => c.createBuffer(1, data.byteLength * 10, c.sampleRate));
    const buf = await ctx.decodeAudioData(new ArrayBuffer(8));
    expect(buf.length).toBe(80);
    expect(buf.sampleRate).toBe(44100);
  });
});

describe('FakeOfflineAudioContext', () => {
  it('renders length frames, runs sources and closes', async () => {
    const ctx = new FakeOfflineAudioContext(2, 48000, 48000);
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 12000, 48000);
    src.connect(ctx.destination);
    let endedAt = -1;
    src.onended = () => {
      endedAt = ctx.currentTime;
    };
    src.start(0.25);
    const loop = ctx.createBufferSource();
    loop.buffer = ctx.createBuffer(1, 4800, 48000);
    loop.loop = true;
    loop.start();
    const out = await ctx.startRendering();
    expect(out.length).toBe(48000);
    expect(out.numberOfChannels).toBe(2);
    expect(out.sampleRate).toBe(48000);
    expect(endedAt).toBeCloseTo(0.5, 12);
    expect(ctx.currentTime).toBe(1);
    expect(ctx.state).toBe('closed');
    expect(ctx.liveSources).toBe(1); // the loop never ended
    await expect(ctx.startRendering()).rejects.toMatchObject({ name: 'InvalidStateError' });
  });
});
