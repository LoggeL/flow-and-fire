/**
 * Formulas of the EconomyManager (ai.md §5.1), pure functions for tests.
 *
 *   D_eff    = D_E · r_M
 *   flowDef  = 1.1 · (D_eff + R_E) − (P_E − U_E) − max(0, S_E − reserveE) / STORE_CREDIT_S (ai.md: 60)
 *   storeDef = (reserveE − (S_E + (P_E − U_E − D_eff − R_E) · horizonS)) / horizonS
 *   deficit  = max(flowDef, storeDef)
 *   E_free   = (P_E − U_E − D_eff) + max(0, S_E − reserveE) / 90 − R_E
 */
import type { AiBlueprint, EcoState } from '../../types.ts';

export interface EnergyBalance {
  /** Mass-limited energy demand D_E · r_M. */
  readonly dEff: number;
  readonly flowDef: number;
  readonly storeDef: number;
  /** max(flowDef, storeDef), E/s (≤ 0 = no deficit). */
  readonly deficit: number;
  /** Net flow P_E − U_E − D_eff. */
  readonly net: number;
  /** Seconds until the storage is empty at the current net flow (Infinity = never). */
  readonly emptyInS: number;
}

/**
 * Seconds over which the storage above the reserve counts as income in flowDef. ai.md §5.1 writes 60;
 * tai-p5 calibration: 120. With 60 s a full Glutspeicher (13.900 E) hid a real deficit of ~220 E/s,
 * the balance ordered power only once the storage was nearly empty, and the Glutkessel then being
 * built (750 E each, Glutkessel II 12.000 E) drained the rest — 9–13 % energy stall on Setons
 * between 8 and 10 min without an enemy. 120 s keeps the storage as a buffer but reacts while
 * about a minute of it is left.
 */
export const STORE_CREDIT_S = 120;

export function energyBalance(e: EcoState, reservedE: number, reserveE: number, horizonS: number): EnergyBalance {
  const dEff = e.energyDemand * e.massRatio;
  const pe = e.energyIncome - e.energyUpkeep;
  const flowDef = 1.1 * (dEff + reservedE) - pe - Math.max(0, e.energyStored - reserveE) / STORE_CREDIT_S;
  const h = horizonS > 0 ? horizonS : 1;
  const storeDef = (reserveE - (e.energyStored + (pe - dEff - reservedE) * h)) / h;
  const net = pe - dEff;
  const emptyInS = net < 0 ? e.energyStored / -net : Infinity;
  return { dEff, flowDef, storeDef, deficit: Math.max(flowDef, storeDef), net, emptyInS };
}

/** E_free of ai.md §5.1 "Energie zuerst" (storage above the reserve spread over 90 s). */
export function energyFree(e: EcoState, reservedE: number, reserveE: number): number {
  const dEff = e.energyDemand * e.massRatio;
  return e.energyIncome - e.energyUpkeep - dEff + Math.max(0, e.energyStored - reserveE) / 90 - reservedE;
}

/** Energy emergency: the storage runs empty within 10 s (ai.md §4.3/§5.1). */
export const EMERGENCY_WITHIN_S = 10;

/**
 * Number of T1 power generators to order: n = ⌈deficit / eps⌉ − inflight, at most
 * maxInflight + ⌊(P_E − U_E) / 100⌋ in flight (ecosim `energy_need`).
 */
export function powerToOrder(deficit: number, pgenEps: number, inflight: number, maxInflight: number, netIncome: number): number {
  if (!(deficit > 0)) return 0;
  const cap = maxInflight + Math.floor(netIncome / 100);
  const need = Math.ceil(deficit / pgenEps);
  return Math.max(0, Math.min(cap, need) - inflight);
}

/**
 * Amortisation of an in-place upgrade in seconds (ai.md §5.1, B4): (Δ mass cost + extra upkeep in
 * power-plant mass) / extra mass income. T1→T2 mex = (900 + 7 · 3.75) / 4 ≈ 232 s.
 */
export function upgradeAmortisationS(from: AiBlueprint, to: AiBlueprint, massPerEnergyRate: number): number {
  const gain = to.massPerSec - from.massPerSec;
  if (!(gain > 0)) return Infinity;
  const upkeep = Math.max(0, to.upkeepEnergyPerSec - from.upkeepEnergyPerSec);
  return (to.mass + upkeep * massPerEnergyRate) / gain;
}

/** Expected mex lifetime (ai.md §5.1): 900 s own zone quiet, 300 s own zone with contact, else 0. */
export function mexLifetimeS(zone: string, contactWithin120s: boolean): number {
  if (zone !== 'own') return 0;
  return contactWithin120s ? 300 : 900;
}

/** Upgrade only if the lifetime exceeds 1.2 × the amortisation. */
export function worthUpgrading(lifetimeS: number, amortS: number): boolean {
  return lifetimeS > amortS * 1.2;
}

/**
 * Mass-sink table of ai.md §5.1 (M/s sink, E/s reservation), in table order: mex upgrade, extra
 * land factory, land factory I → II, +1 engineer.
 */
export const SINK = {
  mexUpgrade: { mass: 10, energy: 60 },
  factory: { mass: 3.7, energy: 19 },
  factoryUpgrade: { mass: 12.2, energy: 96 },
  engineer: { mass: 3, energy: 25 },
} as const;

/** At most +6 engineers over the target from the mass sink (ai.md §5.1). */
export const ENGINEER_BONUS_MAX = 6;
/** At most 4 measures per second (ai.md §5.1). */
export const SINK_ACTIONS_PER_SECOND = 4;
