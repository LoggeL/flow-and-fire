import { createWebGL2Device } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { GpuSpanTimer, TIMER_QUERY_EXT, hideTimerQueryFromDevice } from '../../src/index.ts';
import { FakeCanvas } from '../support/fake-gl.ts';
import type { FakeGlObject } from '../support/fake-gl.ts';

const SEGMENTS = ['shadow', 'opaque', 'shields', 'particles', 'beams', 'post'];

function setup(opts: { disjoint?: () => boolean } = {}) {
  const results = new Map<FakeGlObject, number>();
  const canvas = new FakeCanvas({ timerQuery: true, queryResults: results, ...(opts.disjoint ? { disjoint: opts.disjoint } : {}) });
  const gl = canvas.gl as unknown as WebGL2RenderingContext;
  const ext = hideTimerQueryFromDevice(gl);
  const dev = createWebGL2Device(canvas);
  return { canvas, gl, ext, dev, results };
}

describe('hideTimerQueryFromDevice', () => {
  it('hides the extension from the device but not from the accessor', () => {
    const { gl, ext, dev } = setup();
    expect(dev.caps.timerQuery).toBe(false);
    expect(gl.getExtension(TIMER_QUERY_EXT)).toBeNull();
    expect(gl.getExtension('EXT_color_buffer_float')).toBeNull();
    expect(ext()).not.toBeNull();
  });
});

describe('GpuSpanTimer', () => {
  it('times consecutive named segments and resolves them asynchronously', () => {
    const { canvas, gl, ext, results } = setup();
    const t = new GpuSpanTimer(gl, ext, SEGMENTS);
    expect(t.available).toBe(true);
    t.beginFrame();
    t.beginNamed('shadow');
    t.beginNamed('opaque');
    t.begin(t.segmentIndex('post'));
    t.endFrame();
    const begins = canvas.gl.named('beginQuery');
    const ends = canvas.gl.named('endQuery');
    expect(begins.length).toBe(3);
    expect(ends.length).toBe(3);
    // Never nested: begin/end strictly alternate.
    const seq = canvas.gl.calls.filter((c) => c.name === 'beginQuery' || c.name === 'endQuery').map((c) => c.name);
    expect(seq).toEqual(['beginQuery', 'endQuery', 'beginQuery', 'endQuery', 'beginQuery', 'endQuery']);
    expect(t.inFlight).toBe(3);

    // Nothing available yet.
    t.poll();
    expect(Number.isNaN(t.latestMs[0]!)).toBe(true);
    // The first two finish (in order); the third is still pending.
    results.set(begins[0]!.args[1] as FakeGlObject, 1_500_000);
    results.set(begins[1]!.args[1] as FakeGlObject, 4_000_000);
    const seen: [number, number, number][] = [];
    t.poll((f, s, ms) => seen.push([f, s, ms]));
    expect(seen).toEqual([
      [0, 0, 1.5],
      [0, 1, 4],
    ]);
    expect(t.inFlight).toBe(1);
    results.set(begins[2]!.args[1] as FakeGlObject, 250_000);
    t.poll();
    expect(t.latestMs[5]).toBe(0.25);
    expect(t.latestTotalMs()).toBeCloseTo(5.75, 9);

    // Queries are recycled from the pool.
    const created = canvas.gl.created('query');
    t.beginFrame();
    t.begin(0);
    t.endFrame();
    expect(canvas.gl.created('query')).toBe(created);
    t.dispose();
    expect(canvas.gl.named('deleteQuery').length).toBe(3);
  });

  it('drops disjoint results', () => {
    let disjoint = true;
    const { canvas, gl, ext, results } = setup({ disjoint: () => disjoint });
    const t = new GpuSpanTimer(gl, ext, SEGMENTS);
    t.beginFrame();
    t.begin(1);
    t.endFrame();
    results.set(canvas.gl.named('beginQuery')[0]!.args[1] as FakeGlObject, 2_000_000);
    t.poll();
    expect(t.disjoint).toBe(1);
    expect(Number.isNaN(t.latestMs[1]!)).toBe(true);
    disjoint = false;
    t.beginFrame();
    t.begin(1);
    t.endFrame();
    results.set(canvas.gl.named('beginQuery')[1]!.args[1] as FakeGlObject, 3_000_000);
    t.poll();
    expect(t.latestMs[1]).toBe(3);
    expect(t.latestFrame[1]).toBe(1);
  });

  it('skips segments when the pool is exhausted and is inert without the extension', () => {
    const { gl, ext } = setup();
    const t = new GpuSpanTimer(gl, ext, ['a'], 2);
    for (let i = 0; i < 4; i++) {
      t.beginFrame();
      t.begin(0);
      t.endFrame();
    }
    expect(t.inFlight).toBe(2);
    expect(t.skipped).toBe(2);
    const plain = new FakeCanvas();
    const off = new GpuSpanTimer(plain.gl as unknown as WebGL2RenderingContext, null, ['a']);
    expect(off.available).toBe(false);
    off.beginFrame();
    off.begin(0);
    off.endFrame();
    off.poll();
    expect(plain.gl.named('beginQuery').length).toBe(0);
    expect(() => new GpuSpanTimer(gl, ext, [])).toThrow();
    expect(() => t.beginNamed('nope')).toThrow(RangeError);
  });

  it('survives a context loss via reset()', () => {
    const { canvas, gl, ext, results } = setup();
    const t = new GpuSpanTimer(gl, ext, SEGMENTS);
    t.beginFrame();
    t.begin(0);
    canvas.gl.lose();
    t.begin(1); // ends segment 0 without a GL call, starts nothing
    t.endFrame();
    t.poll();
    expect(canvas.gl.named('endQuery').length).toBe(0);
    canvas.gl.restore();
    t.reset();
    expect(t.inFlight).toBe(0);
    t.beginFrame();
    t.begin(2);
    t.endFrame();
    const q = canvas.gl.named('beginQuery').at(-1)!.args[1] as FakeGlObject;
    expect(q.gen).toBe(canvas.gl.generation);
    results.set(q, 1_000_000);
    t.poll();
    expect(t.latestMs[2]).toBe(1);
  });
});
