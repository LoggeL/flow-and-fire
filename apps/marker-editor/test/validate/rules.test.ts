import { createRtsMap, MAP_MAX_PROPS, type MapProp, type MapSpot, type MapStart, type RtsMap } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import {
  createTerrainAnalysis,
  DEFAULT_VALIDATION_OPTIONS,
  detectSymmetry,
  ISSUE_CODES,
  mirrorPoint,
  validateMap,
  type EditorIssue,
  type ValidationOptions,
} from '../../src/validate/index.ts';
import { circleField, errors, GROUND, STEPS_PER_WU, testMap, withCode, withMarkers, wu } from './helpers.ts';

const run = (map: RtsMap, options?: Partial<ValidationOptions>): EditorIssue[] => validateMap(map, createTerrainAnalysis(map), options);
const start = (army: number, xWu: number, zWu: number): MapStart => ({ army, x: wu(xWu), z: wu(zWu) });
const mass = (xWu: number, zWu: number): MapSpot => ({ kind: 'mass', x: wu(xWu), z: wu(zWu) });
const hydro = (xWu: number, zWu: number): MapSpot => ({ kind: 'hydro', x: wu(xWu), z: wu(zWu) });
const refsOf = (i: EditorIssue): string[] => i.refs.map((r) => `${r.type}${r.index}`);

/** A clean, point-symmetric layout on the flat test map. */
const CLEAN_SPOTS = [mass(80, 64), mass(176, 192), hydro(64, 90), hydro(192, 166)];
const clean = withMarkers(testMap(), { spots: CLEAN_SPOTS });

describe('validateMap: clean map', () => {
  it('has no errors or warnings, only the symmetry info', () => {
    const issues = run(clean);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'info', code: 'asymmetric', x: null, z: null, refs: [] });
    expect(issues[0]!.message).toContain('punktsymmetrisch');
  });

  it('rejects an analysis of another heightfield', () => {
    const other = testMap();
    expect(() => validateMap(clean, createTerrainAnalysis(other))).toThrow(/different heightfield/);
  });
});

describe('start-count', () => {
  it('error below 2 starts', () => {
    const one = testMap({ starts: [start(0, 64, 64)] });
    const e = withCode(run(one), 'start-count');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ severity: 'error', refs: [{ type: 'start', index: 0 }] });
    const none = withMarkers(testMap(), { starts: [] });
    expect(withCode(run(none), 'start-count').map((i) => i.severity)).toEqual(['error']);
  });

  it('warning for a gap in the army numbers, none for 0..n-1', () => {
    const gap = testMap({ starts: [start(0, 64, 64), start(2, 192, 192)] });
    const w = withCode(run(gap), 'start-count');
    expect(w.map((i) => i.severity)).toEqual(['warning']);
    expect(w[0]!.message).toContain('0, 2');
    expect(withCode(run(clean), 'start-count')).toEqual([]);
  });
});

describe('start-edge / spot-edge', () => {
  it('start closer than 16 WU to any edge is an error', () => {
    const bad = withMarkers(clean, { starts: [start(0, 15, 128), start(1, 128, 241)] });
    const e = withCode(run(bad), 'start-edge');
    expect(e.map(refsOf)).toEqual([['start0'], ['start1']]);
    expect(e[0]).toMatchObject({ severity: 'error', x: wu(15), z: wu(128) });
    const ok = withMarkers(clean, { starts: [start(0, 16, 128), start(1, 128, 240)] });
    expect(withCode(run(ok), 'start-edge')).toEqual([]);
  });

  it('spot closer than 12 WU to any edge is an error (DECISIONS 29)', () => {
    const bad = withMarkers(clean, { spots: [mass(11, 100), hydro(100, 245), mass(12, 150), mass(244, 30)] });
    const e = withCode(run(bad), 'spot-edge');
    expect(e.map(refsOf)).toEqual([['spot0'], ['spot1']]);
    expect(e.every((i) => i.severity === 'error')).toBe(true);
    expect(e[1]!.message).toContain('Hydro-Spot 2');
  });
});

