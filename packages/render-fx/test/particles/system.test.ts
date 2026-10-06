import { RENDER_PRESETS } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { FxRng } from '../../src/effects/random.ts';
import {
  EXPIRY_BUCKET_S,
  MAX_PARTICLE_EMITTERS,
  MIN_WINDOW,
  WINDOW_FACTOR,
  PARTICLE_RECORD_STRIDE,
  PRIO2_CAP_FRACTION,
  ParticleSystem,
  particleCapForPreset,
  readRecord,
} from '../../src/particles/index.ts';
import { wrapFxTime } from '../../src/core/frame.ts';
import { COPY_WRITE_BUFFER, FX, RAW, draws, frame, ringWrites, setup } from './support.ts';

/** Applies the ring uploads recorded since the last resetCalls() to a GPU-side shadow copy. */
function applyRingWrites(env: ReturnType<typeof setup>, shadow: Uint8Array): void {
  for (const c of env.gl.named('bufferSubData')) {
    if (c.args[0] !== COPY_WRITE_BUFFER) continue;
    const src = c.args[2] as Uint8Array;
    const off = c.args[3] as number;
    const len = c.args[4] as number;
    shadow.set(src.subarray(off, off + len), c.args[1] as number);
  }
  env.gl.resetCalls();
}

/** Layer index stored in ring slot `slot`. */
function layerOf(env: ReturnType<typeof setup>, slot: number): number {
  return env.ps.records.u16[slot * 16 + 12]!;
}

const ORIGIN = [0, 0, 0];
const S = PARTICLE_RECORD_STRIDE;

describe('particleCapForPreset', () => {
  it('maps the render presets to their particle caps', () => {
    expect(particleCapForPreset('low')).toBe(8192);
    expect(particleCapForPreset('medium')).toBe(16384);
    expect(particleCapForPreset('high')).toBe(32768);
    expect(particleCapForPreset('ultra')).toBe(65536);
    expect(particleCapForPreset(RENDER_PRESETS.medium)).toBe(16384);
  });
});

