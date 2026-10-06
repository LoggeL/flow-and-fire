/**
 * MS3 acceptance benchmark on sim level (PLAN §5.2 MS3 "Headless-Benchmark auf 1.024 WU"):
 * `pnpm bench:ms3 [-- --quick] [--update-docs] [--no-browser]`.
 *
 * One process, scenarios one after another (GC in between), on hollow-ridge (512 WU), the
 * generated 1,024-WU 'bases' map (@faf/nav/testmap, bases stamped as footprints) and the 'choke'
 * map:
 *  1. 200 tanks (classes 1–3) across the map, group and single orders mixed: start-up ticks, arrival
 *     share without stuck > 3 s, group offset errors, land invariants (+ plateau exit, reported).
 *  2. 3-WU choke: 100 T1 tanks through in ≤ 600 ticks, deadlock detection.
 *  3. 200 simultaneous single requests on 1,024 WU with obstacles: ticks until ready, PathService
 *     ms per tick, expansions; one group order of 50 ⇒ requestsIssued + 1.
 *  4. Repath storm: 200 moving units, 20 new footprints ⇒ repaths == brute-force corridor rule.
 *  5. 1,000 moving tanks with pathing on hollow-ridge: sim tick p95 incl. hash tick in Node (fresh
 *     process) and in the Chromium/Firefox/WebKit workers of the harness (cold/warm, sequential).
 *  D. SPK6 follow-up: ticks from the command to the first position change from standstill.
 *
 * Output: tools/headless/results/ms3-<date>.json (git-ignored; machine, engine versions, load
 * average) plus one line per run in results/ms3-history.jsonl (value ranges for the docs).
 * `--update-docs` replaces the tables between the ms3 markers of docs/status/ms3-p5-bench.md.
 * Exit ≠ 0 if a machine-independent criterion fails (shares, tick counts, repath equality,
 * requestsIssued, deadlock, hash equality); ms budgets gate only with FAF_PERF_GATE=1
 * (DECISIONS 16), otherwise they are reported.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { loadavg, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { readRtsMap } from '@faf/formats';
import type { JobResult } from '../src/jobs.ts';
import { navTestRtsMap } from '../src/maps.ts';
import { MS3_LOAD_UNITS } from '../src/ms3/load.ts';
import {
  BASES_CROSS,
  collectGarbage,
  RIDGE_CROSS,
  RIDGE_PLATEAU,
  runBurst,
  runChoke,
  runCrossMap,
  runStartup,
  runStorm,
  type BurstResult,
  type Check,
  type ChokeResult,
  type CrossMapResult,
  type StartupResult,
  type StormResult,
} from '../src/ms3/scenarios.ts';
import type { SeriesResult } from '../src/series.ts';
import { buildHarness, clearRaw, ENGINES, isoDate, loadSimBin, machine, MAP_PATHS, nodeSeries, playwright, readRaw, REPO_DIR, RESULTS_DIR, writeText } from './lib.ts';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const UPDATE_DOCS = args.includes('--update-docs') || process.env['FAF_BENCH_UPDATE_DOCS'] === '1';
const NO_BROWSER = args.includes('--no-browser');
const PERF_GATE = process.env['FAF_PERF_GATE'] === '1';
const MODE = QUICK ? 'quick' : 'full';
const DOC = resolve(REPO_DIR, 'docs/status/ms3-p5-bench.md');
const HISTORY = resolve(RESULTS_DIR, 'ms3-history.jsonl');
const BEGIN = '<!-- ms3:begin -->';
const END = '<!-- ms3:end -->';

/** Budgets (PLAN §5.2 MS3; machine-dependent ⇒ FAF_PERF_GATE). */
const BUDGET_PATHSERVICE_P95_MS = 5;
const BUDGET_LOAD_P95_MS = 8;
/** Scenario 5 must really be under load: at least this share of the units drives (mean). */
const LOAD_MOVING_MIN_SHARE = 0.9;

