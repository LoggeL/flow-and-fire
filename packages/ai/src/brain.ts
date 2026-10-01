/**
 * Brain skeleton (ai.md §2.2): perception ingest, managers in fixed order and think slots, op
 * budget per manager, command emitter. Managers are plugged in as factories (`createBrain`); the
 * default composition (`createDefaultBrain`) follows in wave 2 of TRACK-AI.
 *
 * Commit semantics (ai.md §2.3, AI-DET-04): a manager adopts state only at the end of a completed
 * work step. `ctx.step(work)` runs `work()`, which computes and emits commands and returns a commit
 * closure; if the host's abort signal (`shouldAbort`, wall-clock emergency stop) fires during the
 * step, its commands are rolled back and the commit is not run. After an abort no further manager
 * runs in this think; the already committed commands are still emitted.
 */
import { ThinkBudget, type BudgetKey, type OpBudget } from './budget.ts';
import { analyzeMap, type MapAnalysis } from './analysis/map-analysis.ts';
import { Blackboard, type OwnRecord } from './blackboard.ts';
import { CommandEmitter, type DroppedCommand, type EncodedCommand } from './commands/emitter.ts';
import { RoleTable, selectOpening, type Opening, type OpeningsDoc } from './openings.ts';
import type { AiProfile } from './profile.ts';
import { managerRng, type Xorshift32 } from './rng.ts';
import { OrderKind, type AiBlueprint, type AiStatic, type PerceptionView } from './types.ts';

export type ManagerName = 'intel' | 'opening' | 'economy' | 'tech' | 'defense' | 'factory' | 'engineer' | 'platoon' | 'micro';

/** Execution order within a think (ai.md §2.2; ingest before, emitter after). */
export const MANAGER_ORDER: readonly ManagerName[] = [
  'intel',
  'opening',
  'economy',
  'tech',
  'defense',
  'factory',
  'engineer',
  'platoon',
  'micro',
];

/** Think slot per manager: every think, odd/even k (1-Hz managers on Normal/Hard) or micro. */
export const MANAGER_SLOT: Readonly<Record<ManagerName, 'every' | 'odd' | 'even' | 'micro'>> = {
  intel: 'odd',
  opening: 'every',
  economy: 'even',
  tech: 'even',
  defense: 'odd',
  factory: 'even',
  engineer: 'every',
  platoon: 'every',
  micro: 'micro',
};

/** Default budget key per manager (ai.md §2.3; opening draws from the reserve). */
export const MANAGER_BUDGET_KEY: Readonly<Record<ManagerName, BudgetKey>> = {
  intel: 'intel',
  opening: 'reserve',
  economy: 'economy',
  tech: 'tech',
  defense: 'defense',
  factory: 'factory',
  engineer: 'engineer',
  platoon: 'platoon',
  micro: 'micro',
};

/**
 * True if manager `name` runs on think k. Easy (`oneHzEveryThink`) runs every manager on every
 * think; Normal/Hard alternate the 1-Hz managers (intel/defense on odd k, economy/tech/factory on
 * even k). Micro runs only with `profile.micro` (Hard; MS14 — in this track at think rate).
 */
export function runsOnThink(name: ManagerName, k: number, profile: AiProfile): boolean {
  const slot = MANAGER_SLOT[name];
  if (slot === 'micro') return profile.micro;
  if (slot === 'every' || profile.oneHzEveryThink) return true;
  const odd = (k & 1) === 1;
  return slot === 'odd' ? odd : !odd;
}

/** Everything a manager gets at creation. */
export interface ManagerInitContext {
  readonly static: AiStatic;
  readonly analysis: MapAnalysis;
  readonly bb: Blackboard;
  readonly profile: AiProfile;
  readonly openings: OpeningsDoc;
  readonly opening: Opening | null;
  readonly roles: RoleTable;
  /** The manager's own RNG stream (same instance as in ManagerContext). */
  readonly rng: Xorshift32;
  readonly emitter: CommandEmitter;
}

