/**
 * AI benchmarks in the arena (TRACK-AI tai-p6). Run from the repository root through the heavy-job
 * gate:
 *
 *   tools/heavy node --import tsx tools/ai-arena/scripts/bench.ts [--quick] [--brain module#export]
 *        [--out file.json|dir] [--no-json]
 *
 * Standard run ≤ 3 min, --quick < 60 s. Writes tools/ai-arena/results/bench-<date>.json (or --out),
 * prints Markdown tables and exits with 1 when a blocking gate fails (2 on usage errors).
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchConfig, renderBench, runBench } from '../src/bench/index.ts';

const RESULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../results');
const USAGE = 'usage: bench.ts [--quick] [--brain module#export] [--out file|dir] [--no-json]';

interface Args {
  quick: boolean;
  brain: string | undefined;
  out: string | null;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args = argv[0] === '--' ? argv.slice(1) : argv.slice();
  const a: Args = { quick: false, brain: undefined, out: null, json: true };
  for (let i = 0; i < args.length; i++) {
    const k = args[i]!;
    if (k === '--') continue;
    if (k === '--quick') a.quick = true;
    else if (k === '--no-json') a.json = false;
    else if (k === '--brain' || k === '--out') {
      const v = args[++i];
      if (v === undefined || v.length === 0) throw new Error(`${k}: missing value\n${USAGE}`);
      if (k === '--brain') a.brain = v;
      else a.out = v;
    } else throw new Error(`unknown option '${k}'\n${USAGE}`);
  }
  return a;
}

function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main(): Promise<number> {
  let a: Args;
  try {
    a = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const started = new Date();
  const report = await runBench(benchConfig(a.quick, a.brain), { log: (l) => process.stderr.write(l + '\n') });
  if (a.json) {
    const name = `bench${a.quick ? '-quick' : ''}-${stamp(started)}.json`;
    let file = a.out === null ? join(RESULTS_DIR, name) : resolve(a.out);
    try {
      if (a.out !== null && statSync(file).isDirectory()) file = join(file, name);
    } catch {
      // a file path
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...report, generatedAt: started.toISOString() }, null, 1) + '\n');
    process.stderr.write(`report: ${file}\n`);
  }
  process.stdout.write(renderBench(report) + '\n');
  process.stderr.write(`${report.passed ? 'PASSED' : 'FAILED'} in ${report.wallSeconds.toFixed(0)} s\n`);
  return report.passed ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`bench failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 3;
  },
);
