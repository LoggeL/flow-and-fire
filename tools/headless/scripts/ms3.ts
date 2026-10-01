/** MS3 acceptance on the actual sim and sequential browser-worker harness. */
import { readFileSync, readdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { mapSimData, readRtsMap, type RtsMap } from '@faf/formats';
import { encodeCheatSpawn, encodeMove, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, step, unitHandles, unitInfo, pathStats, unitClass, type World } from '@faf/sim';
import { endpoints, requestBurst as runRequestBurst, requestBurstProblems } from '../src/ms3/request-burst.ts';
import { navTestRtsMap } from '../src/maps.ts';
import { runScenario, failedAsserts } from '../src/scenario.ts';
import { scenarioByName } from '../src/scenarios.ts';
import { summarize } from '../src/stats.ts';
import type { SeriesResult } from '../src/series.ts';
import { bin, buildHarness, clearRaw, HEADLESS_DIR, isoDate, loadMaps, loadSimBin, machine, nodeSeries, readRaw, REPO_DIR, RESULTS_DIR, run, writeText } from './lib.ts';

const raw = 4096;
const table = loadSimBin();
let sequence = 1;
export function envelope(op: Op, units: readonly Handle[], payload: Uint8Array, army = 0): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq: (sequence++ % 65535) + 1, op, flags: 0, units, payload };
}
export function move(handles: readonly Handle[], x: number, z: number, army = 0): CommandEnvelope { return envelope(Op.Move, handles, encodeMove({ x: fx(x), y: fx(0), z: fx(z) }), army); }
export function spawn(w: World, bp: number, x: number, z: number, army = 0): CommandEnvelope { return envelope(Op.Cheat, [], encodeCheatSpawn({ bp, army, count: 1, x: fx(x), z: fx(z), spread: fx(0) }), army); }
export function world(map: RtsMap, seed = 73): World { return createWorld({ simBin: table, map: mapSimData(map), seed, armyCount: 2 }); }
export const distribution = (values: readonly number[]) => summarize(Float64Array.from(values));

export function requestBurst(size: 512 | 1024) { return runRequestBurst(size, table, () => performance.now()); }
export { endpoints };

