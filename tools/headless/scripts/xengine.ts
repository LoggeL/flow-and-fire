/**
 * L3 cross-engine check (script `test:xengine`): builds the harness, runs every golden scenario
 * (test plane and hollow-ridge; the map bytes reach the browser workers as Vite assets) in
 * Node (fresh process) and in Chromium/Firefox/WebKit module workers, each JIT cold and warm, and
 * compares every hash chain and replay with the goldens, including backward seek. Report: results/xengine-<date>.json.
 * Exit code ≠ 0 on any divergence (the first divergent tick is printed).
 */
import { readRtsReplay } from '@faf/formats';
import { requestBurstProblems, type RequestBurstResult } from '../src/ms3/request-burst.ts';
import { compareChains, type Golden } from '../src/goldens.ts';
import type { HashChainResult, JobResult } from '../src/jobs.ts';
import { SCENARIO_NAMES } from '../src/scenarios.ts';
import type { EngineInfo } from '../src/stats.ts';
import type { ReplayVerifyJobResult } from '../src/replay/xengine-job.ts';
import type { SeriesResult } from '../src/series.ts';
import { BROWSERS, buildHarness, clearRaw, isoDate, machine, nodeSeries, playwright, loadReplays, REPLAY_PATHS, readGolden, readRaw, RESULTS_DIR, writeText } from './lib.ts';

interface Row {
  engine: string;
  userAgent: string;
  crossOriginIsolated: boolean;
  scenario: string;
  mode: string;
  equal: boolean;
  firstDivergentTick: number | null;
  detail: string;
  ms: number | null;
  failedAsserts: number;
}

const rows: Row[] = [];
const problems: string[] = [];

function check(series: SeriesResult | null, engine: string, scenario: string, golden: Golden): void {
  if (series === null) {
    problems.push(`${engine} ${scenario}: no result`);
    rows.push({ engine, userAgent: '', crossOriginIsolated: false, scenario, mode: 'missing', equal: false, firstDivergentTick: null, detail: 'no result', ms: null, failedAsserts: 0 });
    return;
  }
  const runs: [string, HashChainResult | null, HashChainResult['chain']][] = [];
  for (const [mode, r] of [['cold', series.cold], ['warm', series.warm]] as const) {
    if (r.kind !== 'hashChain') throw new Error(`unexpected result kind ${r.kind}`);
    runs.push([mode, r, r.chain]);
  }
  series.warmupChains.forEach((c, i) => runs.push([`warmup${i + 1}`, null, c]));
  for (const [mode, r, chain] of runs) {
    const d = compareChains(golden, chain);
    const failed = r?.failedAsserts.length ?? 0;
    rows.push({
      engine,
      userAgent: series.engine.userAgent,
      crossOriginIsolated: series.engine.crossOriginIsolated,
      scenario,
      mode,
      equal: d.equal,
      firstDivergentTick: d.firstDivergentTick,
      detail: d.detail,
      ms: r?.ms ?? null,
      failedAsserts: failed,
    });
    if (!d.equal) problems.push(`${engine} ${scenario} ${mode}: first divergent tick ${d.firstDivergentTick} (${d.detail})`);
    if (failed > 0) problems.push(`${engine} ${scenario} ${mode}: ${failed} scenario asserts failed`);
  }
}

const goldens = new Map<string, Golden>();
for (const s of SCENARIO_NAMES) {
  const g = readGolden(s);
  if (g === null) throw new Error(`missing golden for ${s} (run: pnpm --filter @faf/headless goldens -- --update)`);
  goldens.set(s, g);
}


interface ReplayRow extends ReplayVerifyJobResult { readonly engine: EngineInfo; readonly replay: string; readonly mode: string; readonly equal: boolean; }
interface BurstRow extends RequestBurstResult { readonly engine: EngineInfo; readonly mode: string; readonly errors: readonly string[]; }
const replayRows: ReplayRow[] = [];
const burstRows: BurstRow[] = [];
const replayAssets = loadReplays();
function checkReplay(series: SeriesResult | null, engine: string, replay: string): void {
  if (series === null) { problems.push(`${engine} ${replay}: no result`); return; }
  const scenario = replay.slice(replay.lastIndexOf('/') + 1).replace(/\.rtsreplay$/, '');
  const golden = goldens.get(scenario)!;
  const recorded = readRtsReplay(replayAssets[replay]!);
  if (series.warmupResults.length !== 3) problems.push(`${engine} ${replay}: missing warm-up results`);
  const runs: (readonly [string, JobResult])[] = [['cold', series.cold], ...series.warmupResults.map((r, i) => [`warmup${i + 1}`, r] as const), ['warm', series.warm]];
  for (const [mode, r] of runs) {
    if (r.kind !== 'replayVerify') throw new Error('unexpected replay result kind');
    const d = compareChains(golden, { ...r, scenario });
    const recordedTrail = Array.from(recorded.hashes.hashes, (h) => `0x${h.toString(16).padStart(8, '0')}`);
    const equal = d.equal && r.divergences.length === 0 && r.compared === golden.trail.length && r.seekFullHash === r.finalFullHash && JSON.stringify(r.trail) === JSON.stringify(recordedTrail);
    replayRows.push({ engine: series.engine, replay, mode, equal, ...r });
    if (!equal) problems.push(`${engine} replay ${scenario} ${mode}: ${d.detail}, divergences=${r.divergences.length}, seek=${r.seekFullHash}`);
  }
}
function checkBurst(series: SeriesResult | null, engine: string, size: number): void {
  if (series === null) { problems.push(`${engine} burst ${size}: no result`); return; }
  if (series.warmupResults.length !== 3) problems.push(`${engine} burst ${size}: missing warm-up results`);
  for (const [mode, r] of [['cold', series.cold], ['warm', series.warm]] as const) {
    if (r.kind !== 'requestBurst') throw new Error('unexpected burst result kind');
    const errors = requestBurstProblems(r, process.env['FAF_PERF_GATE'] === '1');
    problems.push(...errors.map((e) => `${engine}/${mode}: ${e}`));
    burstRows.push({ engine: series.engine, mode, ...r, errors });
  }
  for (const r of series.warmupResults) {
    if (r.kind !== 'requestBurst') throw new Error('unexpected burst warmup kind');
    problems.push(...requestBurstProblems(r).map((e) => `${engine}/warmup: ${e}`));
  }
}
console.log('» build harness');
buildHarness();

