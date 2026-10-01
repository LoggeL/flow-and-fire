/**
 * Flow economy for the headless arena (PLAN §3.4 phase 4 "Economy", reference model
 * tools/ai-sim/ecosim.py class Sim, economy part).
 *
 * Model (one priority tier, as in ecosim and the MVP sim):
 * - 10 Hz, DT = 0.1 s. Income and upkeep are rates per second, applied once per tick.
 * - Consumers report their demand per tick at ratio 1 (mass and energy). Per army there is exactly
 *   one stall ratio r = min(1, availMass / massDemand, availEnergy / energyDemand), clamped to [0, 1];
 *   every consumer of that army progresses with the same r (independent of consumer order).
 * - Storage limits with overflow accounting; energy never goes below 0 (unpaid upkeep is counted).
 *
 * Units and exactness (decision, see docs/status/track-ai-tai-p1-arena-base.md):
 * - All stocks, demands and charges are integers in milli-units (1 mass = 1000 mM). Integer sums are
 *   associative, so totals do not depend on the order of `request` calls.
 * - Income/upkeep rates are integers in micro-units per second and are turned into milli per tick
 *   with an integer carry (no drift over long games, no float summation order).
 * - Cumulative accounting: a consumer charges floor(cost·doneNew) − floor(cost·doneOld) (cost in
 *   milli, done ∈ [0, 1]). The per-tick charges telescope, so the sum over a whole build is exactly
 *   `cost` once done reaches exactly 1 (see `advanceDone`). No final correction is needed.
 * - Because floor differences may exceed cost·Δdone by < 1 milli, the ratio is computed against
 *   the available stock minus one milli per active consumer; charges can therefore never exceed the
 *   stock. Any residual shortfall would be clamped and reported (`shortfall*Milli`, expected 0).
 *
 * Tick protocol (the arena world calls this in its economy phase):
 *   beginTick() → addIncome / addUpkeep → request(army, consumerId, m, e, bp) → resolve()
 *   → ratio(army) / granted…(consumerId) → charge… (what was actually consumed) → endTick()
 * Capacities and starting stocks are set by the caller (setCapacity / setStored / addCapacity).
 *
 * Determinism: only IEEE-exact operations; no Map/Set iteration other than insertion order.
 */

export const ECO_TICK_HZ = 10;
/** Seconds per tick (informational; the implementation works with integers). */
export const ECO_DT = 0.1;
/** Milli-units per resource unit. */
export const MILLI = 1000;
/** Micro-units per resource unit (resolution of income and upkeep rates). */
export const MICRO = 1_000_000;
/** Micro-units per second that make one milli-unit per tick (1 unit/s = 1e6 µ/s = 100 milli/tick). */
const MICRO_PER_SEC_PER_MILLI_TICK = 10_000;
/** Maximum number of armies (PLAN: 16 army slots). */
export const ECO_MAX_ARMIES = 16;
/** Progress values this close to 1 snap to exactly 1 (as ecosim: progress ≥ 1 − 1e-9). */
export const DONE_EPSILON = 1e-9;

/** Converts resource units to integer milli-units (rounded to nearest). */
export function toMilli(units: number): number {
  if (!Number.isFinite(units)) throw new RangeError(`flow-eco: non-finite amount ${units}`);
  return Math.round(units * MILLI);
}

/** Converts milli-units back to resource units. */
export function fromMilli(milli: number): number {
  return milli / MILLI;
}

function toMicroRate(perSec: number): number {
  if (!Number.isFinite(perSec)) throw new RangeError(`flow-eco: non-finite rate ${perSec}`);
  return Math.round(perSec * MICRO);
}

/**
 * Advances a progress fraction by `inc` and snaps to exactly 1 at completion (≥ 1 − 1e-9).
 * Use it for every build/upgrade/factory item so `cumulativeCharge` telescopes to the full cost.
 */
export function advanceDone(done: number, inc: number): number {
  const n = done + inc;
  if (n >= 1 - DONE_EPSILON) return 1;
  return n < 0 ? 0 : n;
}

/**
 * Milli-units consumed while progress moves from `doneOld` to `doneNew` (both clamped to [0, 1]):
 * floor(costMilli · doneNew) − floor(costMilli · doneOld). Summed over a build from 0 to exactly 1
 * this is exactly `costMilli` (telescoping sum of integers).
 */
