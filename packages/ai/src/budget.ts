/**
 * Operation budget (ai.md §2.3): budgets count operations, not milliseconds, so browser and
 * headless AIs behave identically. Every loop asks `budget.take(n)`; an exhausted manager stores its
 * cursor and continues in its next run. Unused budget of a manager falls to the reserve of the SAME
 * think; nothing carries over to the next think.
 *
 * Deviation (documented in the status fragment): perception ingest costs 1 op per unit/event and is
 * charged to its own lump sum outside the ai.md table; it is never cut off, because an incomplete
 * blackboard would falsify every manager. `opsByKey().ingest` reports it separately.
 */
import type { BudgetSpec } from './profile.ts';

/** Op costs of ai.md §2.3. */
export const OP_COST = {
  /** A visited unit in forEachOwn/forEachKnownEnemy. */
  unit: 1,
  /** A read or written grid cell (all layers of the cell together). */
  cell: 1,
  /** A node expansion in A* / Dijkstra. */
  node: 1,
  /** An encoded command. */
  command: 10,
} as const;

/** canPlace costs 4 ops + 1 per 4 footprint cells (fabrik 8×8 ⇒ 20, Kraftwerk 2×2 ⇒ 5). */
export function canPlaceCost(footprintW: number, footprintD: number): number {
  return 4 + Math.ceil((footprintW * footprintD) / 4);
}

/** Budget handle of one consumer. */
export interface OpBudget {
  /** Takes n ops if available (all or nothing); false = budget exhausted, nothing taken. */
  take(n: number): boolean;
  /** Ops left. */
  readonly left: number;
  /** Ops used so far. */
  readonly used: number;
}

/** A simple fixed budget (also used for init work and in tests). */
export class FixedBudget implements OpBudget {
  private usedOps = 0;

  constructor(private limit: number) {
    if (!(limit >= 0)) throw new RangeError(`budget limit ${limit}`);
  }

  take(n: number): boolean {
    if (!(n >= 0)) throw new RangeError(`take(${n})`);
    if (this.usedOps + n > this.limit) return false;
    this.usedOps += n;
    return true;
  }

  /** Charges n ops unconditionally (mandatory work); `left` may become negative. */
  charge(n: number): void {
    this.usedOps += n;
  }

  get left(): number {
    return this.limit - this.usedOps;
  }

  get used(): number {
    return this.usedOps;
  }

  get capacity(): number {
    return this.limit;
  }

  /** Raises the limit (reserve top-up). */
  grow(n: number): void {
    this.limit += n;
  }
}

/** Budget keys: the manager allotments of ai.md §2.3 plus reserve and the Hard micro think. */
export type BudgetKey = 'intel' | 'platoon' | 'engineer' | 'economy' | 'defense' | 'factory' | 'tech' | 'reserve' | 'micro';

export const BUDGET_KEYS: readonly BudgetKey[] = [
  'intel',
  'platoon',
  'engineer',
  'economy',
  'defense',
  'factory',
  'tech',
  'reserve',
  'micro',
];

/** Scales an allotment (AI-DET-02: halved budget); floors to whole ops. */
function scaled(v: number, scale: number): number {
  return Math.floor(v * scale);
}

/**
 * Budget of one think. `open(key)` hands out the allotment of a manager; `close()` returns its
 * unused ops to the reserve. Consumers without their own allotment (opening, emitter) draw from
 * the reserve. Ingest is counted separately and never limited.
 */
export class ThinkBudget {
  private readonly spec: BudgetSpec;
  private readonly scale: number;
  private readonly reserveBudget: FixedBudget;
  private current: FixedBudget | null = null;
  private currentKey: BudgetKey | null = null;
  private readonly used: Record<string, number> = {};
  private ingestOps = 0;

  constructor(spec: BudgetSpec, scale = 1) {
    if (!(scale > 0)) throw new RangeError(`budget scale ${scale}`);
    this.spec = spec;
    this.scale = scale;
    this.reserveBudget = new FixedBudget(scaled(spec.reserve, scale));
  }

  /** Allotment of a key (scaled). */
  allotment(key: BudgetKey): number {
    return scaled(this.spec[key === 'reserve' ? 'reserve' : key], this.scale);
  }

  /** Total of the think (scaled), without ingest. */
  get total(): number {
    return scaled(this.spec.total, this.scale);
  }

  /** The reserve budget (opening, emitter, overflow). */
  get reserve(): FixedBudget {
    return this.reserveBudget;
  }

  /**
   * Opens the budget of `key` (a manager allotment, or the reserve itself for 'reserve'). Only one
   * manager budget is open at a time.
   */
  open(key: BudgetKey): OpBudget {
    if (this.current !== null) throw new Error(`budget '${this.currentKey!}' is still open`);
    this.currentKey = key;
    if (key === 'reserve') {
      this.current = null;
      return this.reserveBudget;
    }
    this.current = new FixedBudget(this.allotment(key));
    return this.current;
  }

  /** Closes the open manager budget; its unused ops fall to the reserve of this think. */
  close(): void {
    const key = this.currentKey;
    if (key === null) return;
    if (this.current !== null) {
      const b = this.current;
      this.used[key] = (this.used[key] ?? 0) + b.used;
      if (b.left > 0) this.reserveBudget.grow(b.left);
    }
    this.current = null;
    this.currentKey = null;
  }

  /** Records ingest work (never limited). */
  chargeIngest(n: number): void {
    this.ingestOps += n;
  }

  get ingest(): number {
    return this.ingestOps;
  }

  /** Ops used per key (reserve = everything drawn from the reserve), plus `ingest`. */
  opsByKey(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of BUDGET_KEYS) {
      if (k === 'reserve') continue;
      if (this.used[k] !== undefined) out[k] = this.used[k]!;
    }
    out.reserve = this.reserveBudget.used;
    out.ingest = this.ingestOps;
    return out;
  }

  /** Ops used by managers, opening and emitter (without ingest). */
  get usedTotal(): number {
    let s = this.reserveBudget.used;
    for (const k of BUDGET_KEYS) {
      if (k !== 'reserve' && this.used[k] !== undefined) s += this.used[k]!;
    }
    return s;
  }
}
