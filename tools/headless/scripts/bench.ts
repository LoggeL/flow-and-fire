/**
 * L6 benchmarks (script `bench`): tick bench on hollow-ridge (MS3 budget: 1,000 moving units with
 * pathing, p95 ≤ 8 ms; ms budgets gate only with FAF_PERF_GATE=1, DECISIONS 16) and on the MS1 test
 * plane, SPK1 and SPK5 in Node (fresh process per job) and in Chromium/Firefox/WebKit module
 * workers (sequential), each JIT cold and warm.
 * Writes results/bench-<date>.json (local measurement output, git-ignored) and prints the
 * Markdown tables incl. the spike exit decisions (PLAN §4). Only with `--update-docs` (or
 * FAF_BENCH_UPDATE_DOCS=1) are the tables between the bench markers of docs/status/ms2-p2-sim.md
 * replaced (MS1 tables stay in docs/status/P6-headless.md as recorded) — a plain `pnpm bench`
 * (part of ci:local) never touches tracked files, so it neither contradicts the documented values
 * nor dirties the tree (build hash `<commit>-d<hash>`).
 *
 * Environment: FAF_BENCH_TICKS (1000), FAF_SPK1_TICKS (300), FAF_SPK1_RAMP (40), FAF_SPK5_REPS (10).
 */
import { existsSync, readFileSync } from 'node:fs';
import { jobKey, type Job, type JobResult } from '../src/jobs.ts';
import type { SeriesResult } from '../src/series.ts';
import { buildHarness, clearRaw, ENGINES, isoDate, machine, MAP_PATHS, nodeSeries, playwright, readRaw, RESULTS_DIR, STATUS_DOC, writeText } from './lib.ts';

const env = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const RIDGE = MAP_PATHS[0]!;
const JOBS: Job[] = [
  { kind: 'tickBench', ticks: env('FAF_BENCH_TICKS', 1000), map: RIDGE },
  { kind: 'tickBench', ticks: env('FAF_BENCH_TICKS', 1000) },
  { kind: 'spk1', ticks: env('FAF_SPK1_TICKS', 300), rampTicks: env('FAF_SPK1_RAMP', 40) },
  { kind: 'spk5', reps: env('FAF_SPK5_REPS', 10) },
];

/** Budgets (PLAN §3.4, §4, §5.2). */
/** MS3 (PLAN §5.2): 1,000 moving units with pathing, sim p95 ≤ 8 ms (MS2 was 2 ms without pathing). */
const BUDGET_TICK_P95_MS = 8;
/** Machine-dependent ms budgets gate only with FAF_PERF_GATE=1 (DECISIONS 16); otherwise reported. */
const PERF_GATE = process.env['FAF_PERF_GATE'] === '1';
const BUDGET_SPK1_P95_MS = 25;
const BUDGET_HASH_TICK_MS = 2;

type Kind = Job['kind'];
const results = new Map<string, SeriesResult>(); // `${engine}/${jobKey(job)}`
const RIDGE_KEY = jobKey(JOBS[0]!);
const problems: string[] = [];

console.log('» build harness');
buildHarness();

for (const job of JOBS) {
  console.log(`» node ${jobKey(job)}`);
  results.set(`node/${jobKey(job)}`, nodeSeries<SeriesResult>(job));
}

console.log('» playwright: chromium, firefox, webkit (sequential)');
clearRaw('bench-');
const pwCode = playwright('browser/bench.spec.ts', {
  FAF_BENCH_TICKS: String(env('FAF_BENCH_TICKS', 1000)),
  FAF_SPK1_TICKS: String(env('FAF_SPK1_TICKS', 300)),
  FAF_SPK1_RAMP: String(env('FAF_SPK1_RAMP', 40)),
  FAF_SPK5_REPS: String(env('FAF_SPK5_REPS', 10)),
});
if (pwCode !== 0) problems.push(`playwright exited with ${pwCode}`);
for (const engine of ENGINES.slice(1)) {
  for (const job of JOBS) {
    const r = readRaw<SeriesResult>(`bench-${engine}-${jobKey(job)}`);
    if (r === null) problems.push(`${engine} ${jobKey(job)}: no result`);
    else results.set(`${engine}/${jobKey(job)}`, r);
  }
}

// ---- formatting ----------------------------------------------------------------------------

