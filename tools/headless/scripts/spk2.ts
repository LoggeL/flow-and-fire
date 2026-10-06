/**
 * SPK2 movement benchmark (PLAN §4, DECISIONS 22): `pnpm bench:spk2 [-- --quick] [--update-docs]
 * [--trace <scenario>] [--seeds 1,2]`.
 *
 * Runs the six scenarios with SPK2_PARAMS on ≥ 2 seeds, a one-at-a-time parameter sweep and writes
 * tools/headless/results/spk2.json (git-ignored). `--update-docs` writes the result table into
 * docs/status/ms3-p1-blueprints-spk2.md (between the spk2 markers). `--trace <scenario>` writes a
 * position trace to tools/headless/spk2/out/ for the Canvas2D viewer (tools/headless/spk2/viewer.html).
 * Exit code 1 if SPK2_PARAMS fail any scenario criterion (deadlock, choke > 60 s, cross-map < 95 %
 * without stuck > 3 s, offset error) – machine-independent, always gated.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll, runScenario, score, sweep, type ScenarioMetrics } from '../src/spk2/run.ts';
import { SCENARIO_IDS, type ScenarioId } from '../src/spk2/scenarios.ts';
import { SPK2_PARAMS } from '../src/spk2/params.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const RESULTS = resolve(HERE, '../results/spk2.json');
const TRACE_DIR = resolve(HERE, '../spk2/out');
const DOC = resolve(REPO, 'docs/status/ms3-p1-blueprints-spk2.md');
const BEGIN = '<!-- spk2:begin -->';
const END = '<!-- spk2:end -->';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const updateDocs = args.includes('--update-docs');
const traceAt = args.indexOf('--trace');
const seedsAt = args.indexOf('--seeds');
const seeds = seedsAt >= 0 ? args[seedsAt + 1]!.split(',').map((s) => Number.parseInt(s, 10)) : [1, 2];

if (traceAt >= 0) {
  const id = args[traceAt + 1] as ScenarioId;
  if (!SCENARIO_IDS.includes(id)) {
    console.error(`unknown scenario '${String(id)}' (one of ${SCENARIO_IDS.join(', ')})`);
    process.exit(2);
  }
  const seed = seeds[0] ?? 1;
  const { metrics, trace } = runScenario(id, SPK2_PARAMS, seed, { traceEvery: 1 });
  mkdirSync(TRACE_DIR, { recursive: true });
  const file = resolve(TRACE_DIR, `${id}-seed${seed}.json`);
  writeFileSync(file, JSON.stringify(trace));
  console.log(`trace ${file}: ${metrics.ticks} ticks, ${metrics.units} units, pass=${metrics.pass}`);
  process.exit(metrics.pass ? 0 : 1);
}

const t0 = performance.now();
const perSeed: ScenarioMetrics[][] = seeds.map((seed) => runAll(SPK2_PARAMS, seed));
const sweepSeeds = quick ? [seeds[0]!] : seeds;
const sweepRows = sweepSeeds.flatMap((seed) => sweep(SPK2_PARAMS, SCENARIO_IDS, seed).map((r) => ({ seed, ...r })));
const wallS = (performance.now() - t0) / 1000;

const all = perSeed.flat();
const failures = all.filter((m) => !m.pass).map((m) => `${m.scenario} (seed ${m.seed}): ${m.failures.join('; ')}`);
const baseScore = perSeed.map((ms) => score(ms));

// Best alternative per swept key (lowest mean score over the sweep seeds, all scenarios passing).
const byKey = new Map<string, { value: number | boolean; score: number; passAll: boolean }[]>();
for (const r of sweepRows) {
  const list = byKey.get(r.key) ?? [];
  const e = list.find((x) => x.value === r.value);
  if (e === undefined) list.push({ value: r.value, score: r.score / sweepSeeds.length, passAll: r.passed === SCENARIO_IDS.length });
  else {
    e.score += r.score / sweepSeeds.length;
    e.passAll &&= r.passed === SCENARIO_IDS.length;
  }
  byKey.set(r.key, list);
}
const sweepSummary = [...byKey.entries()].map(([key, list]) => {
  const chosen = SPK2_PARAMS[key as keyof typeof SPK2_PARAMS];
  const best = [...list].filter((x) => x.passAll).sort((a, b) => a.score - b.score)[0];
  return { key, chosen, best: best?.value ?? null, values: list };
});

const range = (xs: readonly number[], digits: number): string => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const f = (v: number): string => v.toFixed(digits).replace('.', ',');
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
};
const pct = (xs: readonly number[]): string => range(xs.map((x) => x * 100), 1) + ' %';

const LABEL: Record<ScenarioId, string> = {
  'cross-map': '1 200 Units über die Karte (Gruppe, Offset-Erhalt)',
  choke: '2 Engstelle 3 WU, 100 Units',
  rolloff: '3 Roll-off an der Fabrik (40 Units)',
  clump: '4 Klumpen bei Attack-Move (100 Units auf einen Punkt)',
  'wall-gaps': '5 Mauerlücken 2/4/6 WU (80 Units, Klassen 1–3)',
  offset: '6 Offset-Erhalt (60 Units, 3 Reihen)',
};

function table(): string {
  const rows = [
    '| Szenario | Deadlock | Zeit bis alle durch/angekommen | ohne Stuck > 3 s | Überlappung max / mittel | Richtungs-Jitter (°/Tick, Umkehr/min) | Anfahr-Ticks sichtbar / Translation (max) | Offset-Fehler p95 | Repaths / Ausweichen |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const id of SCENARIO_IDS) {
    const ms = all.filter((m) => m.scenario === id);
    const offs = ms.map((m) => m.offsetErrP95).filter((x): x is number => x !== null);
    rows.push(
      `| ${LABEL[id]} | ${ms.some((m) => m.deadlock) ? '**ja**' : 'nein'} | ${range(
        ms.map((m) => m.secondsToDone ?? Number.NaN),
        1,
      )} s | ${pct(ms.map((m) => m.noStuckShare))} | ${range(
        ms.map((m) => m.maxOverlap),
        2,
      )} / ${range(
        ms.map((m) => m.meanOverlap),
        3,
      )} WU | ${range(
        ms.map((m) => m.yawJitterDeg),
        2,
      )} / ${range(
        ms.map((m) => m.yawReversalsPerMin),
        1,
      )} | ${range(
        ms.map((m) => m.startTicksMax),
        0,
      )} / ${range(
        ms.map((m) => m.moveTicksMax),
        0,
      )} | ${offs.length === 0 ? '–' : `${range(offs, 2)} WU`} | ${range(
        ms.map((m) => m.stats.repaths),
        0,
      )} / ${range(
        ms.map((m) => m.stats.sidesteps),
        0,
      )} |`,
    );
  }
  const sw = [
    '',
    `Parameter-Sweep (one-at-a-time um SPK2_PARAMS, ${sweepSeeds.length} Seed(s); Score = Summe über alle Szenarien, kleiner ist besser, Fehlschlag +1.000):`,
    '',
    '| Parameter | gewählt | Werte (Score, alle 6 bestanden?) |',
    '|---|---|---|',
    ...sweepSummary.map(
      (s) =>
        `| \`${s.key}\` | ${String(s.chosen)} | ${s.values
          .map((v) => `${String(v.value)}: ${v.score.toFixed(0)}${v.passAll ? '' : ' ✗'}`)
          .join(' · ')} |`,
    ),
  ];
  return [
    `Lokal gemessen, Apple M5 Pro (${cpus()[0]?.model ?? '?'}), Node ${process.version}; Seeds ${seeds.join(', ')} (Wertebereiche über die Läufe); Float64-Prototyp, 10 Hz.`,
    '',
    ...rows,
    ...sw,
  ].join('\n');
}

const report = {
  format: 'faf-spk2-report',
  date: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model ?? '?', cores: cpus().length, node: process.version, loadavg: loadavg() },
  quick,
  seeds,
  params: SPK2_PARAMS,
  pass: failures.length === 0,
  failures,
  baseScore,
  wallSeconds: wallS,
  metrics: perSeed,
  sweep: sweepRows,
  sweepSummary,
};
mkdirSync(dirname(RESULTS), { recursive: true });
writeFileSync(RESULTS, JSON.stringify(report, null, 2) + '\n');

console.log(table());
console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'}: SPK2_PARAMS in ${all.length} scenario runs; wall ${wallS.toFixed(1)} s; report ${RESULTS}`);
for (const f of failures) console.log(`  ✗ ${f}`);

if (updateDocs) {
  const doc = readFileSync(DOC, 'utf8');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) {
    console.error(`${DOC}: markers ${BEGIN} … ${END} missing`);
    process.exit(2);
  }
  writeFileSync(DOC, doc.slice(0, a + BEGIN.length) + '\n' + table() + '\n' + doc.slice(b));
  console.log(`updated ${DOC}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
