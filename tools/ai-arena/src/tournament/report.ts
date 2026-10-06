/**
 * Tournament report: JSON document (schema TOURNAMENT_SCHEMA, written by scripts/tournament.ts to
 * tools/ai-arena/results/<suite>-<date>.json) and a Markdown rendering (stdout or --md <file>).
 * The report is a pure function of the suite definition, the records and the metadata passed in
 * (date and wall time come from the script; arena code never reads the clock).
 */
import { aggregate, fmtClock, type Aggregate, type BreakdownRow, type RateStat } from './aggregate.ts';
import type { SuiteDef } from './suites.ts';
import { TOURNAMENT_SCHEMA, type GameRecord } from './types.ts';

export interface ReportMeta {
  /** ISO date/time of the run (script). */
  readonly generatedAt?: string;
  /** Wall-clock duration of the run in s (script). */
  readonly wallSeconds?: number;
  readonly workers?: number;
  /** Free text, e.g. the command line. */
  readonly command?: string;
}

export interface TournamentReport extends Aggregate {
  readonly schema: typeof TOURNAMENT_SCHEMA;
  readonly note: string;
  readonly suite: string;
  readonly description: string;
  readonly gateMode: SuiteDef['gateMode'];
  readonly maps: readonly string[];
  readonly maxTicks: number;
  readonly host: string;
  /** Emergency-stop clock(s) of the AI hosts ('thread' = thread CPU time, 'wall' = performance.now). */
  readonly clock: string;
  readonly brains: readonly string[];
  readonly meta: ReportMeta;
  readonly records: readonly GameRecord[];
}

/** Marker of arena results (they are no gates of the real sim, TRACK-AI acceptance). */
export const ARENA_NOTE = 'Arena (Headless-Test-Sim tools/ai-arena) statt echter Sim – Werte sind Vorab-Gates, keine MS9-Abnahme';

/** Builds the report of a finished tournament. */
export function buildReport(def: SuiteDef, records: readonly GameRecord[], meta: ReportMeta = {}): TournamentReport {
  const agg = aggregate(records, def.gateMode);
  const brains: string[] = [];
  for (const p of def.pairings) for (const c of [p.a, p.b]) if (!brains.includes(c.brain)) brains.push(c.brain);
  const hosts: string[] = [];
  for (const r of records) if (!hosts.includes(r.host)) hosts.push(r.host);
  const clocks: string[] = [];
  for (const r of records) if (!clocks.includes(r.clock)) clocks.push(r.clock);
  return {
    schema: TOURNAMENT_SCHEMA,
    note: ARENA_NOTE,
    suite: def.name,
    description: def.description,
    gateMode: def.gateMode,
    maps: def.maps,
    maxTicks: def.maxTicks,
    host: hosts.join(',') || '-',
    clock: clocks.join(',') || '-',
    brains,
    meta,
    ...agg,
    records: records.slice(),
  };
}

// ---- Markdown -------------------------------------------------------------------------------------

