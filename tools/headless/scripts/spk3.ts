/**
 * SPK3 "Pathing realistisch" with sim integration (PLAN §4, MS3): `pnpm bench:spk3 [-- --quick]
 * [--update-docs]`. The nav-level part (precompute, budget sweep, HPA* optimality) is
 * `pnpm bench:nav`; this script measures the same questions inside the sim.
 *
 * Maps: generated 'bases' maps with 512 and 1,024 WU (@faf/nav/testmap: cliffs, plateaus with
 * ramps, river with fords, ridge gaps, FA-like bases stamped as footprints).
 *  1. Distribution of HPA* expansions per request and of the ticks until ready: 200 simultaneous
 *     single orders (sim, PathService phase), several runs (run 1 = JIT cold).
 *  2. Base building (sim): 200 tanks under way, every 10 ticks a footprint just ahead of a moving
 *     unit ⇒ corridor repaths, stuck-chain requests, give-ups per minute.
 *  3. Combat (sim): two armies of 100 swap places through each other ⇒ stuck/repath per minute.
 *  4. Repath strategy: corridor rule vs. "invalidation on chunk entry + lazy repair" (PLAN §4
 *     fallback), nav-level replay with the same stamp sequence (variant only here, per option).
 *
 * Output: tools/headless/results/spk3-<date>.json (git-ignored) and Markdown on stdout;
 * `--update-docs` replaces the block between the spk3 markers of docs/status/ms3-p5-bench.md.
 * Exit ≠ 0 if a machine-independent criterion fails (200 requests on 1,024 WU ready ≤ 10 ticks,
 * corridor rule without unnecessary repaths); ms values gate only with FAF_PERF_GATE=1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { NAV_BUDGET_EXPANSIONS_PER_TICK } from '@faf/nav';
import { navTestRtsMap } from '../src/maps.ts';
import { collectGarbage, runBurst, type BurstResult, type Check } from '../src/ms3/scenarios.ts';
import { runBaseBuilding, runCombat, runRepathVariant, type BaseBuildingResult, type CombatResult, type VariantResult } from '../src/ms3/spk3.ts';
import { isoDate, loadSimBin, machine, REPO_DIR, RESULTS_DIR, writeText } from './lib.ts';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const UPDATE_DOCS = args.includes('--update-docs') || process.env['FAF_BENCH_UPDATE_DOCS'] === '1';
const PERF_GATE = process.env['FAF_PERF_GATE'] === '1';
const DOC = resolve(REPO_DIR, 'docs/status/ms3-p5-bench.md');
const BEGIN = '<!-- spk3:begin -->';
const END = '<!-- spk3:end -->';
const BURST_REPS = QUICK ? 5 : 12;
const BUILD_TICKS = QUICK ? 600 : 1800;
const COMBAT_TICKS = QUICK ? 1200 : 3000;
const VARIANT_TICKS = QUICK ? 600 : 1800;
const BUDGET_PATHSERVICE_P95_MS = 5;

const clock = (): number => performance.now();
const t0 = clock();
const load0 = loadavg();
const simBin = loadSimBin();
const checks: Check[] = [];
const log = (s: string): void => console.log(s);
const timed = <T>(label: string, fn: () => T): T => {
  collectGarbage();
  const a = clock();
  const r = fn();
  log(`» ${label} (${((clock() - a) / 1000).toFixed(1)} s)`);
  return r;
};

const SIZES = [512, 1024] as const;
const maps = Object.fromEntries(SIZES.map((s) => [s, navTestRtsMap('bases', s, 1)])) as Record<(typeof SIZES)[number], ReturnType<typeof navTestRtsMap>>;
/** Combat lanes in open lowland (west of the ridge, between the bases and the river). */
const LANES: Record<(typeof SIZES)[number], readonly [readonly [number, number], readonly [number, number]]> = {
  512: [
    [80, 200],
    [200, 200],
  ],
  1024: [
    [220, 400],
    [380, 400],
  ],
};