describe('start-in-water / spot-in-water', () => {
  // Lake: 25 WU deep floor (5 WU under the 30-WU water) in a circle r = 15 around (128, 40).
  const lake = testMap({ heights: (x, z) => ((x - 128) ** 2 + (z - 40) ** 2 <= 225 ? 25 * STEPS_PER_WU : GROUND) });

  it('spot and start in the lake are errors', () => {
    const map = withMarkers(lake, { starts: [start(0, 128, 40), start(1, 192, 192)], spots: [mass(130, 42), hydro(80, 80)] });
    const issues = run(map);
    const s = withCode(issues, 'start-in-water');
    expect(s.map(refsOf)).toEqual([['start0']]);
    expect(s[0]!.message).toContain('Tiefe 5,0 WU');
    expect(withCode(issues, 'spot-in-water').map(refsOf)).toEqual([['spot0']]);
  });

  it('exactly at the water level counts as water; one step above is dry', () => {
    const shore = testMap({ heights: (x) => (x < 100 ? 30 * STEPS_PER_WU : 30 * STEPS_PER_WU + 1) });
    const map = withMarkers(shore, { spots: [mass(50, 50), mass(150, 50)] });
    expect(withCode(run(map), 'spot-in-water').map(refsOf)).toEqual([['spot0']]);
  });

  it('a map without water never reports water, even at height 0', () => {
    const dry = createRtsMap({ sizeWu: 256, spots: [mass(100, 100)] });
    const issues = run(dry);
    expect(withCode(issues, 'spot-in-water')).toEqual([]);
    expect(withCode(issues, 'start-in-water')).toEqual([]);
  });
});

describe('spot-not-flat', () => {
  // Ramp 100 < x < 156 with slope k steps per WU, flat elsewhere.
  const ramp = (k: number): RtsMap => testMap({ heights: (x) => GROUND + Math.min(56, Math.max(0, x - 100)) * k });

  it('error on a 0.5 slope (0.75 WU within 1.5 WU)', () => {
    const map = withMarkers(ramp(64), { spots: [mass(128, 128), mass(50, 128)] });
    const e = withCode(run(map), 'spot-not-flat');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ severity: 'error', x: wu(128), z: wu(128), refs: [{ type: 'spot', index: 0 }] });
    expect(e[0]!.message).toContain('0,8 WU'); // 0.75 rounded to one decimal
  });

  it('warning on a gentle 1/16 slope (0.19 WU within 3 WU), nothing on flat ground', () => {
    const map = withMarkers(ramp(8), { spots: [mass(128, 128), mass(50, 128)] });
    const e = withCode(run(map), 'spot-not-flat');
    expect(e.map((i) => [i.severity, ...refsOf(i)])).toEqual([['warning', 'spot0']]);
    expect(e[0]!.message).toContain('0,19 WU');
  });

  it('a spot next to a ramp foot only sees the ramp inside its radius', () => {
    // 2 WU before the foot: the 3-WU disc reaches 1 WU up the 0.5 slope (0.5 WU) → warning only.
    const map = withMarkers(ramp(64), { spots: [mass(98, 128)] });
    expect(withCode(run(map), 'spot-not-flat').map((i) => i.severity)).toEqual(['warning']);
  });
});

describe('start-not-flat', () => {
  it('warning when the build platform is mostly impassable', () => {
    // Cone of slope 1.0 and radius 8 WU on start 0.
    const cone = testMap({
      heights: (x, z) => GROUND + Math.max(0, Math.round((8 - Math.hypot(x - 64, z - 64)) * STEPS_PER_WU)),
    });
    const w = withCode(run(withMarkers(cone, { spots: CLEAN_SPOTS })), 'start-not-flat');
    expect(w.map((i) => [i.severity, ...refsOf(i)])).toEqual([['warning', 'start0']]);
    expect(w[0]!.message).toMatch(/nur zu \d+ %/);
  });

  it('a cliff edge through a small part of the platform is fine', () => {
    const edge = testMap({ heights: (x) => (x < 59 ? GROUND - 5 * STEPS_PER_WU : GROUND) });
    expect(withCode(run(withMarkers(edge, { spots: CLEAN_SPOTS })), 'start-not-flat')).toEqual([]);
  });
});

