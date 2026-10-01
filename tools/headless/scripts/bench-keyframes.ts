/**
 * Keyframe benchmark (script `bench:keyframes`, PLAN §4 SPK5 follow-up for MS11 seek): compressed
 * arena keyframes on the test plane, hollow-ridge and setons (see src/replay/keyframe-bench.ts).
 *
 *   pnpm --filter @faf/headless bench:keyframes [-- --quick] [--update-docs] [--json]
 *
 * Writes results/keyframes-<date>.json (git-ignored) and prints the Markdown tables. Only
 * `--update-docs` replaces the tables between the bench markers of docs/status/track-replay/p2.md
 * (DECISIONS 16: measurement ≠ gate). Exit 1 only on errors (a restore that does not reproduce the
 * captured hashes), never on timings.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatKeyframeBench, runKeyframeBench } from '../src/replay/keyframe-bench.ts';
import { isoDate, loadSimBin, machine, REPO_DIR, RESULTS_DIR, writeText } from './lib.ts';

const args = new Set(process.argv.slice(2).filter((a) => a !== '--'));
const quick = args.has('--quick');
const updateDocs = args.has('--update-docs');
const jsonOnly = args.has('--json');
for (const a of args) {
  if (a !== '--quick' && a !== '--update-docs' && a !== '--json') {
    console.error(`unknown argument ${a} (allowed: --quick, --update-docs, --json)`);
    process.exit(2);
  }
}

const DOC = resolve(REPO_DIR, 'docs/status/track-replay/p2.md');
const START = '<!-- bench:keyframes:start -->';
const END = '<!-- bench:keyframes:end -->';

const gcFn = (globalThis as { gc?: () => void }).gc;
const readMap = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(REPO_DIR, 'content/maps', `${name}.rtsmap`)));

const result = await runKeyframeBench({
  simBin: loadSimBin(),
  hollowRidge: readMap('hollow-ridge'),
  setons: readMap('setons'),
  clock: () => performance.now(),
  reps: quick ? 5 : 25,
  ...(gcFn !== undefined ? { gc: gcFn } : {}),
  ...(jsonOnly ? {} : { log: (l: string) => console.log(l) }),
});

const date = isoDate();
const env = { date, machine: machine(), node: process.version, quick };
const out = resolve(RESULTS_DIR, `keyframes-${date}.json`);
writeText(out, `${JSON.stringify({ ...env, ...result }, null, 2)}\n`);

const table = formatKeyframeBench(result);
if (jsonOnly) console.log(JSON.stringify({ ...env, ...result }));
else {
  console.log('');
  console.log(table);
  console.log('');
  console.log(`» report: ${out}`);
}

if (updateDocs) {
  if (!existsSync(DOC)) throw new Error(`${DOC} is missing (write the fragment first)`);
  const doc = readFileSync(DOC, 'utf8');
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`bench markers ${START} … ${END} not found in ${DOC}`);
  const header = `Lauf vom ${date}, lokal gemessen, ${env.machine}, Node ${env.node}${quick ? ', --quick' : ''}.`;
  writeText(DOC, `${doc.slice(0, a + START.length)}\n${header}\n\n${table}\n${doc.slice(b)}`);
  if (!jsonOnly) console.log(`» updated ${DOC}`);
}

if (result.errors.length > 0) {
  for (const e of result.errors) console.error(`ERROR ${e}`);
  process.exit(1);
}