const CROSS_SEEDS = QUICK ? [0x3a110001] : [0x3a110001, 2, 3];
const BURST_REPS = QUICK ? 5 : 12;
const LOAD_TICKS = QUICK ? 300 : 1000;
const LOAD_RAMP = QUICK ? 100 : 200;

const clock = (): number => performance.now();
const t0 = clock();
const load0 = loadavg();
const simBin = loadSimBin();
const RIDGE_PATH = MAP_PATHS[0]!;
const ridge = readRtsMap(new Uint8Array(readFileSync(resolve(REPO_DIR, RIDGE_PATH))));
const bases = navTestRtsMap('bases', 1024, 1);
const checks: Check[] = [];
const problems: string[] = [];
const log = (s: string): void => console.log(s);
const step = <T>(label: string, fn: () => T): T => {
  collectGarbage();
  const a = clock();
  const r = fn();
  log(`» ${label} (${((clock() - a) / 1000).toFixed(1)} s)`);
  return r;
};

// ---- 1. 200 units across the map --------------------------------------------------------------

const cross: CrossMapResult[] = [];
for (const seed of CROSS_SEEDS) {
  const tag = seed === CROSS_SEEDS[0] ? '' : ` Seed ${seed}`;
  cross.push(step(`1 hollow-ridge${tag}`, () => runCrossMap(simBin, { label: `hollow-ridge${tag}`, map: ridge, layout: RIDGE_CROSS, maxTicks: 6000, gated: true, seed }, clock)));
  cross.push(step(`1 bases-1024${tag}`, () => runCrossMap(simBin, { label: `bases-1024${tag}`, map: bases.map, nav: bases.nav, layout: BASES_CROSS, maxTicks: 9000, gated: true, seed }, clock)));
}
cross.push(step('1 hollow-ridge-plateau (berichtet)', () => runCrossMap(simBin, { label: 'hollow-ridge-plateau', map: ridge, layout: RIDGE_PLATEAU, maxTicks: 6000, gated: false }, clock)));
for (const r of cross) checks.push(...r.checks);

// ---- 2. choke ----------------------------------------------------------------------------------

const choke: ChokeResult[] = [];
for (const size of [256, 1024]) {
  const c = navTestRtsMap('choke', size, 1);
  choke.push(step(`2 choke-${size}`, () => runChoke(simBin, c.map, c.nav, clock)));
}
for (const r of choke) checks.push(...r.checks);

// ---- 3. burst ----------------------------------------------------------------------------------

const burst: BurstResult[] = [];
burst.push(step('3 burst bases-1024', () => runBurst(simBin, 'bases-1024', bases.map, bases.nav, BURST_REPS, clock)));
burst.push(step('3 burst hollow-ridge (berichtet)', () => runBurst(simBin, 'hollow-ridge', ridge, undefined, BURST_REPS, clock)));
checks.push(...burst[0]!.checks);
for (const c of burst[1]!.checks) checks.push({ ...c, name: `(nur berichtet) ${c.name}`, gated: false });
for (const b of burst) {
  const ok = b.pathServiceWarm.p95 <= BUDGET_PATHSERVICE_P95_MS;
  const gated = PERF_GATE && b === burst[0];
  checks.push({ name: `${b.map}: PathService p95 ≤ ${BUDGET_PATHSERVICE_P95_MS} ms (warm)${gated ? '' : ' [ms, nur berichtet]'}`, ok, detail: `p95 ${b.pathServiceWarm.p95.toFixed(2)} ms, kalt ${b.pathServiceCold.p95.toFixed(2)} ms`, gated });
}

// ---- 4. repath storm ---------------------------------------------------------------------------

const storm: StormResult[] = [];
storm.push(step('4 storm hollow-ridge', () => runStorm(simBin, 'hollow-ridge', ridge, undefined, clock)));
storm.push(step('4 storm bases-1024', () => runStorm(simBin, 'bases-1024', bases.map, bases.nav, clock)));
for (const r of storm) checks.push(...r.checks);

