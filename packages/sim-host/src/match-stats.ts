/**
 * Match statistics recorded by the host from committed authoritative ticks. The World has no
 * cumulative counters; this observer sums the per-tick economy values and counts the tick's
 * BuildComplete/UnitDeath events after every step. It never writes World state and is not part
 * of the command log, hashes or replay layout. Values are released only after the match ended
 * (see SimHost), so no hidden enemy information reaches the running HUD.
 */
import { unpackIndex } from '@faf/heap';
import { EventType, type MatchStatsSnapshot } from '@faf/protocol';
import { UnitBits, type World } from '@faf/sim';

/** Sample interval of the time series in ticks (10 s at 10 Hz). */
export const MATCH_STATS_SAMPLE_TICKS = 100;
const EVENT_WORDS = 11;
const FLAG_STRUCTURE = 1, FLAG_COMMAND = 4;

interface Acc {
  massProduced: number; energyProduced: number; massSpent: number; energySpent: number;
  unitsBuilt: number; structuresBuilt: number; massBuilt: number; unitsLost: number; massLost: number;
  firstFactoryTick: number | null; commanderLostTick: number | null; massIncomeSeries: number[]; armyValueSeries: number[];
}

export class MatchStats {
  private readonly acc: Acc[];
  private fromTick = -1;
  private lastTick = -1;
  private complete = true;
  private settled = false;

  constructor(private readonly armyCount: number) {
    this.acc = Array.from({ length: armyCount }, () => ({
      massProduced: 0, energyProduced: 0, massSpent: 0, energySpent: 0, unitsBuilt: 0, structuresBuilt: 0, massBuilt: 0,
      unitsLost: 0, massLost: 0, firstFactoryTick: null, commanderLostTick: null, massIncomeSeries: [], armyValueSeries: [],
    }));
  }

  /** Call once after every committed tick. Re-simulated or skipped ticks mark the record incomplete. */
  observe(w: World): void {
    const tick = w.tick;
    if (this.lastTick >= 0 && tick <= this.lastTick) { this.complete = false; return; }
    if (this.lastTick >= 0 && tick !== this.lastTick + 1) this.complete = false;
    if (this.fromTick < 0) this.fromTick = tick;
    this.lastTick = tick;
    const A = w.armies.col, U = w.units.col, bp = w.bp;
    for (let a = 0; a < this.armyCount; a++) {
      const s = this.acc[a]!;
      s.massProduced += A.massIncome.get(a); s.energyProduced += A.energyIncome.get(a);
      s.massSpent += A.massSpent.get(a); s.energySpent += A.energySpent.get(a);
    }
    const E = w.combatEvents.i32, n = E[0]!;
    for (let e = 0; e < n; e++) {
      const o = 1 + e * EVENT_WORDS, type = E[o]!;
      if (type !== EventType.BuildComplete && type !== EventType.UnitDeath) continue;
      const visual = E[o + 1]!, flags = E[o + 4]!, slot = unpackIndex(E[o + 9]! >>> 0), army = U.army[slot]!;
      // Columns stay readable until a slot is reallocated; a stale handle would name another unit.
      if (U.bp[slot] !== visual || army >= this.armyCount) { this.complete = false; continue; }
      const s = this.acc[army]!, mass = bp.massCostCol[visual]!;
      if (type === EventType.BuildComplete) {
        if (flags & FLAG_STRUCTURE) s.structuresBuilt++; else s.unitsBuilt++;
        s.massBuilt += mass;
        if (s.firstFactoryTick === null && this.isFactory(w, visual)) s.firstFactoryTick = tick;
      } else {
        s.unitsLost++; s.massLost += mass;
        if ((flags & FLAG_COMMAND) && s.commanderLostTick === null) s.commanderLostTick = tick;
      }
    }
    if (tick % MATCH_STATS_SAMPLE_TICKS === 0) {
      const value = new Array<number>(this.armyCount).fill(0);
      for (let u = 0; u < w.units.highWater; u++) {
        if (!w.units.isLive(u) || (U.flags[u]! & (UnitBits.UnderConstruction | UnitBits.Dead)) !== 0 || bp.speed[U.bp[u]!]! <= 0) continue;
        const army = U.army[u]!; if (army < this.armyCount) value[army] = value[army]! + bp.massCostCol[U.bp[u]!]!;
      }
      for (let a = 0; a < this.armyCount; a++) {
        const s = this.acc[a]!;
        s.massIncomeSeries.push(A.massIncome.get(a) / 100);
        s.armyValueSeries.push(value[a]!);
      }
    }
  }

  private isFactory(w: World, visual: number): boolean {
    const bit = w.bp.categoryNames.indexOf('FACTORY');
    return bit >= 0 && (w.bp.categoryWord(visual, bit >>> 5) & (1 << (bit & 31))) !== 0;
  }

  /**
   * The match end kills every remaining unit of a defeated army by flag; their death events
   * would only appear in a tick that never runs once the session pauses. Count those
   * authoritative pending deaths once, at the end.
   */
  settle(w: World): void {
    if (this.settled) return;
    this.settled = true;
    const U = w.units.col, bp = w.bp;
    for (let u = 0; u < w.units.highWater; u++) {
      if (!w.units.isLive(u) || (U.flags[u]! & UnitBits.Dead) === 0 || (U.flags[u]! & UnitBits.DeathProcessed) !== 0) continue;
      const army = U.army[u]!; if (army >= this.armyCount) continue;
      const s = this.acc[army]!, visual = U.bp[u]!;
      s.unitsLost++; s.massLost += bp.massCostCol[visual]!;
      if (s.commanderLostTick === null && this.isCommander(w, visual)) s.commanderLostTick = w.tick;
    }
  }
  private isCommander(w: World, visual: number): boolean {
    const bit = w.bp.categoryNames.indexOf('COMMAND');
    return bit >= 0 && (w.bp.categoryWord(visual, bit >>> 5) & (1 << (bit & 31))) !== 0;
  }

  /** Plain structured-clonable snapshot (resources converted from milli units). */
  snapshot(): MatchStatsSnapshot {
    return {
      fromTick: this.fromTick, toTick: this.lastTick, complete: this.complete && this.fromTick >= 0, sampleTicks: MATCH_STATS_SAMPLE_TICKS,
      armies: this.acc.map((s, army) => ({
        army, massProduced: Math.floor(s.massProduced / 1000), energyProduced: Math.floor(s.energyProduced / 1000),
        massSpent: Math.floor(s.massSpent / 1000), energySpent: Math.floor(s.energySpent / 1000),
        unitsBuilt: s.unitsBuilt, structuresBuilt: s.structuresBuilt, massBuilt: s.massBuilt, unitsLost: s.unitsLost, massLost: s.massLost,
        firstFactoryTick: s.firstFactoryTick, commanderLostTick: s.commanderLostTick,
        massIncomeSeries: s.massIncomeSeries.slice(), armyValueSeries: s.armyValueSeries.slice(),
      })),
    };
  }
}
