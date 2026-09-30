/**
 * Replay benchmark (script `bench:replay`, PLAN §5.2 MS11 acceptance values, measured headless in
 * Node), see src/replay/replay-bench.ts.
 *
 *   pnpm --filter @faf/headless bench:replay [-- --quick] [--update-docs] [--json]
 *
 * Long game hollow-ridge 2 × 120 APM, 30 min (`--quick`: 10 min) → .rtsreplay; size next to the
 * synthetic model of the same length (replay-size); playback cold (two fresh Node processes),
 * first run and warm; seek backwards from the end (20 targets + worst case); keyframe memory.
 * Writes results/replay-bench-<date>.json (git-ignored) and prints the tables; `--update-docs`
 * replaces the tables between the bench markers of docs/status/track-replay/p5.md.
 *
 * Exit 1 (local measurement, machine-dependent): seek p95 > 2,000 ms, playback < 20x real time
 * (any of cold / first / warm), or any hash divergence / inexact seek.
 *
 * Internal: `--child-cold <file.rtsreplay>` measures one playback in this (fresh) process and
 * prints it as JSON.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReplayBench, measurePlayback, replayBenchGateFailures, runReplayBench, type PlaybackRun } from '../src/replay/replay-bench.ts';
import { buildSyntheticReplay } from './replay-size.ts';
import { HEADLESS_DIR, isoDate, machine, REPO_DIR, RESULTS_DIR, writeText } from './lib.ts';
import { loadReplayAssets, parseCli } from './replay-cli-lib.ts';

const SELF = fileURLToPath(import.meta.url);
const DOC = resolve(REPO_DIR, 'docs/status/track-replay/p5.md');
const START = '<!-- bench:replay:start -->';
const END = '<!-- bench:replay:end -->';
const COLD_RUNS = 2;

const clock = (): number => performance.now();
const gcFn = (globalThis as { gc?: () => void }).gc;

const args = parseCli(process.argv.slice(2), ['--quick', '--update-docs', '--json'], ['--child-cold']);

const childFile = args.values.get('--child-cold')?.[0];
if (childFile !== undefined) {
  // Fresh process: nothing ran before this playback (JIT cold).
  const assets = loadReplayAssets();
  const run = measurePlayback(new Uint8Array(readFileSync(childFile)), assets, clock);
  process.stdout.write(`${JSON.stringify(run)}\n`);
  process.exit(0);
}

const quick = args.flags.has('--quick');
const updateDocs = args.flags.has('--update-docs');
const jsonOnly = args.flags.has('--json');
const minutes = quick ? 10 : 30;
const log = jsonOnly ? undefined : (l: string): void => console.log(l);

const assets = loadReplayAssets();
const measured: { replay: Uint8Array | null } = { replay: null };
const result = runReplayBench({
  ...assets,
  minutes,
  clock,
  warmRuns: quick ? 2 : 3,
  ...(gcFn !== undefined ? { gc: gcFn } : {}),
  ...(log !== undefined ? { log } : {}),
  onReplay: (bytes) => (measured.replay = bytes),
});

// Cold playback in fresh Node processes (JIT cold, nothing simulated before).
log?.(`» cold playback in ${COLD_RUNS} fresh Node processes …`);
const replay = measured.replay;
if (replay === null) throw new Error('runReplayBench did not hand out the replay');
const tmp = mkdtempSync(resolve(tmpdir(), 'faf-replay-bench-'));
const cold: PlaybackRun[] = [];
try {
  const file = resolve(tmp, 'long-game.rtsreplay');
  writeFileSync(file, replay);
  for (let i = 0; i < COLD_RUNS; i++) {
    const r = spawnSync(process.execPath, ['--import', 'tsx', SELF, '--child-cold', file], {
      cwd: HEADLESS_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 16 * 1024 * 1024,
    });
    if (r.error !== undefined) throw r.error;
    if (r.status !== 0) throw new Error(`cold playback process exited with ${r.status}`);
    cold.push(JSON.parse(r.stdout.trim().split('\n').pop()!) as PlaybackRun);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const synthetic = buildSyntheticReplay(120, minutes).report;
const failures = replayBenchGateFailures(result, cold);
const date = isoDate();
const env = { date, machine: machine(), node: process.version, quick, localMeasurement: true };
const out = resolve(RESULTS_DIR, `replay-bench-${date}.json`);
const report = { ...env, ...result, coldProcess: cold, syntheticModel: synthetic, gateFailures: failures };
writeText(out, `${JSON.stringify(report, null, 2)}\n`);

const table = formatReplayBench(result, { synthetic, cold });
const gateLine =
  failures.length === 0
    ? `Gate (lokal gemessen, ${env.machine}): ✓ Wiedergabe ≥ 20x, Rückwärts-Seek p95 ≤ 2.000 ms, keine Hash-Abweichung.`
    : `Gate (lokal gemessen, ${env.machine}): ✗ ${failures.join('; ')}`;
if (jsonOnly) console.log(JSON.stringify(report));
else {
  console.log('');
  console.log(table);
  console.log('');
  console.log(gateLine);
  console.log(`» report: ${out}`);
}

if (updateDocs) {
  if (!existsSync(DOC)) throw new Error(`${DOC} is missing (write the fragment first)`);
  const doc = readFileSync(DOC, 'utf8');
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`bench markers ${START} … ${END} not found in ${DOC}`);
  const header = `Lauf vom ${date}, lokal gemessen, ${env.machine}, Node ${env.node}${quick ? ', --quick' : ''}.`;
  writeText(DOC, `${doc.slice(0, a + START.length)}\n${header}\n\n${table}\n\n${gateLine}\n${doc.slice(b)}`);
  if (!jsonOnly) console.log(`» updated ${DOC}`);
}

if (failures.length > 0) process.exitCode = 1;