// ---- D. start-up from standstill ---------------------------------------------------------------

const startup: StartupResult = step('D startup', () => runStartup(simBin));
checks.push(...startup.checks);

// ---- 5. 1,000 moving units (Node + browsers) ---------------------------------------------------

type LoadResult = Extract<JobResult, { kind: 'ms3Load' }>;
const loadJob = { kind: 'ms3Load' as const, ticks: LOAD_TICKS, rampTicks: LOAD_RAMP, map: RIDGE_PATH };
const loadSeries: Record<string, SeriesResult> = {};
loadSeries['node'] = step('5 load node (frischer Prozess)', () => nodeSeries<SeriesResult>(loadJob));
if (NO_BROWSER) {
  log('» 5 browsers skipped (--no-browser)');
  problems.push('--no-browser: scenario 5 ran in Node only (browser criterion not evaluated)');
} else {
  step('5 build harness', () => buildHarness());
  clearRaw('ms3-');
  const code = step('5 load chromium, firefox, webkit (Playwright, nacheinander)', () =>
    playwright('browser/ms3.spec.ts', { FAF_MS3_TICKS: String(LOAD_TICKS), FAF_MS3_RAMP: String(LOAD_RAMP) }),
  );
  if (code !== 0) problems.push(`playwright exited with ${code}`);
  for (const engine of ENGINES.slice(1)) {
    const r = readRaw<SeriesResult>(`ms3-${engine}-ms3Load`);
    if (r === null) problems.push(`${engine}: no ms3Load result`);
    else loadSeries[engine] = r;
  }
}
const loadRows: { engine: string; mode: 'cold' | 'warm'; r: LoadResult; ua: string }[] = [];
for (const engine of ENGINES) {
  const s = loadSeries[engine];
  if (s === undefined) continue;
  for (const mode of ['cold', 'warm'] as const) {
    const r = s[mode];
    if (r.kind === 'ms3Load') loadRows.push({ engine, mode, r, ua: s.engine.userAgent });
  }
}
const slowest = loadRows.reduce<(typeof loadRows)[number] | null>((a, b) => (a === null || b.r.total.p95 > a.r.total.p95 ? b : a), null);
const loadHashes = [...new Set(loadRows.map((x) => x.r.finalHash))];
checks.push({ name: 'Szenario 5: End-Hash in allen Engines und JIT-Modi identisch', ok: loadHashes.length === 1, detail: loadHashes.join(', '), gated: true });
const minMoving = Math.min(...loadRows.map((x) => x.r.movingMean));
checks.push({
  name: `Szenario 5: Last real (Ø ≥ ${Math.round(LOAD_MOVING_MIN_SHARE * 100)} % von ${MS3_LOAD_UNITS} fahrend)`,
  ok: loadRows.length > 0 && minMoving >= LOAD_MOVING_MIN_SHARE * MS3_LOAD_UNITS,
  detail: `Ø min ${minMoving} fahrend`,
  gated: true,
});
if (slowest !== null) {
  const ok = slowest.r.total.p95 <= BUDGET_LOAD_P95_MS;
  checks.push({
    name: `Szenario 5: Sim-Tick p95 ≤ ${BUDGET_LOAD_P95_MS} ms in der langsamsten Engine${PERF_GATE ? '' : ' [ms, nur berichtet]'}`,
    ok,
    detail: `${slowest.r.total.p95.toFixed(2)} ms (${slowest.engine} ${slowest.mode === 'cold' ? 'kalt' : 'warm'})`,
    gated: PERF_GATE,
  });
}

// ---- report ------------------------------------------------------------------------------------

