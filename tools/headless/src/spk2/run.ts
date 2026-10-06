/**
 * SPK2 runner: runs scenarios, measures (deadlock, time until all through/arrived, share without
 * stuck > 3 s, overlap, direction jitter, start-up ticks, offset error) and sweeps parameters.
 */
import { SPK2_PARAMS, type Spk2Params } from './params.ts';
import { buildScenario, SCENARIO_IDS, UNIT_TYPES, type ScenarioId } from './scenarios.ts';
import { UnitState, type Spk2Observer, type Spk2Sim } from './sim.ts';

/** No progress of all moving units for this long ⇒ deadlock (PLAN: > 5 s). */
export const DEADLOCK_TICKS = 50;
/** Stuck metric threshold (> 3 s). */
export const STUCK_METRIC_TICKS = 30;

export interface ScenarioMetrics {
  readonly scenario: ScenarioId;
  readonly seed: number;
  readonly units: number;
  readonly ticks: number;
  readonly deadlock: boolean;
  /** Seconds until the scenario goal (all through / all arrived), null if not reached. */
  readonly secondsToDone: number | null;
  /** Share of units never without progress for > 3 s while moving. */
  readonly noStuckShare: number;
  /** Largest pair penetration (WU) over the run. */
  readonly maxOverlap: number;
  /** Mean penetration of overlapping pairs, averaged over ticks (WU). */
  readonly meanOverlap: number;
  /** Largest pair penetration after all units settled (WU). */
  readonly settledMaxOverlap: number;
  /** Mean |Δyaw| per tick of moving units (°). */
  readonly yawJitterDeg: number;
  /** Heading reversals (> 1° each way) per moving unit-minute. */
  readonly yawReversalsPerMin: number;
  /** Ticks from the order until the first visible motion (turn ≥ 2° or ≥ 0.05 WU): max / mean. */
  readonly startTicksMax: number;
  readonly startTicksMean: number;
  /** Ticks from the order until the first translation ≥ 0.05 WU: max / mean. */
  readonly moveTicksMax: number;
  readonly moveTicksMean: number;
  /** Offset error of group units after arrival (WU): mean / p95 / max (null without group). */
  readonly offsetErrMean: number | null;
  readonly offsetErrP95: number | null;
  readonly offsetErrMax: number | null;
  readonly stats: Spk2Sim['stats'];
  readonly extra: Record<string, number>;
  /** All pass criteria met. */
  readonly pass: boolean;
  readonly failures: readonly string[];
  /** Wall time (ms, informative). */
  readonly wallMs: number;
}

/** Trace of positions for the Canvas2D viewer (tools/headless/spk2/viewer.html). */
export interface Spk2Trace {
  readonly format: 'faf-spk2-trace';
  readonly version: 1;
  readonly scenario: ScenarioId;
  readonly width: number;
  readonly height: number;
  /** Row-major 1 = blocked, as a string of '0'/'1' per row. */
  readonly blocked: readonly string[];
  readonly types: readonly { readonly name: string; readonly radius: number }[];
  /** Per frame: tick, then per unit [x, z, yaw, state, type] rounded (x/z 1/100 WU, yaw 1/1000 rad). */
  readonly frames: readonly { readonly tick: number; readonly units: readonly number[] }[];
  readonly params: Spk2Params;
}

class MetricsObserver implements Spk2Observer {
  maxOverlap = 0;
  overlapSum = 0;
  overlapTicks = 0;
  jitterSum = 0;
  jitterN = 0;
  reversals = 0;
  movingTicks = 0;
  private prevSign: Int8Array = new Int8Array(0);
  frames: { tick: number; units: number[] }[] | null = null;
  traceEvery = 1;

  tick(sim: Spk2Sim): void {
    if (this.prevSign.length < sim.count) {
      const n = new Int8Array(sim.cap);
      n.set(this.prevSign);
      this.prevSign = n;
    }
    // Overlap (all pairs via a simple sweep over a sorted x list is overkill: grid-free O(n log n)).
    const idx = Array.from({ length: sim.count }, (_, i) => i).sort((a, b) => sim.x[a]! - sim.x[b]!);
    let sum = 0;
    let pairs = 0;
    for (let a = 0; a < idx.length; a++) {
      const i = idx[a]!;
      for (let b = a + 1; b < idx.length; b++) {
        const j = idx[b]!;
        if (sim.x[j]! - sim.x[i]! > 2.5) break;
        const pen = sim.radius[i]! + sim.radius[j]! - Math.hypot(sim.x[j]! - sim.x[i]!, sim.z[j]! - sim.z[i]!);
        if (pen > 1e-6) {
          sum += pen;
          pairs++;
          if (pen > this.maxOverlap) this.maxOverlap = pen;
        }
      }
    }
    if (pairs > 0) {
      this.overlapSum += sum / pairs;
      this.overlapTicks++;
    }
    for (let k = 0; k < sim.count; k++) {
      if (sim.state[k] !== UnitState.Moving || sim.v[k]! < 0.1 * sim.vmax[k]!) {
        this.prevSign[k] = 0;
        continue;
      }
      const d = (sim.lastDYaw[k]! * 180) / Math.PI;
      this.jitterSum += Math.abs(d);
      this.jitterN++;
      this.movingTicks++;
      const sign = d > 1 ? 1 : d < -1 ? -1 : 0;
      if (sign !== 0) {
        if (this.prevSign[k] !== 0 && sign !== this.prevSign[k]) this.reversals++;
        this.prevSign[k] = sign;
      }
    }
    if (this.frames !== null && sim.tick % this.traceEvery === 0) {
      const u: number[] = [];
      for (let k = 0; k < sim.count; k++) {
        u.push(Math.round(sim.x[k]! * 100) / 100, Math.round(sim.z[k]! * 100) / 100, Math.round(sim.yaw[k]! * 1000) / 1000, sim.state[k]!, sim.typeIndex[k]!);
      }
      this.frames.push({ tick: sim.tick, units: u });
    }
  }
}

