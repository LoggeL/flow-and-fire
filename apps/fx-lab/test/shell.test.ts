import { describe, expect, it } from 'vitest';
import { FixedStepClock, MAX_STEPS_PER_FRAME } from '../src/app/clock.ts';
import { LAB_SEGMENTS, SampleRing } from '../src/app/hooks.ts';
import { labParamsToSearch, parseLabParams } from '../src/app/params.ts';

describe('lab shell contracts', () => {
  it('freezes on the same fixed step regardless of frame timing and stays there', () => {
    const run = (dt: number) => {
      const c = new FixedStepClock(1.37);
      while (!c.frozen) { const n = c.advance(dt); for (let i = 0; i < n; i++) c.tick(); }
      expect(c.advance(100)).toBe(0);
      expect(c.alpha).toBe(1);
      return [c.steps, c.renderTime];
    };
    expect(run(1 / 120)).toEqual(run(0.2));
    expect(run(1 / 60)).toEqual([83, 83 / 60]);
  });
  it('bounds catch-up after a stalled live tab and resets for a scene switch', () => {
    const c = new FixedStepClock(null);
    expect(c.advance(10)).toBe(MAX_STEPS_PER_FRAME);
    expect(c.droppedFrames).toBe(1);
    for (let i = 0; i < MAX_STEPS_PER_FRAME; i++) c.tick();
    expect(c.acc).toBeLessThan(c.step);
    c.reset();
    expect([c.steps, c.acc, c.droppedFrames]).toEqual([0, 0, 0]);
    expect(c.advance(Number.NaN)).toBe(0);
  });
  it('keeps chronological samples after wrapping and rejects expired GPU results', () => {
    const r = new SampleRing(2);
    for (let f = 1; f <= 3; f++) r.push(f, f / 60, 16, f, 1, 2, 3, 400);
    expect(r.toArray().map(s => s.frame)).toEqual([2, 3]);
    expect(r.setGpu(1, 0, 9)).toBe(false);
    expect(r.setGpu(3, 0, 1)).toBe(true);
    expect(r.toArray()[1]!.gpuMs).toBeNull(); // A partial segment sum is not a GPU frame time.
    for (let s = 1; s < LAB_SEGMENTS.length; s++) r.setGpu(3, s, 1);
    expect(r.toArray()[1]!.gpuMs).toBe(6);
    r.reset(); expect(r.toArray()).toEqual([]);
    expect(r.setGpu(3, 0, 1)).toBe(false);
  });
  it('round-trips scene URLs and rejects malformed user inputs', () => {
    const warnings: string[] = [];
    const p = parseLabParams('?scene=gallery&preset=high&seed=77&freeze=1.6&hdr=0&fx=0&bench=1&flight=1', () => true);
    expect(parseLabParams(labParamsToSearch(p), () => true)).toEqual(p);
    const fallback = parseLabParams('?scene=other&preset=other&freeze=NaN&seed=-1&fx=maybe', () => true, warnings);
    expect(fallback.scene).toBe('battle'); expect(fallback.preset).toBe('medium');
    expect(fallback.freeze).toBeNull(); expect(fallback.seed).toBe(1); expect(fallback.fx).toBe(true);
    expect(warnings).toHaveLength(5);
  });
});