export function cumulativeCharge(costMilli: number, doneOld: number, doneNew: number): number {
  const a = doneOld <= 0 ? 0 : doneOld >= 1 ? 1 : doneOld;
  const b = doneNew <= 0 ? 0 : doneNew >= 1 ? 1 : doneNew;
  if (b < a) throw new RangeError(`flow-eco: progress went backwards (${doneOld} → ${doneNew})`);
  return Math.floor(costMilli * b) - Math.floor(costMilli * a);
}

/**
 * Demand per tick at ratio 1 for a build of `cost` units with `buildPower` on a blueprint with
 * `buildTime` (FA semantics: seconds = buildTime / buildPower): cost · BP / buildTime · DT.
 * Also returns the progress increment per tick at ratio 1.
 */
export function buildRatePerTick(buildTime: number, buildPower: number): number {
  if (!(buildTime > 0)) throw new RangeError(`flow-eco: buildTime must be > 0 (${buildTime})`);
  return buildPower / buildTime / ECO_TICK_HZ;
}

/** Per-army statistics (integers in milli-units unless noted). */
export interface EcoArmyStats {
  /** Ticks since the army was first resolved. */
  readonly ticks: number;
  /** Ticks with energy ratio < 1 while energy demand > 0 (excluding exempt windows). */
  readonly energyStallTicks: number;
  /** Ticks with energy demand > 0 (excluding exempt windows). */
  readonly energyDemandTicks: number;
  /** Ticks inside an energy-stall exemption window (`exemptEnergyStallUntil`). */
  readonly exemptTicks: number;
  /** Ticks with mass ratio < 1 while mass demand > 0. */
  readonly massStallTicks: number;
  /** Build power · seconds reported by consumers (BP·s, float, summed in tick order). */
  readonly bpSeconds: number;
  /** Build power · seconds left unused because mass was the limiting resource (BP·s). */
  readonly bpSecondsMassStalled: number;
  readonly incomeMassMilli: number;
  readonly incomeEnergyMilli: number;
  readonly upkeepEnergyMilli: number;
  /** Upkeep that could not be paid because the energy stock was empty. */
  readonly upkeepUnpaidMilli: number;
  readonly consumedMassMilli: number;
  readonly consumedEnergyMilli: number;
  /** Mass lost to a full store (the "Overflow" metric). */
  readonly overflowMassMilli: number;
  readonly overflowEnergyMilli: number;
  /** Charges that exceeded the stock and were clamped (should stay 0). */
  readonly shortfallMassMilli: number;
  readonly shortfallEnergyMilli: number;
}

/** Derived report figures (percentages 0..100). */
export interface EcoReport {
  /** Energy stall share: stall ticks / non-exempt ticks (ecosim `stallE`, ai.md §4.5 "E-Stall"). */
  readonly energyStallPct: number;
  /** Mass-starved build power / reported build power (ecosim `stallMbp`, "M-BP-Stall"). */
  readonly massBpStallPct: number;
  /** Overflowed mass / mass income (ecosim `overflowM`, "Overfl."). */
  readonly overflowPct: number;
  /** Average mass income in units per second. */
  readonly avgMassIncome: number;
}

/** Per-army state as seen after `resolve()` (rates per second, stocks in units). */
export interface EcoSnapshot {
  readonly massIncome: number;
  readonly energyIncome: number;
  readonly energyUpkeep: number;
  readonly massStored: number;
  readonly energyStored: number;
  readonly massCapacity: number;
  readonly energyCapacity: number;
  readonly massRatio: number;
  readonly energyRatio: number;
  readonly ratio: number;
  readonly massDemand: number;
  readonly energyDemand: number;
}

type Phase = 'idle' | 'collect' | 'resolved';

class MutableStats {
  ticks = 0;
  energyStallTicks = 0;
  energyDemandTicks = 0;
  exemptTicks = 0;
  massStallTicks = 0;
  bpSeconds = 0;
  bpSecondsMassStalled = 0;
  incomeMassMilli = 0;
  incomeEnergyMilli = 0;
  upkeepEnergyMilli = 0;
  upkeepUnpaidMilli = 0;
  consumedMassMilli = 0;
  consumedEnergyMilli = 0;
  overflowMassMilli = 0;
  overflowEnergyMilli = 0;
  shortfallMassMilli = 0;
  shortfallEnergyMilli = 0;
}

/**
 * Flow economy for up to 16 armies. All per-army arrays are Float64Array holding integers
 * (exact up to 2^53 milli-units).
 */
export class FlowEconomy {
  readonly armies: number;
  /** Index of the current (or last completed) tick; −1 before the first `beginTick`. */
  tick = -1;

