/**
 * Match metrics from the world truth (never from the AI's perception), definitions like ecosim
 * `summary()` / ai-openings.json `expect` and ai.md §5.3/§7.1:
 * - fac1: first completed FACTORY; eng1/eng4: 1st/4th engineer out of a factory (after roll-off);
 *   mex4/mex8: 4th/8th built MASSEXTRACTION (upgrades do not count); t2: first factory with TECH2
 *   completed (built or upgraded). All as ticks after the step (seconds = tick / 10).
 * - massInc / mexAt at 180/300/480/720 s: Σ mass income of all own sources (M/s) and the number of
 *   live extractors (any tech) at that moment.
 * - idle engineers: Σ idle ticks / Σ alive ticks of engineers (commander excluded); idle = no order
 *   for ≥ 2 s (whole streak) or Guard/Assist whose target works on nothing.
 * - energy stall: ticks with energy ratio < 1 while energy is demanded, without the 60 s after losing
 *   an own generator/storage (FlowEconomy statistics), plus overflow and mass-starved build power.
 * - first combat: first combat unit produced (ecosim `firstCombat`: not SCOUT/ENGINEER/AIR) and the
 *   first tick with damage dealt or taken.
 * - produced units per role (ai-openings.json roles, first matching role in document order).
 * - command records per 60-s window (APM).
 */
import type { AiBlueprintTable } from '@faf/ai';
import type { CompiledCategoryExpr } from '@faf/rules';
import { getArenaRoles } from '../data/assumptions.ts';
import type { ArenaUnit } from '../world/unit.ts';
import type { ArenaWorld, CompletionKind, WorldObserver } from '../world/world.ts';

export const SAMPLE_SECONDS = [180, 300, 480, 720] as const;
export type SampleKey = '180' | '300' | '480' | '720';

export interface ArmyMatchMetrics {
  readonly army: number;
  readonly defeated: boolean;
  readonly defeatTick: number | null;
  readonly t2Tick: number | null;
  readonly fac1Tick: number | null;
  readonly eng1Tick: number | null;
  readonly eng4Tick: number | null;
  readonly mex4Tick: number | null;
  readonly mex8Tick: number | null;
  /** Mass income (M/s) at 180/300/480/720 s, null if the match ended before. */
  readonly massInc: Readonly<Record<SampleKey, number | null>>;
  readonly mexAt: Readonly<Record<SampleKey, number | null>>;
  readonly engineerAliveTicks: number;
  readonly engineerIdleTicks: number;
  /** Idle-engineer share in % (0 without engineers). */
  readonly idleEngineerPct: number;
  /** Energy-stall share in % of the counted (non-exempt) ticks (ecosim `stallE` semantics). */
  readonly energyStallPct: number;
  /** Raw counts for pooling over games (tai-p6): stall ticks and counted (non-exempt) ticks. */
  readonly energyStallTicks: number;
  readonly energyCountedTicks: number;
  readonly overflowPct: number;
  readonly massBpStallPct: number;
  /** ecosim `firstCombat`: first combat unit produced. */
  readonly firstCombatUnitTick: number | null;
  /** First damage dealt or taken. */
  readonly firstDamageTick: number | null;
  readonly producedByRole: Readonly<Record<string, number>>;
  readonly unitsProduced: number;
  readonly unitsLost: number;
  /** Command records per 60-s window. */
  readonly commandsPerWindow: readonly number[];
  readonly apmMax: number;
  readonly commandsRejected: number;
}

export interface MatchMetrics {
  readonly armies: readonly ArmyMatchMetrics[];
  /** Winner army, −1 = draw (tick limit or both commanders died in the same tick). */
  readonly winner: number;
  readonly endTick: number;
  readonly endReason: 'running' | 'commanderKilled' | 'maxTicks';
}

class ArmyTrack {
  t2 = -1;
  fac1 = -1;
  eng = 0;
  eng1 = -1;
  eng4 = -1;
  mex = 0;
  mex4 = -1;
  mex8 = -1;
  firstCombat = -1;
  massInc: (number | null)[] = SAMPLE_SECONDS.map(() => null);
  mexAt: (number | null)[] = SAMPLE_SECONDS.map(() => null);
  byRole: number[];

  constructor(roles: number) {
    this.byRole = new Array<number>(roles + 1).fill(0);
  }
}

/** Observer that collects the truth metrics of a match (attach before the first step). */
export class MetricsCollector implements WorldObserver {
  private readonly tracks: ArmyTrack[] = [];
  private readonly roleNames: readonly string[];
  private readonly roleExprs: CompiledCategoryExpr[];
  private readonly table: AiBlueprintTable;