const f = (v: number, d = 3): string => v.toFixed(d).replace('.', ',');
const ms = (v: number): string => (v >= 10 ? f(v, 1) : v >= 1 ? f(v, 2) : f(v, 3));

/** Result of a job (`key` = jobKey, default the kind) in one engine and JIT mode. */
function get<K extends Kind>(engine: string, kind: K, mode: 'cold' | 'warm', key: string = kind): Extract<JobResult, { kind: K }> | null {
  const s = results.get(`${engine}/${key}`);
  if (s === undefined) return null;
  const r = s[mode];
  return r.kind === kind ? (r as Extract<JobResult, { kind: K }>) : null;
}

function info(engine: string, key: string): string {
  const s = results.get(`${engine}/${key}`);
  return s === undefined ? '–' : `${f(s.engine.clockResolutionMs, 4)} ms`;
}

const rowsOf = (): { engine: string; mode: 'cold' | 'warm' }[] =>
  ENGINES.flatMap((engine) => (['cold', 'warm'] as const).map((mode) => ({ engine, mode })));

function maxOf(kind: Kind, pick: (r: JobResult) => number, key: string = kind): { value: number; where: string } {
  let best = { value: -1, where: '–' };
  for (const { engine, mode } of rowsOf()) {
    const r = get(engine, kind, mode, key);
    if (r === null) continue;
    const v = pick(r);
    if (v > best.value) best = { value: v, where: `${engine} ${mode === 'cold' ? 'kalt' : 'warm'}` };
  }
  return best;
}

const lines: string[] = [];
const push = (...l: string[]): void => void lines.push(...l);

// Tick benches (hollow-ridge = MS3 budget, test plane = MS1 reference)
function tickBenchTables(key: string, title: string): { value: number; where: string } {
  const tb0 = get('node', 'tickBench', 'warm', key);
  push(
    `### ${title} (1.000 fahrende Würfel, ${tb0?.ticks ?? '?'} gemessene Ticks)`,
    '',
    'Sim-Tick gesamt (`step` inkl. CommandApply und Hash-Tick) sowie Hash-Tick allein (nur Hash-Ticks, jeder 10.).',
    '',
    '| Engine | JIT | Reps | Uhr | p50 | p95 | p99 | max | Hash-Tick p95 | fahrend am Ende |',
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const { engine, mode } of rowsOf()) {
    const r = get(engine, 'tickBench', mode, key);
    if (r === null) continue;
    push(`| ${engine} | ${mode === 'cold' ? 'kalt' : 'warm'} | ${r.reps} | ${info(engine, key)} | ${ms(r.total.p50)} | **${ms(r.total.p95)}** | ${ms(r.total.p99)} | ${ms(r.total.max)} | ${ms(r.hashTick.p95)} | ${r.movingAtEnd}/${r.units} |`);
  }
  const phaseNames = tb0 === null ? [] : Object.keys(tb0.phases);
  push('', 'p95 je Phase (ms):', '', `| Engine | JIT | ${phaseNames.join(' | ')} | HashTick |`, `|---|---|${phaseNames.map(() => '---|').join('')}---|`);
  for (const { engine, mode } of rowsOf()) {
    const r = get(engine, 'tickBench', mode, key);
    if (r === null) continue;
    push(`| ${engine} | ${mode === 'cold' ? 'kalt' : 'warm'} | ${phaseNames.map((p) => ms(r.phases[p]?.p95 ?? 0)).join(' | ')} | ${ms(r.hashTick.p95)} |`);
  }
  const max = maxOf('tickBench', (r) => (r.kind === 'tickBench' ? r.total.p95 : 0), key);
  push('', `**Ziel:** p95 ≤ ${BUDGET_TICK_P95_MS} ms im langsamsten Engine-Worker inkl. Hash-Tick → gemessen max. p95 = **${ms(max.value)} ms** (${max.where}) ⇒ **${max.value >= 0 && max.value <= BUDGET_TICK_P95_MS ? 'erfüllt' : 'verfehlt'}**.`, '');
  return max;
}
const tickMax = tickBenchTables(RIDGE_KEY, 'Tick-Bench MS3 auf hollow-ridge (mit Pathing)');
const tickOk = tickMax.value >= 0 && tickMax.value <= BUDGET_TICK_P95_MS;
const planeMax = tickBenchTables('tickBench', 'Tick-Bench MS1-Referenz (Testebene)');
const planeOk = planeMax.value >= 0 && planeMax.value <= BUDGET_TICK_P95_MS;
if (!tickOk) {
  const msg = `MS3 tick budget missed on hollow-ridge: p95 ${ms(tickMax.value)} ms (${tickMax.where}) > ${BUDGET_TICK_P95_MS} ms`;
  if (PERF_GATE) problems.push(msg);
  else console.warn(`⚠ ${msg} (reported only; gate with FAF_PERF_GATE=1)`);
}

