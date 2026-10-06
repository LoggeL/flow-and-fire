/**
 * Calibration smoke runs of TRACK-AI (tai-p5; not part of `pnpm test`):
 *
 *   tools/heavy node --import tsx tools/ai-arena/src/scenarios/smoke.ts [--maps a,b] [--seeds 1,2,3]
 *                                                                        [--minutes 30] [--json out.json]
 *
 * Normal against Normal (default brain, weighted opening selection by seed) on Setons, Hollow Ridge
 * and Tessera with seeds 1–3, up to 30 min game time or a commander's death. Checks per run and side
 * (ai.md §7.1/§7.2, MS9 gates in the arena): no crash, T2 ≤ 12:00, first wave (telemetry waveAttack
 * with enemyHalf) ≤ 8:00, idle engineers < 15 %, APM-p99 (60-s windows) ≤ cap, ops-p99 per think ≤
 * budget (total and per manager allotment), 0 aborted thinks. Energy stall as defined by ai.md §7.1
 * (R-G4): the gate is the POOLED share over all sides ≤ 5 %; per side it is reported, sides above
 * 10 % are listed as outliers (with `--strict-stall` every side must stay ≤ 5 %). It also measures the
 * think time of Normal (p50/p95/p99 over all thinks, wall clock — the only place in the arena
 * besides bench/** that reads it; the measurement never feeds back into a decision).
 *
 * The tournament with ≥ 200 games and Wilson bounds is tai-p6/tai-p7 (tournament runner).
 */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createDefaultBrain, PROFILES, type AiBrain, type ThinkOptions, type ThinkResult } from '@faf/ai';
import { nearestRank, runScenario, secondsOf, type ScenarioResult } from './dsl.ts';

const T2_GATE_S = 720;
const WAVE_GATE_S = 480;
const IDLE_GATE_PCT = 15;
const STALL_GATE_PCT = 5;
const STALL_OUTLIER_PCT = 10;

interface Args {
  maps: string[];
  seeds: number[];
  minutes: number;
  json: string | null;
  strictStall: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = { maps: ['setons', 'hollow-ridge', 'tessera'], seeds: [1, 2, 3], minutes: 30, json: null, strictStall: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--strict-stall') {
      a.strictStall = true;
      continue;
    }
    if (k === '--maps' && v !== undefined) a.maps = v.split(',');
    else if (k === '--seeds' && v !== undefined) a.seeds = v.split(',').map(Number);
    else if (k === '--minutes' && v !== undefined) a.minutes = Number(v);
    else if (k === '--json' && v !== undefined) a.json = v;
    else continue;
    i++;
  }
  return a;
}

/** Wraps a brain and measures the wall-clock time of every think (ms). */
function timedBrain(inner: AiBrain, times: number[]): AiBrain {
  return {
    init: (s, p, o) => inner.init(s, p, o),
    think: (view, opts?: ThinkOptions): ThinkResult => {
      const t0 = performance.now();
      const r = inner.think(view, opts);
      times.push(performance.now() - t0);
      return r;
    },
    get initialized() {
      return inner.initialized;
    },
    get blackboard() {
      return inner.blackboard;
    },
    get analysis() {
      return inner.analysis;
    },
    get opening() {
      return inner.opening;
    },
    get profile() {
      return inner.profile;
    },
    get static() {
      return inner.static;
    },
    get managerNames() {
      return inner.managerNames;
    },
    manager: (name) => inner.manager?.(name),
  };
}

export interface SmokeSide {
  readonly army: number;
  readonly opening: string;
  readonly t2S: number | null;
  readonly waveS: number | null;
  readonly waveUnits: number | null;
  readonly idlePct: number;
  readonly stallPct: number;
  readonly stallTicks: number;
  readonly countedTicks: number;
  readonly apmP99: number;
  readonly opsP99: number;
  readonly opsMax: number;
  readonly managerOver: string[];
  readonly aborted: number;
  readonly failures: string[];
}

export interface SmokeRun {
  readonly map: string;
  readonly seed: number;
  readonly crashed: string | null;
  readonly endS: number;
  readonly endReason: string;
  readonly winner: number;
  readonly wallMs: number;
  readonly sides: SmokeSide[];
  readonly ok: boolean;
}

function evaluateSide(r: ScenarioResult, army: number, strictStall: boolean): SmokeSide {
  const m = r.army(army);
  const brain = r.brain(army);
  const p = brain.profile;
  const wave = r.first(army, 'waveAttack', (e) => e.enemyHalf);
  const windows = m.commandsPerWindow.length > 0 ? m.commandsPerWindow : [0];
  const apmP99 = nearestRank(windows, 99);
  const opsP99 = r.opsPercentile(army, 99);
  const opsMax = r.opsPercentile(army, 100);
  const managerOver: string[] = [];
  const budget = p.budget as unknown as Record<string, number>;
  for (const name of brain.managerNames) {
    const key = name === 'opening' ? 'reserve' : name;
    const allot = budget[key];
    if (allot === undefined) continue;
    const vals = r.thinks(army).map((t) => t.opsByManager[name] ?? 0);
    const p99 = nearestRank(vals, 99);
    if (p99 > allot) managerOver.push(`${name} ${p99}>${allot}`);
  }
  const aborted = r.thinks(army).filter((t) => t.aborted).length;
  const failures: string[] = [];
  const t2S = secondsOf(m.t2Tick);
  const waveS = secondsOf(wave?.tick ?? null);
  const endS = r.metrics.endTick / 10;
  // A gate only applies when the match lasted long enough to reach it.
  if (endS >= T2_GATE_S && (t2S === null || t2S > T2_GATE_S)) failures.push(`T2 ${t2S ?? '–'} s > 720 s`);
  if (endS >= WAVE_GATE_S && (waveS === null || waveS > WAVE_GATE_S)) failures.push(`wave ${waveS ?? '–'} s > 480 s`);
  if (!(m.idleEngineerPct < IDLE_GATE_PCT)) failures.push(`idle ${m.idleEngineerPct.toFixed(1)} %`);
  if (strictStall && m.energyStallPct > STALL_GATE_PCT) failures.push(`stall ${m.energyStallPct.toFixed(1)} %`);
  if (apmP99 > p.apm.cap) failures.push(`APM-p99 ${apmP99} > ${p.apm.cap}`);
  if (opsP99 > p.budget.total) failures.push(`ops-p99 ${opsP99} > ${p.budget.total}`);
  if (managerOver.length > 0) failures.push(`manager ops-p99 over allotment: ${managerOver.join(', ')}`);
  if (aborted > 0) failures.push(`${aborted} aborted thinks`);
  return {
    army,
    opening: brain.opening?.id ?? '?',
    t2S,
    waveS,
    waveUnits: wave?.units ?? null,
    idlePct: m.idleEngineerPct,
    stallPct: m.energyStallPct,
    stallTicks: m.energyStallTicks,
    countedTicks: m.energyCountedTicks,
    apmP99,
    opsP99,
    opsMax,
    managerOver,
    aborted,
    failures,
  };
}