const burst: BurstResult[] = [];
const build: BaseBuildingResult[] = [];
const combat: CombatResult[] = [];
const variants: VariantResult[] = [];
for (const size of SIZES) {
  const m = maps[size];
  burst.push(timed(`1 burst bases-${size}`, () => runBurst(simBin, `bases-${size}`, m.map, m.nav, BURST_REPS, clock)));
  build.push(timed(`2 base building bases-${size}`, () => runBaseBuilding(simBin, `bases-${size}`, m.map, m.nav, BUILD_TICKS, clock)));
  combat.push(timed(`3 combat bases-${size}`, () => runCombat(simBin, `bases-${size}`, m.map, m.nav, LANES[size][0], LANES[size][1], COMBAT_TICKS, clock)));
  for (const policy of ['corridor', 'chunk'] as const) {
    variants.push(timed(`4 repath ${policy} bases-${size}`, () => runRepathVariant(m.nav, policy, VARIANT_TICKS, clock)));
  }
}

// ---- criteria -----------------------------------------------------------------------------------

for (const b of burst) {
  const is1024 = b.sizeWu === 1024;
  const pre = is1024 ? '' : '(nur berichtet) ';
  checks.push({ name: `${pre}SPK3 ${b.map}: 200 Anfragen fertig ≤ 10 Ticks`, ok: b.readyTicksMax <= 10, detail: `max ${b.readyTicksMax} Ticks`, gated: is1024 });
  checks.push({
    name: `SPK3 ${b.map}: PathService p95 ≤ ${BUDGET_PATHSERVICE_P95_MS} ms (warm)${PERF_GATE && is1024 ? '' : ' [ms, nur berichtet]'}`,
    ok: b.pathServiceWarm.p95 <= BUDGET_PATHSERVICE_P95_MS,
    detail: `p95 ${b.pathServiceWarm.p95.toFixed(2)} ms (kalt ${b.pathServiceCold.p95.toFixed(2)} ms)`,
    gated: PERF_GATE && is1024,
  });
}
for (const v of variants) {
  if (v.policy !== 'corridor') continue;
  checks.push({ name: `SPK3 ${v.map}: Korridorregel ohne unnötige Repaths, keine verpassten Schnitte`, ok: v.unnecessary === 0 && v.cutUnrepaired === 0 && v.staleTicks === 0, detail: `${v.repathsTotal} Repaths, unnötig ${v.unnecessary}, unrepariert ${v.cutUnrepaired}, Fahrt auf blockiertem Stück ${v.staleTicks}`, gated: true });
}

// ---- report -------------------------------------------------------------------------------------

