/**
 * Mini tournament over the worker pool: 4 games of 3 min game time with the scripted fixture brain
 * (brain spec 'file:…#createFixtureBrain'), records equal to the in-process run (determinism across
 * threads, wall-clock fields excepted), and the script's exit code on a gate violation.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aggregate, planNamedSuite, repoRoot, runGameJob, runTournament, type GameRecord } from '../../src/index.ts';

const FIXTURE_SPEC = `${new URL('../host/fixtures/brains.ts', import.meta.url).href}#createFixtureBrain`;

/** A record without the wall-clock diagnostics. */
function stable(r: GameRecord): unknown {
  return { ...r, sides: r.sides.map((s) => ({ ...s, thinkMsP50: 0, thinkMsP95: 0, thinkMsMax: 0 })) };
}

describe('mini tournament', () => {
  it('4 games à 3 min on the pool: one record per game, deterministic, aggregated', async () => {
    const { jobs } = planNamedSuite('quick', { brain: FIXTURE_SPEC, maxTicks: 1800, games: 4 });
    expect(jobs.length).toBe(4);
    const progress: number[] = [];
    const records = await runTournament(jobs, { workers: 4, onGame: (_r, done) => progress.push(done) });
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(records.map((r) => r.game)).toEqual([0, 1, 2, 3]);
    for (const r of records) {
      expect(r.crash).toBeNull();
      expect(r.endTick).toBe(1800);
      expect(r.sides.length).toBe(2);
      for (const s of r.sides) {
        expect(s.thinks).toBe(360);
        expect(s.aiTimeouts).toBe(0);
        expect(s.fac1Tick).not.toBeNull();
        expect(s.apmWindows.length).toBe(3);
        expect(s.opsByManager.map((m) => m.name)).toEqual(['opening', 'factory', 'platoon', 'emitter']);
      }
    }
    // mirror: the swapped game of a seed exchanges the start markers
    expect(records.map((r) => r.starts)).toEqual([
      [0, 1],
      [1, 0],
      [0, 1],
      [1, 0],
    ]);
    // the same job in-process gives the same record
    const again = await runGameJob(jobs[2]!);
    expect(stable(again)).toEqual(stable(records[2]!));
    const agg = aggregate(records, 'report');
    expect(agg.games).toBe(4);
    expect(agg.crashes).toBe(0);
    expect(agg.pairings[0]!.results.games).toBe(4);
    expect(agg.budgets.map((b) => b.profile)).toEqual(['normal']);
  });

  it('an unloadable brain becomes a crash record, not a failed tournament', async () => {
    const { jobs } = planNamedSuite('quick', { brain: 'file:///nonexistent/brain.ts#x', maxTicks: 50, games: 1 });
    const [r] = await runTournament(jobs, { workers: 0 });
    expect(r!.crash).not.toBeNull();
    expect(r!.endReason).toBe('crash');
    expect(aggregate([r!], 'report').passed).toBe(false);
  });

  it('scripts/tournament.ts exits with 1 on a gate violation (fixture brain never reaches T2)', () => {
    const script = fileURLToPath(new URL('../../scripts/tournament.ts', import.meta.url));
    const p = spawnSync(
      process.execPath,
      ['--import', 'tsx', script, '--', '--suite', 'quick', '--games', '1', '--seeds', '2', '--minutes', '1', '--workers', '0', '--brain', FIXTURE_SPEC, '--no-json'],
      { cwd: repoRoot(), encoding: 'utf8', timeout: 60_000 },
    );
    expect(p.status).toBe(1);
    expect(p.stdout).toContain('## Turnier `quick` – NICHT BESTANDEN');
    expect(p.stderr).toContain('FAILED: 1 games, 0 crashes');
    const bad = spawnSync(process.execPath, ['--import', 'tsx', script, '--workers', '9'], { cwd: repoRoot(), encoding: 'utf8', timeout: 60_000 });
    expect(bad.status).toBe(2);
  });
});
