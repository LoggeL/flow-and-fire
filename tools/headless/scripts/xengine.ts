/**
 * L3 cross-engine check (script `test:xengine`): builds the harness, runs both golden scenarios in
 * Node (fresh process) and in Chromium/Firefox/WebKit module workers, each JIT cold and warm, and
 * compares every hash chain (2,000 ticks) with the goldens. Report: results/xengine-<date>.json.
 * Exit code ≠ 0 on any divergence (the first divergent tick is printed).
 */
import { compareChains, type Golden } from '../src/goldens.ts';
import type { HashChainResult } from '../src/jobs.ts';
import { SCENARIO_NAMES } from '../src/scenarios.ts';
import type { SeriesResult } from '../src/series.ts';
import { BROWSERS, buildHarness, clearRaw, isoDate, machine, nodeSeries, playwright, readGolden, readRaw, RESULTS_DIR, writeText } from './lib.ts';

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

console.log('» build harness');
buildHarness();

console.log('» node (V8) reference, fresh process per scenario');
for (const s of SCENARIO_NAMES) check(nodeSeries<SeriesResult>({ kind: 'hashChain', scenario: s }), 'node', s, goldens.get(s)!);

console.log('» playwright: chromium, firefox, webkit (sequential)');
clearRaw('xengine-');
const pwCode = playwright('browser/xengine.spec.ts');
for (const engine of BROWSERS) {
  for (const s of SCENARIO_NAMES) check(readRaw<SeriesResult>(`xengine-${engine}-${s}`), engine, s, goldens.get(s)!);
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
  ok,
  problems,
  results: rows,
};
const file = `${RESULTS_DIR}/xengine-${isoDate()}.json`;
writeText(file, JSON.stringify(report, null, 2) + '\n');

console.log('\nengine    scenario          mode     result');
for (const r of rows) {
  const res = r.equal ? 'bitgleich' : `ABWEICHUNG ab Tick ${r.firstDivergentTick}`;
  console.log(`${r.engine.padEnd(9)} ${r.scenario.padEnd(17)} ${r.mode.padEnd(8)} ${res}${r.ms !== null ? ` (${r.ms.toFixed(0)} ms)` : ''}`);
}
console.log(`\nreport: ${file}`);
if (!ok) {
  console.error(`\n✗ cross-engine check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${rows.length} hash chains (2 scenarios × 4 engines × cold/warm/3 warm-ups) equal the goldens`);
