/**
 * MS3 bench building blocks (scripts/ms3.ts, scripts/spk3.ts) on small inputs: the scenario
 * runners report their machine-independent criteria as checks, the corridor rule matches the
 * brute force in the storm, the SPK3 nav-level replay of the corridor policy never repaths an intact
 * path and never drives on a cut leg.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRtsMap } from '@faf/formats';
import { navTestRtsMap } from '../src/maps.ts';
import { quantile } from '../src/ms3/driver.ts';
import { runChoke, runStartup, runStorm, type Check } from '../src/ms3/scenarios.ts';
import { runRepathVariant } from '../src/ms3/spk3.ts';
import { loadSimBin, REPO_DIR } from '../scripts/lib.ts';

const clock = (): number => performance.now();
const failed = (checks: readonly Check[]): string[] => checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);

describe('MS3 bench scenarios', () => {
  const simBin = loadSimBin();

  it('start-up from standstill (SPK6 reference): every unit moves in the first tick after the command', () => {
    const r = runStartup(simBin);
    expect(failed(r.checks)).toEqual([]);
    expect(r.rows.length).toBe(15);
    for (const row of r.rows) {
      expect(row.moveTick).toBe(1);
      expect(row.move1Tick).toBeGreaterThanOrEqual(row.move05Tick);
    }
    expect(r.groupMaxMoveTick).toBeLessThanOrEqual(10);
  });

  it('choke: 100 units through the 3-WU gap without deadlock', () => {
    const c = navTestRtsMap('choke', 128, 3);
    const r = runChoke(simBin, c.map, c.nav, clock);
    expect(failed(r.checks)).toEqual([]);
    expect(r.milestones.every((m) => m !== null)).toBe(true);
  });

  it('repath storm on hollow-ridge: marked paths == brute-force corridor cuts, nothing else', () => {
    const ridge = readRtsMap(new Uint8Array(readFileSync(resolve(REPO_DIR, 'content/maps/hollow-ridge.rtsmap'))));
    const r = runStorm(simBin, 'hollow-ridge', ridge, undefined, clock);
    expect(failed(r.checks)).toEqual([]);
    expect(r.stamps.length).toBe(20);
    expect(r.markedTotal).toBe(r.expectedTotal);
  }, 30_000);
});

describe('SPK3 repath variants (nav level)', () => {
  it('corridor policy: every repath is necessary, no cut path is driven on; chunk policy is measured', () => {
    const { nav } = navTestRtsMap('bases', 512, 1);
    const corridor = runRepathVariant(nav, 'corridor', 300, clock);
    expect(corridor.footprints).toBeGreaterThan(5);
    expect(corridor.repathsTotal).toBeGreaterThan(0);
    expect(corridor.unnecessary).toBe(0);
    expect(corridor.staleTicks).toBe(0);
    expect(corridor.latency.max).toBe(0);
    const chunk = runRepathVariant(nav, 'chunk', 300, clock);
    expect(chunk.repathsCorridor).toBe(0);
    expect(chunk.repathsChunkEntry + chunk.repathsLazy).toBe(chunk.repathsTotal);
    expect(chunk.necessary + chunk.unnecessary).toBe(chunk.repathsTotal);
  }, 30_000);

  it('quantile is nearest-rank', () => {
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(quantile([], 0.5)).toBe(0);
  });
});