/** Everything a manager gets per think. */
export interface ManagerContext extends ManagerInitContext {
  readonly tick: number;
  /** Think counter k = tick / thinkEvery. */
  readonly k: number;
  readonly view: PerceptionView;
  /** The manager's budget (its allotment, or the reserve). */
  readonly budget: OpBudget;
  /** Latching abort signal of the host (wall-clock emergency stop). */
  shouldAbort(): boolean;
  /**
   * Runs one work step; `work` returns an optional commit closure. Returns false (commands of the
   * step rolled back, commit skipped) if the think was aborted before or during the step.
   */
  step(work: () => (() => void) | void): boolean;
}

export interface Manager {
  readonly name: ManagerName;
  readonly budgetKey: BudgetKey;
  think(ctx: ManagerContext): void;
}

export interface ManagerFactory {
  readonly name: ManagerName;
  create(init: ManagerInitContext): Manager;
}

/** Convenience: a factory from a name and a creation function (budget key = default of the name). */
export function defineManager(
  name: ManagerName,
  create: (init: ManagerInitContext) => (ctx: ManagerContext) => void,
  budgetKey: BudgetKey = MANAGER_BUDGET_KEY[name],
): ManagerFactory {
  return {
    name,
    create(init) {
      const think = create(init);
      return { name, budgetKey, think };
    },
  };
}

export interface BrainInitOptions {
  readonly openings: OpeningsDoc;
  /** Overrides AiStatic.gameSeed. */
  readonly gameSeed?: number;
  /** Forces an opening (tests, scenarios such as AI-OPEN-01); otherwise weighted selection. */
  readonly openingId?: string;
  /** Highest milestone of selectable openings (default 11: air_opener off). */
  readonly maxMs?: number;
}

export interface ThinkOptions {
  /** Scales every allotment (AI-DET-02: 0.5). */
  readonly budgetScale?: number;
  /** Host abort signal (wall clock); latched once true. */
  readonly shouldAbort?: () => boolean;
}

export interface ThinkResult {
  readonly tick: number;
  readonly commands: EncodedCommand[];
  readonly aborted: boolean;
  /** Ops per manager that ran (reserve draws attributed to the drawing manager) plus `emitter`. */
  readonly opsByManager: Readonly<Record<string, number>>;
  /** Ops of managers, opening and emitter (without ingest) — compared against profile.budget.total. */
  readonly opsTotal: number;
  /** Ingest ops (never limited, outside the ai.md table). */
  readonly ingestOps: number;
  readonly dropped: DroppedCommand[];
}

export interface AiBrain {
  init(s: AiStatic, p: AiProfile, opts: BrainInitOptions): void;
  think(view: PerceptionView, opts?: ThinkOptions): ThinkResult;
  readonly initialized: boolean;
  readonly blackboard: Blackboard;
  readonly analysis: MapAnalysis;
  readonly opening: Opening | null;
  readonly profile: AiProfile;
  readonly static: AiStatic;
  /** Names of the instantiated managers in execution order. */
  readonly managerNames: readonly ManagerName[];
}

// ---- ingest -----------------------------------------------------------------------------------

/** Per-blueprint classification used by the ingest. */
export interface BpClasses {
  readonly engineer: Uint8Array;
  readonly commander: Uint8Array;
  readonly factory: Uint8Array;
  readonly mobile: Uint8Array;
  readonly structure: Uint8Array;
  readonly estore: Uint8Array;
  readonly landFactory: Uint8Array;
}

export function classifyBlueprints(s: AiStatic): BpClasses {
  const t = s.bps;
  const n = t.list.length;
  const mk = (src: string): Uint8Array => {
    const e = t.compile(src);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = t.matches(t.list[i]!, e) ? 1 : 0;
    return out;
  };
  const structure = new Uint8Array(n);
  for (let i = 0; i < n; i++) structure[i] = t.list[i]!.isStructure ? 1 : 0;
  return {
    engineer: mk('ENGINEER - COMMAND'),
    commander: mk('COMMAND'),
    factory: mk('FACTORY'),
    mobile: mk('MOBILE'),
    structure,
    estore: mk('STRUCTURE & ENERGYSTORAGE'),
    landFactory: mk('STRUCTURE & FACTORY & LAND'),
  };
}

/**
 * Perception ingest (ai.md §2.2 step 1; owner of units/enemy/stimuli): own unit lists, enemy
 * memory with reaction delay for new contacts, events as delayed stimuli. Costs 1 op per unit and
 * event (ingest lump sum, never cut off).
 */