// SPK1
const s10 = get('node', 'spk1', 'warm');
const spkPhases = s10 === null ? [] : Object.keys(s10.phases);
push(
  `### SPK1 Sim-Durchsatz (1.000 Bodeneinheiten, 300 Flugzeuge, ≈ 4.000 Projektile; ${s10?.ticks ?? '?'} Ticks nach ${s10?.rampTicks ?? '?'} Ramp-Ticks)`,
  '',
  '| Engine | JIT | Reps | p50 | p95 | p99 | max | Projektile Ø (min) | Treffer/Kills gesamt |',
  '|---|---|---|---|---|---|---|---|---|',
);
for (const { engine, mode } of rowsOf()) {
  const r = get(engine, 'spk1', mode);
  if (r === null) continue;
  push(`| ${engine} | ${mode === 'cold' ? 'kalt' : 'warm'} | ${r.reps} | ${ms(r.total.p50)} | **${ms(r.total.p95)}** | ${ms(r.total.p99)} | ${ms(r.total.max)} | ${r.meanProjectiles} (${r.minProjectiles}) | ${r.counts.hits}/${r.counts.kills} |`);
}
push('', 'p95 je Teilsystem (ms):', '', `| Engine | JIT | ${spkPhases.join(' | ')} |`, `|---|---|${spkPhases.map(() => '---|').join('')}`);
for (const { engine, mode } of rowsOf()) {
  const r = get(engine, 'spk1', mode);
  if (r === null) continue;
  push(`| ${engine} | ${mode === 'cold' ? 'kalt' : 'warm'} | ${spkPhases.map((p) => ms(r.phases[p]?.p95 ?? 0)).join(' | ')} |`);
}
const spkMax = maxOf('spk1', (r) => (r.kind === 'spk1' ? r.total.p95 : 0));
const spkOk = spkMax.value >= 0 && spkMax.value <= BUDGET_SPK1_P95_MS;
const hashes = new Set(ENGINES.flatMap((e) => (['cold', 'warm'] as const).map((m) => get(e, 'spk1', m)?.finalHash).filter((h): h is string => h !== undefined)));
push(
  '',
  `**Exit SPK1 (§4):** p95 ≤ ${BUDGET_SPK1_P95_MS} ms in der langsamsten Engine inkl. Hash-Tick → gemessen max. p95 = **${ms(spkMax.value)} ms** (${spkMax.where}) ⇒ ` +
    (spkOk
      ? '**erfüllt – alles bleibt TypeScript** (Rust/WASM-Ausweg aus DECISIONS Punkt 2 wird nicht gezogen).'
      : '**verfehlt – Rust/WASM-Ausweg (DECISIONS Punkt 2)**: Movement, Projectiles und Targeting ab MS1 in Rust/WASM auf derselben Arena.'),
  `End-Hash des SPK1-Laufs in allen Engines/Modi: ${[...hashes].join(', ')} (${hashes.size === 1 ? 'identisch' : 'NICHT identisch'}).`,
  '',
);
if (hashes.size > 1) problems.push(`SPK1 final hashes differ between engines: ${[...hashes].join(', ')}`);

