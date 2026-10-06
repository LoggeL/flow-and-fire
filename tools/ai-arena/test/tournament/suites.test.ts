/**
 * Suite plans (ms9 210 games, diff 120, quick 12), army/start assignment, side sampling and the
 * tournament command line.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAIN_SPEC, effectiveWorkers, parseSeeds, parseTournamentArgs, planNamedSuite, type MatchJob } from '../../src/index.ts';

const count = (jobs: readonly MatchJob[], f: (j: MatchJob) => boolean): number => jobs.filter(f).length;

describe('suite plans', () => {
  it('ms9: Normal mirror, seeds 1–105 × swapped, 3 maps ⇒ 210 games, 70 per map, 30 min', () => {
    const { def, jobs } = planNamedSuite('ms9');
    expect(jobs.length).toBe(210);
    expect(def.gateMode).toBe('wilson');
    expect(def.maxTicks).toBe(18_000);
    for (const m of ['setons', 'hollow-ridge', 'tessera']) expect(count(jobs, (j) => j.map === m)).toBe(70);
    expect(jobs.map((j) => j.game)).toEqual(jobs.map((_, i) => i));
    expect(new Set(jobs.map((j) => j.seed)).size).toBe(105);
    for (const j of jobs) {
      expect(j.mirror).toBe(true);
      expect(j.sides.map((s) => s.profile)).toEqual(['normal', 'normal']);
      expect(j.sides.map((s) => s.brain)).toEqual([DEFAULT_BRAIN_SPEC, DEFAULT_BRAIN_SPEC]);
      // mirror: the swapped game exchanges the start markers, the sample is the seed's parity
      expect(j.starts).toEqual(j.swapped ? [1, 0] : [0, 1]);
      expect(j.armyA).toBe(0);
      expect(j.sampledArmy).toBe(j.seed % 2 === 0 ? 0 : 1);
      expect(j.host).toBe('sync');
      // the second mirror game of a seed gets its own AI seed (independent opening choice)
      if (j.swapped) expect(j.aiSeed).not.toBe(j.seed);
      else expect(j.aiSeed).toBe(j.seed);
    }
    expect(new Set(jobs.map((j) => j.aiSeed)).size).toBe(210);
    // every seed once unswapped and once swapped, directly after each other
    expect(jobs.slice(0, 4).map((j) => [j.seed, j.swapped, j.map])).toEqual([
      [1, false, 'hollow-ridge'],
      [1, true, 'hollow-ridge'],
      [2, false, 'tessera'],
      [2, true, 'tessera'],
    ]);
  });

  it('diff: Normal vs Easy and Hard vs Normal, 60 games each, report mode, candidate sampled', () => {
    const { def, jobs } = planNamedSuite('diff');
    expect(jobs.length).toBe(120);
    expect(def.gateMode).toBe('report');
    const ne = jobs.filter((j) => j.pairing === 'normal-vs-easy');
    const hn = jobs.filter((j) => j.pairing === 'hard-vs-normal');
    expect(ne.length).toBe(60);
    expect(hn.length).toBe(60);
    for (const j of jobs) {
      expect(j.mirror).toBe(false);
      expect(j.starts).toEqual([0, 1]);
      expect(j.armyA).toBe(j.swapped ? 1 : 0);
      expect(j.sampledArmy).toBe(j.armyA);
      expect(j.aiSeed).toBe(j.seed);
      const a = j.sides[j.armyA]!;
      expect(a.contestant).toBe('A');
      expect(a.profile).toBe(j.pairing === 'normal-vs-easy' ? 'normal' : 'hard');
      expect(j.sides[1 - j.armyA]!.profile).toBe(j.pairing === 'normal-vs-easy' ? 'easy' : 'normal');
    }
    for (const m of ['setons', 'hollow-ridge', 'tessera']) expect(count(ne, (j) => j.map === m)).toBe(20);
  });

  it('quick: 12 games, short game time, point gates', () => {
    const { def, jobs } = planNamedSuite('quick');
    expect(jobs.length).toBe(12);
    expect(def.gateMode).toBe('point');
    expect(def.maxTicks).toBeLessThan(18_000);
    expect(def.maxTicks).toBeGreaterThan(7_200);
  });

  it('overrides: maps, seeds, games, brain, host, max ticks', () => {
    const { def, jobs } = planNamedSuite('ms9', { maps: ['setons'], seeds: [17], brain: 'x#y', host: 'worker', maxTicks: 1800 });
    expect(jobs.length).toBe(2);
    expect(jobs.every((j) => j.map === 'setons' && j.seed === 17 && j.maxTicks === 1800 && j.host === 'worker')).toBe(true);
    expect(jobs[0]!.sides[0]!.brain).toBe('x#y');
    expect(def.maps).toEqual(['setons']);
    expect(planNamedSuite('ms9', { games: 5 }).jobs.length).toBe(5);
    expect(jobs.every((j) => j.clock === 'thread')).toBe(true);
    expect(planNamedSuite('quick', { clock: 'wall' }).jobs.every((j) => j.clock === 'wall')).toBe(true);
    expect(() => planNamedSuite('ms9', { games: 0 })).toThrow(RangeError);
  });
});

describe('pool size', () => {
  it('≤ 4 threads; worker host at most 2 games in parallel; 0 = in-process', () => {
    const sync = planNamedSuite('quick').jobs;
    const worker = planNamedSuite('quick', { host: 'worker' }).jobs;
    expect(effectiveWorkers(sync)).toBe(4);
    expect(effectiveWorkers(sync, 2)).toBe(2);
    expect(effectiveWorkers(sync.slice(0, 3), 4)).toBe(3);
    expect(effectiveWorkers(worker, 4)).toBe(2);
    expect(effectiveWorkers(sync, 0)).toBe(0);
    expect(() => effectiveWorkers(sync, 5)).toThrow(RangeError);
  });
});

describe('command line', () => {
  it('parses options and ignores a leading --', () => {
    const a = parseTournamentArgs(['--', '--suite', 'ms9', '--workers', '4', '--maps', 'setons,tessera', '--seeds', '1-3,9', '--host', 'worker', '--out', 'x.json', '--md=r.md', '--brain', 'm#f', '--minutes', '10', '--games', '7', '--quiet']);
    expect(a.suite).toBe('ms9');
    expect(a.workers).toBe(4);
    expect(a.out).toBe('x.json');
    expect(a.md).toBe('r.md');
    expect(a.json).toBe(true);
    expect(a.quiet).toBe(true);
    expect(a.overrides).toEqual({ maps: ['setons', 'tessera'], seeds: [1, 2, 3, 9], host: 'worker', brain: 'm#f', maxTicks: 6000, games: 7 });
    const d = parseTournamentArgs([]);
    expect(d.suite).toBe('quick');
    expect(d.workers).toBe(4);
    expect(d.out).toBeNull();
    expect(parseTournamentArgs(['--no-json']).json).toBe(false);
    expect(parseTournamentArgs(['--clock', 'wall']).overrides).toEqual({ clock: 'wall' });
    expect(parseTournamentArgs(['--clock=thread']).overrides).toEqual({ clock: 'thread' });
  });

  it('rejects unknown options and invalid values', () => {
    expect(() => parseTournamentArgs(['--suite', 'ms99'])).toThrow(/unknown suite/);
    expect(() => parseTournamentArgs(['--workers', '5'])).toThrow(/at most 4/);
    expect(() => parseTournamentArgs(['--host', 'gpu'])).toThrow(/sync\|worker/);
    expect(() => parseTournamentArgs(['--frobnicate', '1'])).toThrow(/unknown option/);
    expect(() => parseTournamentArgs(['--clock', 'sundial'])).toThrow(/thread\|wall/);
    expect(() => parseTournamentArgs(['--games'])).toThrow(/missing value/);
    expect(() => parseSeeds('5-3')).toThrow(/empty range/);
    expect(parseSeeds('4')).toEqual([4]);
  });
});