function settledOverlap(sim: Spk2Sim): number {
  let max = 0;
  for (let i = 0; i < sim.count; i++) {
    for (let j = i + 1; j < sim.count; j++) {
      const pen = sim.radius[i]! + sim.radius[j]! - Math.hypot(sim.x[j]! - sim.x[i]!, sim.z[j]! - sim.z[i]!);
      if (pen > max) max = pen;
    }
  }
  return max;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

export interface RunOptions {
  /** Record a trace (every n-th tick). */
  readonly traceEvery?: number;
}

/** Runs one scenario with `params` and returns its metrics (and the trace if requested). */
export function runScenario(id: ScenarioId, params: Spk2Params = SPK2_PARAMS, seed = 1, opts: RunOptions = {}): { metrics: ScenarioMetrics; trace: Spk2Trace | null } {
  const t0 = performance.now();
  const run = buildScenario(id, params, seed);
  const sim = run.sim;
  const obs = new MetricsObserver();
  if (opts.traceEvery !== undefined) {
    obs.frames = [];
    obs.traceEvery = opts.traceEvery;
  }
  let doneTick = -1;
  let deadlock = false;
  let settleExtra = 0;
  while (sim.tick < run.maxTicks) {
    run.control(sim);
    sim.step(obs);
    if (sim.tick - sim.lastAnyProgressTick > DEADLOCK_TICKS) {
      deadlock = true;
      break;
    }
    if (doneTick < 0 && run.done(sim)) doneTick = sim.tick;
    // After the goal, keep running 30 ticks to measure settling (overlap, jitter at rest).
    if (doneTick >= 0 && ++settleExtra > 30 && (allIdle(sim) || sim.tick - doneTick > 100)) break;
  }
  // Metrics.
  let noStuck = 0;
  const start: number[] = [];
  const move: number[] = [];
  for (let k = 0; k < sim.count; k++) {
    if (sim.maxNoProgress[k]! <= STUCK_METRIC_TICKS) noStuck++;
    if (sim.firstVisibleTick[k]! >= 0) start.push(sim.firstVisibleTick[k]!);
    if (sim.firstMoveTick[k]! >= 0) move.push(sim.firstMoveTick[k]!);
  }
  const errs: number[] = [];
  for (const oc of run.offsetChecks) {
    let cx = 0;
    let cz = 0;
    for (const k of oc.units) {
      cx += sim.x[k]!;
      cz += sim.z[k]!;
    }
    cx /= oc.units.length;
    cz /= oc.units.length;
    oc.units.forEach((k, i) => errs.push(Math.hypot(sim.x[k]! - cx - oc.offsets[i * 2]!, sim.z[k]! - cz - oc.offsets[i * 2 + 1]!)));
  }
  errs.sort((a, b) => a - b);
  const secondsToDone = doneTick < 0 ? null : doneTick / params.tickHz;
  const failures: string[] = [];
  if (deadlock) failures.push(`deadlock (no progress for > ${DEADLOCK_TICKS / params.tickHz} s at tick ${sim.tick})`);
  if (secondsToDone === null) failures.push(`goal not reached within ${run.maxTicks / params.tickHz} s`);
  const noStuckShare = sim.count === 0 ? 1 : noStuck / sim.count;
  if (run.criteria.maxSeconds !== undefined && secondsToDone !== null && secondsToDone > run.criteria.maxSeconds) {
    failures.push(`took ${secondsToDone} s > ${run.criteria.maxSeconds} s`);
  }
  if (run.criteria.minNoStuckShare !== undefined && noStuckShare < run.criteria.minNoStuckShare) {
    failures.push(`only ${(noStuckShare * 100).toFixed(1)} % without stuck > 3 s (< ${run.criteria.minNoStuckShare * 100} %)`);
  }
  const p95 = errs.length === 0 ? null : quantile(errs, 0.95);
  if (run.criteria.maxOffsetP95 !== undefined && p95 !== null && p95 > run.criteria.maxOffsetP95) {
    failures.push(`offset error p95 ${p95.toFixed(2)} WU > ${run.criteria.maxOffsetP95} WU`);
  }
  const moveMinutes = obs.movingTicks / params.tickHz / 60;
  const metrics: ScenarioMetrics = {
    scenario: id,
    seed,
    units: sim.count,
    ticks: sim.tick,
    deadlock,
    secondsToDone,
    noStuckShare,
    maxOverlap: obs.maxOverlap,
    meanOverlap: obs.overlapTicks === 0 ? 0 : obs.overlapSum / obs.overlapTicks,
    settledMaxOverlap: settledOverlap(sim),
    yawJitterDeg: obs.jitterN === 0 ? 0 : obs.jitterSum / obs.jitterN,
    yawReversalsPerMin: moveMinutes === 0 ? 0 : obs.reversals / moveMinutes,
    startTicksMax: start.length === 0 ? 0 : Math.max(...start),
    startTicksMean: start.length === 0 ? 0 : start.reduce((a, b) => a + b, 0) / start.length,
    moveTicksMax: move.length === 0 ? 0 : Math.max(...move),
    moveTicksMean: move.length === 0 ? 0 : move.reduce((a, b) => a + b, 0) / move.length,
    offsetErrMean: errs.length === 0 ? null : errs.reduce((a, b) => a + b, 0) / errs.length,
    offsetErrP95: p95,
    offsetErrMax: errs.length === 0 ? null : errs[errs.length - 1]!,
    stats: { ...sim.stats },
    extra: { ...run.extra },
    pass: failures.length === 0,
    failures,
    wallMs: performance.now() - t0,
  };
  let trace: Spk2Trace | null = null;
  if (obs.frames !== null) {
    const g = sim.grid;
    const blocked: string[] = [];
    for (let z = 0; z < g.height; z++) {
      let row = '';
      for (let x = 0; x < g.width; x++) row += g.blocked[z * g.width + x] ? '1' : '0';
      blocked.push(row);
    }
    trace = {
      format: 'faf-spk2-trace',
      version: 1,
      scenario: id,
      width: g.width,
      height: g.height,
      blocked,
      types: UNIT_TYPES.map((t) => ({ name: t.name, radius: t.radius })),
      frames: obs.frames,
      params,
    };
  }
  return { metrics, trace };
}

function allIdle(sim: Spk2Sim): boolean {
  for (let k = 0; k < sim.count; k++) if (sim.state[k] === UnitState.Moving || sim.v[k]! > 1e-3) return false;
  return true;
}

/** Runs all scenarios with one parameter set. */
export function runAll(params: Spk2Params = SPK2_PARAMS, seed = 1, ids: readonly ScenarioId[] = SCENARIO_IDS): ScenarioMetrics[] {
  return ids.map((id) => runScenario(id, params, seed).metrics);
}

/** Score of a parameter set (lower is better); failing sets get a large penalty per failure. */
export function score(ms: readonly ScenarioMetrics[]): number {
  let s = 0;
  for (const m of ms) {
    s += m.failures.length * 1000;
    s += m.secondsToDone ?? 300;
    s += m.meanOverlap * 50 + m.settledMaxOverlap * 20;
    s += m.yawReversalsPerMin * 0.5;
    s += (1 - m.noStuckShare) * 200;
    s += (m.offsetErrP95 ?? 0) * 5;
  }
  return s;
}

/** Swept parameters and their candidate values (one-at-a-time around the base set). */
export const SWEEP: readonly { readonly key: keyof Spk2Params; readonly values: readonly (number | boolean)[] }[] = [
  { key: 'separationStrength', values: [0.25, 0.5, 1.0] },
  { key: 'maxNeighbors', values: [4, 6, 8] },
  { key: 'arrivalRadius', values: [0.25, 0.35, 0.5] },
  { key: 'offsetMinGap', values: [0, 0.15, 0.3] },
  { key: 'returnDistance', values: [0.5, 1.0, 2.0] },
  { key: 'contagionDistance', values: [2, 4, 8] },
  { key: 'idleNudge', values: [false, true] },
  { key: 'stuckEpsilon', values: [0.1, 0.15, 0.3] },
  { key: 'movingPriority', values: [1, 2, 4, 8] },
  { key: 'offsetRadiusPerSqrtN', values: [0.8, 1.1, 1.4] },
  { key: 'startAngleDeg', values: [50, 70, 90] },
  { key: 'brakeFactor', values: [1, 2, 3] },
];

export interface SweepRow {
  readonly key: string;
  readonly value: number | boolean;
  readonly score: number;
  readonly passed: number;
  readonly failures: readonly string[];
}

/** One-at-a-time sweep: every value of every swept key, others at `base`. */
export function sweep(base: Spk2Params, ids: readonly ScenarioId[], seed = 1): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const { key, values } of SWEEP) {
    for (const value of values) {
      const p = { ...base, [key]: value } as Spk2Params;
      const ms = runAll(p, seed, ids);
      rows.push({
        key,
        value,
        score: score(ms),
        passed: ms.filter((m) => m.pass).length,
        failures: ms.flatMap((m) => m.failures.map((f) => `${m.scenario}: ${f}`)),
      });
    }
  }
  return rows;
}