describe('ParticleSystem – ring and uploads', () => {
  it('uploads only the new records, one writeBuffer, uploadBytesFrame = spawned × stride', () => {
    const env = setup();
    env.gl.resetCalls();
    const n = env.ps.spawn(FX.p1, ORIGIN, { seed: 1 });
    expect(n).toBe(100);
    expect(ringWrites(env.gl)).toEqual([]); // nothing before update()
    frame(env, 1);
    expect(ringWrites(env.gl)).toEqual([[0, 100 * S]]);
    expect(env.ps.stats.uploadBytesFrame).toBe(100 * S);
    expect(env.ps.stats.spawnedFrame).toBe(100);
    // Next frame: no spawns, no upload.
    env.gl.resetCalls();
    frame(env, 1 + 1 / 60);
    expect(ringWrites(env.gl)).toEqual([]);
    expect(env.ps.stats.uploadBytesFrame).toBe(0);
    expect(env.ps.stats.spawnedFrame).toBe(0);
    // Two bursts in one frame: one contiguous upload starting at slot 100.
    env.ps.spawn(FX.p1, ORIGIN);
    env.ps.spawn(FX.p1, ORIGIN);
    frame(env, 1 + 2 / 60);
    expect(ringWrites(env.gl)).toEqual([[100 * S, 200 * S]]);
    expect(env.ps.stats.uploadBytesFrame).toBe(200 * S);
  });

  it('wraps: 2 writeBuffer at the right offsets and 2 draws while the window wraps', () => {
    const env = setup({ capacity: 256, cap: 256 });
    env.ps.spawn(FX.p1, ORIGIN); // slots 0..99
    env.ps.spawn(FX.p1, ORIGIN); // 100..199
    expect(frame(env, 0)).toBe(1);
    // All expire after 1 s; the tail follows.
    frame(env, 1.05);
    expect(env.ps.windowRange).toEqual({ tail: 200, head: 200 });
    expect(frame(env, 1.06)).toBe(0);
    env.gl.resetCalls();
    env.ps.spawn(FX.p1, ORIGIN); // 200..299 → slots 200..255, 0..43
    const n = frame(env, 1.1);
    expect(ringWrites(env.gl)).toEqual([
      [200 * S, 56 * S],
      [0, 44 * S],
    ]);
    expect(n).toBe(2);
    expect(draws(env.gl)).toEqual([56, 44]);
    // First draw starts at slot 200, second at slot 0 (instance attribute base offsets).
    const ptrs = env.gl.named('vertexAttribIPointer').filter((c) => c.args[0] === 0);
    expect(ptrs.map((c) => c.args[4])).toEqual([200 * S, 0]);
    expect(env.ps.stats.uploadBytesFrame).toBe(100 * S);
  });

  it('draws 0 when empty and 1 for a contiguous window', () => {
    const env = setup();
    env.gl.resetCalls();
    expect(frame(env, 0)).toBe(0);
    expect(draws(env.gl)).toEqual([]);
    env.ps.spawn(FX.p1, ORIGIN);
    expect(frame(env, 0.1)).toBe(1);
    expect(draws(env.gl)).toEqual([100]);
    expect(env.ps.stats.draws).toBe(1);
  });

  it('uploads the whole ring once when more than capacity records were written in one frame', () => {
    const env = setup({ capacity: 150, cap: 150 });
    env.gl.resetCalls();
    env.ps.spawn(FX.p0, ORIGIN);
    env.ps.spawn(FX.p0, ORIGIN);
    frame(env, 0);
    expect(ringWrites(env.gl)).toEqual([[0, 150 * S]]);
    expect(env.ps.stats.overwritten).toEqual([50, 0, 0]);
    expect(env.ps.stats.alive).toBe(150);
    expect(env.ps.windowRange).toEqual({ tail: 50, head: 200 });
  });

  it('writes the record layout (origin, t0, f16 axis/scale, layer, seed, tint)', () => {
    const env = setup();
    frame(env, 10);
    env.ps.spawn(FX.p1, [5 * RAW, 7, -3 * RAW], { dir: [0, 0, 2], scale: 1.5, tint: 0x336699, seed: 9 });
    expect(readRecord(env.ps.records, 0).t0).toBe(0); // pending until update()
    frame(env, 10.25);
    const rec = readRecord(env.ps.records, 0);
    expect(rec.originRaw).toEqual([5 * RAW, 7, -3 * RAW]);
    expect(rec.t0).toBe(Math.fround(wrapFxTime(10.25)));
    expect(rec.vec).toEqual([0, 0, 1, 1.5]);
    expect(rec.layer).toBe(env.lib.effects[FX.p1]!.firstLayer);
    expect(rec.tint).toBe(0x336699);
    // Stream layers carry the target delta instead of the axis.
    const h = env.ps.createEmitter(FX.stream, [RAW, 0, 0], { targetRaw: [RAW * 11, RAW * 2, 0] });
    frame(env, 10.5);
    const r2 = readRecord(env.ps.records, 100);
    expect(r2.vec.slice(0, 3)).toEqual([10, 2, 0]);
    expect(r2.layer).toBe(env.lib.effects[FX.stream]!.firstLayer);
    env.ps.destroyEmitter(h);
  });
});