export function ingestPerception(
  bb: Blackboard,
  view: PerceptionView,
  classes: BpClasses,
  charge: (n: number) => void,
  onUnitGone: (handle: number) => void,
): void {
  const tick = view.tick;
  const delay = bb.profile.reactionDelayTicks;
  const list = bb.static.bps.list;
  const u = bb.units;
  const think = bb.thinks;
  const all: OwnRecord[] = [];
  const engineers: OwnRecord[] = [];
  const factories: OwnRecord[] = [];
  const army: OwnRecord[] = [];
  const structures: OwnRecord[] = [];
  const sites: OwnRecord[] = [];
  let commander: OwnRecord | null = null;
  view.forEachOwn(null, (o) => {
    charge(1);
    let r = u.byHandle.get(o.handle);
    const blueprint: AiBlueprint = list[o.bp]!;
    if (r === undefined || r.bp !== o.bp) {
      r = {
        handle: o.handle,
        bp: o.bp,
        blueprint,
        x: o.x,
        z: o.z,
        hpFrac: o.hpFrac,
        buildFrac: o.buildFrac,
        complete: o.complete,
        order: o.order,
        orderTarget: o.orderTarget,
        orderBp: o.orderBp,
        orderX: o.orderX,
        orderZ: o.orderZ,
        queueLength: o.queueLength,
        factoryBp: o.factoryBp,
        factoryProgress: o.factoryProgress,
        factoryRepeat: o.factoryRepeat,
        upgradingTo: o.upgradingTo,
        lastDamagedTick: o.lastDamagedTick,
        firstSeenTick: r?.firstSeenTick ?? tick,
        idleSinceTick: -1,
        seenThink: think,
      };
      u.byHandle.set(o.handle, r);
    } else {
      r.blueprint = blueprint;
      r.x = o.x;
      r.z = o.z;
      r.hpFrac = o.hpFrac;
      r.buildFrac = o.buildFrac;
      r.complete = o.complete;
      r.order = o.order;
      r.orderTarget = o.orderTarget;
      r.orderBp = o.orderBp;
      r.orderX = o.orderX;
      r.orderZ = o.orderZ;
      r.queueLength = o.queueLength;
      r.factoryBp = o.factoryBp;
      r.factoryProgress = o.factoryProgress;
      r.factoryRepeat = o.factoryRepeat;
      r.upgradingTo = o.upgradingTo;
      r.lastDamagedTick = o.lastDamagedTick;
      r.seenThink = think;
    }
    const idle = o.complete && o.order === OrderKind.Idle && o.queueLength === 0 && o.factoryBp < 0 && o.upgradingTo < 0;
    if (idle) {
      if (r.idleSinceTick < 0) r.idleSinceTick = tick;
    } else r.idleSinceTick = -1;
    all.push(r);
    const b = o.bp;
    if (classes.structure[b] === 1) {
      structures.push(r);
      if (!o.complete) sites.push(r);
      else if (classes.factory[b] === 1) factories.push(r);
    } else if (o.complete) {
      if (classes.commander[b] === 1) commander = r;
      else if (classes.engineer[b] === 1) engineers.push(r);
      else if (classes.mobile[b] === 1) army.push(r);
    }
  });
  for (const [h, r] of u.byHandle) {
    if (r.seenThink !== think) {
      u.byHandle.delete(h);
      onUnitGone(h);
    }
  }
  u.all = all;
  u.engineers = engineers;
  u.factories = factories;
  u.army = army;
  u.structures = structures;
  u.sites = sites;
  u.commander = commander;

  // Enemy memory.
  const mem = bb.enemy;
  for (const c of mem.contacts.values()) c.present = false;
  const current: typeof mem.current = [];
  const structs: typeof mem.structures = [];
  let landFactories = 0;
  view.forEachKnownEnemy(null, (e) => {
    charge(1);
    let c = mem.contacts.get(e.id);
    if (c === undefined) {
      c = {
        id: e.id,
        army: e.army,
        bp: e.bp,
        kind: e.kind,
        x: e.x,
        z: e.z,
        hpFrac: e.hpFrac,
        firstSeenTick: tick,
        lastSeenTick: e.lastSeenTick,
        reactableAt: tick + delay,
        present: true,
      };
      mem.contacts.set(e.id, c);
      bb.stimuli.push({ kind: 'newContact', id: e.id, army: e.army, bp: e.bp, x: e.x, z: e.z, tick, visibleAt: tick + delay });
    } else {
      c.army = e.army;
      c.bp = e.bp;
      c.kind = e.kind;
      c.x = e.x;
      c.z = e.z;
      c.hpFrac = e.hpFrac;
      c.lastSeenTick = e.lastSeenTick;
      c.present = true;
    }
    if (tick < c.reactableAt) return;
    current.push(c);
    mem.noteWindow(c.id, c.bp, tick);
    if (c.bp >= 0) {
      const b = list[c.bp]!;
      if (b.tech > mem.highestTechSeen && b.tech <= 4) mem.highestTechSeen = b.tech;
      if (classes.structure[c.bp] === 1) structs.push(c);
      if (classes.estore[c.bp] === 1) mem.estoreSeen = true;
      if (classes.landFactory[c.bp] === 1) {
        landFactories++;
        if (b.tech >= 2) mem.t2LandFactorySeen = true;
      }
    }
  });
  for (const [id, c] of mem.contacts) {
    if (!c.present && c.lastSeenTick <= tick - 1800) mem.contacts.delete(id);
  }
  mem.current = current;
  mem.structures = structs;
  mem.landFactories = landFactories;
  mem.pruneWindow(tick);

  // Events → delayed stimuli.
  view.forEachEvent((e) => {
    charge(1);
    bb.stimuli.push({ kind: 'event', event: e, tick: e.tick, visibleAt: e.tick + delay });
    if (e.kind === 'enemyDestroyed') mem.forgetId(e.id);
  });
  bb.stimuli.prune(tick);
}