  constructor(world: ArenaWorld, roles: Readonly<Record<string, string>> = getArenaRoles()) {
    this.table = world.bps;
    this.roleNames = Object.keys(roles);
    this.roleExprs = this.roleNames.map((r) => world.bps.compile(roles[r]!));
    for (let a = 0; a < 16; a++) this.tracks.push(new ArmyTrack(this.roleNames.length));
  }

  private roleOf(u: ArenaUnit): number {
    for (let i = 0; i < this.roleExprs.length; i++) if (this.table.matches(u.bp, this.roleExprs[i]!)) return i;
    return this.roleExprs.length;
  }

  onCompleted(_w: ArenaWorld, u: ArenaUnit, how: CompletionKind, tick: number): void {
    const t = this.tracks[u.army]!;
    const cats = u.bp.categoryNames;
    if (u.info.isFactory && cats.includes('TECH2') && t.t2 < 0) t.t2 = tick;
    if (how === 'build') {
      if (u.info.isFactory && t.fac1 < 0) t.fac1 = tick;
      if (u.info.isMex) {
        t.mex++;
        if (t.mex === 4) t.mex4 = tick;
        if (t.mex === 8) t.mex8 = tick;
      }
      return;
    }
    if (how === 'produced') {
      t.byRole[this.roleOf(u)]!++;
      if (u.info.isEngineer) {
        t.eng++;
        if (t.eng === 1) t.eng1 = tick;
        if (t.eng === 4) t.eng4 = tick;
      } else if (t.firstCombat < 0 && !cats.includes('SCOUT') && !cats.includes('ENGINEER') && !cats.includes('AIR')) {
        t.firstCombat = tick;
      }
    }
  }

  onTickEnd(w: ArenaWorld): void {
    for (let i = 0; i < SAMPLE_SECONDS.length; i++) {
      if (w.tick !== SAMPLE_SECONDS[i]! * 10) continue;
      for (const a of w.armies) {
        const t = this.tracks[a]!;
        t.massInc[i] = w.income[a]!.mass;
        let mex = 0;
        for (const u of w.slots) if (u !== null && u.alive && u.army === a && u.complete && u.info.isMex) mex++;
        t.mexAt[i] = mex;
      }
    }
  }

  /** Metrics of all armies of the world at its current tick. */
  result(w: ArenaWorld): MatchMetrics {
    const armies: ArmyMatchMetrics[] = [];
    const opt = (v: number): number | null => (v < 0 ? null : v);
    for (const a of w.armies) {
      const t = this.tracks[a]!;
      const c = w.counters[a]!;
      const st = w.eco.statsOf(a);
      const rep = w.eco.reportOf(a);
      const byRole: Record<string, number> = {};
      this.roleNames.forEach((n, i) => {
        byRole[n] = t.byRole[i]!;
      });
      byRole['other'] = t.byRole[this.roleNames.length]!;
      const rec = (arr: (number | null)[]): Record<SampleKey, number | null> => ({
        '180': arr[0] ?? null,
        '300': arr[1] ?? null,
        '480': arr[2] ?? null,
        '720': arr[3] ?? null,
      });
      let apmMax = 0;
      for (const n of c.commandsPerWindow) if (n > apmMax) apmMax = n;
      armies.push({
        army: a,
        defeated: w.defeated[a] === true,
        defeatTick: opt(w.defeatTick[a] ?? -1),
        t2Tick: opt(t.t2),
        fac1Tick: opt(t.fac1),
        eng1Tick: opt(t.eng1),
        eng4Tick: opt(t.eng4),
        mex4Tick: opt(t.mex4),
        mex8Tick: opt(t.mex8),
        massInc: rec(t.massInc),
        mexAt: rec(t.mexAt),
        engineerAliveTicks: c.engineerAliveTicks,
        engineerIdleTicks: c.engineerIdleTicks,
        idleEngineerPct: c.engineerAliveTicks > 0 ? (100 * c.engineerIdleTicks) / c.engineerAliveTicks : 0,
        energyStallPct: rep.energyStallPct,
        energyStallTicks: st.energyStallTicks,
        energyCountedTicks: st.ticks - st.exemptTicks,
        overflowPct: rep.overflowPct,
        massBpStallPct: rep.massBpStallPct,
        firstCombatUnitTick: opt(t.firstCombat),
        firstDamageTick: opt(c.firstDamageTick),
        producedByRole: byRole,
        unitsProduced: c.unitsProduced,
        unitsLost: c.unitsLost,
        commandsPerWindow: c.commandsPerWindow.slice(),
        apmMax,
        commandsRejected: c.commandsRejected,
      });
    }
    return { armies, winner: w.winner, endTick: w.tick, endReason: w.endReason };
  }
}

/** Seconds of a metric tick (null stays null). */
export function ticksToSeconds(t: number | null): number | null {
  return t === null ? null : t / 10;
}
