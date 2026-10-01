/**
 * Signal measurements on rendered/decoded PCM (plain Float32Array channels, no DOM), shared by the
 * browser test cases and their Vitest unit tests.
 */

/** Clamps a sample window to 0..len. */
function window(len: number, from: number, to: number): [number, number] {
  const a = Math.max(0, Math.min(len, Math.floor(from)));
  const b = Math.max(a, Math.min(len, Math.floor(to)));
  return [a, b];
}

/** Sum of squares of `ch[from..to)`. */
export function energy(ch: Float32Array, from = 0, to = ch.length): number {
  const [a, b] = window(ch.length, from, to);
  let s = 0;
  for (let i = a; i < b; i++) {
    const v = ch[i]!;
    s += v * v;
  }
  return s;
}

/** RMS over all channels in `[from, to)` samples (0 for an empty window). */
export function rms(channels: readonly Float32Array[], from = 0, to = Number.POSITIVE_INFINITY): number {
  let s = 0;
  let n = 0;
  for (const ch of channels) {
    const [a, b] = window(ch.length, from, to);
    s += energy(ch, a, b);
    n += b - a;
  }
  return n === 0 ? 0 : Math.sqrt(s / n);
}

/** Largest absolute sample over all channels in `[from, to)`. */
export function peak(channels: readonly Float32Array[], from = 0, to = Number.POSITIVE_INFINITY): number {
  let p = 0;
  for (const ch of channels) {
    const [a, b] = window(ch.length, from, to);
    for (let i = a; i < b; i++) {
      const v = Math.abs(ch[i]!);
      if (v > p) p = v;
    }
  }
  return p;
}

/** 10·log10(a / b) with a floor for silence (−200 dB / +200 dB instead of ±∞). */
export function ratioDb(a: number, b: number): number {
  const tiny = 1e-20;
  return 10 * Math.log10(Math.max(a, tiny) / Math.max(b, tiny));
}

/** Median of a numeric array (copy is sorted; NaN for an empty input). */
export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return Number.NaN;
  const s = Float64Array.from(values).sort();
  const mid = n >> 1;
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Pearson correlation of `a[i]` and `b[i + lag]` over the overlapping range (NaN if the overlap is
 * empty or one side is constant).
 */
export function correlation(a: Float32Array, b: Float32Array, lag = 0): number {
  const start = Math.max(0, -lag);
  const end = Math.min(a.length, b.length - lag);
  const n = end - start;
  if (n <= 1) return Number.NaN;
  let sa = 0;
  let sb = 0;
  for (let i = start; i < end; i++) {
    sa += a[i]!;
    sb += b[i + lag]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = start; i < end; i++) {
    const da = a[i]! - ma;
    const db = b[i + lag]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return Number.NaN;
  return cov / Math.sqrt(va * vb);
}

/** Best correlation over lags −maxLag..maxLag (ties: smallest |lag|). */
export function bestCorrelation(a: Float32Array, b: Float32Array, maxLag: number): { corr: number; lag: number } {
  let best = correlation(a, b, 0);
  let bestLag = 0;
  for (let d = 1; d <= maxLag; d++) {
    for (const lag of [-d, d]) {
      const c = correlation(a, b, lag);
      if (c > best || (Number.isNaN(best) && !Number.isNaN(c))) {
        best = c;
        bestLag = lag;
      }
    }
  }
  return { corr: best, lag: bestLag };
}

/** Result of {@link seamCheck}. */
export interface SeamCheck {
  /** Output sample index of the loop wrap (first sample read from loopStart). */
  index: number;
  /** max |x[n] − x[n−1]| for n ∈ {index, index + 1} over all channels. */
  jump: number;
  /** Median |x[n] − x[n−1]| over ±`halfWindow` samples around the seam (all channels). */
  medianDiff: number;
  /** jump / medianDiff (0 if both are 0). */
  ratio: number;
}

/**
 * Sample discontinuity at a loop seam compared with the local signal activity: a clean seam has a
 * step no larger than a few typical sample-to-sample differences of its neighbourhood.
 */
export function seamCheck(channels: readonly Float32Array[], index: number, halfWindow: number): SeamCheck {
  let jump = 0;
  const diffs: number[] = [];
  for (const ch of channels) {
    for (const n of [index, index + 1]) {
      if (n >= 1 && n < ch.length) jump = Math.max(jump, Math.abs(ch[n]! - ch[n - 1]!));
    }
    const a = Math.max(1, index - halfWindow);
    const b = Math.min(ch.length, index + halfWindow + 1);
    for (let n = a; n < b; n++) diffs.push(Math.abs(ch[n]! - ch[n - 1]!));
  }
  const medianDiff = median(diffs);
  const ratio = jump === 0 && medianDiff === 0 ? 0 : jump / medianDiff;
  return { index, jump, medianDiff, ratio };
}
