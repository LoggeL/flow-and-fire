/** Shared console output for the CLIs. */

/** Directory the user invoked pnpm from (pnpm --filter runs scripts inside the package). */
export const USER_CWD = process.env.INIT_CWD ?? process.cwd();

export const SPECTRO_DIR = process.env.FAF_SFX_SPECTRO_DIR ?? '/private/tmp/claude-501/faf-sfx';

export interface Row {
  file: string;
  category?: string;
  durationS: number;
  lufs: number;
  truePeakDb: number;
  target?: number;
  rmsDb?: number;
  peakDb?: number;
  centroidHz?: number;
  clipped?: number;
  xcheck?: number | null;
  /** Momentary max (analyze CLI). */
  lufsM?: number;
  /** Which value the target applies to. */
  mode?: 'integrated' | 'momentary';
}

const f = (v: number | undefined, d = 1): string => (v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d));

export function printTable(rows: readonly Row[]): void {
  const extended = rows.some((r) => r.rmsDb !== undefined);
  const head = extended
    ? ['Datei', 'Dauer s', 'I LUFS', 'M-max', 'Δ Ziel', 'Peak dB', 'TP dBTP', 'RMS dB', 'Schwerpkt Hz', 'Clip', 'ffmpeg I']
    : ['Datei', 'Kategorie', 'Dauer s', 'LUFS', 'Ziel', 'TP dBTP'];
  const body = rows.map((r) =>
    extended
      ? [r.file, f(r.durationS, 3), f(r.lufs, 2), f(r.lufsM, 2), r.target === undefined ? '–' : f((r.mode === 'integrated' ? r.lufs : (r.lufsM ?? r.lufs)) - r.target, 2) + (r.mode === 'integrated' ? ' (I)' : ' (M)'), f(r.peakDb, 2), f(r.truePeakDb, 2), f(r.rmsDb, 1), f(r.centroidHz, 0), String(r.clipped ?? 0), r.xcheck == null ? '–' : f(r.xcheck, 2)]
      : [r.file, r.category ?? '', f(r.durationS, 3), f(r.lufs, 2), f(r.target, 0), f(r.truePeakDb, 2)],
  );
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? '').length)));
  const line = (cells: readonly string[]): string => cells.map((c, i) => (i === 0 ? c.padEnd(w[i]!) : c.padStart(w[i]!))).join('  ');
  console.log(line(head));
  console.log(w.map((n) => '-'.repeat(n)).join('  '));
  for (const b of body) console.log(line(b));
}