  private phase: Phase = 'idle';

  private readonly storedM: Float64Array;
  private readonly storedE: Float64Array;
  private readonly capM: Float64Array;
  private readonly capE: Float64Array;

  // Rates of the current tick (micro-units per second) and their integer carries.
  private readonly rateIncM: Float64Array;
  private readonly rateIncE: Float64Array;
  private readonly rateUpkE: Float64Array;
  private readonly carryIncM: Float64Array;
  private readonly carryIncE: Float64Array;
  private readonly carryUpkE: Float64Array;

  // Per-tick amounts (milli).
  private readonly incM: Float64Array;
  private readonly incE: Float64Array;
  private readonly upkE: Float64Array;
  private readonly demM: Float64Array;
  private readonly demE: Float64Array;
  private readonly bpTick: Float64Array;
  private readonly consumerCount: Int32Array;
  private readonly chargedM: Float64Array;
  private readonly chargedE: Float64Array;

  // Ratios of the last resolve.
  private readonly rMass: Float64Array;
  private readonly rEnergy: Float64Array;
  private readonly rAll: Float64Array;

  private readonly stallExemptUntil: Float64Array;
  private readonly stats: MutableStats[];

  // Consumers of the current tick, in request order.
  private cCount = 0;
  private cArmy: number[] = [];
  private cReqM: number[] = [];
  private cReqE: number[] = [];
  private readonly cIndex = new Map<number, number>();

  constructor(armies: number) {
    if (!Number.isInteger(armies) || armies < 1 || armies > ECO_MAX_ARMIES) {
      throw new RangeError(`flow-eco: armies must be 1..${ECO_MAX_ARMIES} (${armies})`);
    }
    this.armies = armies;
    const f = (): Float64Array => new Float64Array(armies);
    this.storedM = f();
    this.storedE = f();
    this.capM = f();
    this.capE = f();
    this.rateIncM = f();
    this.rateIncE = f();
    this.rateUpkE = f();
    this.carryIncM = f();
    this.carryIncE = f();
    this.carryUpkE = f();
    this.incM = f();
    this.incE = f();
    this.upkE = f();
    this.demM = f();
    this.demE = f();
    this.bpTick = f();
    this.consumerCount = new Int32Array(armies);
    this.chargedM = f();
    this.chargedE = f();
    this.rMass = f().fill(1);
    this.rEnergy = f().fill(1);
    this.rAll = f().fill(1);
    this.stallExemptUntil = f().fill(-1);
    this.stats = [];
    for (let a = 0; a < armies; a++) this.stats.push(new MutableStats());
  }

  private checkArmy(army: number): void {
    if (!Number.isInteger(army) || army < 0 || army >= this.armies) {
      throw new RangeError(`flow-eco: army ${army} out of range 0..${this.armies - 1}`);
    }
  }

  private expect(phase: Phase, what: string): void {
    if (this.phase !== phase) throw new Error(`flow-eco: ${what} not allowed in phase '${this.phase}' (expected '${phase}')`);
  }

  // --- storage (callable at any time; clamping happens in endTick) --------------------------------

  /** Sets the storage capacities in units (e.g. commander 650 M / 3,900 E plus storages). */
  setCapacity(army: number, mass: number, energy: number): void {
    this.checkArmy(army);
    const m = toMilli(mass);
    const e = toMilli(energy);
    if (m < 0 || e < 0) throw new RangeError('flow-eco: capacity must be >= 0');
    this.capM[army] = m;
    this.capE[army] = e;
  }

  /** Adds (or with negative values removes) capacity, e.g. when a storage is completed/destroyed. */
  addCapacity(army: number, mass: number, energy: number): void {
    this.checkArmy(army);
    const m = (this.capM[army] ?? 0) + toMilli(mass);
    const e = (this.capE[army] ?? 0) + toMilli(energy);
    this.capM[army] = m < 0 ? 0 : m;
    this.capE[army] = e < 0 ? 0 : e;
  }

  /** Sets the current stocks in units (starting storage is the caller's decision). */
  setStored(army: number, mass: number, energy: number): void {
    this.checkArmy(army);
    const m = toMilli(mass);
    const e = toMilli(energy);
    if (m < 0 || e < 0) throw new RangeError('flow-eco: stock must be >= 0');
    this.storedM[army] = m;
    this.storedE[army] = e;
  }

