/**
 * Benchmark suite of the AI (TRACK-AI tai-p6; local Apple-silicon/Node figures, no reference laptop):
 *
 *   (a) think time per difficulty (Setons 1v1, 15 min; quick 5 min)
 *   (b) Big Battle 2 × 300, Hard (AI-BUD-01 analogue; 1,200 ticks, quick 300)
 *   (c) SPK7 analogue: AI in worker threads, real-time scheduler at 3x (3,000 ticks, quick 600)
 *   (d) arena throughput with and without AI (from (a))
 *
 * Gates: ops-p99 ≤ budget and 0 aborted thinks in (a) and (b), SPK7 wait share < 1 %, replays
 * bit-exact. Report only: Normal think p95 ≤ 8 ms (ai.md §2.3 target on the reference laptop), Big
 * Battle step p95 with vs. without AI (±2 %, AI-BUD-01).
 */
import type { Difficulty } from '@faf/ai';
import { cpus, platform, release } from 'node:os';
import type { Summary } from '../stats/summary.ts';
import type { GateResult } from '../tournament/aggregate.ts';
import { benchBigBattle, type BigBattleResult } from './big-battle.ts';
import { wallNow } from './clock.ts';
import { benchSpk7, type Spk7Result } from './spk7.ts';
import { benchThinkTime, type ThinkTimeResult } from './think-time.ts';

export const BENCH_SCHEMA = 'faf-ai-arena/bench/1';

/** Normal think p95 target of ai.md §2.3 (reference laptop). */
export const THINK_P95_TARGET_MS = 8;
/** SPK7 exit criterion (PLAN §4). */
export const SPK7_WAIT_GATE_PCT = 1;

export interface BenchConfig {
  readonly quick: boolean;
  readonly thinkTicks: number;
  readonly profiles: readonly Difficulty[];
  readonly bigBattlePerSide: number;
  readonly bigBattleTicks: number;
  readonly spk7Ticks: number;
  readonly spk7Speed: number;
  readonly brainSpec?: string;
}

export function benchConfig(quick: boolean, brainSpec?: string): BenchConfig {
  return {
    quick,
    thinkTicks: quick ? 3000 : 9000,
    profiles: ['easy', 'normal', 'hard'],
    bigBattlePerSide: 300,
    bigBattleTicks: quick ? 300 : 1200,
    spk7Ticks: quick ? 600 : 3000,
    spk7Speed: 3,
    ...(brainSpec !== undefined ? { brainSpec } : {}),
  };
}

export interface BenchReport {
  readonly schema: typeof BENCH_SCHEMA;
  readonly note: string;
  readonly config: BenchConfig;
  readonly machine: { readonly cpu: string; readonly cores: number; readonly platform: string; readonly node: string };
  readonly thinkTime: readonly ThinkTimeResult[];
  readonly bigBattle: BigBattleResult;
  readonly spk7: Spk7Result;
  readonly wallSeconds: number;
  readonly gates: readonly GateResult[];
  readonly passed: boolean;
}

export interface RunBenchOptions {
  readonly log?: (line: string) => void;
}

export async function runBench(config: BenchConfig, o: RunBenchOptions = {}): Promise<BenchReport> {
  const log = o.log ?? (() => undefined);
  const t0 = wallNow();
  const spec = config.brainSpec !== undefined ? { brainSpec: config.brainSpec } : {};
  const thinkTime: ThinkTimeResult[] = [];
  for (const p of config.profiles) {
    log(`(a) think time ${p}: Setons 1v1, ${config.thinkTicks} ticks`);
    thinkTime.push(await benchThinkTime(p, { ticks: config.thinkTicks, ...spec }));
  }
  log(`(b) big battle 2 × ${config.bigBattlePerSide}, hard, ${config.bigBattleTicks} ticks`);
  const bigBattle = await benchBigBattle({ perSide: config.bigBattlePerSide, ticks: config.bigBattleTicks, ...spec });
  log(`(c) SPK7 analogue: worker AI at ${config.spk7Speed}x, ${config.spk7Ticks} ticks`);
  const spk7 = await benchSpk7({ ticks: config.spk7Ticks, speed: config.spk7Speed, ...spec });
  const gates = benchGates(thinkTime, bigBattle, spk7);
  const c = cpus();
  return {
    schema: BENCH_SCHEMA,
    note: 'Arena (Headless-Test-Sim) auf dem Entwicklungsrechner, Node – kein Referenz-Laptop',
    config,
    machine: { cpu: c[0]?.model ?? 'unknown', cores: c.length, platform: `${platform()} ${release()}`, node: process.version },
    thinkTime,
    bigBattle,
    spk7,
    wallSeconds: (wallNow() - t0) / 1000,
    gates,
    passed: gates.every((g) => !g.blocking || g.pass),
  };
}

