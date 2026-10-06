/**
 * AI tournament in the arena (ai.md §7, TRACK-AI tai-p6). Run from the repository root through the
 * heavy-job gate:
 *
 *   tools/heavy node --import tsx tools/ai-arena/scripts/tournament.ts --suite ms9 --workers 4
 *   tools/heavy pnpm --filter @faf/ai-arena run tournament -- --suite quick
 *
 * Suites: ms9 (Normal mirror, 210 games, 30 min, Wilson gates), diff (Normal vs Easy, Hard vs Normal,
 * 120 games, report), quick (12 games, 13 min, point gates). Writes the JSON report to
 * tools/ai-arena/results/<suite>-<date>.json (or --out), prints the Markdown report (or --md <file>)
 * and exits with 1 when a blocking gate fails (2 on usage errors).
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReport,
  effectiveWorkers,
  fmtClock,
  parseTournamentArgs,
  planNamedSuite,
  renderMarkdown,
  runTournament,
  type GameRecord,
  type TournamentArgs,
} from '../src/tournament/index.ts';

const RESULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../results');

function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function outPath(a: TournamentArgs, started: Date): string {
  const name = `${a.suite}-${stamp(started)}.json`;
  if (a.out === null) return join(RESULTS_DIR, name);
  const p = resolve(a.out);
  try {
    if (statSync(p).isDirectory()) return join(p, name);
  } catch {
    // not existing: a file path
  }
  return p;
}

function progressLine(r: GameRecord, done: number, total: number): string {
  const head = `[${String(done).padStart(String(total).length)}/${total}] game ${r.game} ${r.pairing} seed ${r.seed} ${r.map}${r.swapped ? ' (swapped)' : ''}`;
  if (r.crash !== null) return `${head}: CRASH ${r.crash}`;
  const sides = r.sides
    .map((s) => {
      const t2 = s.t2Tick === null ? '–' : fmtClock(s.t2Tick);
      const wave = s.firstWaveTick === null ? '–' : fmtClock(s.firstWaveTick);
      return `a${s.army} ${s.label}/${s.opening ?? '-'} T2 ${t2} wave ${wave} idle ${s.idleEngineerPct.toFixed(1)}% stall ${s.energyStallPct.toFixed(1)}%`;
    })
    .join(' | ');
  return `${head}: winner ${r.winner} at ${fmtClock(r.endTick)} (${r.endReason}) | ${sides}`;
}

async function main(): Promise<number> {
  let a: TournamentArgs;
  try {
    a = parseTournamentArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const { def, jobs } = planNamedSuite(a.suite, a.overrides);
  const workers = effectiveWorkers(jobs, a.workers);
  const started = new Date();
  const t0 = process.hrtime.bigint();
  process.stderr.write(`tournament ${def.name}: ${jobs.length} games on ${def.maps.join(', ')}, ≤ ${fmtClock(def.maxTicks)} game time, ${workers} worker(s), host ${a.overrides.host ?? 'sync'}, emergency-stop clock ${a.overrides.clock ?? 'thread'}\n`);
  const records = await runTournament(jobs, {
    workers,
    onGame: (r, done, total) => {
      if (!a.quiet || r.crash !== null) process.stderr.write(progressLine(r, done, total) + '\n');
    },
  });
  const wallSeconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const report = buildReport(def, records, {
    generatedAt: started.toISOString(),
    wallSeconds,
    workers,
    command: ['tournament.ts', ...process.argv.slice(2)].join(' '),
  });
  const md = renderMarkdown(report);
  if (a.json) {
    const file = outPath(a, started);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(report, null, 1) + '\n');
    process.stderr.write(`report: ${file}\n`);
  }
  if (a.md !== null) {
    mkdirSync(dirname(resolve(a.md)), { recursive: true });
    writeFileSync(resolve(a.md), md);
    process.stderr.write(`markdown: ${resolve(a.md)}\n`);
  } else {
    process.stdout.write(md + '\n');
  }
  process.stderr.write(`${report.passed ? 'PASSED' : 'FAILED'}: ${report.games} games, ${report.crashes} crashes, ${wallSeconds.toFixed(0)} s\n`);
  return report.passed ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`tournament failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 3;
  },
);
