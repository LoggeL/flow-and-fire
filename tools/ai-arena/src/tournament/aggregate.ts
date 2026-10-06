/**
 * Tournament aggregation and gates (ai.md §7.1–§7.3, PLAN §3.12 "KI-Qualität").
 *
 * Per pairing (contestant A against B, every seed twice with exchanged armies):
 * - results: wins/draws/losses of A over the finished games, win rate with 95 % Wilson interval
 *   and Elo difference (report figure),
 * - samples: exactly one side per game (mirror: army with the seed's parity; otherwise A's army,
 *   `MatchJob.sampledArmy`): T2 ≤ 12 min, first wave ≤ 8 min (rates with Wilson interval, crashed
 *   games count as failures), pooled energy stall (Σ stall ticks / Σ counted ticks),
 * - breakdown per map and per opening of the sampled side.
 *
 * Over all games: crashes, aiTimeout marks, idle engineers of every side, APM (p99 over all 60-s
 * windows per profile against the cap), ops (per-side p99 per think against the total budget and per
 * manager against its allotment), think time on the host clock (diagnostics; wall or thread CPU).
 *
 * Gates (`GateMode` of the suite): crashes, aiTimeout, APM and ops block in every mode (ai.md §7.2
 * "zusätzlich in jedem Turnier"); T2, first wave and idle engineers block in 'wilson' (lower bound)
 * and 'point' (point estimate) mode and are reported in 'report' mode; the energy stall is always a
 * report (MS10 target ≤ 5 %). The outlier list names every game to replay (T2 > 12 min, stall > 10 %,
 * idle ≥ 15 %, timeout, crash) with seed and map.
 *
 * Deterministic: records are processed in game order, sums in fixed order, sorting with total
 * comparators; the result depends only on the records.
 */
import { compareNumbers, percentile } from '../stats/percentile.ts';
import { summarize } from '../stats/summary.ts';
import { eloDiff, wilson, type WilsonInterval } from '../stats/wilson.ts';
import {
  GATE_IDLE_PCT,
  GATE_RATE,
  GATE_T2_TICKS,
  GATE_WAVE_TICKS,
  OUTLIER_STALL_PCT,
  TARGET_STALL_PCT,
  type GameRecord,
  type GateMode,
  type SideRecord,
} from './types.ts';

/** Ticks per second of the arena (10 Hz). */
const TPS = 10;

export interface RateStat {
  /** Samples (games of the pairing, crashed games included as failures). */
  readonly n: number;
  readonly successes: number;
  readonly rate: number;
  readonly lo: number;
  readonly hi: number;
  /** Median / p90 in seconds over the samples that reached the event (null if none). */
  readonly medianS: number | null;
  readonly p90S: number | null;
  /** Samples that never reached the event. */
  readonly missing: number;
}

export interface ResultTally {
  readonly games: number;
  readonly crashes: number;
  /** Finished games (n of the win rate). */
  readonly n: number;
  readonly winsA: number;
  readonly draws: number;
  readonly winsB: number;
  /** Win rate of A (draws 0.5) with Wilson interval. */
  readonly winRateA: WilsonInterval;
  /** Elo difference A − B (report figure, p clamped to [0.001, 0.999]). */
  readonly eloA: number;
}

export interface BreakdownRow {
  readonly key: string;
  /** Sampled sides (games) of this row. */
  readonly n: number;
  /** Wins of the sampled side (draws 0.5) over finished games. */
  readonly winRate: WilsonInterval;
  /** Elo difference of the sampled side (eloDiff of winRate.p; 0 without finished games). */
  readonly elo: number;
  readonly t2: RateStat;
  readonly wave: RateStat;
  readonly stallPooledPct: number;
  readonly idleMaxPct: number;
}

export interface PairingReport {
  readonly id: string;
  readonly mirror: boolean;
  readonly a: { readonly label: string; readonly profile: string };
  readonly b: { readonly label: string; readonly profile: string };
  readonly results: ResultTally;
  /** Results per map (A's view). */
  readonly resultsByMap: readonly (ResultTally & { readonly map: string })[];
  readonly t2: RateStat;
  readonly wave: RateStat;
  /** Energy stall pooled over the sampled sides in % (Σ stall ticks / Σ counted ticks). */
  readonly stallPooledPct: number;
  /** p90 of the per-game stall % of the sampled sides. */
  readonly stallP90Pct: number;
  /** Idle engineers over every side of every finished game. */
  readonly idleMaxPct: number;
  readonly idleMeanPct: number;
  readonly idleViolations: number;
  readonly byMap: readonly BreakdownRow[];
  readonly byOpening: readonly BreakdownRow[];
}

