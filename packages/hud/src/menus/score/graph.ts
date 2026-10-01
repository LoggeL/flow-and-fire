import type { ScoreSeries } from '../../model/menus/score.ts';
export function seriesMax(s: ScoreSeries): number { return Math.max(1, ...s.self, ...s.enemy); }
export function seriesPath(values: readonly number[], max: number, width = 420, height = 150): string { return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${40 + i / Math.max(1, values.length - 1) * width},${170 - Math.max(0, v) / max * height}`).join(' '); }
export function sampleAt(s: ScoreSeries, fraction: number) { const index = Math.max(0, Math.min(Math.max(s.self.length, s.enemy.length) - 1, Math.round(fraction * (Math.max(s.self.length, s.enemy.length) - 1)))); return { index, timeS: index * s.stepS, self: s.self[index] ?? 0, enemy: s.enemy[index] ?? 0 }; }
export function isBetter(a: number | null, b: number | null, lower = false): boolean { return a !== null && b !== null && (lower ? a < b : a > b); }