/** Engine version for the report: Node version, else the browser's product token. */
function engineName(engine: string, s: SeriesResult): string {
  if (engine === 'node') return `Node ${process.version}`;
  const ua = s.engine.userAgent;
  const m = /(Chrome|Firefox)\/[\d.]+/.exec(ua) ?? /Version\/[\d.]+ Safari/.exec(ua);
  return m !== null ? m[0] : ua;
}

const load1 = loadavg();
const wallS = (clock() - t0) / 1000;
const date = isoDate();
const failed = checks.filter((c) => c.gated && !c.ok);
const report = {
  format: 'faf-ms3-bench',
  version: 1,
  date: new Date().toISOString(),
  mode: MODE,
  machine: `${machine()} (lokal gemessen, nicht Referenz-Laptop)`,
  memoryGiB: Math.round(totalmem() / 2 ** 30),
  node: process.version,
  engines: Object.fromEntries(Object.entries(loadSeries).map(([e, s]) => [e, engineName(e, s)])),
  loadAverage: { before: load0.map((v) => Math.round(v * 100) / 100), after: load1.map((v) => Math.round(v * 100) / 100) },
  perfGate: PERF_GATE,
  wallSeconds: Math.round(wallS),
  checks,
  problems,
  cross,
  choke,
  burst: burst.map((b) => ({ ...b, runs: b.runs.map((r) => ({ ticksUntilReady: r.ticksUntilReady, pathServiceMs: r.pathServiceMs.map((v) => Math.round(v * 1000) / 1000), expansionsPerTick: r.expansionsPerTick })) })),
  storm,
  startup,
  load: loadSeries,
};
const file = resolve(RESULTS_DIR, `ms3-${date}.json`);
writeText(file, JSON.stringify(report, null, 2) + '\n');

/** Key metrics of this run (history line; value ranges in the docs). */
const key: Record<string, number> = {};
for (const r of cross) {
  key[`s1.${r.map}.share`] = r.arrivalShare;
  key[`s1.${r.map}.start`] = r.startTicks.max;
  key[`s1.${r.map}.idle`] = r.ticksUntilAllIdle ?? -1;
  key[`s1.${r.map}.offP95`] = r.offsetAll.p95;
}
for (const r of choke) key[`s2.${r.sizeWu}.through`] = r.allThroughTick ?? -1;
for (const b of burst) {
  key[`s3.${b.map}.ready`] = b.readyTicksMax;
  key[`s3.${b.map}.psP95`] = b.pathServiceWarm.p95;
  key[`s3.${b.map}.psP50`] = b.pathServiceWarm.p50;
  key[`s3.${b.map}.psMax`] = b.pathServiceWarm.max;
  key[`s3.${b.map}.psColdP95`] = b.pathServiceCold.p95;
}
for (const r of storm) key[`s4.${r.map}.marked`] = r.markedTotal;
for (const x of loadRows) {
  key[`s5.${x.engine}.${x.mode}.p95`] = x.r.total.p95;
  key[`s5.${x.engine}.${x.mode}.p50`] = x.r.total.p50;
  key[`s5.${x.engine}.${x.mode}.ps95`] = x.r.phases['PathService']?.p95 ?? 0;
  key[`s5.${x.engine}.${x.mode}.mv95`] = x.r.phases['Movement']?.p95 ?? 0;
  key[`s5.${x.engine}.${x.mode}.sr95`] = x.r.phases['SpatialRebuild']?.p95 ?? 0;
  key[`s5.${x.engine}.${x.mode}.hash95`] = x.r.hashTick.p95;
}
appendFileSync(HISTORY, JSON.stringify({ date: report.date, mode: MODE, load: load0[0], key }) + '\n');

// ---- Markdown -----------------------------------------------------------------------------------

interface HistoryLine {
  date: string;
  mode: string;
  load: number;
  key: Record<string, number>;
}
const history: HistoryLine[] = existsSync(HISTORY)
  ? readFileSync(HISTORY, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as HistoryLine)
      .filter((h) => h.mode === MODE)
      .slice(-5)
  : [];
