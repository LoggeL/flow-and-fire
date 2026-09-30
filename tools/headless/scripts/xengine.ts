/**
 * L3 cross-engine check (script `test:xengine`): builds the harness, runs every golden scenario
 * (test plane and hollow-ridge; the map bytes reach the browser workers as Vite assets) in
 * Node (fresh process) and in Chromium/Firefox/WebKit module workers, each JIT cold and warm, and
 * compares every hash chain (2,000 ticks) with the goldens. Then every golden replay
 * (test/golden-replays/*.rtsreplay, TRACK-REPLAY p6) is played in the same engines (Node fresh
 * process, browser module workers; cold, 3 warm-ups, warm): keyframes on, hash + sub-hash check,
 * backward seek to the middle and replay to the end. Each run's rule-hash trail must equal the
 * HASH chunk and the golden JSON, its final hashes the golden's, and the full hash after the seek
 * the one of the first pass. Report: results/xengine-<date>.json. Exit code ≠ 0 on any divergence
 * (the first divergent tick is printed).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readRtsReplay } from '@faf/formats';
import { compareChains, type Golden } from '../src/goldens.ts';
import type { HashChainResult, ReplayVerifyResultOfJob } from '../src/jobs.ts';
import { checkReplayJobResult, recordedTrail, scenarioOfReplayPath } from '../src/replay/xengine-job.ts';
import { SCENARIO_NAMES } from '../src/scenarios.ts';
import type { SeriesResult } from '../src/series.ts';
import { BROWSERS, buildHarness, clearRaw, isoDate, machine, nodeSeries, playwright, readGolden, readRaw, REPLAY_PATHS, REPO_DIR, RESULTS_DIR, writeText } from './lib.ts';

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

interface ReplayRow {
  engine: string;
  userAgent: string;
  crossOriginIsolated: boolean;
  replay: string;
  scenario: string;
  mode: string;
  equal: boolean;
  firstDivergentTick: number | null;
  detail: string;
  ms: number | null;
  seekMs: number | null;
  compared: number;
  subCompared: number;
  finalRuleHash: string;
  finalFullHash: string;
  seekTick: number;
  seekFullHash: string;
  restores: number;
}

const replayRows: ReplayRow[] = [];

interface RecordedReplay {
  readonly firstTick: number;
  readonly interval: number;
  readonly trail: readonly string[];
  readonly bytes: number;
}

function checkReplay(series: SeriesResult | null, engine: string, path: string, recorded: RecordedReplay, golden: Golden): void {
  const scenario = scenarioOfReplayPath(path);
  const base = { engine, replay: path, scenario, compared: 0, subCompared: 0, finalRuleHash: '', finalFullHash: '', seekTick: 0, seekFullHash: '', restores: 0, seekMs: null };
  if (series === null) {
    problems.push(`${engine} replay ${scenario}: no result`);
    replayRows.push({ ...base, userAgent: '', crossOriginIsolated: false, mode: 'missing', equal: false, firstDivergentTick: null, detail: 'no result', ms: null });
    return;
  }
  const runs: [string, ReplayVerifyResultOfJob][] = [];
  for (const [mode, r] of [['cold', series.cold], ['warm', series.warm]] as const) {
    if (r.kind !== 'replayVerify') throw new Error(`unexpected result kind ${r.kind}`);
    runs.push([mode, r]);
  }
  const warmups = series.warmupReplays;
  if (warmups.length !== 3) problems.push(`${engine} replay ${scenario}: ${warmups.length} warm-up results (expected 3)`);
  warmups.forEach((r, i) => runs.push([`warmup${i + 1}`, r]));
  for (const [mode, r] of runs) {
    const c = checkReplayJobResult(r, recorded, golden);
    replayRows.push({
      ...base,
      userAgent: series.engine.userAgent,
      crossOriginIsolated: series.engine.crossOriginIsolated,
      mode,
      equal: c.equal,
      firstDivergentTick: c.firstDivergentTick,
      detail: c.equal ? `${r.trail.length} trail hashes = HASH chunk = golden, ${r.subCompared} sub-hash rows, seek ${r.seekTick} → end equal` : c.problems.join('; '),
      ms: r.ms,
      seekMs: r.seekMs,
      compared: r.compared,
      subCompared: r.subCompared,
      finalRuleHash: r.finalRuleHash,
      finalFullHash: r.finalFullHash,
      seekTick: r.seekTick,
      seekFullHash: r.seekFullHash,
      restores: r.restores,
    });
    if (!c.equal) problems.push(`${engine} replay ${scenario} ${mode}: first divergent tick ${c.firstDivergentTick ?? '–'} (${c.problems.join('; ')})`);
  }
}

const goldens = new Map<string, Golden>();
for (const s of SCENARIO_NAMES) {
  const g = readGolden(s);
  if (g === null) throw new Error(`missing golden for ${s} (run: pnpm --filter @faf/headless goldens -- --update)`);
  goldens.set(s, g);
}

// Golden replays: expected trail from the HASH chunk (and the golden JSON of the scenario).
const recordedReplays = new Map<string, RecordedReplay>();
for (const p of REPLAY_PATHS) {
  const scenario = scenarioOfReplayPath(p);
  if (!goldens.has(scenario)) throw new Error(`golden replay ${p} has no golden JSON`);
  const bytes = new Uint8Array(readFileSync(resolve(REPO_DIR, p)));
  const r = readRtsReplay(bytes);
  recordedReplays.set(p, { firstTick: r.hashes.firstTick, interval: r.hashes.interval, trail: recordedTrail(r), bytes: bytes.length });
}

console.log('» build harness');
buildHarness();

console.log('» node (V8) reference, fresh process per scenario');
for (const s of SCENARIO_NAMES) check(nodeSeries<SeriesResult>({ kind: 'hashChain', scenario: s }), 'node', s, goldens.get(s)!);
console.log('» node (V8) golden replays, fresh process per replay');
for (const p of REPLAY_PATHS) {
  checkReplay(nodeSeries<SeriesResult>({ kind: 'replayVerify', replay: p }), 'node', p, recordedReplays.get(p)!, goldens.get(scenarioOfReplayPath(p))!);
}

console.log('» playwright: chromium, firefox, webkit (sequential)');
clearRaw('xengine-');
const pwCode = playwright('browser/xengine.spec.ts');
for (const engine of BROWSERS) {
  for (const s of SCENARIO_NAMES) check(readRaw<SeriesResult>(`xengine-${engine}-${s}`), engine, s, goldens.get(s)!);
  for (const p of REPLAY_PATHS) {
    const sc = scenarioOfReplayPath(p);
    checkReplay(readRaw<SeriesResult>(`xengine-${engine}-replay-${sc}`), engine, p, recordedReplays.get(p)!, goldens.get(sc)!);
  }
}
if (pwCode !== 0) problems.push(`playwright exited with ${pwCode}`);

const ok = problems.length === 0;
const report = {
  format: 'faf-xengine-report',
  version: 1,
  date: new Date().toISOString(),
  machine: `${machine()} (lokal gemessen, nicht Referenz-Laptop)`,
  node: process.version,
  ticks: 2000,
  goldens: Object.fromEntries([...goldens].map(([k, g]) => [k, { trail: g.trail.length, finalRuleHash: g.finalRuleHash, finalFullHash: g.finalFullHash, simHash: g.simHash, layoutHash: g.layoutHash }])),
  replays: Object.fromEntries([...recordedReplays].map(([k, r]) => [k, { bytes: r.bytes, hashes: r.trail.length, firstTick: r.firstTick, interval: r.interval }])),
  ok,
  problems,
  results: rows,
  replayResults: replayRows,
};
const file = `${RESULTS_DIR}/xengine-${isoDate()}.json`;
writeText(file, JSON.stringify(report, null, 2) + '\n');

console.log('\nengine    scenario          mode     result');
for (const r of rows) {
  const res = r.equal ? 'bitgleich' : `ABWEICHUNG ab Tick ${r.firstDivergentTick}`;
  console.log(`${r.engine.padEnd(9)} ${r.scenario.padEnd(17)} ${r.mode.padEnd(8)} ${res}${r.ms !== null ? ` (${r.ms.toFixed(0)} ms)` : ''}`);
}
console.log('\nengine    replay              mode     result');
for (const r of replayRows) {
  const res = r.equal ? `bitgleich (Seek ${r.seekTick} → Ende gleich)` : `ABWEICHUNG ab Tick ${r.firstDivergentTick ?? '–'}: ${r.detail}`;
  const t = r.ms !== null ? ` (${r.ms.toFixed(0)} ms, Seek+Rest ${r.seekMs?.toFixed(0) ?? '–'} ms)` : '';
  console.log(`${r.engine.padEnd(9)} ${r.scenario.padEnd(19)} ${r.mode.padEnd(8)} ${res}${t}`);
}
console.log(`\nreport: ${file}`);
if (!ok) {
  console.error(`\n✗ cross-engine check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${rows.length} hash chains (${SCENARIO_NAMES.length} scenarios × 4 engines × cold/warm/3 warm-ups) equal the goldens`);
console.log(`✓ ${replayRows.length} replay runs (${REPLAY_PATHS.length} golden replays × 4 engines × cold/warm/3 warm-ups) equal HASH chunk + goldens, incl. backward seek`);
