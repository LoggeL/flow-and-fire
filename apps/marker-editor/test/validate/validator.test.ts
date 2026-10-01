import { describe, expect, it } from 'vitest';
import { createValidator, fieldExpansionStats } from '../../src/validate/index.ts';
import { circleField, loadMap, testMap, withCode, withMarkers, wu } from './helpers.ts';

describe('createValidator', () => {
  it('builds the terrain analysis once per heightfield', () => {
    const validate = createValidator();
    expect(validate.analysis()).toBeNull();
    const map = loadMap('tessera');
    const first = validate(map);
    expect(validate.analysisBuilds()).toBe(1);
    const analysis = validate.analysis();
    // Marker edits (new meta, same heights object) reuse the analysis.
    for (let i = 0; i < 5; i++) {
      const spots = map.meta.spots.map((s, k) => (k === 0 ? { ...s, x: s.x + wu(i) } : s));
      validate(withMarkers(map, { spots }));
    }
    expect(validate.analysisBuilds()).toBe(1);
    expect(validate.analysis()).toBe(analysis);
    expect(JSON.stringify(validate(map))).toBe(JSON.stringify(first));
    expect(validate.analysisBuilds()).toBe(1);
  });

  it('rebuilds on a new heights object, water level, height scale or size', () => {
    const validate = createValidator();
    const map = testMap();
    validate(map);
    validate({ ...map, heights: map.heights.slice() });
    expect(validate.analysisBuilds()).toBe(2);
    const current = validate.analysis()!;
    validate({ ...map, heights: current.heights, meta: { ...map.meta, waterLevelRaw: wu(10) } });
    expect(validate.analysisBuilds()).toBe(3);
    validate({ ...map, heights: current.heights, meta: { ...map.meta, waterLevelRaw: wu(10), heightScaleRaw: 16 } });
    expect(validate.analysisBuilds()).toBe(4);
    const small = testMap({ sizeWu: 128, starts: [{ army: 0, x: wu(32), z: wu(32) }, { army: 1, x: wu(96), z: wu(96) }] });
    validate(small);
    expect(validate.analysisBuilds()).toBe(5);
    expect(validate.analysis()!.sizeWu).toBe(128);
  });

  it('passes options through (rule thresholds and passability slope)', () => {
    const map = withMarkers(testMap(), { spots: [{ kind: 'mass', x: wu(100), z: wu(100) }, { kind: 'mass', x: wu(106), z: wu(100) }] });
    expect(withCode(createValidator()(map), 'spot-close')).toEqual([]);
    expect(withCode(createValidator({ spotCloseRaw: wu(8) })(map), 'spot-close')).toHaveLength(1);
    const v = createValidator({ maxSlopePermille: 300 });
    v(map);
    expect(v.analysis()!.maxSlopePermille).toBe(300);
  });

  it('expands every prop field once per field object and terrain', () => {
    const validate = createValidator();
    const base = testMap();
    const f0 = circleField(100, 100, 10);
    const f1 = circleField(150, 150, 10, { seed: 9 });
    const before = fieldExpansionStats.expansions;
    validate(withMarkers(base, { propFields: [f0, f1] }));
    expect(fieldExpansionStats.expansions - before).toBe(2);
    // Moving a spot or reordering fields: no new expansion.
    validate(withMarkers(base, { propFields: [f1, f0], spots: [{ kind: 'mass', x: wu(20), z: wu(20) }] }));
    expect(fieldExpansionStats.expansions - before).toBe(2);
    // A changed field is a new object: exactly one expansion.
    validate(withMarkers(base, { propFields: [f0, { ...f1, seed: 10 }] }));
    expect(fieldExpansionStats.expansions - before).toBe(3);
    // Another terrain: expanded again.
    validate({ ...withMarkers(base, { propFields: [f0] }), heights: base.heights.slice() });
    expect(fieldExpansionStats.expansions - before).toBe(4);
  });

  it('returns identical lists for identical input (determinism)', () => {
    const setons = loadMap('setons');
    const a = createValidator()(setons);
    const b = createValidator()(setons);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
