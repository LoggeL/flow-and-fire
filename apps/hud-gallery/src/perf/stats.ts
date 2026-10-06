/** Summary statistics of the perf harness (pure). */
export interface PerfSummary {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export const EMPTY_SUMMARY: PerfSummary = { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };

/** Nearest-rank percentiles (p95 of 600 samples = the 570th smallest). */
export function summarize(samples: readonly number[]): PerfSummary {
  if (samples.length === 0) return EMPTY_SUMMARY;
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
  let sum = 0;
  for (const v of s) sum += v;
  const r = (v: number): number => Math.round(v * 10000) / 10000;
  return { n: s.length, mean: r(sum / s.length), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1]!) };
}

/** DOM nodes under a root, counting every <svg> as <svg><use> (2 nodes) like the gallery layout check. */
export function countHudNodes(root: Element): number {
  const svgs = root.querySelectorAll('svg').length;
  const svgInner = root.querySelectorAll('svg *').length;
  return root.querySelectorAll('*').length - svgInner + svgs;
}
