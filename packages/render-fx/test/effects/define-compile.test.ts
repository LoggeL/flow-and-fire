import { describe, expect, it } from 'vitest';
import {
  L_COS_SPREAD,
  L_COS_SPREAD_INNER,
  L_COUNT_MAX,
  L_COUNT_MIN,
  L_DRAG,
  L_EFFECT,
  L_GRAVITY,
  L_LIFE_MAX,
  L_LIFE_MIN,
  L_LUT_ROW,
  L_MOTION,
  L_ORIENT,
  L_PRIORITY,
  L_RATE,
  L_SHAPE,
  L_SIZE_MAX,
  L_STRETCH,
  L_TINT,
  LAYER_STRIDE,
  MAX_LIBRARY_LAYERS,
  MOTION_ID,
  ORIENT_ID,
  SHAPE_ID,
  compileEffectLibrary,
} from '../../src/effects/compile.ts';
import { LUT_WIDTH } from '../../src/effects/curves.ts';
import type { EffectDef, EffectLayerDef } from '../../src/effects/define.ts';
import { defineEffect, effectBudget } from '../../src/effects/define.ts';

const baseLayer: EffectLayerDef = {
  name: 'core',
  shape: 'glow',
  orient: 'billboard',
  motion: 'ballistic',
  count: [4, 6],
  lifetime: [0.5, 1],
  speed: [1, 2],
  spread: 45,
  gravity: -2,
  drag: 1.5,
  size: [
    [0, 1],
    [1, 3],
  ],
  color: [
    [0, 4, 3, 2, 1],
    [1, 1, 0.5, 0.2, 0],
  ],
  blend: 0.25,
  priority: 1,
};

function effect(layer: Partial<EffectLayerDef>, extra: Partial<EffectDef> = {}): EffectDef {
  return { id: 'test:fx', boundsWu: 5, layers: [{ ...baseLayer, ...layer } as EffectLayerDef], ...extra };
}

describe('defineEffect validation', () => {
  it('accepts a valid effect and returns it unchanged', () => {
    const d = effect({});
    expect(defineEffect(d)).toBe(d);
  });

  const bad: [string, EffectDef, RegExp][] = [
    ['bad id', { ...effect({}), id: 'NoNamespace' as `${string}:${string}` }, /id must look like/],
    ['no layers', { id: 'test:x', boundsWu: 1, layers: [] }, /at least one layer/],
    ['too many layers', { id: 'test:x', boundsWu: 1, layers: Array.from({ length: 9 }, (_, i) => ({ ...baseLayer, name: `l${i}` })) }, /9 layers > 8/],
    ['bounds', effect({}, { boundsWu: 0 }), /boundsWu/],
    ['lifetime zero', effect({ lifetime: [0, 1] }), /lifetime min 0 must be > 0/],
    ['lifetime too long', effect({ lifetime: [1, 31] }), /lifetime max 31 > 30/],
    ['lifetime reversed', effect({ lifetime: [2, 1] }), /lifetime min 2 > max 1/],
    ['priority', effect({ priority: 3 as 0 }), /priority 3 must be 0, 1 or 2/],
    ['curve order', effect({ size: [[0.5, 1], [0.2, 2]] }), /size: key 1: t=0.2 not strictly ascending/],
    ['color range', effect({ color: [[0, 20, 1, 1, 1]] }), /color: key 0: color component 20/],
    ['blend range', effect({ blend: 2 }), /blend: value 2 outside/],
    ['count too big', effect({ count: 5000 }), /count 5000 must be an integer/],
    ['count fraction', effect({ count: 1.5 }), /count 1.5 must be an integer/],
    ['spread', effect({ spread: 190 }), /spread 190/],
    ['spreadInner', effect({ spread: 30, spreadInner: 40 }), /spreadInner 40/],
    ['shape', effect({ shape: 'blob' as 'glow' }), /unknown shape 'blob'/],
    ['rate needs continuous', effect({ rate: 10 }), /rate requires a continuous effect/],
    ['emits nothing', effect({ count: 0 }), /emits nothing/],
    ['continuous without rate', effect({}, { continuous: true }), /continuous effect needs at least one layer with rate/],
    ['stream wave on ballistic', effect({ streamWave: 1 }), /need motion 'stream'/],
    ['delay too long', effect({ delay: [0, 11] }), /delay max 11 > 10/],
    ['shake', effect({}, { shake: { amplitudeWu: 1, durationS: 0, radiusWu: 10, frequencyHz: 5 } }), /shake.durationS 0/],
  ];
  for (const [name, def, re] of bad) {
    it(`rejects: ${name}`, () => {
      expect(() => defineEffect(def)).toThrow(re);
    });
  }

  it('rejects duplicate layer names', () => {
    expect(() => defineEffect({ id: 'test:x', boundsWu: 1, layers: [baseLayer, baseLayer] })).toThrow(/duplicate layer name/);
  });

  it('computes budgets from bursts and steady-state rates', () => {
    const d: EffectDef = {
      id: 'test:b',
      boundsWu: 1,
      continuous: true,
      layers: [
        { ...baseLayer, name: 'a', count: [3, 7] },
        { ...baseLayer, name: 'b', count: 0, rate: 10, lifetime: [1, 2.5] },
      ],
    };
    expect(effectBudget(d)).toEqual({ burst: 7, steady: 25, total: 32 });
  });
});

