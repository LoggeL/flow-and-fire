/**
 * Production mix of the FactoryManager (ai.md §5.4): base mix per phase, counter table and the
 * repeat loop built by largest deficit. Pure functions over roles (ai.md §1 Leitplanke 2) — the
 * German unit names in the comments are only for the reader; decisions use roles + tech.
 *
 * Base mix (shares of the mass value of production):
 *   T1: tank@1 (Punze) 45 · arty@1 (Kelle) 20 · bot@1 (Stichel) 20 · aa@1 (Sieb) 0, 15 after air
 *       contact, 30 with the air-strike counter rule (ai.md "15–30 %", counter "25–35 %").
 *   T2: tank@2 (Meißel) 45 · arty@2 (Rinne) 20 · tank@1 (Punze) 15 as cheap filler only while
 *       P_M < 20 · aa@2 (Rüttelsieb) 0 / 15 / 30 as above ("0–25 %") · bot@1 (Stichel) 10 (raids).
 *   The scout (Funke) is not part of the mix (1 living scout, FactoryManager).
 * Counter table: every rule whose threat-weighted share of the enemy objects seen in the last 180 s
 * reaches 35 % (air rules: ≥ 5 aircraft or ≥ 20 % share) adds its percentage points to the role
 * groups of the current phase (tank = the phase's main tank, i.e. Punze in T1 / Meißel in T2);
 * several rules add up; negative results clamp to 0; then the mix is normalised.
 */
import type { Xorshift32 } from '../../rng.ts';
import type { AiBlueprint, AiBlueprintTable } from '../../types.ts';

export type MixGroup = 'tank' | 'arty' | 'bot' | 'aa' | 'filler';

export interface MixEntry {
  readonly role: string;
  readonly tech: number;
  /** Counter-table group (the filler Punze of T2 is never adjusted). */
  readonly group: MixGroup;
  /** Share in percentage points before normalisation. */
  share: number;
}

/** Share threshold of a counter rule (ai.md §5.4). */
export const COUNTER_SHARE_MIN = 0.35;
/** Air rules: ≥ 5 aircraft or ≥ 20 % air threat. */
export const COUNTER_AIR_COUNT = 5;
export const COUNTER_AIR_SHARE = 0.2;
/** Enemy commander "in front": ≤ 150 WU from own units. */
export const COUNTER_COMMAND_RANGE_WU = 150;
/** aa share after air contact / with the air-strike rule. */
export const AA_SHARE_CONTACT = 15;
export const AA_SHARE_COUNTER = 30;
/** Filler Punze in T2 only while P_M < 20 M/s. */
export const T2_FILLER_MAX_INCOME = 20;
/** Hard prediction: enemy T2 land factory seen ⇒ Meißel +10 (T2 mix). */
export const HARD_PREDICT_T2_TANK = 10;

export interface CounterRule {
  readonly id: string;
  /** Category expression over the enemy blueprints (null = positional rule `commandFront`). */
  readonly expr: string | null;
  readonly air: boolean;
  readonly deltas: Readonly<Partial<Record<Exclude<MixGroup, 'filler'>, number>>>;
  /** Raises the aa share to at least this value. */
  readonly aaFloor: number;
}

/** Counter table of ai.md §5.4 (table order). */
export const COUNTER_RULES: readonly CounterRule[] = [
  { id: 'bots', expr: 'LAND & MOBILE & BOT - SNIPER', air: false, deltas: { tank: 20, arty: 10, bot: -10 }, aaFloor: 0 },
  { id: 'tanks', expr: 'LAND & MOBILE & TANK', air: false, deltas: { arty: 15, tank: 5 }, aaFloor: 0 },
  { id: 'artillery', expr: 'LAND & MOBILE & INDIRECTFIRE', air: false, deltas: { bot: 20 }, aaFloor: 0 },
  { id: 'pointDefense', expr: 'STRUCTURE & DEFENSE & DIRECTFIRE', air: false, deltas: { arty: 25 }, aaFloor: 0 },
  { id: 'airStrike', expr: 'AIR & (BOMBER | GUNSHIP)', air: true, deltas: {}, aaFloor: AA_SHARE_COUNTER },
  { id: 'fighters', expr: 'AIR & ANTIAIR - BOMBER - GUNSHIP', air: true, deltas: {}, aaFloor: 0 },
  { id: 'shield', expr: 'SHIELD', air: false, deltas: { tank: 15, arty: -10 }, aaFloor: 0 },
  { id: 'sniper', expr: 'SNIPER', air: false, deltas: { bot: 15, tank: 15 }, aaFloor: 0 },
  { id: 'commandFront', expr: null, air: false, deltas: { tank: 15 }, aaFloor: 0 },
];

/** Base mix of a phase (1 or 2; T3 is MS13 and uses the T2 mix). */
export function baseMix(phase: number, airContact: boolean, massIncome: number): MixEntry[] {
  const aa = airContact ? AA_SHARE_CONTACT : 0;
  if (phase < 2) {
    return [
      { role: 'tank', tech: 1, group: 'tank', share: 45 },
      { role: 'arty', tech: 1, group: 'arty', share: 20 },
      { role: 'bot', tech: 1, group: 'bot', share: 20 },
      { role: 'aa', tech: 1, group: 'aa', share: aa },
    ];
  }
  return [
    { role: 'tank', tech: 2, group: 'tank', share: 45 },
    { role: 'arty', tech: 2, group: 'arty', share: 20 },
    { role: 'tank', tech: 1, group: 'filler', share: massIncome < T2_FILLER_MAX_INCOME ? 15 : 0 },
    { role: 'aa', tech: 2, group: 'aa', share: aa },
    { role: 'bot', tech: 1, group: 'bot', share: 10 },
  ];
}