  /** Energy stall ticks up to and including `untilTick` are not counted (ai.md §7.1: 60 s after losing a generator). */
  exemptEnergyStallUntil(army: number, untilTick: number): void {
    this.checkArmy(army);
    if (untilTick > (this.stallExemptUntil[army] ?? -1)) this.stallExemptUntil[army] = untilTick;
  }

  // --- tick protocol --------------------------------------------------------------------------------

  /** Starts a tick: clears income, upkeep and demands of all armies. */
  beginTick(): void {
    this.expect('idle', 'beginTick');
    this.tick++;
    this.phase = 'collect';
    this.rateIncM.fill(0);
    this.rateIncE.fill(0);
    this.rateUpkE.fill(0);
    this.demM.fill(0);
    this.demE.fill(0);
    this.bpTick.fill(0);
    this.consumerCount.fill(0);
    this.chargedM.fill(0);
    this.chargedE.fill(0);
    this.cCount = 0;
    this.cIndex.clear();
  }

  /** Adds income in units per second (mass extractors, generators, commander, modifiers applied by the caller). */
  addIncome(army: number, massPerSec: number, energyPerSec: number): void {
    this.expect('collect', 'addIncome');
    this.checkArmy(army);
    const m = toMicroRate(massPerSec);
    const e = toMicroRate(energyPerSec);
    if (m < 0 || e < 0) throw new RangeError('flow-eco: income must be >= 0');
    this.rateIncM[army] = (this.rateIncM[army] ?? 0) + m;
    this.rateIncE[army] = (this.rateIncE[army] ?? 0) + e;
  }

  /** Adds energy upkeep in units per second (radar, shields, …). */
  addUpkeep(army: number, energyPerSec: number): void {
    this.expect('collect', 'addUpkeep');
    this.checkArmy(army);
    const e = toMicroRate(energyPerSec);
    if (e < 0) throw new RangeError('flow-eco: upkeep must be >= 0');
    this.rateUpkE[army] = (this.rateUpkE[army] ?? 0) + e;
  }

  /**
   * Registers a consumer's demand for this tick at ratio 1 (units per tick; rounded up to milli).
   * `buildPower` only feeds the build-power statistics. Each consumerId at most once per tick.
   */
  request(army: number, consumerId: number, massPerTick: number, energyPerTick: number, buildPower = 0): void {
    this.expect('collect', 'request');
    this.checkArmy(army);
    if (this.cIndex.has(consumerId)) throw new Error(`flow-eco: consumer ${consumerId} requested twice in tick ${this.tick}`);
    if (!Number.isFinite(massPerTick) || !Number.isFinite(energyPerTick) || massPerTick < 0 || energyPerTick < 0) {
      throw new RangeError(`flow-eco: invalid demand (${massPerTick}, ${energyPerTick})`);
    }
    const m = Math.ceil(massPerTick * MILLI);
    const e = Math.ceil(energyPerTick * MILLI);
    const i = this.cCount++;
    this.cArmy[i] = army;
    this.cReqM[i] = m;
    this.cReqE[i] = e;
    this.cIndex.set(consumerId, i);
    this.demM[army] = (this.demM[army] ?? 0) + m;
    this.demE[army] = (this.demE[army] ?? 0) + e;
    this.bpTick[army] = (this.bpTick[army] ?? 0) + buildPower;
    if (m > 0 || e > 0) this.consumerCount[army] = (this.consumerCount[army] ?? 0) + 1;
  }

  /** Computes income of this tick and the stall ratio of every army; updates the statistics. */
  resolve(): void {
    this.expect('collect', 'resolve');
    for (let a = 0; a < this.armies; a++) {
      const incM = this.takeCarry(this.carryIncM, this.rateIncM, a);
      const incE = this.takeCarry(this.carryIncE, this.rateIncE, a);
      const upkE = this.takeCarry(this.carryUpkE, this.rateUpkE, a);
      this.incM[a] = incM;
      this.incE[a] = incE;
      this.upkE[a] = upkE;
      const reserve = this.consumerCount[a] ?? 0;
      const availM = (this.storedM[a] ?? 0) + incM - reserve;
      const availE = (this.storedE[a] ?? 0) + incE - upkE - reserve;
      const dM = this.demM[a] ?? 0;
      const dE = this.demE[a] ?? 0;
      const rM = dM <= 0 ? 1 : ratioOf(availM, dM);
      const rE = dE <= 0 ? 1 : ratioOf(availE, dE);
      const r = rM < rE ? rM : rE;
      this.rMass[a] = rM;
      this.rEnergy[a] = rE;
      this.rAll[a] = r;

      const st = this.stats[a] as MutableStats;
      st.ticks++;
      if (this.tick <= (this.stallExemptUntil[a] ?? -1)) {
        st.exemptTicks++;
      } else if (dE > 0) {
        st.energyDemandTicks++;
        if (rE < 1) st.energyStallTicks++;
      }
      if (dM > 0 && rM < 1) st.massStallTicks++;
      const bp = this.bpTick[a] ?? 0;
      if (bp > 0) {
        st.bpSeconds += bp * ECO_DT;
        if (rM <= rE && rM < 1) st.bpSecondsMassStalled += bp * ECO_DT * (1 - rM);
      }
      st.incomeMassMilli += incM;
      st.incomeEnergyMilli += incE;
      st.upkeepEnergyMilli += upkE;
    }
    this.phase = 'resolved';
  }

