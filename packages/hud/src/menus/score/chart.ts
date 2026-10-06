/**
 * Chart maths of the score screen (ui.md §5.15): one shared y axis for both series, "nice" tick steps,
 * time axis in minutes, SVG paths, direct labels at the line ends (pushed apart when they would collide)
 * and the crosshair lookup. Pure functions – tested without a DOM.
 */
import { sampleTime } from '../../model/menus/score.ts';

export interface ChartBox {
  readonly width: number;
  readonly height: number;
  /** Plot margins (left: y tick labels, right: direct labels). */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface NiceScale {
  /** Top of the axis (a multiple of step). */
  readonly max: number;
  readonly step: number;
  readonly ticks: readonly number[];
}

function scaleFor(maxValue: number, count: number): NiceScale {
  const raw = Number.isFinite(maxValue) && maxValue > 0 ? maxValue / count : 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw - 1e-9) ?? 10 * mag) as number;
  const ticks: number[] = [];
  for (let k = 0; k <= count; k++) ticks.push(Math.round(step * k * 1e6) / 1e6);
  return { max: Math.round(step * count * 1e6) / 1e6, step, ticks };
}

/**
 * Axis from 0 to a "nice" maximum (steps 1, 2, 2.5, 5 × 10^n) with `minCount`…`maxCount` intervals, as in the
 * mockup: the interval count whose top lies closest above the data wins (fewer intervals on a tie), so 4.300
 * gets 0–5.000 in steps of 1.000 instead of 0–8.000. A zero or empty range still yields a usable axis.
 */
export function niceScale(maxValue: number, minCount = 4, maxCount = minCount + 1): NiceScale {
  let best = scaleFor(maxValue, minCount);
  for (let c = minCount + 1; c <= maxCount; c++) {
    const s = scaleFor(maxValue, c);
    if (s.max < best.max) best = s;
  }
  return best;
}

/** Minute ticks (seconds) so that at most `maxTicks` fit: every 1, 2, 4, 5, 10, 15, 20 or 30 minutes. */
export function timeTicks(durationS: number, maxTicks = 7): readonly number[] {
  const steps = [60, 120, 240, 300, 600, 900, 1200, 1800, 3600];
  const d = Math.max(0, durationS);
  const step = steps.find((s) => Math.floor(d / s) + 1 <= maxTicks) ?? (steps[steps.length - 1] as number);
  const out: number[] = [];
  for (let s = 0; s <= d + 1e-9; s += step) out.push(s);
  return out;
}

/** "4:00" style tick label (whole minutes). */
export function minuteLabel(seconds: number): string {
  return `${Math.round(seconds / 60)}:00`;
}

export interface ChartGeometry {
  readonly box: ChartBox;
  readonly scale: NiceScale;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  x(timeS: number): number;
  y(value: number): number;
}

/** Plot geometry for two series sharing ONE y axis (the larger maximum of both decides). */
export function chartGeometry(box: ChartBox, durationS: number, series: readonly (readonly number[])[]): ChartGeometry {
  let max = 0;
  for (const s of series) for (const v of s) if (v > max) max = v;
  const scale = niceScale(max);
  const x0 = box.left;
  const x1 = Math.max(x0 + 1, box.width - box.right);
  const y0 = box.top;
  const y1 = Math.max(y0 + 1, box.height - box.bottom);
  const d = Math.max(1, durationS);
  return {
    box,
    scale,
    x0,
    x1,
    y0,
    y1,
    x: (t) => x0 + (Math.min(d, Math.max(0, t)) / d) * (x1 - x0),
    y: (v) => y0 + (1 - Math.min(scale.max, Math.max(0, v)) / scale.max) * (y1 - y0),
  };
}

function r1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}

/** SVG path "M x y L x y …" of a series (sample i at min(i × step, duration)). */
export function linePath(g: ChartGeometry, values: readonly number[], stepS: number, durationS: number): string {
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${r1(g.x(sampleTime(i, stepS, durationS)))} ${r1(g.y(v))}`).join(' ');
}

/**
 * Vertical positions of direct labels: sorted and pushed apart to at least `gap` px, kept inside
 * [min, max]. Returns positions in the input order.
 */
export function separateLabels(ys: readonly number[], gap: number, min: number, max: number): readonly number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const pos = order.map((o) => o.y);
  for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k] as number, (pos[k - 1] as number) + gap);
  const overflow = (pos[pos.length - 1] ?? 0) - max;
  if (overflow > 0) for (let k = 0; k < pos.length; k++) pos[k] = (pos[k] as number) - overflow;
  for (let k = pos.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k] as number, (pos[k + 1] as number) - gap);
  if ((pos[0] ?? min) < min) {
    const shift = min - (pos[0] as number);
    for (let k = 0; k < pos.length; k++) pos[k] = (pos[k] as number) + shift;
  }
  const out: number[] = new Array<number>(ys.length);
  order.forEach((o, k) => {
    out[o.i] = pos[k] as number;
  });
  return out;
}

/** Sample index under a pointer x (clamped, nearest sample in time). */
export function indexAtX(g: ChartGeometry, px: number, count: number, stepS: number, durationS: number): number {
  if (count <= 1) return 0;
  const f = (Math.min(g.x1, Math.max(g.x0, px)) - g.x0) / (g.x1 - g.x0);
  const t = f * Math.max(1, durationS);
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const d = Math.abs(sampleTime(i, stepS, durationS) - t);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}