describe('ParticleSystem – window, alive count', () => {
  it('advances the tail over expired slots only (window = first alive slot .. head)', () => {
    const env = setup({ capacity: 8192, cap: 8192 });
    const rng = new FxRng(3);
    let t = 0;
    for (let f = 0; f < 240; f++) {
      if (f % 3 === 0) env.ps.spawn(FX.varied, ORIGIN, { seed: rng.next() });
      frame(env, t);
      const { tail, head } = env.ps.windowRange;
      expect(head).toBeLessThan(8192); // no wrap in this test: slot = index
      // Brute force: the tail is the first slot (from 0) that has not expired yet, or head.
      let first = head;
      for (let c = 0; c < head; c++) {
        if (env.ps.expiryOf(c) > t) {
          first = c;
          break;
        }
      }
      expect(tail).toBe(first);
      if (f === 60) expect(tail).toBeGreaterThan(0);
      t += 1 / 60;
    }
  });

  it('alive (histogram) == brute force over the ring', () => {
    const env = setup({ capacity: 32768, cap: 32768 });
    const rng = new FxRng(11);
    let t = 3.7;
    for (let f = 0; f < 400; f++) {
      const k = rng.int(0, 3);
      for (let i = 0; i < k; i++) env.ps.spawn(FX.varied, ORIGIN, { seed: rng.next() });
      if (f === 150) env.ps.createEmitter(FX.emit, ORIGIN);
      frame(env, t);
      const { tail, head } = env.ps.windowRange;
      const bucketNow = Math.floor(t * 64);
      expect(EXPIRY_BUCKET_S).toBe(1 / 64);
      let brute = 0;
      let exact = 0;
      let inBucket = 0;
      expect(head).toBeLessThan(32768);
      void tail;
      for (let c = 0; c < head; c++) {
        const e = env.ps.expiryOf(c);
        const b = Math.floor(e * 64);
        if (b >= bucketNow) brute++;
        if (e > t) exact++;
        if (b === bucketNow) inBucket++;
      }
      expect(env.ps.stats.alive).toBe(brute);
      expect(Math.abs(env.ps.stats.alive - exact)).toBeLessThanOrEqual(inBucket);
      t += rng.range(0.005, 0.05);
    }
    expect(env.ps.stats.alive).toBeGreaterThan(0);
  });
});

