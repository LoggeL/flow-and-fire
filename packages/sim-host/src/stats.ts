/**
 * Phase timing (PLAN §3.12 L6: p50/p95/p99 per phase and for the hash tick). The probe brackets
 * each sim phase with the host clock; samples go into fixed-size rings, percentiles are computed
 * on demand into a scratch buffer. Recording is allocation-free.
 */

import { PHASE_ID_COUNT, PHASE_NAMES, PhaseId, type PhaseProbe } from '@faf/sim';
import type { Clock } from './clock.ts';

/** Metric ids: 1..17 = sim PhaseId (17 = HashTick), plus host-side metrics. */
export const Metric = {
  /** Whole `step()` incl. the hash tick. */
  Tick: 0,
  HashTick: PhaseId.HashTick,
  /** Frame writing + publishing. */
  Frame: PHASE_ID_COUNT,
  /** Recorder + keyframes + sources (host overhead around the step). */
  Host: PHASE_ID_COUNT + 1,
} as const;
export const METRIC_COUNT = PHASE_ID_COUNT + 2;

/** Metric names (index = metric id). */
export const METRIC_NAMES: readonly string[] = (() => {
  const n = PHASE_NAMES.slice();
  n[Metric.Tick] = 'Tick';
  n[Metric.Frame] = 'Frame';
  n[Metric.Host] = 'Host';
  return n;
})();

export interface PercentileSummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** Ring buffers of µs samples per metric. */
export class PhaseStats {
  readonly window: number;
  private readonly samples: Float64Array;
  private readonly counts: Float64Array;
  private readonly scratch: Float64Array;

  constructor(window = 256) {
    this.window = Math.max(1, window);
    this.samples = new Float64Array(METRIC_COUNT * this.window);
    this.counts = new Float64Array(METRIC_COUNT);
    this.scratch = new Float64Array(this.window);
  }

  record(metric: number, us: number): void {
    const c = this.counts[metric]!;
    this.samples[metric * this.window + (c % this.window)] = us;
    this.counts[metric] = c + 1;
  }

  /** Total samples recorded for `metric` (not limited by the window). */
  count(metric: number): number {
    return this.counts[metric]!;
  }

  /** Samples currently in the window. */
  size(metric: number): number {
    const c = this.counts[metric]!;
    return c < this.window ? c : this.window;
  }

  private sorted(metric: number): number {
    const n = this.size(metric);
    const s = this.scratch;
    const base = metric * this.window;
    for (let i = 0; i < n; i++) s[i] = this.samples[base + i]!;
    s.subarray(0, n).sort();
    return n;
  }

  /** Percentile `q` (0..1, nearest rank) of the window; 0 if empty. */
  percentile(metric: number, q: number): number {
    const n = this.sorted(metric);
    if (n === 0) return 0;
    return this.scratch[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]!;
  }

  /** p50/p95/p99/max/mean of the window into `out`. */
  summarize(metric: number, out: PercentileSummary): PercentileSummary {
    const n = this.sorted(metric);
    const s = this.scratch;
    out.count = n;
    if (n === 0) {
      out.p50 = out.p95 = out.p99 = out.max = out.mean = 0;
      return out;
    }
    const at = (q: number): number => s[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]!;
    out.p50 = at(0.5);
    out.p95 = at(0.95);
    out.p99 = at(0.99);
    out.max = s[n - 1]!;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s[i]!;
    out.mean = sum / n;
    return out;
  }

  reset(): void {
    this.counts.fill(0);
  }
}

export function emptySummary(): PercentileSummary {
  return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
}

/**
 * PhaseProbe measuring with the host clock. `lastUs[id]` holds the durations of the most recent
 * tick (debug frame section); every measurement also goes into `stats`.
 */
export class TimingProbe implements PhaseProbe {
  readonly stats: PhaseStats;
  readonly lastUs = new Float64Array(METRIC_COUNT);
  private readonly t0 = new Float64Array(METRIC_COUNT);
  private readonly clock: Clock;

  constructor(clock: Clock, stats: PhaseStats) {
    this.clock = clock;
    this.stats = stats;
  }

  begin(phase: number): void {
    const now = this.clock.now();
    this.t0[phase] = now;
    // The first phase opens the whole step (Metric.Tick).
    if (phase === PhaseId.CommandApply) this.t0[Metric.Tick] = now;
  }

  end(phase: number): void {
    const now = this.clock.now();
    const us = (now - this.t0[phase]!) * 1000;
    this.lastUs[phase] = us;
    this.stats.record(phase, us);
    // Output is the last phase: close the whole step (incl. the nested hash tick).
    if (phase === PhaseId.Output) {
      const tick = (now - this.t0[Metric.Tick]!) * 1000;
      this.lastUs[Metric.Tick] = tick;
      this.stats.record(Metric.Tick, tick);
    }
  }
}
