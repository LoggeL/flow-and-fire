/**
 * Difficulty profiles (ai.md §2.1 timing, §2.3 op budget, §2.4 APM, §6 difficulty table).
 * The opening handicaps (`difficultyTiming`) come from ai-openings.json via `profileFor`.
 */
import type { Difficulty, DifficultyTiming, OpeningsDoc } from './openings.ts';

/** Op budget per think (ai.md §2.3). `micro` is the extra budget of a Hard micro think. */
export interface BudgetSpec {
  readonly total: number;
  readonly intel: number;
  readonly platoon: number;
  readonly engineer: number;
  readonly economy: number;
  readonly defense: number;
  readonly factory: number;
  readonly tech: number;
  /** Opening, emitter, overflow. */
  readonly reserve: number;
  readonly micro: number;
}

export interface ApmSpec {
  /** Command records per minute (hard cap over every 60-s window). */
  readonly cap: number;
  /** Bucket capacity. */
  readonly burst: number;
  /** P0 may overdraw the bucket by this many records. */
  readonly p0Overdraft: number;
}

export type CounterMode = 'off' | 'nextMix' | 'immediatePredict';

export interface AiProfileBase {
  readonly name: Difficulty;
  /** Think every N ticks (10 Hz sim). */
  readonly thinkEvery: number;
  /** Hard micro think every N ticks (MS14), null = none. */
  readonly microEvery: number | null;
  /** Commands of think N apply at N + lead. */
  readonly lead: number;
  /** Extra delay for NEW stimuli in ticks (ai.md §2.1). */
  readonly reactionDelayTicks: number;
  /** 1-Hz managers run on every think (Easy) instead of alternating even/odd k. */
  readonly oneHzEveryThink: boolean;
  readonly budget: BudgetSpec;
  readonly apm: ApmSpec;
  /** Mix error rate: with this probability the factory picks randomly among the top `errorTopK`. */
  readonly errorRate: number;
  readonly errorTopK: number;
  /** Energy horizon in s; null = `followUp.energy.horizonS` of the opening (Normal). */
  readonly horizonS: number | null;
  readonly attackRatio: number;
  readonly retreatRatio: number;
  readonly reentryRatio: number;
  /** HP fraction required to re-enter after a retreat. */
  readonly reentryHpFrac: number;
  readonly raids: { readonly count: number; readonly fromS: number };
  readonly counterMode: CounterMode;
  /** Allowed opening ids, null = all of the milestone. */
  readonly openingFilter: readonly string[] | null;
  /** First wave size override (Easy 12 = eco_standard 8 + waveExtra 4), null = from the opening. */
  readonly firstWave: number | null;
  /** Easy: threat only from currently visible units (no threat memory, ai.md §6). */
  readonly threatVisibleOnly: boolean;
  /** Micro techniques (§5.8) active — Hard, MS14 (not implemented in MS9). */
  readonly micro: boolean;
  /** Platoon uses the threat grid instead of the local estimate (MS11+; prepared, default off). */
  readonly platoonGridMode: boolean;
}

export interface AiProfile extends AiProfileBase {
  /** Opening handicaps from ai-openings.json → difficultyTiming. */
  readonly timing: DifficultyTiming;
}

export const PROFILES: Readonly<Record<Difficulty, AiProfileBase>> = {
  easy: {
    name: 'easy',
    thinkEvery: 10,
    microEvery: null,
    lead: 3,
    reactionDelayTicks: 20,
    oneHzEveryThink: true,
    budget: {
      total: 12000,
      intel: 4000,
      platoon: 2500,
      engineer: 2500,
      economy: 1000,
      defense: 800,
      factory: 500,
      tech: 200,
      reserve: 500,
      micro: 0,
    },
    apm: { cap: 40, burst: 10, p0Overdraft: 5 },
    errorRate: 0.15,
    errorTopK: 3,
    horizonS: 10,
    attackRatio: 1.5,
    retreatRatio: 0.7,
    reentryRatio: 1.0,
    reentryHpFrac: 0.6,
    raids: { count: 0, fromS: 0 },
    counterMode: 'off',
    openingFilter: ['eco_standard'],
    firstWave: 12,
    threatVisibleOnly: true,
    micro: false,
    platoonGridMode: false,
  },
  normal: {
    name: 'normal',
    thinkEvery: 5,
    microEvery: null,
    lead: 3,
    reactionDelayTicks: 5,
    oneHzEveryThink: false,
    budget: {
      total: 24000,
      intel: 7000,
      platoon: 5000,
      engineer: 5000,
      economy: 2000,
      defense: 2000,
      factory: 1000,
      tech: 500,
      reserve: 1500,
      micro: 0,
    },
    apm: { cap: 120, burst: 20, p0Overdraft: 5 },
    errorRate: 0.05,
    errorTopK: 2,
    horizonS: null,
    attackRatio: 1.2,
    retreatRatio: 0.7,
    reentryRatio: 1.0,
    reentryHpFrac: 0.6,
    raids: { count: 1, fromS: 360 },
    counterMode: 'nextMix',
    openingFilter: null,
    firstWave: null,
    threatVisibleOnly: false,
    micro: false,
    platoonGridMode: false,
  },
  hard: {
    name: 'hard',
    thinkEvery: 5,
    microEvery: 2,
    lead: 3,
    reactionDelayTicks: 0,
    oneHzEveryThink: false,
    budget: {
      total: 40000,
      intel: 12000,
      platoon: 9000,
      engineer: 8000,
      economy: 3000,
      defense: 3500,
      factory: 1500,
      tech: 500,
      reserve: 2500,
      micro: 8000,
    },
    apm: { cap: 300, burst: 40, p0Overdraft: 5 },
    errorRate: 0,
    errorTopK: 1,
    horizonS: 60,
    attackRatio: 1.0,
    retreatRatio: 0.7,
    reentryRatio: 1.0,
    reentryHpFrac: 0.6,
    raids: { count: 2, fromS: 240 },
    counterMode: 'immediatePredict',
    openingFilter: null,
    firstWave: null,
    threatVisibleOnly: false,
    micro: true,
    platoonGridMode: false,
  },
};

/** Full profile: base values of `PROFILES` plus the opening handicaps of the openings document. */
export function profileFor(difficulty: Difficulty, openings: OpeningsDoc): AiProfile {
  const base = PROFILES[difficulty];
  return { ...base, timing: openings.difficultyTiming[difficulty] };
}

/** Energy horizon in s for a profile and an opening's `followUp.energy.horizonS`. */
export function horizonFor(profile: AiProfileBase, openingHorizonS: number): number {
  return profile.horizonS ?? openingHorizonS;
}

/** Wave threshold of the first wave: profile override or opening `waves.first` + waveExtra. */
export function firstWaveFor(profile: AiProfile, openingFirst: number): number {
  return profile.firstWave ?? openingFirst + profile.timing.waveExtra;
}