describe('ParticleSystem – bounded window and full-ring eviction', () => {
  it('a long-lived particle at the tail does not hold the window open (window ≤ limit, P0 kept)', () => {
    const capacity = 65536;
    const cap = 1000;
    const env = setup({ capacity, cap });
    const shadow = new Uint8Array(capacity * S);
    env.gl.resetCalls();
    env.ps.spawn(FX.long0, ORIGIN, { seed: 77 }); // slot 0: priority 0, 30 s
    frame(env, 0);
    applyRingWrites(env, shadow);
    const longLayer = env.lib.effects[FX.long0]!.firstLayer;
    const orig = readRecord(env.ps.records, 0);
    let t = 0;
    let maxWindow = 0;
    for (let f = 1; f <= 1200; f++) {
      t = f / 60;
      env.ps.spawn(FX.short1, ORIGIN); // 50 × 0.2 s, priority 1: ~600 alive
      frame(env, t);
      applyRingWrites(env, shadow);
      const st = env.ps.stats;
      expect(st.window).toBeLessThanOrEqual(st.windowLimit);
      expect(st.windowLimit).toBe(Math.max(MIN_WINDOW, Math.floor(WINDOW_FACTOR * Math.max(st.alive, cap))));
      maxWindow = Math.max(maxWindow, st.window);
    }
    const st = env.ps.stats;
    expect(maxWindow).toBeLessThanOrEqual(Math.floor(WINDOW_FACTOR * cap));
    expect(st.overwritten).toEqual([0, 0, 0]);
    expect(st.relocated).toBeGreaterThan(0);
    expect(st.dropped).toEqual([0, 0, 0]);
    // 20 s × 60 × 50 spawns would have grown an unbounded window to ≈ 60 000 records.
    expect(st.requested[1]).toBe(1200 * 50);
    // The long-lived particle is still in the window, byte-identical (same t0, seed, layer) and
    // the GPU copy of every window slot matches the CPU mirror.
    const { tail, head } = env.ps.windowRange;
    let found = 0;
    for (let c = tail; c < head; c++) {
      const slot = c % capacity;
      expect(shadow.subarray(slot * S, slot * S + S)).toEqual(env.ps.records.u8.subarray(slot * S, slot * S + S));
      if (layerOf(env, slot) === longLayer) {
        found++;
        expect(readRecord(env.ps.records, slot)).toEqual(orig);
        expect(env.ps.expiryOf(slot)).toBe(30);
      }
    }
    expect(found).toBe(1);
  });

  it('draws exactly the bounded window', () => {
    const env = setup({ capacity: 65536, cap: 500 });
    env.ps.spawn(FX.long0, ORIGIN);
    frame(env, 0);
    for (let f = 1; f <= 300; f++) {
      env.ps.spawn(FX.short1, ORIGIN);
      env.gl.resetCalls();
      frame(env, f / 60);
      expect(draws(env.gl).reduce((a, b) => a + b, 0)).toBe(env.ps.stats.window);
    }
    expect(env.ps.stats.window).toBeLessThanOrEqual(Math.max(MIN_WINDOW, Math.floor(WINDOW_FACTOR * 500)));
  });

  it('full ring: new priority-0 particles take priority-1 slots, never live priority-0 ones', () => {
    const capacity = 256;
    const env = setup({ capacity, cap: capacity });
    const shadow = new Uint8Array(capacity * S);
    env.gl.resetCalls();
    env.ps.spawn(FX.long0, ORIGIN, { seed: 1 }); // position 0: priority 0
    env.ps.spawn(FX.long1, ORIGIN, { seed: 2 }); // 1..100: priority 1
    env.ps.spawn(FX.long1, ORIGIN, { seed: 3 }); // 101..200
    frame(env, 0);
    applyRingWrites(env, shadow);
    // Fill the rest with priority 1 up to cap (255 alive), then overflow with priority 0 only.
    expect(env.ps.spawn(FX.long1, ORIGIN, { seed: 4 })).toBe(55);
    frame(env, 0.1);
    applyRingWrites(env, shadow);
    expect(env.ps.stats.alive).toBe(256);
    const p0Layer = env.lib.effects[FX.long0]!.firstLayer;
    let k = 0;
    for (let f = 0; f < 150; f++) {
      env.ps.spawn(FX.long0, ORIGIN, { seed: 100 + f });
      k++;
      frame(env, 0.2 + f / 60);
      applyRingWrites(env, shadow);
      expect(env.ps.stats.overwritten).toEqual([0, k, 0]);
    }
    const { tail, head } = env.ps.windowRange;
    expect(head - tail).toBe(capacity);
    let p0 = 0;
    for (let c = tail; c < head; c++) {
      const slot = c % capacity;
      if (layerOf(env, slot) === p0Layer) p0++;
      expect(shadow.subarray(slot * S, slot * S + S)).toEqual(env.ps.records.u8.subarray(slot * S, slot * S + S));
    }
    expect(p0).toBe(1 + k);
    expect(env.ps.stats.alive).toBe(256);
    // Once only priority 0 is left, the oldest priority-0 particle goes.
    for (let f = 0; f < 120; f++) {
      env.ps.spawn(FX.long0, ORIGIN, { seed: 1000 + f });
      frame(env, 3 + f / 60);
    }
    expect(env.ps.stats.overwritten[1]).toBe(255);
    expect(env.ps.stats.overwritten[0]).toBe(1 + k + 120 - 256);
  });
});