const f = (v: number, d = 2): string => v.toFixed(d).replace('.', ',');
const ms = (v: number): string => (v >= 10 ? f(v, 1) : v >= 1 ? f(v, 2) : f(v, 3));
const pct = (v: number): string => `${f(100 * v, 1)} %`;
/** Value range of a key metric over the history runs of this mode (this run included). */
function rng(k: string, fmt: (v: number) => string): string {
  const vs = history.map((h) => h.key[k]).filter((v): v is number => v !== undefined);
  if (vs.length < 2) return fmt(key[k] ?? 0);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
}
const tick = (v: number): string => (v < 0 ? 'nie' : String(Math.round(v)));
const mark = (ok: boolean, gated: boolean): string => (ok ? '✅' : gated ? '❌' : '⚠️');
const jit = (m: 'cold' | 'warm'): string => (m === 'cold' ? 'kalt' : 'warm');
const lines: string[] = [];
const push = (...l: string[]): void => void lines.push(...l);
const engines = Object.entries(loadSeries).map(([e, s]) => `${e}: ${engineName(e, s)}`);

push(
  `Letzter Lauf: ${date}, \`pnpm bench:ms3${QUICK ? ' -- --quick' : ''}\` (${MODE}, ${Math.round(wallS)} s). **Lokal gemessen (${machine()}), nicht Referenz-Laptop.**`,
  `Engines: ${engines.join('; ')}.`,
  `Fremdlast: Load-Average ${load0.map((v) => f(v, 1)).join(' / ')} (vorher), ${load1.map((v) => f(v, 1)).join(' / ')} (nachher). Wertebereiche = ${history.length} Lauf/Läufe im Modus „${MODE}“ (results/ms3-history.jsonl).`,
  `ms-Grenzen ${PERF_GATE ? '**gegated** (FAF_PERF_GATE=1)' : 'nur berichtet (ohne FAF_PERF_GATE=1, DECISIONS 16)'}; maschinenunabhängige Kriterien immer gegated.`,
  '',
  '### Kriterien',
  '',
  '| Kriterium | Ergebnis | Status |',
  '|---|---|---|',
  ...checks.map((c) => `| ${c.name} | ${c.detail} | ${mark(c.ok, c.gated)} |`),
  '',
  '### Szenario 1 – 200 Units über die Karte',
  '',
  'Anfahren = erster Tick mit Positionsänderung nach dem Befehl (Befehls-Tick = 1). Stuck = 30 Ticks ohne 0,15 WU Fortschritt auf der Restroute (SPK2-Definition, Referenz folgt einer längeren neuen Route ohne Gutschrift). Offset = Abstand zu Schwerpunkt + komprimiertem Offset nach Ankunft (nur berichtet).',
  '',
  '| Lauf | Befehle ⇒ Anfragen | Anfahren max (Ticks) | ohne Stuck > 3 s | Bereich | längste Pause p95 / max | alle ruhend nach | Offset p50 / p95 / max (WU) | Verstöße |',
  '|---|---|---|---|---|---|---|---|---|',
  ...cross.map(
    (r) =>
      `| ${r.map}${r.gated ? '' : ' (berichtet)'} | ${r.orders} ⇒ ${r.requestsAtCommand} | ${r.startTicks.max} | ${r.arrivedNoStuck}/${r.units} = ${pct(r.arrivalShare)} | ${rng(`s1.${r.map}.share`, pct)} | ${r.maxNoProgress.p95} / ${r.maxNoProgress.max} | ${tick(r.ticksUntilAllIdle ?? -1)} | ${f(r.offsetAll.p50)} / ${f(r.offsetAll.p95)} / ${f(r.offsetAll.max)} | ${r.invariantViolations} |`,
  ),
  '',
  ...[...new Set(cross.map((r) => r.layout))].map((l) => `- ${cross.find((r) => r.layout === l)!.map.replace(/ Seed.*/, '')}: ${l}`),
  '',
  '### Szenario 2 – Engstelle 3 WU (100 T1-Panzer)',
  '',
  '| Karte | alle durch nach (Ticks) | Bereich | 25 / 50 / 75 / 100 durch | längste Pause | Deadlock | Verstöße |',
  '|---|---|---|---|---|---|---|',
  ...choke.map(
    (r) =>
      `| ${r.map} | ${tick(r.allThroughTick ?? -1)} | ${rng(`s2.${r.sizeWu}.through`, tick)} | ${r.milestones.map((m) => (m === null ? '–' : String(m))).join(' / ')} | ${r.longestNoThroughput} | ${r.deadlock ? 'ja' : 'nein'} | ${r.invariantViolations} |`,
  ),
  '',
  `### Szenario 3 – 200 Einzelanfragen gleichzeitig (${BURST_REPS} Läufe: Lauf 1 = JIT kalt, 2–3 Aufwärmen, Rest = warm)`,
  '',
  '| Karte | Footprints | Ticks bis alle Ready (je Lauf) | Ready-Tick p50 / p95 | PathService warm p50 / **p95** / max (ms) | Bereich p95 | kalt p95 | Expansionen/Tick p50 / max | Expansionen/Anfrage p50 / p95 / max | Ready / Direct / Failed / Retarget | Gruppe 50 ⇒ Anfragen |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...burst.map(
    (b) =>
      `| ${b.map} | ${b.footprints} | ${b.runs.map((r) => r.ticksUntilReady).join(', ')} | ${b.readyTicks.p50} / ${b.readyTicks.p95} | ${ms(b.pathServiceWarm.p50)} / **${ms(b.pathServiceWarm.p95)}** / ${ms(b.pathServiceWarm.max)} | ${rng(`s3.${b.map}.psP95`, ms)} | ${ms(b.pathServiceCold.p95)} | ${Math.round(b.expansionsPerTick.p50)} / ${Math.round(b.expansionsPerTick.max)} | ${Math.round(b.expansionsPerRequest.p50)} / ${Math.round(b.expansionsPerRequest.p95)} / ${Math.round(b.expansionsPerRequest.max)} | ${b.states.ready} / ${b.states.direct} / ${b.states.failed} / ${b.states.retargeted} | +${b.groupRequests}${b.groupSharedPath ? ', ein Pfad' : ''} |`,
  ),
  '',
  '### Szenario 4 – Repath-Sturm (200 fahrende Units, 20 neue Footprints)',
  '',
  '| Karte | markiert | erwartet (Brute Force) | falsch-positiv / -negativ | Zähler == Markierungen | sonstige Korridor-Repaths | sonstige Anfragen (Stuck) | Verstöße |',
  '|---|---|---|---|---|---|---|---|',
  ...storm.map(
    (r) =>
      `| ${r.map} | ${r.markedTotal} | ${r.expectedTotal} | ${r.falsePositives} / ${r.falseNegatives} | ${r.stamps.every((s) => s.counterDelta === s.marked) ? 'ja' : 'nein'} | ${r.otherRepaths} | ${r.otherRequests} | ${r.invariantViolations} |`,
  ),
  '',
  `### Szenario 5 – ${MS3_LOAD_UNITS} fahrende Panzer mit Pathing auf hollow-ridge (${LOAD_TICKS} gemessene Ticks nach ${LOAD_RAMP} Ramp-Ticks)`,
  '',
  '10 Gruppen à 100 (Klassen 1–3, 2 Armeen), alle 20 Ticks ein neues Ziel quer über die Karte (jedes 3. mit Shift). Reps > 1: Engine-Uhr zu grob, Tick per Snapshot/Restore wiederholt.',
  '',
  '| Engine | JIT | Reps | p50 | **p95** | Bereich p95 | p99 | max | PathService p95 | Movement p95 | SpatialRebuild p95 | Hash-Tick p95 | fahrend Ø (min) | Anfragen | End-Hash |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...loadRows.map(
    (x) =>
      `| ${x.engine} | ${jit(x.mode)} | ${x.r.reps} | ${ms(x.r.total.p50)} | **${ms(x.r.total.p95)}** | ${rng(`s5.${x.engine}.${x.mode}.p95`, ms)} | ${ms(x.r.total.p99)} | ${ms(x.r.total.max)} | ${ms(x.r.phases['PathService']?.p95 ?? 0)} | ${ms(x.r.phases['Movement']?.p95 ?? 0)} | ${ms(x.r.phases['SpatialRebuild']?.p95 ?? 0)} | ${ms(x.r.hashTick.p95)} | ${x.r.movingMean} (${x.r.movingMin}) | ${x.r.requestsIssued} | ${x.r.finalHash} |`,
  ),
  '',
  slowest === null
    ? '**Budget:** keine Messung.'
    : `**Budget:** p95 ≤ ${BUDGET_LOAD_P95_MS} ms in der langsamsten Engine inkl. Hash-Tick → gemessen **${ms(slowest.r.total.p95)} ms** (${slowest.engine} ${jit(slowest.mode)}) ⇒ **${slowest.r.total.p95 <= BUDGET_LOAD_P95_MS ? 'erfüllt' : 'verfehlt'}**.`,
  '',
  '### SPK6-Folgepunkt – Anfahren aus dem Stand (Sim-Anteil, Referenz für ms3-p6)',
  '',
  'Testebene, je Blueprint und Kursfehler zwischen Blickrichtung und Ziel; Ticks nach dem Befehl (Befehls-Tick = 1, inputDelay 0): erste Drehung, erste Positionsänderung, ≥ 0,05 / 0,5 / 1 WU Weg.',
  '',
  '| Blueprint | Kursfehler | Drehung | Position ändert sich | ≥ 0,05 WU | ≥ 0,5 WU | ≥ 1 WU |',
  '|---|---|---|---|---|---|---|',
  ...startup.rows.map((r) => `| ${r.bp} | ${r.headingDeg}° | ${r.headingDeg === 0 ? '–' : r.yawTick} | ${r.moveTick} | ${r.move005Tick} | ${r.move05Tick} | ${r.move1Tick} |`),
  '',
  `Gruppe aus 20 gemischten Panzern (Gruppenbefehl, Pfad noch ausstehend): alle ändern ihre Position spätestens nach **${startup.groupMaxMoveTick} Tick(s)**.`,
);
if (problems.length > 0) push('', `Hinweise: ${problems.join('; ')}.`);
const markdown = lines.join('\n');

if (!UPDATE_DOCS) {
  log('\n' + markdown);
  log(`\n(results in ${file}; status tables unchanged — run with --update-docs to replace them)`);
} else if (existsSync(DOC)) {
  const doc = readFileSync(DOC, 'utf8');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a >= 0 && b > a) {
    writeText(DOC, doc.slice(0, a + BEGIN.length) + '\n' + markdown + '\n' + doc.slice(b));
    log(`status tables updated: ${DOC}`);
  } else console.warn(`markers ${BEGIN}/${END} not found in ${DOC}; tables only in ${file}`);
} else console.warn(`${DOC} missing; tables only in ${file}`);

log(`\nreport: ${file} (${Math.round(wallS)} s)`);
for (const c of checks) log(`${mark(c.ok, c.gated)} ${c.name}: ${c.detail}`);
const hardProblems = problems.filter((p) => !p.startsWith('--no-browser'));
if (failed.length > 0 || hardProblems.length > 0) {
  console.error(`\n✗ ms3 bench: ${failed.length} criteria failed${hardProblems.length > 0 ? `; ${hardProblems.join('; ')}` : ''}`);
  process.exit(1);
}