  private takeCarry(carry: Float64Array, rate: Float64Array, a: number): number {
    const t = (carry[a] ?? 0) + (rate[a] ?? 0);
    const milli = Math.floor(t / MICRO_PER_SEC_PER_MILLI_TICK);
    carry[a] = t - milli * MICRO_PER_SEC_PER_MILLI_TICK;
    return milli;
  }

  /** Stall ratio r of the army in this tick (valid after `resolve`). */
  ratio(army: number): number {
    this.checkArmy(army);
    return this.rAll[army] ?? 1;
  }

  /** Mass-only ratio (availMass / massDemand clamped to [0, 1]); ai.md §5.1 r_M. */
  massRatio(army: number): number {
    this.checkArmy(army);
    return this.rMass[army] ?? 1;
  }

  /** Energy-only ratio (availEnergy / energyDemand clamped to [0, 1]). */
  energyRatio(army: number): number {
    this.checkArmy(army);
    return this.rEnergy[army] ?? 1;
  }

  private consumer(consumerId: number): number {
    const i = this.cIndex.get(consumerId);
    if (i === undefined) throw new Error(`flow-eco: consumer ${consumerId} has no request in tick ${this.tick}`);
    return i;
  }

  /** Army of a consumer that requested in this tick. */
  consumerArmy(consumerId: number): number {
    return this.cArmy[this.consumer(consumerId)] ?? 0;
  }

  /** Mass (milli) granted to a consumer: floor(request · r). */
  grantedMassMilli(consumerId: number): number {
    this.expect('resolved', 'grantedMassMilli');
    const i = this.consumer(consumerId);
    return Math.floor((this.cReqM[i] ?? 0) * (this.rAll[this.cArmy[i] ?? 0] ?? 1));
  }

  /** Energy (milli) granted to a consumer: floor(request · r). */
  grantedEnergyMilli(consumerId: number): number {
    this.expect('resolved', 'grantedEnergyMilli');
    const i = this.consumer(consumerId);
    return Math.floor((this.cReqE[i] ?? 0) * (this.rAll[this.cArmy[i] ?? 0] ?? 1));
  }

  /** Books what a consumer actually used this tick (milli-units, integers ≥ 0). */
  charge(army: number, massMilli: number, energyMilli: number): void {
    this.expect('resolved', 'charge');
    this.checkArmy(army);
    if (!Number.isInteger(massMilli) || !Number.isInteger(energyMilli) || massMilli < 0 || energyMilli < 0) {
      throw new RangeError(`flow-eco: charge must be non-negative integers (${massMilli}, ${energyMilli})`);
    }
    this.chargedM[army] = (this.chargedM[army] ?? 0) + massMilli;
    this.chargedE[army] = (this.chargedE[army] ?? 0) + energyMilli;
  }

  /** Books exactly the granted amount of a consumer (non-progress consumers). */
  chargeGranted(consumerId: number): void {
    const m = this.grantedMassMilli(consumerId);
    const e = this.grantedEnergyMilli(consumerId);
    this.charge(this.consumerArmy(consumerId), m, e);
  }

  /**
   * Cumulative accounting for a build/upgrade/factory item: books
   * cumulativeCharge(cost, doneOld, doneNew) for mass and energy.
   * `costMassMilli`/`costEnergyMilli` must be integers (use `toMilli` once per item).
   */
  chargeProgress(army: number, costMassMilli: number, costEnergyMilli: number, doneOld: number, doneNew: number): void {
    this.charge(army, cumulativeCharge(costMassMilli, doneOld, doneNew), cumulativeCharge(costEnergyMilli, doneOld, doneNew));
  }