describe('ParticleSystem – caps and priorities', () => {
  it('drops priority 2 first (at 0.75·cap), then priority 1 (at cap), never priority 0', () => {
    const cap = 1000;
    const env = setup({ capacity: 4096, cap });
    frame(env, 0);
    // Fill with priority 1 up to 0.75·cap.
    for (let i = 0; i < 7; i++) env.ps.spawn(FX.p1, ORIGIN);
    env.ps.spawn(FX.p1, ORIGIN, { seed: 5 }); // 800
    expect(env.ps.stats.alive).toBe(800);
    // Priority 2 is rejected above 750.
    expect(env.ps.spawn(FX.p2, ORIGIN)).toBe(0);
    expect(env.ps.stats.dropped).toEqual([0, 0, 100]);
    // Priority 1 fills up to cap exactly.
    expect(env.ps.spawn(FX.p1, ORIGIN)).toBe(100);
    expect(env.ps.spawn(FX.p1, ORIGIN)).toBe(100);
    expect(env.ps.spawn(FX.p1, ORIGIN)).toBe(0);
    expect(env.ps.stats.alive).toBe(cap);
    expect(env.ps.stats.dropped).toEqual([0, 100, 100]);
    // Priority 0 always spawns (documented overshoot above cap).
    expect(env.ps.spawn(FX.p0, ORIGIN)).toBe(100);
    expect(env.ps.stats.alive).toBe(cap + 100);
    expect(env.ps.stats.dropped[0]).toBe(0);
    expect(env.ps.stats.requested).toEqual([100, 1100, 100]);
  });

  it('overload: prio 2 dropped first, prio 0 never, alive ≤ cap + prio-0 excess', () => {
    const cap = 2000;
    const env = setup({ capacity: 4096, cap });
    let t = 0;
    const prio0PerFrame = 4 * 10; // 4 bursts × 10 priority-0 particles
    for (let f = 0; f < 300; f++) {
      for (let i = 0; i < 4; i++) env.ps.spawn(FX.mixed, ORIGIN);
      frame(env, t);
      const s = env.ps.stats;
      expect(s.dropped[0]).toBe(0);
      // Priority-0 excess is bounded by one second of priority-0 spawns (lifetime 1 s).
      expect(s.alive).toBeLessThanOrEqual(cap + prio0PerFrame * 61);
      t += 1 / 60;
    }
    const s = env.ps.stats;
    expect(s.dropped[2]).toBeGreaterThan(s.dropped[1]);
    expect(s.dropped[1]).toBeGreaterThan(0);
    expect(s.requested[0]).toBe(300 * 4 * 10);
    // Priority 2 is only admitted below 0.75·cap.
    expect(s.dropped[2]).toBeGreaterThan(s.requested[2] * 0.5);
    expect(PRIO2_CAP_FRACTION).toBe(0.75);
  });

  it('setCap validates and applies immediately', () => {
    const env = setup({ capacity: 4096, cap: 4096 });
    env.ps.setCap(50);
    expect(env.ps.spawn(FX.p1, ORIGIN)).toBe(50);
    expect(() => env.ps.setCap(5000)).toThrow(RangeError);
    expect(() => env.ps.setCap(-1)).toThrow(RangeError);
  });
});

describe('ParticleSystem – visibility culling (priority 2)', () => {
  it('culls priority-2 bursts outside the frustum, keeps priority 1', () => {
    const env = setup();
    frame(env, 0);
    // Far behind the camera (camera at +z side looking towards -z? use a point far away on all axes).
    const behind = [5000 * RAW, 0, 5000 * RAW];
    expect(env.ps.spawn(FX.p2, behind)).toBe(0);
    expect(env.ps.stats.culled).toBe(100);
    expect(env.ps.stats.requested[2]).toBe(100);
    expect(env.ps.stats.dropped[2]).toBe(0);
    expect(env.ps.spawn(FX.p1, behind)).toBe(100);
    // In view: nothing culled.
    expect(env.ps.spawn(FX.p2, ORIGIN)).toBe(100);
    expect(env.ps.stats.culled).toBe(100);
  });

  it('thins priority-2 bursts that are tiny on screen', () => {
    const env = setup();
    env.camera.distance = 1400;
    env.camera.update();
    frame(env, 0);
    // boundsWu 4 at ~1400 WU: radius ≈ 4·724/1400 ≈ 2 px → thinned, not culled.
    const n = env.ps.spawn(FX.p2, ORIGIN);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(100);
    expect(env.ps.stats.culled).toBe(100 - n);
  });
});