// ---- brain ------------------------------------------------------------------------------------

interface Slot {
  readonly manager: Manager;
  readonly rng: Xorshift32;
}

class Brain implements AiBrain {
  private readonly factories: readonly ManagerFactory[];
  private st: AiStatic | null = null;
  private prof: AiProfile | null = null;
  private bbValue: Blackboard | null = null;
  private an: MapAnalysis | null = null;
  private op: Opening | null = null;
  private doc: OpeningsDoc | null = null;
  private roles: RoleTable | null = null;
  private emitter: CommandEmitter | null = null;
  private classes: BpClasses | null = null;
  private slots: Slot[] = [];

  constructor(factories: readonly ManagerFactory[]) {
    const names = new Set<string>();
    for (const f of factories) {
      if (names.has(f.name)) throw new Error(`createBrain: manager '${f.name}' given twice`);
      names.add(f.name);
    }
    this.factories = factories;
  }

  get initialized(): boolean {
    return this.bbValue !== null;
  }

  private need<T>(v: T | null, what: string): T {
    if (v === null) throw new Error(`brain: ${what} before init()`);
    return v;
  }

  get blackboard(): Blackboard {
    return this.need(this.bbValue, 'blackboard');
  }

  get analysis(): MapAnalysis {
    return this.need(this.an, 'analysis');
  }

  get opening(): Opening | null {
    return this.op;
  }

  get profile(): AiProfile {
    return this.need(this.prof, 'profile');
  }

  get static(): AiStatic {
    return this.need(this.st, 'static');
  }

  get managerNames(): readonly ManagerName[] {
    return this.slots.map((s) => s.manager.name);
  }

