import { describe, expect, it } from 'vitest';
import { FrameStream } from '../src/frames.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';

const RAF_MS = 1000 / 60;

interface Sample {
  t: number;
  tick: number;
  alpha: number;
  shown: number;
  newFrame: boolean;
}

/** Runs the link with 60 Hz rAFs for `ms`, polling + alpha each rAF. */
function run(link: FakeSimLink, s: FrameStream, t0: number, ms: number): Sample[] {
  const out: Sample[] = [];
  for (let t = t0; t < t0 + ms; t += RAF_MS) {
    link.advance(RAF_MS);
    const nf = s.poll(t);
    const a = s.alpha(t);
    out.push({ t, tick: s.tick, alpha: a, shown: s.tick - 1 + a, newFrame: nf });
  }
  return out;
}

describe('FrameStream: adaptive render delay and alpha', () => {
  it('interpolates smoothly with regular arrivals (steady state: monotonic, ~0.5 tick average lag)', () => {
    const link = new FakeSimLink({ units: 4 });
    const s = new FrameStream(link.frames);
    run(link, s, 0, 1000);
    const samples = run(link, s, 1000, 3000);
    let stalls = 0;
    let lag = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      expect(b.alpha).toBeGreaterThanOrEqual(0);
      expect(b.alpha).toBeLessThanOrEqual(1);
      // The displayed sim time never goes backwards.
      expect(b.shown).toBeGreaterThanOrEqual(a.shown - 1e-9);
      if (b.shown - a.shown < 1e-9) stalls++;
      lag += b.tick - b.shown;
    }
    lag /= samples.length - 1;
    // rAF quantisation of the arrivals (±1 rAF) is the only jitter here.
    expect(s.jitterMs).toBeGreaterThan(0);
    expect(s.jitterMs).toBeLessThanOrEqual(RAF_MS + 1e-6);
    expect(s.renderDelayMs).toBeCloseTo(50 + s.jitterMs, 9);
    // Average lag behind the newest frame ≈ delay (0.5 tick + jitter) within a sixth of a tick.
    expect(Math.abs(lag - s.renderDelayMs / s.tickMs)).toBeLessThan(0.17);
    expect(stalls / samples.length).toBeLessThan(0.1);
    expect(s.snaps).toBe(0);
    expect(s.skippedTicks).toBe(0);
  });

  it('freezes alpha at 1 while paused; tick stands; resynchronises after resume', () => {
    const link = new FakeSimLink({ units: 4 });
    const s = new FrameStream(link.frames);
    run(link, s, 0, 1000);
    link.sendCtl({ t: 'pause' });
    const paused = run(link, s, 1000, 1500);
    const tick = paused[paused.length - 1]!.tick;
    for (const p of paused.slice(2)) {
      expect(p.alpha).toBe(1);
      expect(p.tick).toBe(tick);
    }
    expect(s.paused).toBe(true);
    // Step while paused: new tick, still alpha 1.
    link.sendCtl({ t: 'step', ticks: 1 });
    const stepped = run(link, s, 2500, 50);
    expect(stepped[stepped.length - 1]!.tick).toBe(tick + 1);
    expect(stepped[stepped.length - 1]!.alpha).toBe(1);
    link.sendCtl({ t: 'resume' });
    const resumed = run(link, s, 2550, 2000);
    expect(s.paused).toBe(false);
    expect(resumed[resumed.length - 1]!.tick).toBeGreaterThan(tick + 15);
    const tail = resumed.slice(30);
    expect(tail.some((x) => x.alpha > 0 && x.alpha < 1)).toBe(true);
  });

  it('derives the tick length from the header speed (2x → 50 ms)', () => {
    const link = new FakeSimLink({ units: 4 });
    link.sendCtl({ t: 'speed', speed: 2 });
    const s = new FrameStream(link.frames);
    const samples = run(link, s, 0, 3000);
    expect(s.speedPermille).toBe(2000);
    expect(s.tickMs).toBe(50);
    expect(samples[samples.length - 1]!.tick).toBeGreaterThanOrEqual(59);
    expect(s.renderDelayMs).toBeCloseTo(25 + s.jitterMs, 9);
    link.sendCtl({ t: 'speed', speed: 0.5 });
    run(link, s, 3000, 1000);
    expect(s.tickMs).toBe(200);
  });

  it('builds the jitter buffer from the recent arrival intervals (capped at 0.5 tick)', () => {
    const link = new FakeSimLink({ units: 1 });
    const s = new FrameStream(link.frames, { historySize: 16 });
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t += i % 2 === 0 ? 70 : 130;
      link.tickNow();
      s.poll(t);
      s.alpha(t);
    }
    expect(s.jitterMs).toBeCloseTo(30, 9);
    expect(s.renderDelayMs).toBeCloseTo(80, 9);
    const iv = new Float64Array(16);
    expect(s.intervalsInto(iv)).toBe(16);
    expect([...iv].every((v) => v === 70 || v === 130)).toBe(true);
    for (let i = 0; i < 40; i++) {
      t += i % 2 === 0 ? 10 : 190;
      link.tickNow();
      s.poll(t);
      s.alpha(t);
    }
    expect(s.jitterMs).toBe(50);
    expect(s.renderDelayMs).toBe(100);
  });

  it('counts ticks the transport skipped and normalises the interval per tick', () => {
    const link = new FakeSimLink({ units: 1 });
    const s = new FrameStream(link.frames);
    s.poll(0);
    link.tickNow();
    s.poll(100);
    link.tickNow();
    link.tickNow(); // never polled
    s.poll(300);
    expect(s.skippedTicks).toBe(1);
    const iv = new Float64Array(4);
    expect(s.intervalsInto(iv)).toBe(2);
    expect(iv[0]).toBe(100);
    expect(iv[1]).toBe(100);
  });

  it('exposes header fields and a cached UnitRecord view without re-allocating', () => {
    const link = new FakeSimLink({ units: 9 });
    const s = new FrameStream(link.frames);
    expect(s.poll(5)).toBe(true);
    expect(s.poll(6)).toBe(false);
    expect(s.hasFrame).toBe(true);
    expect(s.unitCount).toBe(9);
    const u1 = s.units();
    expect(u1.length).toBe(9 * 48);
    expect(s.units()).toBe(u1);
    link.tickNow();
    s.poll(100);
    expect(s.units()).toBe(u1); // same buffer, same layout → same view
    expect(s.frameCount).toBe(2);
    expect(s.tick).toBe(1);
    expect(s.arrivalMs).toBe(100);
  });

  it('rejects corrupt frames', () => {
    const link = new FakeSimLink({ units: 2 });
    const s = new FrameStream(link.frames);
    s.poll(0);
    link.frames.deliver(new Uint8Array(200), 999);
    expect(s.poll(10)).toBe(false);
    expect(s.invalidFrames).toBe(1);
    expect(s.hasFrame).toBe(false);
    expect(s.alpha(20)).toBe(1);
    expect(s.unitCount).toBe(0);
    link.tickNow();
    expect(s.poll(30)).toBe(true);
    expect(s.hasFrame).toBe(true);
  });

  it('alpha is 1 before the first frame', () => {
    const link = new FakeSimLink({ units: 0 });
    const s = new FrameStream(link.frames);
    expect(s.alpha(0)).toBe(1);
  });
});