describe('compileEffectLibrary', () => {
  const a: EffectDef = {
    id: 'test:a',
    boundsWu: 3,
    shake: { amplitudeWu: 1, durationS: 1, radiusWu: 50, frequencyHz: 8 },
    layers: [
      { ...baseLayer, name: 'x', priority: 0 },
      {
        ...baseLayer,
        name: 'y',
        shape: 'spark',
        orient: 'velocity',
        stretch: 2.5,
        spread: 90,
        spreadInner: 60,
        tint: 'spawn',
        priority: 2,
        count: 9,
      },
    ],
  };
  const b: EffectDef = {
    id: 'test:b',
    boundsWu: 8,
    continuous: true,
    layers: [{ ...baseLayer, name: 's', motion: 'stream', shape: 'stream', count: 0, rate: 30, streamWave: 0.5, streamWaves: 2 }],
  };
  const lib = compileEffectLibrary([a, b]);

  it('lays out effects, layer ranges and the index', () => {
    expect(lib.layerCount).toBe(3);
    expect(lib.layers.length).toBe(3 * LAYER_STRIDE);
    expect(lib.effects.map((e) => [e.id, e.firstLayer, e.layerCount])).toEqual([
      ['test:a', 0, 2],
      ['test:b', 2, 1],
    ]);
    expect(lib.index).toEqual({ 'test:a': 0, 'test:b': 1 });
    expect(lib.indexOf('test:b')).toBe(1);
    expect(lib.get('test:a').shake?.radiusWu).toBe(50);
    expect(() => lib.indexOf('test:c')).toThrow(/unknown effect 'test:c'/);
    expect(lib.effects[0]!.minPriority).toBe(0);
    expect(lib.effects[0]!.maxBurst).toBe(6 + 9);
    expect(lib.effects[1]!.continuous).toBe(true);
    expect(lib.maxBurst).toBe(15);
    expect(lib.layerInfo[2]).toMatchObject({ index: 2, effect: 1, name: 's', rate: 30, motion: 'stream', countMax: 0 });
  });

  it('writes the documented fields per layer', () => {
    const L = lib.layers;
    const o1 = 1 * LAYER_STRIDE;
    expect(L[L_LIFE_MIN]).toBeCloseTo(0.5, 6);
    expect(L[L_LIFE_MAX]).toBe(1);
    expect(L[L_GRAVITY]).toBe(-2);
    expect(L[L_DRAG]).toBe(1.5);
    expect(L[L_COS_SPREAD]).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    expect(L[L_COS_SPREAD_INNER]).toBe(1);
    expect(L[L_COUNT_MIN]).toBe(4);
    expect(L[L_COUNT_MAX]).toBe(6);
    expect(L[L_SIZE_MAX]).toBe(3);
    expect(L[L_PRIORITY]).toBe(0);
    expect(L[o1 + L_SHAPE]).toBe(SHAPE_ID.spark);
    expect(L[o1 + L_ORIENT]).toBe(ORIENT_ID.velocity);
    expect(L[o1 + L_STRETCH]).toBe(2.5);
    expect(L[o1 + L_TINT]).toBe(1);
    expect(L[o1 + L_PRIORITY]).toBe(2);
    expect(L[o1 + L_COS_SPREAD]).toBeCloseTo(0, 6);
    expect(L[o1 + L_COS_SPREAD_INNER]).toBeCloseTo(0.5, 6);
    expect(L[o1 + L_LUT_ROW]).toBe(2);
    expect(L[o1 + L_EFFECT]).toBe(0);
    const o2 = 2 * LAYER_STRIDE;
    expect(L[o2 + L_MOTION]).toBe(MOTION_ID.stream);
    expect(L[o2 + L_RATE]).toBe(30);
    expect(L[o2 + L_EFFECT]).toBe(1);
    expect(L[o2 + L_LUT_ROW]).toBe(4);
  });

  it('bakes the LUT rows: color row 2i, size/blend/stretch row 2i+1', () => {
    const { width, height, data } = lib.lut;
    expect(width).toBe(LUT_WIDTH);
    expect(height).toBe(6);
    expect(data.length).toBe(width * height * 4);
    const row = (r: number, x: number): number[] => Array.from(data.subarray((r * width + x) * 4, (r * width + x) * 4 + 4));
    expect(row(0, 0)).toEqual([4, 3, 2, 1]);
    expect(row(0, width - 1)).toEqual([1, 0.5, Math.fround(0.2), 0]);
    expect(row(1, 0)).toEqual([1, 0.25, 0, 0]);
    expect(row(1, width - 1)).toEqual([3, 0.25, 0, 0]);
    expect(row(3, 10)[2]).toBe(2.5);
  });

  it('hash is stable and content sensitive', () => {
    expect(compileEffectLibrary([a, b]).hash).toBe(lib.hash);
    const b2: EffectDef = { ...b, layers: [{ ...b.layers[0]!, gravity: -2.5 }] };
    expect(compileEffectLibrary([a, b2]).hash).not.toBe(lib.hash);
  });

  it('rejects duplicates and oversized libraries', () => {
    expect(() => compileEffectLibrary([a, a])).toThrow(/duplicate effect id 'test:a'/);
    const many: EffectDef[] = [];
    for (let i = 0; i < 33; i++) {
      many.push({ id: `test:e${i}`, boundsWu: 1, layers: Array.from({ length: 8 }, (_, j) => ({ ...baseLayer, name: `l${j}` })) });
    }
    expect(() => compileEffectLibrary(many)).toThrow(new RegExp(`264 layers > ${MAX_LIBRARY_LAYERS}`));
  });
});