describe('ParticleSystem – emitters', () => {
  it('rate 100 over 1 s → 100 ± 1 particles with evenly spread t0', () => {
    const env = setup();
    frame(env, 2);
    const h = env.ps.createEmitter(FX.emit, ORIGIN);
    let t = 2;
    let total = 0;
    for (let f = 0; f < 60; f++) {
      t += 1 / 60;
      env.ps.update(t, env.camera);
      total += env.ps.stats.spawnedFrame;
      const enc = env.dev.beginPass({});
      env.ps.encode(enc);
      enc.end();
    }
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(1);
    // t0 values are strictly increasing, ~10 ms apart (no pulsing per frame).
    const t0s: number[] = [];
    for (let i = 0; i < total; i++) t0s.push(readRecord(env.ps.records, i).t0);
    for (let i = 1; i < t0s.length; i++) {
      const d = t0s[i]! - t0s[i - 1]!;
      expect(d).toBeGreaterThan(0.0099);
      expect(d).toBeLessThan(0.0101);
    }
    expect(env.ps.stats.emitters).toBe(1);
    env.ps.setEmitterRate(h, 0);
    const before = env.ps.stats.alive;
    frame(env, t + 0.5);
    expect(env.ps.stats.spawnedFrame).toBe(0);
    expect(env.ps.stats.alive).toBeLessThanOrEqual(before);
    env.ps.setEmitterRate(h, 2);
    frame(env, t + 0.75);
    expect(env.ps.stats.spawnedFrame).toBe(50); // 0.25 s × 200/s
    // Stalls are clamped to MAX_EMIT_DT_S (0.25 s): no burst of a whole second.
    frame(env, t + 1.75);
    expect(env.ps.stats.spawnedFrame).toBe(50);
    env.ps.destroyEmitter(h);
    expect(env.ps.hasEmitter(h)).toBe(false);
    expect(env.ps.stats.emitters).toBe(0);
    frame(env, t + 2);
    expect(env.ps.stats.spawnedFrame).toBe(0);
  });

  it('moves emitters and follows their stream target', () => {
    const env = setup();
    frame(env, 0);
    const h = env.ps.createEmitter(FX.stream, [0, 0, 0], { targetRaw: [10 * RAW, 0, 0] });
    frame(env, 0.1);
    env.ps.moveEmitter(h, [RAW, 2 * RAW, 3 * RAW], [RAW, 2 * RAW, 13 * RAW]);
    const head = env.ps.windowRange.head;
    frame(env, 0.2);
    const r = readRecord(env.ps.records, head);
    expect(r.originRaw).toEqual([RAW, 2 * RAW, 3 * RAW]);
    expect(r.vec.slice(0, 3)).toEqual([0, 0, 10]);
    // Moving without a target keeps the absolute target (1, 2, 13): the delta follows the origin.
    env.ps.moveEmitter(h, [5 * RAW, 2 * RAW, 3 * RAW]);
    const head2 = env.ps.windowRange.head;
    frame(env, 0.3);
    expect(readRecord(env.ps.records, head2).vec.slice(0, 3)).toEqual([-4, 0, 10]);
  });

  it('handles, freelist, stale handles and the 1024 limit', () => {
    const env = setup();
    const handles: number[] = [];
    for (let i = 0; i < MAX_PARTICLE_EMITTERS; i++) handles.push(env.ps.createEmitter(FX.emit, ORIGIN));
    expect(new Set(handles).size).toBe(MAX_PARTICLE_EMITTERS);
    expect(env.ps.createEmitter(FX.emit, ORIGIN)).toBe(-1);
    env.ps.destroyEmitter(handles[5]!);
    const h2 = env.ps.createEmitter(FX.emit, ORIGIN);
    expect(h2).not.toBe(-1);
    expect(h2).not.toBe(handles[5]);
    expect(env.ps.hasEmitter(handles[5]!)).toBe(false);
    env.ps.destroyEmitter(handles[5]!); // stale: ignored
    expect(env.ps.hasEmitter(h2)).toBe(true);
    expect(() => env.ps.createEmitter(FX.p1, ORIGIN)).toThrow(/not continuous/);
    env.ps.clear();
    expect(env.ps.stats.emitters).toBe(0);
    expect(env.ps.hasEmitter(h2)).toBe(false);
  });
});