  /** Applies income, upkeep and charges to the stocks, clamps to [0, capacity] and counts overflow. */
  endTick(): void {
    this.expect('resolved', 'endTick');
    for (let a = 0; a < this.armies; a++) {
      const st = this.stats[a] as MutableStats;
      const cm = this.chargedM[a] ?? 0;
      const ce = this.chargedE[a] ?? 0;
      st.consumedMassMilli += cm;
      st.consumedEnergyMilli += ce;

      let m = (this.storedM[a] ?? 0) + (this.incM[a] ?? 0) - cm;
      if (m < 0) {
        st.shortfallMassMilli += -m;
        m = 0;
      }
      const capM = this.capM[a] ?? 0;
      if (m > capM) {
        st.overflowMassMilli += m - capM;
        m = capM;
      }
      this.storedM[a] = m;

      // Upkeep is paid from stock + income first; what cannot be paid is counted, not borrowed.
      let e = (this.storedE[a] ?? 0) + (this.incE[a] ?? 0) - (this.upkE[a] ?? 0);
      if (e < 0) {
        st.upkeepUnpaidMilli += -e;
        e = 0;
      }
      e -= ce;
      if (e < 0) {
        st.shortfallEnergyMilli += -e;
        e = 0;
      }
      const capE = this.capE[a] ?? 0;
      if (e > capE) {
        st.overflowEnergyMilli += e - capE;
        e = capE;
      }
      this.storedE[a] = e;
    }
    this.phase = 'idle';
  }

  /**
   * Convenience for callers that step whole ticks: runs endTick if a tick is resolved, so the next
   * beginTick is valid. Throws if the tick is still collecting.
   */
  finishIfResolved(): void {
    if (this.phase === 'resolved') this.endTick();
  }

  // --- reading ------------------------------------------------------------------------------------

  massStoredMilli(army: number): number {
    this.checkArmy(army);
    return this.storedM[army] ?? 0;
  }

  energyStoredMilli(army: number): number {
    this.checkArmy(army);
    return this.storedE[army] ?? 0;
  }

  massCapacityMilli(army: number): number {
    this.checkArmy(army);
    return this.capM[army] ?? 0;
  }

  energyCapacityMilli(army: number): number {
    this.checkArmy(army);
    return this.capE[army] ?? 0;
  }

  /** Eco state of the army in units (rates per second from the last resolved tick). */
  snapshot(army: number): EcoSnapshot {
    this.checkArmy(army);
    const perSec = ECO_TICK_HZ / MILLI;
    return {
      massIncome: (this.incM[army] ?? 0) * perSec,
      energyIncome: (this.incE[army] ?? 0) * perSec,
      energyUpkeep: (this.upkE[army] ?? 0) * perSec,
      massStored: fromMilli(this.storedM[army] ?? 0),
      energyStored: fromMilli(this.storedE[army] ?? 0),
      massCapacity: fromMilli(this.capM[army] ?? 0),
      energyCapacity: fromMilli(this.capE[army] ?? 0),
      massRatio: this.rMass[army] ?? 1,
      energyRatio: this.rEnergy[army] ?? 1,
      ratio: this.rAll[army] ?? 1,
      massDemand: (this.demM[army] ?? 0) * perSec,
      energyDemand: (this.demE[army] ?? 0) * perSec,
    };
  }

  /** Copy of the army's statistics. */
  statsOf(army: number): EcoArmyStats {
    this.checkArmy(army);
    const s = this.stats[army] as MutableStats;
    return { ...s };
  }

  /** Report figures of ai.md §4.5 / §7.1 for the army. */
  reportOf(army: number): EcoReport {
    return ecoReport(this.statsOf(army));
  }
}

/** Derives the report percentages from raw statistics. */
export function ecoReport(s: EcoArmyStats): EcoReport {
  return {
    energyStallPct: s.ticks - s.exemptTicks > 0 ? (100 * s.energyStallTicks) / (s.ticks - s.exemptTicks) : 0,
    massBpStallPct: s.bpSeconds > 0 ? (100 * s.bpSecondsMassStalled) / s.bpSeconds : 0,
    overflowPct: s.incomeMassMilli > 0 ? (100 * s.overflowMassMilli) / s.incomeMassMilli : 0,
    avgMassIncome: s.ticks > 0 ? (s.incomeMassMilli * ECO_TICK_HZ) / MILLI / s.ticks : 0,
  };
}

function ratioOf(avail: number, demand: number): number {
  if (avail <= 0) return 0;
  if (avail >= demand) return 1;
  return avail / demand;
}