const pct = (v: number): string => `${(100 * v).toFixed(1)} %`;
const secs = (s: number | null): string => (s === null ? '–' : fmtClock(Math.round(s * 10)));

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const esc = (c: string): string => c.split('|').join('\\|');
  const lines = [`| ${head.map(esc).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const r of rows) lines.push(`| ${r.map(esc).join(' | ')} |`);
  return lines.join('\n');
}

function rateCell(s: RateStat): string {
  return `${s.successes}/${s.n} = ${pct(s.rate)} [${pct(s.lo)}; ${pct(s.hi)}]`;
}

function breakdownTable(rows: readonly BreakdownRow[], keyName: string): string {
  return table(
    [keyName, 'n', 'Siegquote Stichprobe', 'Elo Stichprobe', 'T2 ≤ 12:00', 'T2 Median', 'Welle ≤ 8:00', 'Welle Median', 'Stall gepoolt', 'Idle max'],
    rows.map((r) => [
      r.key,
      String(r.n),
      `${pct(r.winRate.p)} [${pct(r.winRate.lo)}; ${pct(r.winRate.hi)}]`,
      r.elo.toFixed(0),
      rateCell(r.t2),
      secs(r.t2.medianS),
      rateCell(r.wave),
      secs(r.wave.medianS),
      `${r.stallPooledPct.toFixed(2)} %`,
      `${r.idleMaxPct.toFixed(1)} %`,
    ]),
  );
}

/** Markdown rendering of a report. */
export function renderMarkdown(r: TournamentReport, maxOutliers = 50): string {
  const out: string[] = [];
  out.push(`## Turnier \`${r.suite}\` – ${r.passed ? 'BESTANDEN' : 'NICHT BESTANDEN'}`);
  out.push('');
  out.push(`${r.description}. ${r.note}.`);
  out.push('');
  const meta: string[] = [`Spiele ${r.games}`, `Karten ${r.maps.join(', ')}`, `Spielzeit ≤ ${fmtClock(r.maxTicks)}`, `Host ${r.host}`, `Notabbruch-Uhr ${r.clock === 'thread' ? 'Thread-CPU' : r.clock}`, `Gate-Modus ${r.gateMode}`];
  if (r.meta.workers !== undefined) meta.push(`Worker ${r.meta.workers}`);
  if (r.meta.wallSeconds !== undefined) meta.push(`Laufzeit ${r.meta.wallSeconds.toFixed(0)} s`);
  if (r.meta.generatedAt !== undefined) meta.push(r.meta.generatedAt);
  out.push(meta.join(' · '));
  out.push(`Brain: ${r.brains.join(', ')}`);
  out.push('');
  out.push('### Gates');
  out.push('');
  out.push(
    table(
      ['Gate', 'Wert', 'Schwelle', 'Ergebnis'],
      r.gates.map((g) => [g.label, g.value, g.threshold, g.pass ? 'ok' : g.blocking ? 'VERLETZT' : 'verfehlt (Bericht)']),
    ),
  );
  out.push('');
  out.push('### Paarungen');
  out.push('');
  out.push(
    table(
      ['Paarung', 'Spiele', 'A–Remis–B', 'Siegquote A [Wilson 95 %]', 'Elo A−B', 'Crashes'],
      r.pairings.map((p) => [
        `${p.id} (${p.a.label} gegen ${p.b.label}${p.mirror ? ', Spiegel' : ''})`,
        String(p.results.games),
        `${p.results.winsA}–${p.results.draws}–${p.results.winsB}`,
        `${pct(p.results.winRateA.p)} [${pct(p.results.winRateA.lo)}; ${pct(p.results.winRateA.hi)}]`,
        p.results.n > 0 ? p.results.eloA.toFixed(0) : '–',
        String(p.results.crashes),
      ]),
    ),
  );
  for (const p of r.pairings) {
    out.push('');
    out.push(`#### ${p.id}: Siegquote je Karte`);
    out.push('');
    out.push(
      table(
        ['Karte', 'Spiele', 'A–Remis–B', 'Siegquote A', 'Elo A−B'],
        p.resultsByMap.map((m) => [
          m.map,
          String(m.games),
          `${m.winsA}–${m.draws}–${m.winsB}`,
          `${pct(m.winRateA.p)} [${pct(m.winRateA.lo)}; ${pct(m.winRateA.hi)}]`,
          m.n > 0 ? m.eloA.toFixed(0) : '–',
        ]),
      ),
    );
    out.push('');
    out.push(`#### ${p.id}: Stichprobe je Karte (${p.mirror ? 'Seite nach Seed-Parität' : `Seite ${p.a.label}`})`);
    out.push('');
    out.push(breakdownTable(p.byMap, 'Karte'));
    out.push('');
    out.push(`#### ${p.id}: Stichprobe je Eröffnung`);
    out.push('');
    out.push(breakdownTable(p.byOpening, 'Eröffnung'));
  }
  out.push('');
  out.push('### Budget, APM und Think-Zeit je Profil');
  out.push('');
  out.push(
    table(
      ['Profil', 'Seiten', 'Thinks', 'ops-p99 (max je Seite)', 'Budget', 'aiTimeout', 'APM-p99', 'APM max', 'Cap', 'Think ms p50 / p95 max / max'],
      r.budgets.map((b) => [
        b.profile,
        String(b.sides),
        String(b.thinks),
        String(b.opsP99Max),
        String(b.budget),
        String(b.aiTimeouts),
        String(b.apmP99),
        String(b.apmMax),
        String(b.apmCap),
        `${b.thinkMsP50.toFixed(2)} / ${b.thinkMsP95Max.toFixed(2)} / ${b.thinkMsMax.toFixed(1)}`,
      ]),
    ),
  );
  for (const b of r.budgets) {
    out.push('');
    out.push(`ops je Manager (${b.profile}): ` + b.managers.map((m) => `${m.name} ${m.p99Max}/${m.budget}${m.p99Max > m.budget ? ' (über Zuteilung)' : ''}`).join(' · '));
  }
  out.push('');
  out.push(`### Ausreißer (${r.outliers.length})`);
  out.push('');
  if (r.outliers.length === 0) out.push('keine');
  else {
    out.push(
      table(
        ['Spiel', 'Paarung', 'Seed', 'Karte', 'getauscht', 'Army', 'Seite', 'Befund', 'Nachspielen'],
        r.outliers.slice(0, maxOutliers).map((o) => [
          String(o.game),
          o.pairing,
          String(o.seed),
          o.map,
          o.swapped ? 'ja' : 'nein',
          o.army < 0 ? '–' : String(o.army),
          o.label,
          o.reasons.join('; '),
          `--suite ${r.suite} --seeds ${o.seed} --maps ${o.map}`,
        ]),
      ),
    );
    if (r.outliers.length > maxOutliers) out.push(`… und ${r.outliers.length - maxOutliers} weitere (JSON)`);
  }
  out.push('');
  return out.join('\n');
}