export interface ManagerBudgetRow {
  readonly name: string;
  /** Largest per-side p99 of the manager's ops per think. */
  readonly p99Max: number;
  readonly max: number;
  readonly budget: number;
}

export interface ProfileBudgetRow {
  readonly profile: string;
  readonly sides: number;
  readonly thinks: number;
  /** Largest per-side p99 of ops per think (≥ the pooled p99, see gate text). */
  readonly opsP99Max: number;
  readonly opsMax: number;
  readonly budget: number;
  readonly managers: readonly ManagerBudgetRow[];
  readonly aiTimeouts: number;
  /** p99 over all 60-s windows of all sides of the profile (command records per minute). */
  readonly apmP99: number;
  readonly apmMax: number;
  readonly apmCap: number;
  readonly apmWindows: number;
  /** Think time on the host clock (wall or thread CPU, diagnostics only): median of per-side p50, max of p95 and max. */
  readonly thinkMsP50: number;
  readonly thinkMsP95Max: number;
  readonly thinkMsMax: number;
}

export interface GateResult {
  readonly id: string;
  readonly label: string;
  readonly blocking: boolean;
  readonly pass: boolean;
  readonly value: string;
  readonly threshold: string;
}

export interface Outlier {
  readonly game: number;
  readonly pairing: string;
  readonly seed: number;
  readonly map: string;
  readonly swapped: boolean;
  /** Army of the side (−1 for crashes). */
  readonly army: number;
  readonly label: string;
  readonly reasons: readonly string[];
}

export interface Aggregate {
  readonly games: number;
  readonly crashes: number;
  readonly crashList: readonly { readonly game: number; readonly seed: number; readonly map: string; readonly error: string }[];
  readonly pairings: readonly PairingReport[];
  readonly budgets: readonly ProfileBudgetRow[];
  readonly gates: readonly GateResult[];
  readonly outliers: readonly Outlier[];
  /** All blocking gates pass. */
  readonly passed: boolean;
}

// ---- helpers ------------------------------------------------------------------------------------

function sideOf(r: GameRecord, army: number): SideRecord | null {
  for (const s of r.sides) if (s.army === army) return s;
  return null;
}

/** Rate of `tickOf(side) ≤ limit` over the samples; null sides (crashes) are failures. */
export function rateStat(samples: readonly (SideRecord | null)[], tickOf: (s: SideRecord) => number | null, limit: number): RateStat {
  let k = 0;
  let missing = 0;
  const secs: number[] = [];
  for (const s of samples) {
    const t = s === null ? null : tickOf(s);
    if (t === null) {
      missing++;
      continue;
    }
    secs.push(t / TPS);
    if (t <= limit) k++;
  }
  const n = samples.length;
  const w = wilson(k, n);
  return {
    n,
    successes: k,
    rate: w.p,
    lo: w.lo,
    hi: w.hi,
    medianS: secs.length === 0 ? null : percentile(secs, 50),
    p90S: secs.length === 0 ? null : percentile(secs, 90),
    missing,
  };
}

/** Pooled energy stall in % over sides (Σ stall ticks / Σ counted ticks; 0 without counted ticks). */
export function pooledStallPct(sides: readonly SideRecord[]): number {
  let stall = 0;
  let counted = 0;
  for (const s of sides) {
    stall += s.energyStallTicks;
    counted += s.energyCountedTicks;
  }
  return counted > 0 ? (100 * stall) / counted : 0;
}

function tally(records: readonly GameRecord[], armyA: (r: GameRecord) => number): ResultTally {
  let crashes = 0;
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  for (const r of records) {
    if (r.crash !== null) {
      crashes++;
      continue;
    }
    if (r.winner < 0) draws++;
    else if (r.winner === armyA(r)) winsA++;
    else winsB++;
  }
  const n = winsA + winsB + draws;
  const w = wilson(winsA + 0.5 * draws, n);
  return { games: records.length, crashes, n, winsA, draws, winsB, winRateA: w, eloA: n > 0 ? eloDiff(w.p) : 0 };
}