describe('spot distances', () => {
  it('spot-overlap (< 2 WU) error, spot-close (< 4 WU) warning, 5 WU nothing', () => {
    const map = withMarkers(clean, { spots: [mass(100, 100), hydro(101, 100), mass(100, 140), mass(103, 140), mass(100, 170), mass(105, 170)] });
    const issues = run(map);
    expect(withCode(issues, 'spot-overlap').map((i) => [i.severity, ...refsOf(i)])).toEqual([['error', 'spot0', 'spot1']]);
    expect(withCode(issues, 'spot-close').map((i) => [i.severity, ...refsOf(i)])).toEqual([['warning', 'spot2', 'spot3']]);
    expect(withCode(issues, 'spot-overlap')[0]!.message).toContain('1,0 WU');
  });

  it('spot-on-start (< 4 WU) error, 5 WU nothing', () => {
    const map = withMarkers(clean, { spots: [mass(67, 64), mass(197, 192)] });
    const e = withCode(run(map), 'spot-on-start');
    expect(e.map((i) => [i.severity, ...refsOf(i)])).toEqual([['error', 'spot0', 'start0']]);
  });

  it('start-close: < 48 WU error, < 96 WU warning, 100 WU nothing', () => {
    const at = (dx: number): EditorIssue[] => withCode(run(withMarkers(clean, { starts: [start(0, 64, 64), start(1, 64 + dx, 64)], spots: [] })), 'start-close');
    expect(at(40).map((i) => [i.severity, ...refsOf(i)])).toEqual([['error', 'start0', 'start1']]);
    expect(at(80).map((i) => i.severity)).toEqual(['warning']);
    expect(at(100)).toEqual([]);
    expect(at(40)[0]!.message).toContain('40,0 WU');
  });
});

describe('reachability', () => {
  // Cliff ring (r 20..24 WU, 10 WU high) around start 1; `gap` opens a 7-WU pass at z ≈ 192, x > 192.
  const ring = (gap: boolean): RtsMap =>
    testMap({
      heights: (x, z) => {
        const d2 = (x - 192) ** 2 + (z - 192) ** 2;
        if (gap && x > 192 && Math.abs(z - 192) <= 3) return GROUND;
        return d2 >= 400 && d2 <= 576 ? GROUND + 10 * STEPS_PER_WU : GROUND;
      },
    });

  it('start-unreachable: a start behind a closed cliff ring is an error', () => {
    const issues = run(withMarkers(ring(false), { spots: CLEAN_SPOTS }));
    const e = withCode(issues, 'start-unreachable');
    expect(e.map((i) => [i.severity, ...refsOf(i)])).toEqual([['error', 'start1']]);
    expect(e[0]).toMatchObject({ x: wu(192), z: wu(192) });
    // Spots inside the ring are in start 1's component: still reachable from a start.
    expect(withCode(issues, 'spot-unreachable')).toEqual([]);
  });

  it('a pass through the ring makes it reachable', () => {
    expect(withCode(run(withMarkers(ring(true), { spots: CLEAN_SPOTS })), 'start-unreachable')).toEqual([]);
  });

  it('the main component is the one with most starts', () => {
    const map = withMarkers(ring(false), { starts: [start(0, 192, 192), start(1, 64, 64), start(2, 40, 200)], spots: [] });
    expect(withCode(run(map), 'start-unreachable').map(refsOf)).toEqual([['start0']]);
  });

  it('spot-unreachable: an island spot is a warning (air only), mainland spots are fine', () => {
    // Water 30 WU, sea floor 25 WU for x ≥ 150, island r 15 around (210, 60).
    const sea = testMap({
      heights: (x, z) => (x < 150 || (x - 210) ** 2 + (z - 60) ** 2 <= 225 ? GROUND : 25 * STEPS_PER_WU),
      starts: [start(0, 64, 64), start(1, 64, 192)],
    });
    const issues = run(withMarkers(sea, { spots: [mass(100, 100), mass(210, 60)] }));
    const w = withCode(issues, 'spot-unreachable');
    expect(w.map((i) => [i.severity, ...refsOf(i)])).toEqual([['warning', 'spot1']]);
    expect(errors(issues)).toEqual([]);
  });

  it('a spot on a small bump snaps to the passable ground around it', () => {
    // 2×2-sample block of 3 WU height under the spot: all four samples are impassable.
    const bump = testMap({ heights: (x, z) => ((x === 100 || x === 101) && (z === 100 || z === 101) ? GROUND + 3 * STEPS_PER_WU : GROUND) });
    const map = withMarkers(bump, { spots: [mass(100, 100)] });
    expect(createTerrainAnalysis(map).isPassableAt(wu(100), wu(100))).toBe(false);
    expect(withCode(run(map), 'spot-unreachable')).toEqual([]);
    expect(withCode(run(map, { reachSnapRadiusRaw: 0 }), 'spot-unreachable')).toHaveLength(1);
  });
});

