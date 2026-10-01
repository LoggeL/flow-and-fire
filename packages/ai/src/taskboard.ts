/**
 * Task board (ai.md §5.3): managers post tasks, the EngineerManager assigns them to free builders.
 * Stable order: prio descending, createdTick ascending, id ascending. Ids are monotonic per board.
 *
 * Ownership: every manager may `add` tasks and change the tasks it created (`source`); only the
 * EngineerManager (and the OpeningRunner for its own builders) assigns builders.
 */
import type { Vec2 } from './types.ts';

export type TaskKind = 'build' | 'assist' | 'repair' | 'reclaim' | 'guard' | 'upgrade';
export type TaskState = 'open' | 'assigned' | 'done' | 'failed' | 'cancelled';
/** Site selector string (ai.md §4.2, e.g. 'slot:fac2', 'mex:next') or a fixed world position. */
export type TaskSite = string | Vec2 | null;

/** Well-known priorities of ai.md §5.3. */
export const TaskPrio = {
  energyEmergency: 100,
  defense: 95,
  power: 90,
  techAssist: 80,
  storage: 70,
  factory: 60,
  mex: 50,
  hydro: 45,
  mexUpgradeAssist: 40,
  repair: 30,
  reclaim: 20,
  buildAssist: 12,
  factoryGuard: 10,
} as const;

export interface TaskSpec {
  readonly kind: TaskKind;
  readonly role?: string | null;
  readonly tech?: number;
  /** Blueprint index if already resolved, −1 otherwise. */
  readonly bp?: number;
  readonly site?: TaskSite;
  /** Target handle (assist/repair/guard/upgrade), 0 = none. */
  readonly target?: number;
  readonly prio: number;
  /** Wanted number of builders. */
  readonly wanted?: number;
  /** Creating manager. */
  readonly source: string;
  /** Optional dedup key (at most one live task per key). */
  readonly key?: string | null;
  /** Spot index for mex/hydro tasks, −1 otherwise. */
  readonly spot?: number;
}

export interface Task {
  readonly id: number;
  readonly kind: TaskKind;
  role: string | null;
  tech: number;
  bp: number;
  site: TaskSite;
  target: number;
  prio: number;
  wanted: number;
  /** Assigned builder handles (assignment order). */
  readonly assigned: number[];
  readonly createdTick: number;
  readonly source: string;
  state: TaskState;
  readonly key: string | null;
  spot: number;
  /** Placement failures (3 ⇒ the site is locked for 60 s, ai.md §5.3). */
  failures: number;
  /** Handle of the construction site once started, 0 before. */
  siteHandle: number;
}

/** Stable comparator of the board. */
export function compareTasks(a: Task, b: Task): number {
  if (a.prio !== b.prio) return b.prio - a.prio;
  if (a.createdTick !== b.createdTick) return a.createdTick - b.createdTick;
  return a.id - b.id;
}

function live(t: Task): boolean {
  return t.state === 'open' || t.state === 'assigned';
}

export class TaskBoard {
  private readonly tasks = new Map<number, Task>();
  private nextId = 1;

  /** Adds a task; with a key that already has a live task, returns the existing one. */
  add(spec: TaskSpec, tick: number): Task {
    const key = spec.key ?? null;
    if (key !== null) {
      const existing = this.byKey(key);
      if (existing !== undefined) return existing;
    }
    const t: Task = {
      id: this.nextId++,
      kind: spec.kind,
      role: spec.role ?? null,
      tech: spec.tech ?? 1,
      bp: spec.bp ?? -1,
      site: spec.site ?? null,
      target: spec.target ?? 0,
      prio: spec.prio,
      wanted: spec.wanted ?? 1,
      assigned: [],
      createdTick: tick,
      source: spec.source,
      state: 'open',
      key,
      spot: spec.spot ?? -1,
      failures: 0,
      siteHandle: 0,
    };
    this.tasks.set(t.id, t);
    return t;
  }

  get(id: number): Task | undefined {
    return this.tasks.get(id);
  }

  /** Live task with `key`. */
  byKey(key: string): Task | undefined {
    for (const t of this.tasks.values()) if (t.key === key && live(t)) return t;
    return undefined;
  }

  /** Number of stored tasks (all states until `prune`). */
  get size(): number {
    return this.tasks.size;
  }

  /** Live tasks in board order (a sorted copy). */
  ordered(): Task[] {
    const out: Task[] = [];
    for (const t of this.tasks.values()) if (live(t)) out.push(t);
    out.sort(compareTasks);
    return out;
  }

  /** Iterates live tasks in board order. */
  forEach(fn: (t: Task) => void): void {
    for (const t of this.ordered()) fn(t);
  }

  /** Live tasks matching `pred` (board order). */
  filter(pred: (t: Task) => boolean): Task[] {
    return this.ordered().filter(pred);
  }

  /** Assigns a builder (at most `wanted`); true if assigned. */
  assign(id: number, handle: number): boolean {
    const t = this.tasks.get(id);
    if (t === undefined || !live(t)) return false;
    if (t.assigned.includes(handle)) return true;
    if (t.assigned.length >= t.wanted) return false;
    t.assigned.push(handle);
    t.state = 'assigned';
    return true;
  }

  /** Removes a builder from every task; tasks without builders go back to 'open'. Returns the affected tasks. */
  release(handle: number): Task[] {
    const out: Task[] = [];
    for (const t of this.tasks.values()) {
      const i = t.assigned.indexOf(handle);
      if (i < 0) continue;
      t.assigned.splice(i, 1);
      if (t.state === 'assigned' && t.assigned.length === 0) t.state = 'open';
      out.push(t);
    }
    return out;
  }

  /** Live tasks a builder is assigned to. */
  tasksOf(handle: number): Task[] {
    const out: Task[] = [];
    for (const t of this.tasks.values()) if (live(t) && t.assigned.includes(handle)) out.push(t);
    return out;
  }

  complete(id: number): void {
    this.setState(id, 'done');
  }

  fail(id: number): void {
    this.setState(id, 'failed');
  }

  cancel(id: number): void {
    this.setState(id, 'cancelled');
  }

  private setState(id: number, s: TaskState): void {
    const t = this.tasks.get(id);
    if (t !== undefined) t.state = s;
  }

  /** Drops finished (done/failed/cancelled) tasks. */
  prune(): void {
    for (const [id, t] of this.tasks) if (!live(t)) this.tasks.delete(id);
  }
}
