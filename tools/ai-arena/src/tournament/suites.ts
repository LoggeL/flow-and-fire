/**
 * Tournament suites and plans (ai.md §7.3, TRACK-AI tai-p6):
 *
 * | suite | pairings                                   | seeds × swap × maps                          | games | game time | gates    |
 * |-------|--------------------------------------------|----------------------------------------------|-------|-----------|----------|
 * | ms9   | Normal mirror                              | 1–105 × 2, Setons / Hollow Ridge / Tessera   | 210   | 30 min    | Wilson   |
 * | diff  | Normal vs Easy, Hard vs Normal             | 1–30 × 2 each, same maps                     | 120   | 30 min    | report   |
 * | quick | Normal mirror                              | 1–6 × 2, same maps                           | 12    | 13 min    | point    |
 *
 * Seed s plays maps[s mod k]; every seed twice with exchanged armies (stats/schedule.ts). In the
 * mirror the second game exchanges the start markers of the two armies instead (exchanging identical
 * deterministic contestants would replay the identical game). The sampled side is the army with the
 * seed's parity in the mirror (ai.md §7.1), otherwise contestant A (the candidate: Normal in
 * Normal-vs-Easy, Hard in Hard-vs-Normal).
 */
import { mirrorAiSeed, pairingSchedule, sampleSide, seedRange } from '../stats/schedule.ts';
import { DEFAULT_BRAIN_SPEC } from '../host-node/brain-spec.ts';
import type { HostClockKind } from '../bench/clock.ts';
import type { HostKind } from '../host-node/sides.ts';
import { DEFAULT_MAX_TICKS, type Contestant, type GateMode, type MatchJob } from './types.ts';

export type SuiteName = 'ms9' | 'diff' | 'quick';

export const SUITE_NAMES: readonly SuiteName[] = ['ms9', 'diff', 'quick'];

/** MS9 maps (ai.md §7.3: Setons, Hollow Ridge, a third 512-WU map). */
export const MS9_MAPS: readonly string[] = ['setons', 'hollow-ridge', 'tessera'];

export interface PairingDef {
  readonly id: string;
  readonly a: Contestant;
  readonly b: Contestant;
  readonly mirror: boolean;
  readonly seeds: readonly number[];
}

export interface SuiteDef {
  readonly name: SuiteName;
  readonly description: string;
  readonly pairings: readonly PairingDef[];
  readonly maps: readonly string[];
  readonly maxTicks: number;
  readonly gateMode: GateMode;
}

const c = (label: 'easy' | 'normal' | 'hard', brain: string = DEFAULT_BRAIN_SPEC): Contestant => ({ label, profile: label, brain });

/** The built-in suite definitions. */
export function suiteDef(name: SuiteName): SuiteDef {
  switch (name) {
    case 'ms9':
      return {
        name,
        description: 'MS9-Gate: Normal-Spiegel, Seeds 1–105 × getauschte Startmarker (eigener KI-Seed je Spiel), 3 Karten (210 Spiele, 30 min)',
        pairings: [{ id: 'normal-vs-normal', a: c('normal'), b: c('normal'), mirror: true, seeds: seedRange(1, 105) }],
        maps: MS9_MAPS,
        maxTicks: DEFAULT_MAX_TICKS,
        gateMode: 'wilson',
      };
    case 'diff':
      return {
        name,
        description: 'Schwierigkeitsvergleich (Bericht): Normal gegen Easy und Hard gegen Normal, je 60 Spiele (30 min)',
        pairings: [
          { id: 'normal-vs-easy', a: c('normal'), b: c('easy'), mirror: false, seeds: seedRange(1, 30) },
          { id: 'hard-vs-normal', a: c('hard'), b: c('normal'), mirror: false, seeds: seedRange(1, 30) },
        ],
        maps: MS9_MAPS,
        maxTicks: DEFAULT_MAX_TICKS,
        gateMode: 'report',
      };
    case 'quick':
      return {
        name,
        description: 'Schnelltest: Normal-Spiegel, Seeds 1–6 × getauschte Startmarker (eigener KI-Seed je Spiel), 3 Karten (12 Spiele, 13 min)',
        pairings: [{ id: 'normal-vs-normal', a: c('normal'), b: c('normal'), mirror: true, seeds: seedRange(1, 6) }],
        maps: MS9_MAPS,
        maxTicks: 7_800,
        gateMode: 'point',
      };
  }
}

export interface PlanOverrides {
  /** Replaces the suite's maps. */
  readonly maps?: readonly string[];
  /** Replaces the seeds of every pairing. */
  readonly seeds?: readonly number[];
  /** Replaces every contestant's brain. */
  readonly brain?: string;
  readonly host?: HostKind;
  /** Emergency-stop clock of the AI hosts (default 'thread'). */
  readonly clock?: HostClockKind;
  readonly maxTicks?: number;
  /** Keeps only the first N games of the plan. */
  readonly games?: number;
}

/** Applies overrides to a suite definition (maps/seeds/brain/maxTicks). */
export function withOverrides(def: SuiteDef, o: PlanOverrides): SuiteDef {
  const brain = o.brain;
  const swapBrain = (x: Contestant): Contestant => (brain === undefined ? x : { ...x, brain });
  return {
    ...def,
    maps: o.maps ?? def.maps,
    maxTicks: o.maxTicks ?? def.maxTicks,
    pairings: def.pairings.map((p) => ({ ...p, a: swapBrain(p.a), b: swapBrain(p.b), seeds: o.seeds ?? p.seeds })),
  };
}

/** The job list of a suite (pairings in order, each by pairingSchedule; game = running index). */
export function planSuite(def: SuiteDef, host: HostKind = 'sync', games?: number, clock: HostClockKind = 'thread'): MatchJob[] {
  if (def.maps.length === 0) throw new RangeError(`suite ${def.name}: no maps`);
  const jobs: MatchJob[] = [];
  for (const p of def.pairings) {
    for (const s of pairingSchedule({ seeds: p.seeds, maps: def.maps, swap: true })) {
      // Mirror: identical contestants ⇒ exchange the start markers instead of the armies (see MatchJob.swapped).
      const armyA: 0 | 1 = p.mirror ? 0 : s.armyA;
      const starts: [number, number] = p.mirror && s.swapped ? [1, 0] : [0, 1];
      const side = (army: 0 | 1): MatchJob['sides'][number] => {
        const isA = army === armyA;
        const who = isA ? p.a : p.b;
        return { army, contestant: isA ? 'A' : 'B', label: who.label, profile: who.profile, brain: who.brain };
      };
      jobs.push({
        game: jobs.length,
        suite: def.name,
        pairing: p.id,
        mirror: p.mirror,
        seed: s.seed,
        map: s.map,
        swapped: s.swapped,
        armyA,
        starts,
        aiSeed: p.mirror ? mirrorAiSeed(s.seed, s.swapped) : s.seed >>> 0,
        maxTicks: def.maxTicks,
        host,
        clock,
        sampledArmy: p.mirror ? sampleSide(s.seed) : armyA,
        sides: [side(0), side(1)],
      });
    }
  }
  if (games !== undefined) {
    if (!Number.isInteger(games) || games < 1) throw new RangeError(`--games must be a positive integer (${games})`);
    return jobs.slice(0, games);
  }
  return jobs;
}

/** Plan of a named suite with overrides. */
export function planNamedSuite(name: SuiteName, o: PlanOverrides = {}): { def: SuiteDef; jobs: MatchJob[] } {
  const def = withOverrides(suiteDef(name), o);
  return { def, jobs: planSuite(def, o.host ?? 'sync', o.games, o.clock ?? 'thread') };
}
