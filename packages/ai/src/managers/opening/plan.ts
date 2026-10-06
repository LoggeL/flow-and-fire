/**
 * Opening plans as executable step lists (ai.md §4.1): `count` expands to single steps whose place
 * is chosen when the step starts; `fallback` replaces a step whose role/place is unavailable
 * (no reachable hydro ⇒ 4 × Glutkessel I); Easy's `skipChance` (10 % of the opening mex steps)
 * is rolled once at creation with the manager's own RNG stream, in document order, so a budget
 * cut-off never shifts the sequence.
 */
import type { FallbackStep, Opening, OpeningStep } from '../../openings.ts';
import type { Xorshift32 } from '../../rng.ts';

export interface PlanStep {
  readonly kind: 'build' | 'assist';
  readonly role: string;
  readonly tech: number;
  /** Site selector (build) or assist target (`fac1`, `upgrade:fac1`). */
  readonly at: string;
  readonly fallback: FallbackStep | null;
  /** Rolled skip (Easy error rate). */
  readonly skip: boolean;
}

/** Site selectors whose place is only known when the step is reached (ai.md §4.3). */
export function isDeferredSelector(at: string): boolean {
  return at === 'mex:next' || at === 'hydro:next';
}

/** Expands builder steps (build/assist) of a plan; produce/loop/rally are factory steps. */
export function expandBuilderSteps(steps: readonly OpeningStep[], rng: Xorshift32 | null, skipChance: number): PlanStep[] {
  const out: PlanStep[] = [];
  for (const s of steps) {
    if (s.do === 'build') {
      for (let i = 0; i < s.count; i++) {
        const skip = s.role === 'mex' && skipChance > 0 && rng !== null && rng.chance(skipChance);
        out.push({ kind: 'build', role: s.role, tech: s.tech, at: s.at, fallback: s.fallback, skip });
      }
    } else if (s.do === 'assist') {
      out.push({ kind: 'assist', role: '', tech: 0, at: s.target, fallback: null, skip: false });
    }
  }
  return out;
}

/** The fallback of a step as single plan steps. */
export function expandFallback(f: FallbackStep): PlanStep[] {
  const out: PlanStep[] = [];
  for (let i = 0; i < f.count; i++) out.push({ kind: 'build', role: f.role, tech: f.tech, at: f.at, fallback: null, skip: false });
  return out;
}

/** One entry of a factory's production queue. */
export interface ProduceEntry {
  readonly role: string;
  readonly tech: number;
  readonly count: number;
}

export interface FactoryPlan {
  readonly slot: string;
  readonly rally: string | null;
  readonly produce: readonly ProduceEntry[];
  readonly loop: readonly { readonly role: string; readonly tech: number }[];
}

/** Factory plans in document order. */
export function factoryPlans(o: Opening): FactoryPlan[] {
  const out: FactoryPlan[] = [];
  for (const slot of o.factoryOrder) {
    let rally: string | null = null;
    const produce: ProduceEntry[] = [];
    let loop: { role: string; tech: number }[] = [];
    for (const s of o.factories[slot] ?? []) {
      if (s.do === 'rally') rally = s.at;
      else if (s.do === 'produce') produce.push({ role: s.role, tech: s.tech, count: s.count });
      else if (s.do === 'loop') loop = s.items.map((it) => ({ role: it.role, tech: it.tech }));
    }
    out.push({ slot, rally, produce, loop });
  }
  return out;
}