/** One smoke run (Normal vs Normal); `times` collects the think times of both sides (ms). */
export function smokeRun(map: string, seed: number, minutes: number, times: number[], strictStall = false): SmokeRun {
  const t0 = performance.now();
  try {
    const r = runScenario({
      name: `smoke ${map} ${seed}`,
      map,
      seed,
      sides: [
        { army: 0, ai: { brain: () => timedBrain(createDefaultBrain(), times) } },
        { army: 1, ai: { brain: () => timedBrain(createDefaultBrain(), times) } },
      ],
      until: { seconds: minutes * 60 },
    });
    const sides = [evaluateSide(r, 0, strictStall), evaluateSide(r, 1, strictStall)];
    return {
      map,
      seed,
      crashed: null,
      endS: r.metrics.endTick / 10,
      endReason: r.metrics.endReason,
      winner: r.metrics.winner,
      wallMs: performance.now() - t0,
      sides,
      ok: sides.every((s) => s.failures.length === 0),
    };
  } catch (e) {
    return { map, seed, crashed: e instanceof Error ? (e.stack ?? e.message) : String(e), endS: 0, endReason: 'crash', winner: -1, wallMs: performance.now() - t0, sides: [], ok: false };
  }
}

function fmt(v: number | null, d = 1): string {
  return v === null ? '–' : v.toFixed(d);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const times: number[] = [];
  const runs: SmokeRun[] = [];
  for (const map of args.maps) {
    for (const seed of args.seeds) {
      const run = smokeRun(map, seed, args.minutes, times, args.strictStall);
      runs.push(run);
      if (run.crashed !== null) {
        console.log(`${map} seed ${seed}: CRASH\n${run.crashed}`);
        continue;
      }
      console.log(`${run.ok ? 'OK  ' : 'FAIL'} ${map} seed ${seed}: end ${fmt(run.endS)} s (${run.endReason}, winner ${run.winner}), wall ${fmt(run.wallMs, 0)} ms`);
      for (const s of run.sides) {
        console.log(
          `     army ${s.army} ${s.opening.padEnd(12)} T2 ${fmt(s.t2S)} s · wave ${fmt(s.waveS)} s (${s.waveUnits ?? '–'}) · idle ${fmt(s.idlePct)} % · stall ${fmt(s.stallPct)} % · APM-p99 ${s.apmP99} · ops-p99 ${s.opsP99} (max ${s.opsMax})${s.failures.length > 0 ? ' · ' + s.failures.join('; ') : ''}`,
        );
      }
    }
  }
  let stallTicks = 0;
  let countedTicks = 0;
  const outliers: string[] = [];
  for (const r of runs) {
    for (const s of r.sides) {
      stallTicks += s.stallTicks;
      countedTicks += s.countedTicks;
      if (s.stallPct > STALL_OUTLIER_PCT) outliers.push(`${r.map} seed ${r.seed} army ${s.army} ${s.stallPct.toFixed(1)} %`);
    }
  }
  const pooledStall = countedTicks > 0 ? (100 * stallTicks) / countedTicks : 0;
  const stallOk = pooledStall <= STALL_GATE_PCT;
  console.log(
    `\nEnergy stall pooled over ${runs.reduce((n, r) => n + r.sides.length, 0)} sides: ${pooledStall.toFixed(2)} % (gate ≤ ${STALL_GATE_PCT} %: ${stallOk ? 'OK' : 'FAIL'}); outliers > ${STALL_OUTLIER_PCT} %: ${outliers.length === 0 ? 'none' : outliers.join(', ')}`,
  );
  const ok = runs.filter((r) => r.ok).length;
  const think = { p50: nearestRank(times, 50), p95: nearestRank(times, 95), p99: nearestRank(times, 99), max: nearestRank(times, 100), n: times.length };
  console.log(`${ok}/${runs.length} runs pass. Think time Normal (wall clock, ${think.n} thinks): p50 ${think.p50.toFixed(3)} ms · p95 ${think.p95.toFixed(3)} ms · p99 ${think.p99.toFixed(3)} ms · max ${think.max.toFixed(2)} ms`);
  console.log(`Normal budget ${PROFILES.normal.budget.total} ops, APM cap ${PROFILES.normal.apm.cap}.`);
  if (args.json !== null) writeFileSync(args.json, JSON.stringify({ runs, think, pooledStall, outliers }, null, 1));
  process.exitCode = ok === runs.length && stallOk ? 0 : 1;
}

main();