  init(s: AiStatic, p: AiProfile, opts: BrainInitOptions): void {
    const gameSeed = (opts.gameSeed ?? s.gameSeed) >>> 0;
    const st: AiStatic = gameSeed === s.gameSeed ? s : { ...s, gameSeed };
    this.st = st;
    this.prof = p;
    this.doc = opts.openings;
    this.roles = new RoleTable(st.bps, opts.openings.roles);
    this.an = analyzeMap(st, opts.openings);
    this.classes = classifyBlueprints(st);
    const bb = new Blackboard(st, p);
    this.bbValue = bb;
    if (opts.openingId !== undefined) {
      const o = opts.openings.openings.find((x) => x.id === opts.openingId);
      if (o === undefined) throw new Error(`brain: unknown opening '${opts.openingId}'`);
      this.op = o;
    } else {
      const rng = managerRng(gameSeed, st.army, 'opening-select');
      this.op = selectOpening(opts.openings, st.map.mapClass, p.name, rng, {
        maxMs: opts.maxMs ?? 11,
        allow: p.openingFilter,
      });
    }
    bb.opening.id = this.op.id;
    bb.telemetry.push({ kind: 'openingSelected', tick: 0, id: this.op.id });
    this.emitter = new CommandEmitter({ army: st.army, apm: p.apm, lead: p.lead });
    const byName = new Map<string, ManagerFactory>();
    for (const f of this.factories) byName.set(f.name, f);
    this.slots = [];
    for (const name of MANAGER_ORDER) {
      const f = byName.get(name);
      if (f === undefined) continue;
      const rng = managerRng(gameSeed, st.army, name);
      const manager = f.create({
        static: st,
        analysis: this.an,
        bb,
        profile: p,
        openings: opts.openings,
        opening: this.op,
        roles: this.roles,
        rng,
        emitter: this.emitter,
      });
      if (manager.name !== name) throw new Error(`manager factory '${name}' created '${manager.name}'`);
      this.slots.push({ manager, rng });
    }
  }

  think(view: PerceptionView, opts: ThinkOptions = {}): ThinkResult {
    const bb = this.blackboard;
    const p = this.profile;
    const st = this.static;
    const emitter = this.need(this.emitter, 'emitter');
    const classes = this.need(this.classes, 'classes');
    if (view.army !== st.army) throw new Error(`brain of army ${st.army} got perception of army ${view.army}`);
    const tick = view.tick;
    const k = Math.floor(tick / p.thinkEvery);
    bb.tick = tick;
    bb.k = k;
    bb.thinks++;
    const budget = new ThinkBudget(p.budget, opts.budgetScale ?? 1);
    emitter.beginThink(tick, (h) => bb.units.get(h));
    ingestPerception(
      bb,
      view,
      classes,
      (n) => budget.chargeIngest(n),
      (h) => {
        emitter.forget(h);
        bb.taskBoard.release(h);
        bb.reservations.releaseUnit(h);
      },
    );

    const check = opts.shouldAbort ?? ((): boolean => false);
    let aborted = false;
    const shouldAbort = (): boolean => {
      if (!aborted && check()) aborted = true;
      return aborted;
    };
    const rolledBack: DroppedCommand[] = [];
    const opsByManager: Record<string, number> = {};
    const doc = this.need(this.doc, 'openings');
    const roles = this.need(this.roles, 'roles');
    const analysis = this.analysis;
    for (const slot of this.slots) {
      const m = slot.manager;
      if (!runsOnThink(m.name, k, p)) continue;
      if (shouldAbort()) break;
      const b = budget.open(m.budgetKey);
      const before = b.used;
      const ctx: ManagerContext = {
        static: st,
        analysis,
        bb,
        profile: p,
        openings: doc,
        opening: this.op,
        roles,
        rng: slot.rng,
        emitter,
        tick,
        k,
        view,
        budget: b,
        shouldAbort,
        step: (work) => {
          if (shouldAbort()) return false;
          const mark = emitter.mark();
          const commit = work();
          if (shouldAbort()) {
            for (const d of emitter.rollback(mark)) rolledBack.push(d);
            return false;
          }
          if (typeof commit === 'function') commit();
          return true;
        },
      };
      try {
        m.think(ctx);
        shouldAbort();
      } finally {
        opsByManager[m.name] = b.used - before;
        budget.close();
      }
    }
    const reserve = budget.reserve;
    const beforeEmit = reserve.used;
    const flushed = emitter.flush(reserve);
    opsByManager.emitter = reserve.used - beforeEmit;
    return {
      tick,
      commands: flushed.commands,
      aborted,
      opsByManager,
      opsTotal: budget.usedTotal,
      ingestOps: budget.ingest,
      dropped: [...rolledBack, ...flushed.dropped],
    };
  }
}

/** Creates a brain from manager factories (missing managers are skipped). */
export function createBrain(opts: { managers: readonly ManagerFactory[] }): AiBrain {
  return new Brain(opts.managers);
}