/** Applies the active counter rules (additive by group, aa floor, Hard prediction). Mutates `mix`. */
export function applyCounters(mix: MixEntry[], active: readonly string[], predictT2Tank: boolean): void {
  for (const rule of COUNTER_RULES) {
    if (!active.includes(rule.id)) continue;
    for (const g of ['tank', 'arty', 'bot', 'aa'] as const) {
      const d = rule.deltas[g];
      if (d === undefined) continue;
      const e = mix.find((m) => m.group === g);
      if (e !== undefined) e.share += d;
    }
    if (rule.aaFloor > 0) {
      const e = mix.find((m) => m.group === 'aa');
      if (e !== undefined && e.share < rule.aaFloor) e.share = rule.aaFloor;
    }
  }
  if (predictT2Tank) {
    const e = mix.find((m) => m.group === 'tank' && m.tech >= 2);
    if (e !== undefined) e.share += HARD_PREDICT_T2_TANK;
  }
  for (const e of mix) if (e.share < 0) e.share = 0;
}

/** A mix entry resolved for one factory: blueprint and normalised share (0..1). */
export interface ResolvedEntry {
  readonly role: string;
  readonly tech: number;
  readonly group: MixGroup;
  readonly bp: AiBlueprint;
  readonly share: number;
}

/**
 * Resolves the entries to blueprints the factory can build (others drop out) and normalises the
 * shares to 1. Returns [] if nothing positive remains.
 */
export function resolveMix(
  mix: readonly MixEntry[],
  factory: AiBlueprint,
  table: AiBlueprintTable,
  resolve: (role: string, tech: number) => AiBlueprint | null,
): ResolvedEntry[] {
  const out: { role: string; tech: number; group: MixGroup; bp: AiBlueprint; share: number }[] = [];
  let total = 0;
  for (const e of mix) {
    if (e.share <= 0) continue;
    const bp = resolve(e.role, e.tech);
    if (bp === null || !table.canBuild(factory, bp)) continue;
    out.push({ role: e.role, tech: e.tech, group: e.group, bp, share: e.share });
    total += e.share;
  }
  if (total <= 0) return [];
  for (const e of out) e.share = e.share / total;
  return out;
}

/** Signature of a resolved mix (phase entries and shares rounded to 0.1 %). */
export function mixSignature(mix: readonly ResolvedEntry[]): string {
  return mix.map((e) => `${e.bp.index}:${Math.round(e.share * MIX_SIGNATURE_STEPS)}`).join(',');
}

/**
 * Share quantisation of the mix signature (5 % steps). A loop of 5–6 orders cannot express finer
 * shares; with 0.1 % steps the continuously sliding counter-table window changed the signature
 * almost every mix run and the loop rewrites ate the whole APM budget (tai-p5 smoke runs: 2.000+
 * FactoryRepeat records dropped per side and game).
 */
export const MIX_SIGNATURE_STEPS = 20;

/** Blueprint set of a mix (order-independent key). */
export function mixRoleKey(mix: readonly ResolvedEntry[]): string {
  return mix
    .map((e) => e.bp.index)
    .sort((a, b) => a - b)
    .join(',');
}

/** Loop length: 5 orders, 6 with five or more roles (ai.md: "4–6 Aufträge"). */
export function loopLength(mix: readonly ResolvedEntry[]): number {
  return mix.length >= 5 ? 6 : 5;
}

export interface LoopOptions {
  readonly rng: Xorshift32;
  /** Probability of a random pick among the top K (Easy 0.15/3, Normal 0.05/2, Hard 0). */
  readonly errorRate: number;
  readonly topK: number;
}

/**
 * Builds the repeat loop by largest deficit (ai.md §5.4): state S = current mass shares (living
 * army + queue, `istMass` per entry) scaled to the mass of one loop, plus the picks so far; each
 * order takes the entry with the largest `target − S/ΣS`, ties by table order. With probability
 * `errorRate` the pick is uniform among the top K instead (own RNG stream).
 */
export function buildLoop(mix: readonly ResolvedEntry[], istMass: readonly number[], o: LoopOptions): number[] {
  if (mix.length === 0) return [];
  const k = loopLength(mix);
  let istTotal = 0;
  for (let i = 0; i < mix.length; i++) istTotal += istMass[i] ?? 0;
  let loopMass = 0;
  for (const e of mix) loopMass += e.share * e.bp.mass;
  loopMass *= k;
  const s = new Float64Array(mix.length);
  if (istTotal > 0) for (let i = 0; i < mix.length; i++) s[i] = ((istMass[i] ?? 0) / istTotal) * loopMass;
  const out: number[] = [];
  const order: number[] = [];
  for (let n = 0; n < k; n++) {
    let sum = 0;
    for (let i = 0; i < mix.length; i++) sum += s[i]!;
    order.length = 0;
    for (let i = 0; i < mix.length; i++) order.push(i);
    const deficit = (i: number): number => mix[i]!.share - (sum > 0 ? s[i]! / sum : 0);
    order.sort((a, b) => {
      const da = deficit(a);
      const db = deficit(b);
      return da > db ? -1 : da < db ? 1 : a - b;
    });
    let pick = order[0]!;
    if (o.errorRate > 0 && o.topK > 1 && o.rng.chance(o.errorRate)) {
      pick = order[o.rng.nextInt(Math.min(o.topK, order.length))]!;
    }
    out.push(mix[pick]!.bp.index);
    s[pick] = s[pick]! + mix[pick]!.bp.mass;
  }
  return out;
}

/** Normalised shares of a resolved mix by group (tests, diagnostics). */
export function groupShares(mix: readonly ResolvedEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of mix) out[`${e.role}@${e.tech}`] = (out[`${e.role}@${e.tech}`] ?? 0) + e.share;
  return out;
}
