// SPK2 (PLAN §4, DECISIONS 22): every scenario runs without deadlock with SPK2_PARAMS and meets
// its machine-independent criteria; the prototype mirrors the blueprint defaults.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_BRAKE_FACTOR, DEFAULT_MASS_BY_SIZE_CLASS } from '@faf/blueprints';
import { describe, expect, it } from 'vitest';
import {
  offsetRadius,
  runScenario,
  SCENARIO_IDS,
  SPK2_PARAMS,
  Spk2Grid,
  UNIT_TYPES,
  type ScenarioMetrics,
} from '../src/spk2/index.ts';

const REPO = resolve(import.meta.dirname, '../../..');

describe('SPK2 scenarios (quick: seed 1, all six)', () => {
  const results = new Map<string, ScenarioMetrics>();
  for (const id of SCENARIO_IDS) {
    it(`${id}: no deadlock, goal reached, criteria met`, () => {
      const { metrics } = runScenario(id, SPK2_PARAMS, 1);
      results.set(id, metrics);
      expect(metrics.deadlock).toBe(false);
      expect(metrics.secondsToDone).not.toBeNull();
      expect(metrics.failures).toEqual([]);
      // Every unit shows motion within 2 ticks and translates within 1 s (MS3 "alle fahren < 1 s los").
      expect(metrics.startTicksMax).toBeLessThanOrEqual(2);
      expect(metrics.moveTicksMax).toBeLessThanOrEqual(10);
      // Settled units do not overlap.
      expect(metrics.settledMaxOverlap).toBeLessThan(0.1);
    });
  }

  it('acceptance numbers: choke 100 units ≤ 60 s, cross-map ≥ 95 % without stuck > 3 s', () => {
    const choke = results.get('choke') ?? runScenario('choke').metrics;
    expect(choke.units).toBe(100);
    expect(choke.secondsToDone!).toBeLessThanOrEqual(60);
    const cross = results.get('cross-map') ?? runScenario('cross-map').metrics;
    expect(cross.units).toBe(200);
    expect(cross.noStuckShare).toBeGreaterThanOrEqual(0.95);
    // The group order issued exactly one path request (offset preservation).
    expect(cross.stats.orderRequests).toBe(1);
    const offset = results.get('offset') ?? runScenario('offset').metrics;
    expect(offset.offsetErrP95!).toBeLessThanOrEqual(1.5);
  });

  it('is deterministic for a seed and records a viewer trace', () => {
    const a = runScenario('offset', SPK2_PARAMS, 3, { traceEvery: 5 });
    const b = runScenario('offset', SPK2_PARAMS, 3);
    const strip = (m: ScenarioMetrics) => ({ ...m, wallMs: 0 });
    expect(strip(a.metrics)).toEqual(strip(b.metrics));
    const t = a.trace!;
    expect(t.format).toBe('faf-spk2-trace');
    expect(t.blocked).toHaveLength(t.height);
    expect(t.blocked[0]).toHaveLength(t.width);
    expect(t.frames.length).toBeGreaterThan(10);
    expect(t.frames[0]!.units).toHaveLength(a.metrics.units * 5);
  });
});

describe('SPK2 building blocks', () => {
  it('grid: clearance, distance field, A* around a wall, LOS', () => {
    const g = new Spk2Grid(32, 32);
    g.fillRect(15, 0, 2, 28);
    g.rebuild();
    expect(g.clearance[5 * 32 + 14]).toBe(1);
    expect(g.clearance[5 * 32 + 12]).toBe(3);
    expect(g.passable(3, 12, 5)).toBe(true);
    expect(g.passable(3, 13, 5)).toBe(false);
    expect(g.sampleDist(14.5, 5.5)).toBeCloseTo(0.5, 5);
    expect(g.lineOfSight(1, 5, 5, 25, 5)).toBe(false);
    const path = g.findPath(1, 5.5, 5.5, 25.5, 5.5)!;
    expect(path).not.toBeNull();
    // The path goes around the wall end (z ≥ 28) and ends at the exact goal.
    expect(Math.max(...path.filter((_, i) => i % 2 === 1))).toBeGreaterThanOrEqual(28);
    expect(path.slice(-2)).toEqual([25.5, 5.5]);
    // The 4-cell corridor between the wall end and the map edge admits class 2, not class 3.
    expect(g.findPath(2, 5.5, 5.5, 25.5, 5.5)).not.toBeNull();
    expect(g.findPath(3, 5.5, 5.5, 25.5, 5.5)).toBeNull();
  });

  it('R(n) compression radius', () => {
    expect(offsetRadius(SPK2_PARAMS, 100)).toBeCloseTo(SPK2_PARAMS.offsetRadiusBase + SPK2_PARAMS.offsetRadiusPerSqrtN * 10, 9);
  });

  it('mirrors the blueprint defaults and the compiled core units', () => {
    expect(SPK2_PARAMS.brakeFactor).toBe(DEFAULT_BRAKE_FACTOR);
    expect(SPK2_PARAMS.massBySizeClass).toEqual(DEFAULT_MASS_BY_SIZE_CLASS.slice(0, SPK2_PARAMS.massBySizeClass.length));
    const bundle = JSON.parse(readFileSync(resolve(REPO, 'content/generated/bundle.json'), 'utf8')) as {
      units: { id: string; blueprint: { sim: { motion: { speed: number; accel: number; turnRateDeg: number; sizeClass: number; radius: number; mass?: number } } } }[];
    };
    for (const t of UNIT_TYPES) {
      const u = bundle.units.find((x) => x.id === t.name);
      expect(u, t.name).toBeDefined();
      const m = u!.blueprint.sim.motion;
      expect({ speed: m.speed, accel: m.accel, turnRateDeg: m.turnRateDeg, sizeClass: m.sizeClass, radius: m.radius }).toEqual({
        speed: t.speed,
        accel: t.accel,
        turnRateDeg: t.turnRateDeg,
        sizeClass: t.sizeClass,
        radius: t.radius,
      });
      if (t.mass !== undefined) expect(m.mass).toBe(t.mass);
    }
  });
});