/** 200 mixed classes across a map, measuring first position change and arrival with real steering. */
function traversal(map: RtsMap, quick: boolean) {
  const w = world(map);
  const req = endpoints(w);
  const bps = ['core:lnd_t1_tank', 'core:lnd_t2_tank', 'core:lnd_t3_heavy'].map((id) => w.bp.indexOf(id));
  step(w, req.map((p) => spawn(w, bps[p.cls - 1]!, p.sx, p.sz)));
  const hs = unitHandles(w); const initial = hs.map((h) => unitInfo(w, h)!);
  const started = new Int32Array(hs.length).fill(-1); const stalled = new Uint8Array(hs.length);
  const reached = new Uint8Array(hs.length);
  const limit = quick ? 8000 : 16000;
  let blocked = 0; let ticks = 0;
  for (; ticks < limit; ticks++) {
    step(w, ticks === 0 ? hs.map((h, i) => move([h], req[i]!.tx, req[i]!.tz)) : null);
    const U = w.units.col; const M = w.movers.col;
    for (let i = 0; i < hs.length; i++) {
      const slot = w.units.resolve(hs[i]!); const row = U.mover[slot]!;
      const x = U.x[slot]!; const z = U.z[slot]!;
      if (started[i]! < 0 && (x !== initial[i]!.x || z !== initial[i]!.z)) started[i] = ticks + 1;
      if (w.navClear[((z >> 12) << w.navShift) | (x >> 12)]! < unitClass(w, slot)) blocked++;
      if (M.stuck[row]! > 30) stalled[i] = 1;
      if (Math.hypot(x / raw - req[i]!.tx, z / raw - req[i]!.tz) <= 2) reached[i] = 1;
    }
    if (reached.every((v) => v === 1)) break;
  }
  const arrived = Array.from(reached).filter((v) => v === 1).length;
  return { map: map.meta.name, size: w.mapSizeWu, units: hs.length, ticks, firstMoveTicks: distribution(Array.from(started)), notStarted: Array.from(started).filter((v) => v < 0).length, arrived, arrivalRate: arrived / hs.length, stalledOver30: Array.from(stalled).filter((v) => v === 1).length, blocked, ...pathStats(w) };
}

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick'); const update = process.argv.includes('--update-docs');
  const problems: string[] = [];
  const functional = [];
  for (const name of ['ridge-group-offset', 'ridge-shift-queue', 'choke-3wu', 'obstacle-repath']) {
    console.log(`MS3 acceptance: ${name}`);
    const t = performance.now(); const result = runScenario(scenarioByName(name), { simBin: table, maps: loadMaps() });
    const failures = failedAsserts(result); for (const failure of failures) problems.push(`${name}: ${JSON.stringify(failure)}`);
    functional.push({ name, ticks: result.ticks, units: result.finalUnitCount, assertions: result.asserts.length, failures, ms: performance.now() - t, finalHash: result.finalRuleHash });
    globalThis.gc?.();
  }
  const bursts = [requestBurst(512), requestBurst(1024)];
  for (const r of bursts) if (r.units !== 200 || r.ready !== 200 || r.requests !== 200 || r.groupRequests50 !== 1 || r.ticks > 10) problems.push(`burst ${r.size}: ${JSON.stringify(r)}`);
  const traversals = [];
  for (const map of [readRtsMap(readFileSync(resolve(REPO_DIR, 'content/maps/hollow-ridge.rtsmap'))), navTestRtsMap('bases', 1024, 73).map]) {
    console.log(`MS3 traversal: ${map.meta.name}`);
    const r = traversal(map, quick); traversals.push(r);
    if (r.notStarted > 0 || r.firstMoveTicks.max > 10 || r.arrivalRate < 0.95 || r.stalledOver30 > 0 || r.blocked > 0) problems.push(`traversal ${r.map}: ${JSON.stringify(r)}`);
    globalThis.gc?.();
  }
  const job = { kind: 'tickBench' as const, ticks: quick ? 100 : 1000, map: 'content/maps/hollow-ridge.rtsmap' };
  console.log('MS3 tick benchmark: Node and sequential Chromium/Firefox/WebKit workers');
  const series: Record<string, SeriesResult> = { node: nodeSeries<SeriesResult>(job) };
  buildHarness(); clearRaw('bench-');
  const code = run(bin('playwright'), ['test', '-c', 'playwright.xengine.config.ts', 'browser/bench.spec.ts', '-g', 'bench tickBench-hollow-ridge'], { allowFail: true, env: { ...process.env, FAF_BENCH_TICKS: String(job.ticks) } });
  if (code !== 0) problems.push(`browser worker harness exit ${code}`);
  for (const engine of ['chromium', 'firefox', 'webkit']) { const r = readRaw<SeriesResult>(`bench-${engine}-tickBench-hollow-ridge`); if (r === null) problems.push(`missing ${engine}`); else series[engine] = r; }
  if (process.env['FAF_PERF_GATE'] === '1') {
    for (const r of bursts) if (r.phaseMs.p95 > 5) problems.push(`PathService p95 ${r.phaseMs.p95} > 5 ms (${r.size})`);
    for (const [engine, r] of Object.entries(series)) for (const mode of ['cold', 'warm'] as const) { const b = r[mode]; if (b.kind === 'tickBench' && b.total.p95 > 8) problems.push(`${engine}/${mode} tick p95 ${b.total.p95} > 8 ms`); }
  }
  const burstSeries: Record<string, SeriesResult> = {};
  clearRaw('burst-');
  for (const size of [512, 1024] as const) burstSeries[`node-${size}`] = nodeSeries<SeriesResult>({ kind: 'requestBurst', size });
  const burstCode = run(bin('playwright'), ['test', '-c', 'playwright.xengine.config.ts', 'browser/request-burst.spec.ts'], { allowFail: true });
  if (burstCode !== 0) problems.push(`browser request-burst harness exit ${burstCode}`);
  for (const engine of ['chromium', 'firefox', 'webkit']) for (const size of [512, 1024]) {
    const r = readRaw<SeriesResult>(`burst-${engine}-${size}`);
    if (r === null) problems.push(`missing request-burst ${engine}/${size}`);
    else burstSeries[`${engine}-${size}`] = r;
  }
  for (const [engine, r] of Object.entries(burstSeries)) {
    if (r.warmupResults.length !== 3) problems.push(`${engine}: missing burst warm-ups`);
    for (const b of [r.cold, ...r.warmupResults, r.warm]) {
      if (b.kind !== 'requestBurst') problems.push(`${engine}: incorrect burst result kind`);
      else problems.push(...requestBurstProblems(b, (b === r.cold || b === r.warm) && process.env['FAF_PERF_GATE'] === '1').map((p) => `${engine}: ${p}`));
    }
  }
  const report = { format: 'faf-ms3-acceptance', date: new Date().toISOString(), machine: machine(), node: process.version, loadAverage: loadavg(), quick, functional, bursts, traversals, series, burstSeries, problems };
  const file = resolve(RESULTS_DIR, `ms3-${Date.now()}.json`); writeText(file, JSON.stringify(report, null, 2) + '\n');
  if (update) {
    const previous = readdirSync(RESULTS_DIR).filter((f) => /^ms3-\d+\.json$/.test(f)).sort().slice(-2).map((f) => JSON.parse(readFileSync(resolve(RESULTS_DIR, f), 'utf8')) as typeof report);
    const lines = ['# MS3 P5: Headless-Abnahme', '', `Stand ${isoDate()}, lokal ${machine()}. ${previous.length} Läufe; ms-Gates nur mit FAF_PERF_GATE=1.`, '', '| Karte | 200 Ready (Ticks) | PathService p95 ms |', '|---|---:|---:|'];
    for (const r of bursts) { const values = previous.flatMap((p) => p.bursts.filter((b) => b.size === r.size).map((b) => b.phaseMs.p95)); lines.push(`| ${r.size} WU mit Basis-Footprints | ${r.ticks} | ${Math.min(...values).toFixed(3)} bis ${Math.max(...values).toFixed(3)} |`); }
    lines.push('', '| Engine | kalt p95 | warm p95 |', '|---|---:|---:|');
    for (const [engine, r] of Object.entries(series)) if (r.cold.kind === 'tickBench' && r.warm.kind === 'tickBench') lines.push(`| ${engine} | ${r.cold.total.p95} | ${r.warm.total.p95} |`);
    lines.push('', '| Karte | Anfahren max Ticks | Ankunft | blockierte Positionen |', '|---|---:|---:|---:|');
    for (const r of traversals) lines.push(`| ${r.map} | ${r.firstMoveTicks.max} | ${r.arrived}/${r.units} | ${r.blocked} |`);
    lines.push('', ...functional.map((r) => `- ${r.name}: ${r.failures.length === 0 ? 'bestanden' : 'FEHLER'}, ${r.ticks} Ticks, ${r.assertions} Assertions.`), '', 'Die Gruppenfahrt prüft 40 gemischte Panzer, genau eine Anfrage und Offsetfehler ≤ 1,5 WU. Der Repath-Sturm prüft 20 Footprints gegen einen unabhängigen Brute-Force-Korridorschnitt. Einzel- und Gruppenanfahrwerte werden getrennt erhoben. Der Tick-Benchmark enthält PathService/Movement/SpatialRebuild sowie Hash-Ticks; JSON enthält alle Phasen und Browser-Versionen.', '', `Ergebnis: ${problems.length === 0 ? 'alle funktionalen Gates bestanden' : problems.join('\n')}.`, '', `Berichte: ${previous.map((p) => p.date).join(', ')}.`, 'Befehle: `pnpm bench:ms3 -- --quick --update-docs`, `pnpm bench:spk3 -- --quick`, `pnpm bench:nav -- --quick`.');
    const docPath = resolve(REPO_DIR, 'docs/status/ms3-p5-bench.md');
    const existing = readFileSync(docPath, 'utf8');
    const extra = existing.indexOf('\n## ');
    if (extra >= 0) lines.push(existing.slice(extra).trimEnd());
    writeText(docPath, lines.join('\n') + '\n');
  }
  console.log(JSON.stringify({ file, functional: functional.map((f) => ({ name: f.name, failures: f.failures.length })), bursts, traversals, problems }, null, 2));
  if (problems.length > 0) process.exitCode = 1;
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
void HEADLESS_DIR;