/** Army of contestant A in a game. */
function armyOfA(r: GameRecord): number {
  return r.armyA;
}

function sampleOf(r: GameRecord): SideRecord | null {
  return r.crash !== null ? null : sideOf(r, r.sampledArmy);
}

function breakdown(records: readonly GameRecord[], keyOf: (r: GameRecord) => string): BreakdownRow[] {
  const groups = new Map<string, GameRecord[]>();
  for (const r of records) {
    const k = keyOf(r);
    let g = groups.get(k);
    if (g === undefined) {
      g = [];
      groups.set(k, g);
    }
    g.push(r);
  }
  const keys = [...groups.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return keys.map((key) => {
    const g = groups.get(key)!;
    const samples = g.map(sampleOf);
    const finished = samples.filter((s): s is SideRecord => s !== null);
    let wins = 0;
    let draws = 0;
    for (const r of g) {
      if (r.crash !== null) continue;
      if (r.winner < 0) draws++;
      else if (r.winner === r.sampledArmy) wins++;
    }
    let idleMax = 0;
    for (const r of g) for (const s of r.sides) if (s.idleEngineerPct > idleMax) idleMax = s.idleEngineerPct;
    const winRate = wilson(wins + 0.5 * draws, finished.length);
    return {
      key,
      n: g.length,
      winRate,
      elo: finished.length > 0 ? eloDiff(winRate.p) : 0,
      t2: rateStat(samples, (s) => s.t2Tick, GATE_T2_TICKS),
      wave: rateStat(samples, (s) => s.firstWaveTick, GATE_WAVE_TICKS),
      stallPooledPct: pooledStallPct(finished),
      idleMaxPct: idleMax,
    };
  });
}

function pairingReport(id: string, records: readonly GameRecord[]): PairingReport {
  const first = records[0]!;
  const finishedFirst = records.find((r) => r.crash === null && r.sides.length === 2);
  const who = (c: 'A' | 'B'): { label: string; profile: string } => {
    const s = finishedFirst?.sides.find((x) => x.contestant === c);
    return s !== undefined ? { label: s.label, profile: s.profile } : { label: c, profile: '?' };
  };
  const samples = records.map(sampleOf);
  const finishedSamples = samples.filter((s): s is SideRecord => s !== null);
  const stallPerGame = finishedSamples.map((s) => s.energyStallPct);
  let idleMax = 0;
  let idleSum = 0;
  let idleN = 0;
  let idleViolations = 0;
  for (const r of records) {
    for (const s of r.sides) {
      if (s.idleEngineerPct > idleMax) idleMax = s.idleEngineerPct;
      idleSum += s.idleEngineerPct;
      idleN++;
      if (s.idleEngineerPct >= GATE_IDLE_PCT) idleViolations++;
    }
  }
  const maps: string[] = [];
  for (const r of records) if (!maps.includes(r.map)) maps.push(r.map);
  return {
    id,
    mirror: first.mirror,
    a: who('A'),
    b: who('B'),
    results: tally(records, armyOfA),
    resultsByMap: maps.map((map) => ({ map, ...tally(records.filter((r) => r.map === map), armyOfA) })),
    t2: rateStat(samples, (s) => s.t2Tick, GATE_T2_TICKS),
    wave: rateStat(samples, (s) => s.firstWaveTick, GATE_WAVE_TICKS),
    stallPooledPct: pooledStallPct(finishedSamples),
    stallP90Pct: stallPerGame.length === 0 ? 0 : percentile(stallPerGame, 90),
    idleMaxPct: idleMax,
    idleMeanPct: idleN > 0 ? idleSum / idleN : 0,
    idleViolations,
    byMap: breakdown(records, (r) => r.map),
    byOpening: breakdown(records, (r) => sampleOf(r)?.opening ?? (r.crash !== null ? '(crash)' : '(none)')),
  };
}

function budgetRows(records: readonly GameRecord[]): ProfileBudgetRow[] {
  interface Acc {
    sides: number;
    thinks: number;
    opsP99Max: number;
    opsMax: number;
    budget: number;
    managers: Map<string, { p99Max: number; max: number; budget: number }>;
    aiTimeouts: number;
    apm: number[];
    apmCap: number;
    msP50: number[];
    msP95Max: number;
    msMax: number;
  }
  const byProfile = new Map<string, Acc>();
  for (const r of records) {
    for (const s of r.sides) {
      let a = byProfile.get(s.profile);
      if (a === undefined) {
        a = {
          sides: 0,
          thinks: 0,
          opsP99Max: 0,
          opsMax: 0,
          budget: s.budgetTotal,
          managers: new Map(),
          aiTimeouts: 0,
          apm: [],
          apmCap: s.apmCap,
          msP50: [],
          msP95Max: 0,
          msMax: 0,
        };
        byProfile.set(s.profile, a);
      }
      a.sides++;
      a.thinks += s.thinks;
      if (s.opsP99 > a.opsP99Max) a.opsP99Max = s.opsP99;
      if (s.opsMax > a.opsMax) a.opsMax = s.opsMax;
      for (const m of s.opsByManager) {
        let e = a.managers.get(m.name);
        if (e === undefined) {
          e = { p99Max: 0, max: 0, budget: m.budget };
          a.managers.set(m.name, e);
        }
        if (m.p99 > e.p99Max) e.p99Max = m.p99;
        if (m.max > e.max) e.max = m.max;
      }
      a.aiTimeouts += s.aiTimeouts;
      for (const w of s.apmWindows) a.apm.push(w);
      if (s.thinks > 0) a.msP50.push(s.thinkMsP50);
      if (s.thinkMsP95 > a.msP95Max) a.msP95Max = s.thinkMsP95;
      if (s.thinkMsMax > a.msMax) a.msMax = s.thinkMsMax;
    }
  }
  const order = ['easy', 'normal', 'hard'];
  const names = [...byProfile.keys()].sort((x, y) => {
    const ix = order.indexOf(x);
    const iy = order.indexOf(y);
    if (ix !== iy) return compareNumbers(ix, iy);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return names.map((profile) => {
    const a = byProfile.get(profile)!;
    const apm = summarize(a.apm);
    return {
      profile,
      sides: a.sides,
      thinks: a.thinks,
      opsP99Max: a.opsP99Max,
      opsMax: a.opsMax,
      budget: a.budget,
      managers: [...a.managers.entries()].map(([name, e]) => ({ name, p99Max: e.p99Max, max: e.max, budget: e.budget })),
      aiTimeouts: a.aiTimeouts,
      apmP99: apm.p99,
      apmMax: apm.max,
      apmCap: a.apmCap,
      apmWindows: apm.n,
      thinkMsP50: a.msP50.length === 0 ? 0 : percentile(a.msP50, 50),
      thinkMsP95Max: a.msP95Max,
      thinkMsMax: a.msMax,
    };
  });
}

const pct = (v: number): string => `${(100 * v).toFixed(1)} %`;

function rateGate(id: string, label: string, s: RateStat, mode: GateMode, limitText: string): GateResult {
  const byWilson = mode === 'wilson' || mode === 'report';
  const pass = byWilson ? s.lo >= GATE_RATE : s.rate >= GATE_RATE;
  return {
    id,
    label: `${label} ≤ ${limitText}`,
    blocking: mode !== 'report',
    pass,
    value: `${s.successes}/${s.n} = ${pct(s.rate)} (Wilson ${pct(s.lo)}–${pct(s.hi)})`,
    threshold: byWilson ? `untere Wilson-Grenze ≥ ${pct(GATE_RATE)}` : `Anteil ≥ ${pct(GATE_RATE)} (Punktschätzung)`,
  };
}

/** Gates of a tournament (see module comment). */
export function evaluateGates(pairings: readonly PairingReport[], budgets: readonly ProfileBudgetRow[], crashes: number, mode: GateMode): GateResult[] {
  const gates: GateResult[] = [];
  gates.push({ id: 'crash', label: 'Crashes', blocking: true, pass: crashes === 0, value: String(crashes), threshold: '0' });
  let timeouts = 0;
  for (const b of budgets) timeouts += b.aiTimeouts;
  gates.push({ id: 'aiTimeout', label: 'aiTimeout-Marken', blocking: true, pass: timeouts === 0, value: String(timeouts), threshold: '0' });
  for (const b of budgets) {
    gates.push({
      id: `apm:${b.profile}`,
      label: `APM-p99 ${b.profile} (60-s-Fenster)`,
      blocking: true,
      pass: b.apmP99 <= b.apmCap,
      value: `${b.apmP99} (max ${b.apmMax}, ${b.apmWindows} Fenster)`,
      threshold: `≤ ${b.apmCap}`,
    });
    gates.push({
      id: `ops:${b.profile}`,
      label: `ops-p99 je Think ${b.profile}`,
      blocking: true,
      pass: b.opsP99Max <= b.budget,
      value: `${b.opsP99Max} (größtes p99 einer Seite; max ${b.opsMax})`,
      threshold: `≤ ${b.budget}`,
    });
  }
  for (const p of pairings) {
    gates.push(rateGate(`t2:${p.id}`, `T2 ${p.id}`, p.t2, mode, '12:00'));
    gates.push(rateGate(`wave:${p.id}`, `Erste Welle ${p.id}`, p.wave, mode, '8:00'));
    gates.push({
      id: `idle:${p.id}`,
      label: `Idle-Engineer ${p.id} (jede Seite jedes Spiels)`,
      blocking: mode !== 'report',
      pass: p.idleViolations === 0,
      value: `max ${p.idleMaxPct.toFixed(1)} %, Mittel ${p.idleMeanPct.toFixed(1)} %, ${p.idleViolations} Verstöße`,
      threshold: `< ${GATE_IDLE_PCT} %`,
    });
    gates.push({
      id: `stall:${p.id}`,
      label: `Energie-Stall ${p.id} (gepoolt, MS10-Ziel)`,
      blocking: false,
      pass: p.stallPooledPct <= TARGET_STALL_PCT,
      value: `${p.stallPooledPct.toFixed(2)} % (p90 je Spiel ${p.stallP90Pct.toFixed(1)} %)`,
      threshold: `≤ ${TARGET_STALL_PCT} % (Bericht)`,
    });
  }
  return gates;
}

/** Outliers (game order, then army): crash, T2 > 12 min, stall > 10 %, idle ≥ 15 %, aiTimeout. */
export function findOutliers(records: readonly GameRecord[]): Outlier[] {
  const out: Outlier[] = [];
  for (const r of records) {
    if (r.crash !== null) {
      out.push({ game: r.game, pairing: r.pairing, seed: r.seed, map: r.map, swapped: r.swapped, army: -1, label: '-', reasons: [`crash: ${r.crash}`] });
      continue;
    }
    for (const s of r.sides) {
      const reasons: string[] = [];
      if (s.t2Tick !== null ? s.t2Tick > GATE_T2_TICKS : r.endTick > GATE_T2_TICKS) {
        reasons.push(s.t2Tick === null ? 'kein T2' : `T2 ${fmtClock(s.t2Tick)}`);
      }
      if (s.energyStallPct > OUTLIER_STALL_PCT) reasons.push(`Stall ${s.energyStallPct.toFixed(1)} %`);
      if (s.idleEngineerPct >= GATE_IDLE_PCT) reasons.push(`Idle ${s.idleEngineerPct.toFixed(1)} %`);
      if (s.aiTimeouts > 0) reasons.push(`aiTimeout ×${s.aiTimeouts} (Tick ${s.timeoutTicks.join(', ')})`);
      if (reasons.length > 0) out.push({ game: r.game, pairing: r.pairing, seed: r.seed, map: r.map, swapped: r.swapped, army: s.army, label: s.label, reasons });
    }
  }
  return out;
}

/** m:ss of a tick count. */
export function fmtClock(ticks: number): string {
  const s = Math.floor(ticks / TPS);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** Aggregates the records of one tournament (records in game order). */
export function aggregate(records: readonly GameRecord[], mode: GateMode): Aggregate {
  const sorted = records.slice().sort((x, y) => compareNumbers(x.game, y.game));
  const pairingIds: string[] = [];
  for (const r of sorted) if (!pairingIds.includes(r.pairing)) pairingIds.push(r.pairing);
  const pairings = pairingIds.map((id) => pairingReport(id, sorted.filter((r) => r.pairing === id)));
  const budgets = budgetRows(sorted);
  const crashList = sorted.filter((r) => r.crash !== null).map((r) => ({ game: r.game, seed: r.seed, map: r.map, error: r.crash! }));
  const gates = evaluateGates(pairings, budgets, crashList.length, mode);
  return {
    games: sorted.length,
    crashes: crashList.length,
    crashList,
    pairings,
    budgets,
    gates,
    outliers: findOutliers(sorted),
    passed: gates.every((g) => !g.blocking || g.pass),
  };
}