// SPK5
push(
  '### SPK5 Hash & Snapshot (Arena 20 MiB `WebAssembly.Memory`, warm)',
  '',
  '| Engine | JS==WASM (20 MiB / Live / 400 Zufallsbereiche) | xxh32 JS 20 MiB | xxh32 WASM 20 MiB | Live-Bytes | Sim-Regel-Hash p95 (Hash-Tick) | kalt p95 | JS Live p95 | WASM Live p95 |',
  '|---|---|---|---|---|---|---|---|---|',
);
for (const engine of ENGINES) {
  const r = get(engine, 'spk5', 'warm');
  if (r === null) continue;
  const eq = `${r.equality.full20MB ? 'ja' : 'NEIN'} / ${r.equality.liveRange ? 'ja' : 'NEIN'} / ${r.equality.randomRanges.mismatches === 0 ? 'ja' : `NEIN (${r.equality.randomRanges.mismatches})`}`;
  push(`| ${engine} | ${eq} | ${ms(r.full20MB.js.p50)} ms (${f(r.full20MB.jsGBps, 2)} GB/s) | ${ms(r.full20MB.wasm.p50)} ms (${f(r.full20MB.wasmGBps, 2)} GB/s) | ${r.live.bytes} | **${ms(r.live.simRuleHash.p95)} ms** | ${ms(get(engine, 'spk5', 'cold')?.live.simRuleHash.p95 ?? 0)} ms | ${ms(r.live.jsContiguous.p95)} ms | ${ms(r.live.wasmContiguous.p95)} ms |`);
  if (!r.equality.full20MB || !r.equality.liveRange || r.equality.randomRanges.mismatches !== 0) problems.push(`${engine}: JS xxh32 != WASM xxh32`);
}
push('', '| Engine | Snapshot 20 MiB p50 (Arena → Puffer) | Restore 20 MiB p50 (Puffer → Arena) | Sim-Snapshot (Bytes) p95 | Sim-Restore p95 | Keyframe deflate-raw (Bytes → Bytes, Ratio) | deflate p50 | inflate p50 | 20 MiB Zufall deflate p50 (Ratio) |', '|---|---|---|---|---|---|---|---|---|');
for (const engine of ENGINES) {
  const r = get(engine, 'spk5', 'warm');
  if (r === null) continue;
  const k = r.keyframe.sim;
  push(
    `| ${engine} | ${ms(r.snapshot.arena20MB.snapshot.p50)} ms | ${ms(r.snapshot.arena20MB.restore.p50)} ms | ${ms(r.snapshot.sim.snapshot.p95)} ms (${r.snapshot.sim.bytes}) | ${ms(r.snapshot.sim.restore.p95)} ms | ${k.bytes} → ${k.compressedBytes} (${f(k.ratio, 1)}:1${k.roundtrip ? '' : ', Roundtrip FEHLER'}) | ${ms(k.deflate.p50)} ms | ${ms(k.inflate.p50)} ms | ${ms(r.keyframe.random20MB.deflate.p50)} ms (${f(r.keyframe.random20MB.ratio, 2)}:1) |`,
  );
}
const hashMax = maxOf('spk5', (r) => (r.kind === 'spk5' ? r.live.simRuleHash.p95 : 0));
const tbHashRidge = maxOf('tickBench', (r) => (r.kind === 'tickBench' ? r.hashTick.p95 : 0), RIDGE_KEY);
const tbHashPlane = maxOf('tickBench', (r) => (r.kind === 'tickBench' ? r.hashTick.p95 : 0));
const tbHashMax = tbHashRidge.value >= tbHashPlane.value ? tbHashRidge : tbHashPlane;
const worstHash = Math.max(hashMax.value, tbHashMax.value);
const hashOk = worstHash >= 0 && worstHash <= BUDGET_HASH_TICK_MS;
push(
  '',
  `**Exit SPK5 (§4):** Hash-Tick ≤ ${BUDGET_HASH_TICK_MS} ms in der langsamsten Engine → gemessen max. p95 = **${ms(worstHash)} ms** (SPK5-Live-Hash: ${ms(hashMax.value)} ms, ${hashMax.where}; Tick-Bench-Hash-Tick: ${ms(tbHashMax.value)} ms, ${tbHashMax.where}) ⇒ ` +
    (hashOk ? '**erfüllt – Live-Bereich-Hash bleibt in JS** (kein Rolling-Hash, kein WASM nötig).' : '**verfehlt – Rolling-Hash (1/10 der Tabellen pro Tick) oder WASM-Hash einführen.**'),
  '',
);