const f = (v: number, d = 2): string => v.toFixed(d).replace('.', ',');
const ms = (v: number): string => (v >= 10 ? f(v, 1) : v >= 1 ? f(v, 2) : f(v, 3));
const int = (v: number): string => Math.round(v).toLocaleString('de-DE');
function histogram(values: readonly number[], edges: readonly number[]): string {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const v of values) {
    let i = 0;
    while (i < edges.length && v > edges[i]!) i++;
    counts[i] = counts[i]! + 1;
  }
  const labels = edges.map((e, i) => (i === 0 ? `≤ ${int(e)}` : edges[i - 1]! + 1 === e ? int(e) : `${int(edges[i - 1]! + 1)}–${int(e)}`));
  labels.push(`> ${int(edges[edges.length - 1]!)}`);
  const n = values.length || 1;
  return labels.map((l, i) => `${l}: ${f((100 * counts[i]!) / n, 1)} %`).join(' · ');
}
const load1 = loadavg();
const wallS = (clock() - t0) / 1000;
const lines: string[] = [];
const push = (...l: string[]): void => void lines.push(...l);
push(
  `Letzter Lauf: ${isoDate()}, \`pnpm bench:spk3${QUICK ? ' -- --quick' : ''}\` (${Math.round(wallS)} s). **Lokal gemessen (${machine()}, Node ${process.version}), nicht Referenz-Laptop.** Fremdlast: Load-Average ${load0.map((v) => f(v, 1)).join(' / ')} → ${load1.map((v) => f(v, 1)).join(' / ')}.`,
  `Karten \`generateNavTestMap({ kind: 'bases', seed: 1 })\` 512 / 1.024 WU mit gestempelten Basen; Budget ${int(NAV_BUDGET_EXPANSIONS_PER_TICK)} Expansionen/Tick (\`PATH_BUDGET_EXPANSIONS\`).`,
  '',
  `#### 1. HPA*-Expansionen und Ticks bis Ready (200 Einzelbefehle gleichzeitig, ${BURST_REPS} Läufe)`,
  '',
  '| Karte | Ticks bis alle Ready | Ready-Tick p50 / p95 / max | Expansionen/Anfrage p50 / p95 / max | Expansionen gesamt | PathService warm p50 / p95 / max (ms) | kalt p95 |',
  '|---|---|---|---|---|---|---|',
  ...burst.map(
    (b) =>
      `| ${b.map} | ${b.runs.map((r) => r.ticksUntilReady).join(', ')} | ${b.readyTicks.p50} / ${b.readyTicks.p95} / ${b.readyTicks.max} | ${int(b.expansionsPerRequest.p50)} / ${int(b.expansionsPerRequest.p95)} / ${int(b.expansionsPerRequest.max)} | ${int(b.expansionsTotal)} | ${ms(b.pathServiceWarm.p50)} / ${ms(b.pathServiceWarm.p95)} / ${ms(b.pathServiceWarm.max)} | ${ms(b.pathServiceCold.p95)} |`,
  ),
  '',
  ...burst.map((b) => `- ${b.map} Expansionen je Anfrage: ${histogram(b.expansionsPerRequestRaw, [100, 300, 1000, 3000, 10000])}`),
  ...burst.map((b) => `- ${b.map} Ready nach Ticks: ${histogram(b.readyTicksRaw.filter((v) => v >= 0), [1, 2, 3, 5, 7, 10])}`),
  '',
  `#### 2. Basisbau im Sim (200 Panzer unterwegs, alle 10 Ticks ein Footprint 3×3…8×8 wenige WU vor einer fahrenden Unit, ${BUILD_TICKS} Ticks)`,
  '',
  '| Karte | Footprints (übersprungen) | Korridor-Repaths je Footprint Ø / p95 / max | Korridor-Repaths/min | Stuck-Anfragen/min | Aufgaben/min | Befehle/min | Evictions | PathService p50 / p95 / max (ms) | Expansionen/Tick p95 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...build.map(
    (b) =>
      `| ${b.map} | ${b.footprints} (${b.skipped}) | ${f(b.repathsPerFootprint.mean)} / ${b.repathsPerFootprint.p95} / ${b.repathsPerFootprint.max} | ${f(b.perMinute.corridorRepaths, 1)} | ${f(b.perMinute.stuckRequests, 1)} | ${f(b.perMinute.giveUps, 1)} | ${f(b.perMinute.orders, 1)} | ${b.evicted} | ${ms(b.pathServiceMs.p50)} / ${ms(b.pathServiceMs.p95)} / ${ms(b.pathServiceMs.max)} | ${int(b.expansionsPerTick.p95)} |`,
  ),
  '',
  `#### 3. Gefecht im Sim (2 × 100 Panzer, je 4 Gruppen à 25, tauschen die Plätze durcheinander hindurch, ${COMBAT_TICKS} Ticks)`,
  '',
  '| Karte | Legs | Stuck-Anfragen/min | Aufgaben/min | Stau-Episoden > 3 s/min | Units mit ≥ 1 Episode | längste Pause p95 / max (Ticks) | PathService p95 / max (ms) |',
  '|---|---|---|---|---|---|---|---|',
  ...combat.map(
    (c) =>
      `| ${c.map} | ${c.legs} | ${f(c.perMinute.stuckRequests, 1)} | ${f(c.perMinute.giveUps, 1)} | ${f(c.perMinute.stalls, 1)} | ${c.unitsWithStall}/${c.units} | ${c.maxNoProgress.p95} / ${c.maxNoProgress.max} | ${ms(c.pathServiceMs.p95)} / ${ms(c.pathServiceMs.max)} |`,
  ),
  '',
  `#### 4. Repath-Strategie: Korridor-Schnitt vs. „Invalidierung beim Chunk-Eintritt + Lazy-Repair“ (Nav-Ebene, 200 Mover à 2,5 WU/s, alle 10 Ticks ein Footprint 4–10 WU vor einem Mover, ${VARIANT_TICKS} Ticks)`,
  '',
  'Notwendig = Pfad war zum Zeitpunkt des Repaths tatsächlich geschnitten (Korridorregel bzw. Brute Force `@faf/nav/check`); Fahrt auf blockiertem Stück = Mover-Prüfungen (alle 5 Ticks), bei denen das Stück zum nächsten Wegpunkt keine Clearance-LOS mehr hatte.',
  '',
  '| Karte | Strategie | Footprints | Repaths (Korridor / Chunk-Eintritt / Lazy) | Repaths/min | notwendig / unnötig | geschnitten, nie repariert | Latenz Schnitt → Repath p50 / p95 / max (Ticks) | Fahrt auf blockiertem Stück | Expansionen | Stempel ms p50 / max | PathService ms p95 |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...variants.map(
    (v) =>
      `| ${v.map} | ${v.policy === 'corridor' ? 'Korridor-Schnitt' : 'Chunk-Eintritt + Lazy-Repair'} | ${v.footprints} | ${v.repathsTotal} (${v.repathsCorridor} / ${v.repathsChunkEntry} / ${v.repathsLazy}) | ${f(v.repathsPerMinute, 1)} | ${v.necessary} / ${v.unnecessary} | ${v.cutUnrepaired} | ${v.latency.p50} / ${v.latency.p95} / ${v.latency.max} | ${v.staleTicks} | ${int(v.expansions)} | ${ms(v.stampMs.p50)} / ${ms(v.stampMs.max)} | ${ms(v.serviceMs.p95)} |`,
  ),
  '',
  '| Kriterium | Ergebnis | Status |',
  '|---|---|---|',
  ...checks.map((c) => `| ${c.name} | ${c.detail} | ${c.ok ? '✅' : c.gated ? '❌' : '⚠️'} |`),
);
const markdown = lines.join('\n');
const file = resolve(RESULTS_DIR, `spk3-${isoDate()}.json`);
writeText(
  file,
  JSON.stringify(
    {
      format: 'faf-spk3-bench',
      version: 1,
      date: new Date().toISOString(),
      mode: QUICK ? 'quick' : 'full',
      machine: `${machine()} (lokal gemessen, nicht Referenz-Laptop)`,
      node: process.version,
      loadAverage: { before: load0, after: load1 },
      checks,
      burst,
      build,
      combat,
      variants,
    },
    null,
    2,
  ) + '\n',
);
if (!UPDATE_DOCS) log('\n' + markdown);
else if (existsSync(DOC)) {
  const doc = readFileSync(DOC, 'utf8');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a >= 0 && b > a) {
    writeText(DOC, doc.slice(0, a + BEGIN.length) + '\n' + markdown + '\n' + doc.slice(b));
    log(`status tables updated: ${DOC}`);
  } else console.warn(`markers ${BEGIN}/${END} not found in ${DOC}`);
}
log(`\nreport: ${file} (${Math.round(wallS)} s)`);
const failed = checks.filter((c) => c.gated && !c.ok);
for (const c of checks) log(`${c.ok ? '✅' : c.gated ? '❌' : '⚠️'} ${c.name}: ${c.detail}`);
if (failed.length > 0) {
  console.error(`\n✗ spk3: ${failed.length} criteria failed`);
  process.exit(1);
}