console.log('» node (V8) reference, fresh process per scenario');
for (const s of SCENARIO_NAMES) check(nodeSeries<SeriesResult>({ kind: 'hashChain', scenario: s }), 'node', s, goldens.get(s)!);

for (const replay of REPLAY_PATHS) checkReplay(nodeSeries<SeriesResult>({ kind: 'replayVerify', replay }), 'node', replay);
for (const size of [512, 1024]) checkBurst(nodeSeries<SeriesResult>({ kind: 'requestBurst', size }), 'node', size);

console.log('» playwright: chromium, firefox, webkit (sequential)');
clearRaw('xengine-');
clearRaw('burst-');
const pwCode = playwright('browser/xengine.spec.ts');
for (const engine of BROWSERS) {
  for (const s of SCENARIO_NAMES) check(readRaw<SeriesResult>(`xengine-${engine}-${s}`), engine, s, goldens.get(s)!);
}
const burstCode = playwright('browser/request-burst.spec.ts');
for (const engine of BROWSERS) {
  for (const replay of REPLAY_PATHS) {
    const scenario = replay.slice(replay.lastIndexOf('/') + 1).replace(/\.rtsreplay$/, '');
    checkReplay(readRaw<SeriesResult>(`xengine-${engine}-replay-${scenario}`), engine, replay);
  }
  for (const size of [512, 1024]) checkBurst(readRaw<SeriesResult>(`burst-${engine}-${size}`), engine, size);
}
if (burstCode !== 0) problems.push(`burst playwright exited with ${burstCode}`);
if (pwCode !== 0) problems.push(`playwright exited with ${pwCode}`);

const ok = problems.length === 0;
const report = {
  format: 'faf-xengine-report',
  version: 2,
  date: new Date().toISOString(),
  machine: `${machine()} (lokal gemessen, nicht Referenz-Laptop)`,
  node: process.version,
  ticks: 2000,
  ticksByScenario: Object.fromEntries([...goldens].map(([name, g]) => [name, g.ticks])),
  goldens: Object.fromEntries([...goldens].map(([k, g]) => [k, { trail: g.trail.length, finalRuleHash: g.finalRuleHash, finalFullHash: g.finalFullHash, simHash: g.simHash, layoutHash: g.layoutHash }])),
  ok,
  problems,
  results: rows,
  replays: replayRows,
  requestBursts: burstRows,
  perfGate: process.env['FAF_PERF_GATE'] === '1',
};
const file = `${RESULTS_DIR}/xengine-${isoDate()}.json`;
writeText(file, JSON.stringify(report, null, 2) + '\n');

console.log('\nengine    scenario          mode     result');
for (const r of rows) {
  const res = r.equal ? 'bitgleich' : `ABWEICHUNG ab Tick ${r.firstDivergentTick}`;
  console.log(`${r.engine.padEnd(9)} ${r.scenario.padEnd(17)} ${r.mode.padEnd(8)} ${res}${r.ms !== null ? ` (${r.ms.toFixed(0)} ms)` : ''}`);
}
console.log('\nengine    replay                     mode     hashes + seek');
for (const r of replayRows) if (r.mode === 'cold' || r.mode === 'warm') {
  const name = r.replay.slice(r.replay.lastIndexOf('/') + 1).replace(/\.rtsreplay$/, '');
  console.log(`${r.engine.engine.padEnd(9)} ${name.padEnd(26)} ${r.mode.padEnd(8)} ${r.equal ? 'bitgleich' : 'ABWEICHUNG'} (${r.ms.toFixed(0)} ms)`);
}
console.log('\nengine    WU    mode     Ready/ticks   group   PathService p95 ms');
for (const r of burstRows) console.log(`${r.engine.engine.padEnd(9)} ${String(r.size).padEnd(5)} ${r.mode.padEnd(8)} ${`${r.ready}/${r.ticks}`.padEnd(13)} ${r.groupRequests50}       ${r.phaseMs.p95}`);
console.log(`\nreplay results: ${replayRows.length} verified runs; burst results: ${burstRows.length} cold/warm runs (details in JSON)`);
console.log(`\nreport: ${file}`);
if (!ok) {
  console.error(`\n✗ cross-engine check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${rows.length} hash chains (${SCENARIO_NAMES.length} scenarios × 4 engines × cold/warm/3 warm-ups) equal the goldens`);