describe('prop fields', () => {
  it('field-covers-spot: props within 2 WU of a spot / 8 WU of a start', () => {
    const map = withMarkers(clean, {
      spots: [mass(100, 100), mass(150, 40)],
      propFields: [circleField(100, 100, 10, { densityPerKWu2: 1024 }), circleField(64, 64, 12, { densityPerKWu2: 256, name: 'Hain' }), circleField(150, 60, 10, { densityPerKWu2: 1024 })],
    });
    const w = withCode(run(map), 'field-covers-spot');
    expect(w.map((i) => [i.severity, ...refsOf(i)])).toEqual([
      ['warning', 'start0', 'field1'],
      ['warning', 'spot0', 'field0'],
    ]);
    expect(w[0]).toMatchObject({ x: wu(64), z: wu(64) });
    expect(w[0]!.message).toContain('„Hain“');
    expect(w[0]!.message).toMatch(/setzt \d+ Props näher als 8,0 WU/);
  });

  it('field-empty: a dry-only field in a lake expands to nothing', () => {
    const lake = testMap({ heights: (x, z) => ((x - 128) ** 2 + (z - 40) ** 2 <= 225 ? 25 * STEPS_PER_WU : GROUND) });
    const wet = withMarkers(lake, { propFields: [circleField(128, 40, 6, { dryOnly: true }), circleField(128, 40, 6, { dryOnly: false })] });
    const w = withCode(run(wet), 'field-empty');
    expect(w.map((i) => [i.severity, ...refsOf(i)])).toEqual([['warning', 'field0']]);
    expect(w[0]).toMatchObject({ x: wu(128), z: wu(40) });
  });

  it('field-invalid: an invalid field is an error, not an exception', () => {
    const map = withMarkers(clean, { propFields: [circleField(100, 100, 10, { densityPerKWu2: 0 })] });
    const e = withCode(run(map), 'field-invalid');
    expect(e.map((i) => [i.severity, ...refsOf(i)])).toEqual([['error', 'field0']]);
    expect(e[0]!.message).toContain('densityPerKWu2');
  });

  it('prop-count: PROP entries + expansion above MAP_MAX_PROPS is an error', () => {
    const props: MapProp[] = [];
    for (let i = 0; i < MAP_MAX_PROPS - 10; i++) props.push({ id: 'core:rock_01', x: wu(1), z: wu(1), yaw: 0, scalePermille: 1000 });
    const field = circleField(150, 60, 10, { densityPerKWu2: 1024 });
    const full: RtsMap = { ...withMarkers(clean, { propFields: [field] }), props };
    const e = withCode(run(full), 'prop-count');
    expect(e.map((i) => [i.severity, ...refsOf(i)])).toEqual([['error', 'field0']]);
    expect(e[0]!.message).toContain(`${MAP_MAX_PROPS - 10} einzelne`);
    // Below the limit: no error; the limit is an option.
    expect(withCode(run(withMarkers(clean, { propFields: [field] })), 'prop-count')).toEqual([]);
    expect(withCode(run(withMarkers(clean, { propFields: [field] }), { maxProps: 100 }), 'prop-count')).toHaveLength(1);
  });
});

describe('asymmetric (symmetry detection)', () => {
  const S = 256 * 4096;
  it('mirrorPoint follows the model convention', () => {
    expect(mirrorPoint('point', S, 1, 2)).toEqual([S - 1, S - 2]);
    expect(mirrorPoint('mirrorX', S, 1, 2)).toEqual([S - 1, 2]);
    expect(mirrorPoint('mirrorZ', S, 1, 2)).toEqual([1, S - 2]);
    expect(mirrorPoint('diagonal', S, 1, 2)).toEqual([2, 1]);
    expect(mirrorPoint('antiDiagonal', S, 1, 2)).toEqual([S - 2, S - 1]);
    expect(mirrorPoint('none', S, 1, 2)).toEqual([1, 2]);
  });

  it.each([
    ['mirrorX', [start(0, 64, 128), start(1, 192, 128)], [mass(80, 100), mass(176, 100), hydro(128, 60)]],
    ['mirrorZ', [start(0, 128, 64), start(1, 128, 192)], [mass(100, 80), mass(100, 176), hydro(60, 128)]],
    ['diagonal', [start(0, 64, 192), start(1, 192, 64)], [mass(80, 200), mass(200, 80), hydro(100, 100)]],
    ['antiDiagonal', [start(0, 64, 64), start(1, 192, 192)], [mass(80, 60), mass(196, 176)]],
  ] as const)('detects %s', (mode, starts, spots) => {
    const map = withMarkers(testMap(), { starts, spots });
    expect(detectSymmetry(map)).toEqual([mode]);
    const info = withCode(run(map), 'asymmetric');
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({ severity: 'info', refs: [] });
    expect(info[0]!.message).toContain(`(Symmetrie: ${mode})`);
  });

  it('kind matters, the tolerance is 1 WU by default', () => {
    const base = { starts: [start(0, 64, 64), start(1, 192, 192)] };
    expect(detectSymmetry(withMarkers(testMap(), { ...base, spots: [mass(80, 64), hydro(176, 192)] }))).toEqual([]);
    expect(detectSymmetry(withMarkers(testMap(), { ...base, spots: [mass(80, 64), mass(176.5, 192.5)] }))).toContain('point');
    expect(detectSymmetry(withMarkers(testMap(), { ...base, spots: [mass(80, 64), mass(178, 192)] }))).not.toContain('point');
  });

  it('asymmetric layout: info with the markers lacking a partner under the best mode', () => {
    const map = withMarkers(testMap(), { spots: [mass(80, 64), mass(120, 30)] });
    const info = withCode(run(map), 'asymmetric');
    expect(info).toHaveLength(1);
    expect(info[0]!.severity).toBe('info');
    expect(info[0]!.message).toContain('keiner Spiegelung');
    expect(info[0]!.refs.length).toBeGreaterThan(0);
    expect(info[0]!.refs.every((r) => r.type === 'spot')).toBe(true);
  });
});