export function benchGates(thinkTime: readonly ThinkTimeResult[], bb: BigBattleResult, spk7: Spk7Result): GateResult[] {
  const g: GateResult[] = [];
  for (const t of thinkTime) {
    g.push({
      id: `think-ops:${t.profile}`,
      label: `(a) ops-p99 je Think ${t.profile}`,
      blocking: true,
      pass: t.ops.p99 <= t.budget,
      value: `${t.ops.p99} (max ${t.ops.max})`,
      threshold: `≤ ${t.budget}`,
    });
    g.push({ id: `think-abort:${t.profile}`, label: `(a) aiTimeout ${t.profile}`, blocking: true, pass: t.aborted === 0, value: String(t.aborted), threshold: '0' });
    g.push({ id: `think-replay:${t.profile}`, label: `(a) Replay bitgleich ${t.profile}`, blocking: true, pass: t.replayHashEqual, value: String(t.replayHashEqual), threshold: 'true' });
    if (t.profile === 'normal') {
      g.push({
        id: 'think-p95:normal',
        label: '(a) Think-Zeit p95 normal (Ziel Referenz-Laptop)',
        blocking: false,
        pass: t.thinkMs.p95 <= THINK_P95_TARGET_MS,
        value: `${t.thinkMs.p95.toFixed(3)} ms`,
        threshold: `≤ ${THINK_P95_TARGET_MS} ms (Bericht)`,
      });
    }
  }
  g.push({ id: 'bb-ops', label: `(b) Big Battle ops-p99 ${bb.profile}`, blocking: true, pass: bb.ops.p99 <= bb.budget, value: `${bb.ops.p99} (max ${bb.ops.max})`, threshold: `≤ ${bb.budget}` });
  g.push({ id: 'bb-abort', label: '(b) Big Battle aiTimeout', blocking: true, pass: bb.aborted === 0, value: String(bb.aborted), threshold: '0' });
  g.push({ id: 'bb-replay', label: '(b) Big Battle Replay bitgleich', blocking: true, pass: bb.replayHashEqual, value: String(bb.replayHashEqual), threshold: 'true' });
  g.push({
    id: 'bb-step',
    label: '(b) Arena-Tick-p95 mit/ohne KI',
    blocking: false,
    pass: Math.abs(bb.stepP95DeltaPct) <= 2,
    value: `${bb.stepMsWithAi.p95.toFixed(3)} / ${bb.stepMsNoAi.p95.toFixed(3)} ms (${bb.stepP95DeltaPct >= 0 ? '+' : ''}${bb.stepP95DeltaPct.toFixed(1)} %)`,
    threshold: '±2 % (Bericht)',
  });
  g.push({
    id: 'spk7-wait',
    label: `(c) SPK7: Ticks mit Warten auf 'pending' bei ${spk7.speed}x`,
    blocking: true,
    pass: spk7.waitedPct < SPK7_WAIT_GATE_PCT,
    value: `${spk7.ticksWaited}/${spk7.ticks} = ${spk7.waitedPct.toFixed(2)} %`,
    threshold: `< ${SPK7_WAIT_GATE_PCT} %`,
  });
  g.push({ id: 'spk7-abort', label: '(c) SPK7 aiTimeout', blocking: true, pass: spk7.aborted === 0, value: String(spk7.aborted), threshold: '0' });
  return g;
}

// ---- rendering ------------------------------------------------------------------------------------

const f3 = (v: number): string => v.toFixed(3);
const ms3 = (s: Summary): string => `${f3(s.p50)} / ${f3(s.p95)} / ${f3(s.p99)} / ${f3(s.max)}`;

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  return lines.join('\n');
}