describe('ParticleSystem – frame protocol, shake, restore', () => {
  it('spawn() before update() gets this frame time; after update() it is uploaded in encode()', () => {
    const env = setup();
    frame(env, 5);
    env.gl.resetCalls();
    env.ps.spawn(FX.p1, ORIGIN); // pending
    env.ps.update(5.5, env.camera);
    expect(ringWrites(env.gl)).toEqual([[0, 100 * S]]);
    expect(readRecord(env.ps.records, 0).t0).toBe(Math.fround(5.5));
    env.gl.resetCalls();
    env.ps.spawn(FX.p1, ORIGIN); // between update and encode
    expect(readRecord(env.ps.records, 100).t0).toBe(Math.fround(5.5));
    const enc = env.dev.beginPass({});
    expect(env.ps.encode(enc)).toBe(1);
    enc.end();
    expect(ringWrites(env.gl)).toEqual([[100 * S, 100 * S]]);
    expect(draws(env.gl)).toEqual([200]);
    expect(env.ps.stats.spawnedFrame).toBe(200);
  });

  it('calls onShake for effects with a shake definition', () => {
    const calls: [string, number[], number][] = [];
    const env = setup({ onShake: (e, p, t) => calls.push([e.id, [...p], t]) });
    frame(env, 7);
    env.ps.spawn(FX.shake, [RAW, 2 * RAW, 3 * RAW]);
    env.ps.spawn(FX.p1, ORIGIN);
    expect(calls).toEqual([['test:shake', [RAW, 2 * RAW, 3 * RAW], 7]]);
  });

  it('a clock running backwards clears the ring', () => {
    const env = setup();
    frame(env, 10);
    env.ps.spawn(FX.p1, ORIGIN);
    frame(env, 10.1);
    expect(env.ps.stats.alive).toBe(100);
    frame(env, 1);
    expect(env.ps.stats.alive).toBe(0);
    expect(frame(env, 1.1)).toBe(0);
    // Counting restarts at the new clock: a fresh burst is alive, then expires after its 1 s life.
    env.ps.spawn(FX.p1, ORIGIN);
    frame(env, 1.2);
    expect(env.ps.stats.alive).toBe(100);
    frame(env, 2.3);
    expect(env.ps.stats.alive).toBe(0);
  });

  it('restore re-uploads the whole ring mirror, the LUT and the layer table', () => {
    const env = setup({ capacity: 512, cap: 512, loseContext: true });
    env.ps.spawn(FX.p1, ORIGIN);
    frame(env, 1);
    env.gl.lose();
    env.ps.spawn(FX.p1, ORIGIN); // written to the mirror while lost
    frame(env, 1.1);
    env.gl.resetCalls();
    env.gl.restore();
    const writes = ringWrites(env.gl);
    expect(writes).toContainEqual([0, 512 * S]);
    const texUploads = env.gl.named('texSubImage2D');
    const sizes = texUploads.map((c) => [c.args[4], c.args[5]]);
    expect(sizes).toContainEqual([env.lib.lut.width, env.lib.lut.height]);
    expect(sizes).toContainEqual([8, env.lib.layerCount]);
    // The restored buffer holds both bursts.
    const buf = env.gl.state.lastBufferWrite!;
    const data = env.gl.state.bufferData.get(buf) as Uint8Array;
    expect(data.length).toBe(512 * S);
    expect([...data.subarray(0, 200 * S)]).toEqual([...env.ps.records.u8.subarray(0, 200 * S)]);
    env.gl.resetCalls();
    expect(frame(env, 1.2)).toBe(1);
    expect(draws(env.gl)).toEqual([200]);
  });

  it('destroy releases GPU resources and rejects further frames', () => {
    const env = setup();
    env.ps.destroy();
    env.ps.destroy();
    expect(() => env.ps.update(0, env.camera)).toThrow();
    expect(() => new ParticleSystem(env.dev, { frame: 0 as never, fxView: 0 as never }, env.lib, { cap: 70000 })).toThrow(RangeError);
  });
});