describe('issue list', () => {
  const messy = withMarkers(testMap({ heights: (x) => GROUND + Math.min(56, Math.max(0, x - 100)) * 64 }), {
    starts: [start(0, 10, 64), start(2, 40, 64)],
    spots: [mass(128, 128), mass(129, 128), mass(5, 100), mass(12, 64)],
    propFields: [circleField(40, 64, 10, { densityPerKWu2: 512 }), circleField(200, 200, 5, { densityPerKWu2: 0 })],
  });

  it('is sorted by severity, uses known codes, raw integer positions and valid refs', () => {
    const issues = run(messy);
    const rank = { error: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < issues.length; i++) expect(rank[issues[i]!.severity]).toBeGreaterThanOrEqual(rank[issues[i - 1]!.severity]);
    const codes = new Set(issues.map((i) => i.code));
    for (const c of codes) expect(ISSUE_CODES).toContain(c);
    for (const c of ['start-count', 'start-edge', 'spot-edge', 'spot-not-flat', 'spot-overlap', 'spot-on-start', 'start-close', 'field-covers-spot', 'field-invalid']) expect(codes).toContain(c);
    for (const i of issues) {
      expect(i.message.length).toBeGreaterThan(10);
      if (i.x !== null) expect(Number.isInteger(i.x) && Number.isInteger(i.z)).toBe(true);
      for (const r of i.refs) {
        const len = r.type === 'start' ? messy.meta.starts.length : r.type === 'spot' ? messy.meta.spots.length : messy.propFields!.length;
        expect(r.index).toBeLessThan(len);
      }
    }
  });

  it('is deterministic (same list twice, also with fresh analyses)', () => {
    const a = run(messy);
    const b = run(messy);
    const analysis = createTerrainAnalysis(messy);
    const c = validateMap(messy, analysis);
    const d = validateMap(messy, analysis);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    expect(JSON.stringify(d)).toBe(JSON.stringify(a));
  });

  it('defaults are documented values in Fx raw', () => {
    expect(DEFAULT_VALIDATION_OPTIONS).toMatchObject({
      startEdgeMinRaw: wu(16),
      spotEdgeMinRaw: wu(12),
      spotFlatErrorRadiusRaw: wu(1.5),
      spotFlatErrorDhRaw: wu(0.5),
      spotFlatWarnRadiusRaw: wu(3),
      spotOverlapRaw: wu(2),
      spotCloseRaw: wu(4),
      spotStartMinRaw: wu(4),
      startCloseErrorRaw: wu(48),
      startCloseWarnRaw: wu(96),
      fieldSpotClearRaw: wu(2),
      fieldStartClearRaw: wu(8),
      startPlatformRadiusRaw: wu(8),
      maxProps: MAP_MAX_PROPS,
    });
    expect(Math.abs(DEFAULT_VALIDATION_OPTIONS.spotFlatWarnDhRaw - wu(0.1))).toBeLessThanOrEqual(1);
    expect(Object.isFrozen(DEFAULT_VALIDATION_OPTIONS)).toBe(true);
  });
});