/** Markdown tables of a bench report. */
export function renderBench(r: BenchReport): string {
  const out: string[] = [];
  out.push(`## KI-Benchmarks${r.config.quick ? ' (--quick)' : ''} – ${r.passed ? 'BESTANDEN' : 'NICHT BESTANDEN'}`);
  out.push('');
  out.push(`${r.note}. ${r.machine.cpu}, ${r.machine.cores} Kerne, ${r.machine.platform}, Node ${r.machine.node}. Laufzeit ${r.wallSeconds.toFixed(0)} s.`);
  out.push('');
  out.push('### (a) Think-Zeit je Schwierigkeit (Setons 1v1, synchroner Host) und (d) Durchsatz');
  out.push('');
  out.push(
    table(
      ['Profil', 'Ticks', 'Thinks', 'Think ms p50/p95/p99/max', 'ops p50/p99/max', 'Budget', 'Abbrüche', 'Ticks/s mit KI', 'Ticks/s Arena allein'],
      r.thinkTime.map((t) => [
        t.profile,
        String(t.ticks),
        String(t.thinks),
        ms3(t.thinkMs),
        `${t.ops.p50} / ${t.ops.p99} / ${t.ops.max}`,
        String(t.budget),
        String(t.aborted),
        t.ticksPerSecWithAi.toFixed(0),
        t.ticksPerSecArena.toFixed(0),
      ]),
    ),
  );
  for (const t of r.thinkTime) {
    out.push('');
    out.push(`ops-p99 je Manager (${t.profile}): ` + t.managers.map((m) => `${m.name} ${m.p99}/${m.budget}`).join(' · '));
  }
  const bb = r.bigBattle;
  out.push('');
  out.push(`### (b) Big Battle 2 × ${bb.perSide} (${bb.profile}, ${bb.ticks} Ticks)`);
  out.push('');
  out.push(
    table(
      ['Thinks', 'ops p50/p99/max', 'Budget', 'Abbrüche', 'Think ms p50/p95/p99/max', 'Arena-Tick ms mit KI p50/p95/p99/max', 'ohne KI (Replay)', 'Δ p95', 'Verluste', 'Commands'],
      [
        [
          String(bb.thinks),
          `${bb.ops.p50} / ${bb.ops.p99} / ${bb.ops.max}`,
          String(bb.budget),
          String(bb.aborted),
          ms3(bb.thinkMs),
          ms3(bb.stepMsWithAi),
          ms3(bb.stepMsNoAi),
          `${bb.stepP95DeltaPct.toFixed(1)} %`,
          bb.unitsLost.join(' / '),
          String(bb.commands),
        ],
      ],
    ),
  );
  const s = r.spk7;
  out.push('');
  out.push(`### (c) SPK7-Analogon (KI im Worker, ${s.speed}x = ${s.tickMs.toFixed(1)} ms je Tick, ≤ 3 Ticks je Slice)`);
  out.push('');
  out.push(
    table(
      ['Ticks', 'Ticks mit Warten', 'Anteil', 'Warte-Polls', 'Wartezeit ms p50/p95/max', 'eff. Tempo', 'Step ms p50/p95/p99/max', 'Think ms (Worker) p50/p95/p99/max', 'Ladezeit'],
      [
        [
          String(s.ticks),
          String(s.ticksWaited),
          `${s.waitedPct.toFixed(2)} %`,
          String(s.pendingPolls),
          `${f3(s.waitMs.p50)} / ${f3(s.waitMs.p95)} / ${f3(s.waitMs.max)}`,
          `${s.effectiveSpeed.toFixed(2)}x`,
          ms3(s.stepMs),
          ms3(s.thinkMs),
          `${s.readyMs.toFixed(0)} ms`,
        ],
      ],
    ),
  );
  out.push('');
  out.push('### Gates');
  out.push('');
  out.push(table(['Gate', 'Wert', 'Schwelle', 'Ergebnis'], r.gates.map((g) => [g.label, g.value, g.threshold, g.pass ? 'ok' : g.blocking ? 'VERLETZT' : 'verfehlt (Bericht)'])));
  out.push('');
  return out.join('\n');
}