const summaryTable = [
  '| Kriterium | Budget | gemessen (max. über Engines, kalt/warm) | Ergebnis |',
  '|---|---|---|---|',
  `| MS3 Sim-Tick p95, 1.000 fahrende Würfel mit Pathing auf hollow-ridge, inkl. Hash-Tick | ≤ ${BUDGET_TICK_P95_MS} ms | ${ms(tickMax.value)} ms (${tickMax.where}) | ${tickOk ? 'erfüllt' : 'verfehlt'} |`,
  `| MS1 Sim-Tick p95 (Testebene, Referenz) | ≤ ${BUDGET_TICK_P95_MS} ms | ${ms(planeMax.value)} ms (${planeMax.where}) | ${planeOk ? 'erfüllt' : 'verfehlt'} |`,
  `| SPK1 Big-Battle-Prototyp p95 | ≤ ${BUDGET_SPK1_P95_MS} ms | ${ms(spkMax.value)} ms (${spkMax.where}) | ${spkOk ? 'erfüllt → TS' : 'verfehlt → Rust/WASM'} |`,
  `| SPK5 Hash-Tick (Live-Bereich, 1.000 Units) p95 | ≤ ${BUDGET_HASH_TICK_MS} ms | ${ms(worstHash)} ms | ${hashOk ? 'erfüllt → JS-Hash' : 'verfehlt → Rolling/WASM'} |`,
];

const date = isoDate();
const header = [
  `Letzter Lauf: ${date}, \`pnpm --filter @faf/headless bench\`. **Lokal gemessen (${machine()}), nicht Referenz-Laptop.**`,
  `Node ${process.version}; Browser: Playwright-Builds (headless) von Chromium, Firefox, WebKit, Module-Worker, crossOriginIsolated.`,
  'JIT kalt = erster Lauf im frischen Worker bzw. Node-Prozess, warm = Lauf nach 3 Aufwärmläufen im selben Worker.',
  'Reps > 1: Engine-Uhr zu grob (WebKit 1 ms) → jeder Tick wird per Arena-Snapshot/Restore mehrfach ausgeführt und gemittelt (Restore-Kosten abgezogen).',
  '',
  ...summaryTable,
  '',
];
const markdown = [...header, ...lines].join('\n');

const report = {
  format: 'faf-bench-report',
  version: 1,
  date: new Date().toISOString(),
  machine: `${machine()} (lokal gemessen, nicht Referenz-Laptop)`,
  node: process.version,
  jobs: JOBS,
  budgets: { tickP95Ms: BUDGET_TICK_P95_MS, spk1P95Ms: BUDGET_SPK1_P95_MS, hashTickMs: BUDGET_HASH_TICK_MS },
  decisions: {
    ms2TickRidge: { maxP95Ms: tickMax.value, where: tickMax.where, ok: tickOk },
    ms1TickPlane: { maxP95Ms: planeMax.value, where: planeMax.where, ok: planeOk },
    spk1: { maxP95Ms: spkMax.value, where: spkMax.where, ok: spkOk, decision: spkOk ? 'typescript' : 'rust-wasm' },
    spk5: { maxHashTickMs: worstHash, ok: hashOk, decision: hashOk ? 'js-live-range-hash' : 'rolling-or-wasm-hash' },
  },
  problems,
  series: Object.fromEntries(results),
};
const file = `${RESULTS_DIR}/bench-${date}.json`;
writeText(file, JSON.stringify(report, null, 2) + '\n');

// Status fragment (only on request): replace the block between the markers (the rest is prose).
const BEGIN = '<!-- bench:begin -->';
const END = '<!-- bench:end -->';
const updateDocs = process.argv.includes('--update-docs') || process.env['FAF_BENCH_UPDATE_DOCS'] === '1';
if (!updateDocs) {
  console.log(markdown);
  console.log(`\n(results in ${file}; status tables unchanged — run with --update-docs to replace them)`);
} else if (existsSync(STATUS_DOC)) {
  const doc = readFileSync(STATUS_DOC, 'utf8');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a >= 0 && b > a) {
    writeText(STATUS_DOC, doc.slice(0, a + BEGIN.length) + '\n' + markdown + '\n' + doc.slice(b));
    console.log(`status tables updated: ${STATUS_DOC}`);
  } else {
    console.warn(`markers ${BEGIN}/${END} not found in ${STATUS_DOC}; tables only in ${file}`);
  }
}

console.log('\n' + summaryTable.join('\n'));
console.log(`\nreport: ${file}`);
if (problems.length > 0) {
  console.error(`\n✗ bench problems:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
