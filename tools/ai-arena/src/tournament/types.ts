/**
 * Tournament data model (ai.md §7, PLAN §3.12 "KI-Qualität"): match jobs (one arena game each),
 * per-game records with truth metrics (MatchMetrics) and AI telemetry, and the report schema.
 * Everything here is structured-clone-able (jobs and records cross worker boundaries).
 */
import type { Difficulty } from '@faf/ai';
import type { HostClockKind } from '../bench/clock.ts';
import type { HostKind } from '../host-node/sides.ts';

export const TOURNAMENT_SCHEMA = 'faf-ai-arena/tournament/1';

/** 30 min game time (ai.md §7.2 "KI gegen KI 30 min ohne Crash"). */
export const DEFAULT_MAX_TICKS = 18_000;

/** Gate thresholds (ai.md §7.1/§7.2, MS9). */
export const GATE_T2_TICKS = 7_200; // 12 min
export const GATE_WAVE_TICKS = 4_800; // 8 min
export const GATE_RATE = 0.9;
export const GATE_IDLE_PCT = 15;
export const TARGET_STALL_PCT = 5; // MS10 target, report only
export const OUTLIER_STALL_PCT = 10;

/**
 * How the rate gates (T2, first wave) and the idle gate are judged:
 * - 'wilson': lower 95 % Wilson bound ≥ 0.90 (MS9 gate, n ≥ 200),
 * - 'point':  point estimate ≥ 0.90 (smoke suites with small n, where Wilson cannot reach 0.90),
 * - 'report': reported, not blocking (difficulty comparisons).
 * Crashes, aiTimeout, APM and ops are blocking in every mode (ai.md §7.2 "in jedem Turnier").
 */
export type GateMode = 'wilson' | 'point' | 'report';

export interface Contestant {
  /** Report label (e.g. 'normal', 'hard'). */
  readonly label: string;
  readonly profile: Difficulty;
  /** Brain specifier 'module#export'. */
  readonly brain: string;
}

export interface JobSide {
  readonly army: 0 | 1;
  readonly contestant: 'A' | 'B';
  readonly label: string;
  readonly profile: Difficulty;
  readonly brain: string;
}

export interface MatchJob {
  /** Index in the tournament plan. */
  readonly game: number;
  readonly suite: string;
  /** Pairing id, e.g. 'normal-vs-easy'. */
  readonly pairing: string;
  readonly mirror: boolean;
  readonly seed: number;
  readonly map: string;
  /**
   * Second game of the seed. Non-mirror: contestant A plays army 1 (at start marker 1). Mirror:
   * exchanging identical contestants would replay the identical game, so the armies keep their ids
   * and exchange their start markers instead (`starts`).
   */
  readonly swapped: boolean;
  /** Army of contestant A. */
  readonly armyA: 0 | 1;
  /** Start marker index per army: starts[army]. */
  readonly starts: readonly [number, number];
  /** Game seed of both AIs: `seed`, in the second mirror game `mirrorAiSeed(seed, true)`. */
  readonly aiSeed: number;
  readonly maxTicks: number;
  readonly host: HostKind;
  /** Clock of the AI hosts' emergency stop (default 'thread', see bench/clock.ts). */
  readonly clock: HostClockKind;
  /** The side that contributes the sample (mirror: seed parity; otherwise contestant A). */
  readonly sampledArmy: 0 | 1;
  /** sides[army]. */
  readonly sides: readonly [JobSide, JobSide];
}

export interface ManagerOps {
  readonly name: string;
  readonly thinks: number;
  readonly p99: number;
  readonly max: number;
  /** Allotment of the profile (reserve for opening/emitter). */
  readonly budget: number;
}

export interface SideRecord {
  readonly army: 0 | 1;
  readonly contestant: 'A' | 'B';
  readonly label: string;
  readonly profile: Difficulty;
  readonly opening: string | null;
  readonly defeated: boolean;
  readonly t2Tick: number | null;
  /** First waveAttack with a target in the enemy half (telemetry, think tick). */
  readonly firstWaveTick: number | null;
  readonly firstWaveUnits: number;
  readonly firstWaveForced: boolean;
  readonly waves: number;
  readonly retreats: number;
  readonly fac1Tick: number | null;
  readonly mex8Tick: number | null;
  readonly idleEngineerPct: number;
  readonly engineerIdleTicks: number;
  readonly engineerAliveTicks: number;
  readonly energyStallPct: number;
  readonly energyStallTicks: number;
  readonly energyCountedTicks: number;
  readonly overflowPct: number;
  readonly massBpStallPct: number;
  /** Command records per 60-s window. */
  readonly apmWindows: readonly number[];
  readonly apmMax: number;
  readonly apmCap: number;
  readonly thinks: number;
  readonly opsP50: number;
  readonly opsP99: number;
  readonly opsMax: number;
  readonly budgetTotal: number;
  readonly opsByManager: readonly ManagerOps[];
  readonly aiTimeouts: number;
  readonly timeoutTicks: readonly number[];
  /** ms per think measured by the host clock (GameRecord.clock: wall or thread CPU; diagnostics). */
  readonly thinkMsP50: number;
  readonly thinkMsP95: number;
  readonly thinkMsMax: number;
  readonly unitsProduced: number;
  readonly unitsLost: number;
  readonly commandsRejected: number;
}

export interface GameRecord {
  readonly game: number;
  readonly suite: string;
  readonly pairing: string;
  readonly mirror: boolean;
  readonly seed: number;
  readonly map: string;
  readonly swapped: boolean;
  readonly armyA: 0 | 1;
  readonly starts: readonly [number, number];
  /** AI game seed (absent in reports before the mirror-seed fix: equal to `seed`). */
  readonly aiSeed?: number;
  readonly host: HostKind;
  readonly clock: HostClockKind;
  readonly maxTicks: number;
  readonly sampledArmy: 0 | 1;
  /** null = the game ran to its end; otherwise the error (crash). */
  readonly crash: string | null;
  /** Winner army, −1 draw (also for crashes). */
  readonly winner: number;
  readonly endTick: number;
  readonly endReason: string;
  readonly commands: number;
  /** sides[army] (empty for crashes before the match started). */
  readonly sides: readonly SideRecord[];
}
