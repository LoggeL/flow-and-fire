/**
 * The blackboard is the ONLY state shared between managers (ai.md §2.2). Every section documents
 * its owner — the only writer; everybody else reads.
 *
 * | Section              | Owner (writer)                                    |
 * |----------------------|---------------------------------------------------|
 * | units, enemy, stimuli| perception ingest (brain.ts) — once per think     |
 * | taskBoard            | creators add/change their tasks; EngineerManager   |
 * |                      | (and OpeningRunner for its builders) assign        |
 * | reservations         | see Reservations (spots/sites: claimant; commander|
 * |                      | control: handover rule below)                     |
 * | eco                  | EconomyManager                                     |
 * | eco.startedEnergy    | issuing Economy/Tech manager adds same-think load  |
 * | threat               | default local estimate; IntelManager replaces it  |
 * | engineerTarget       | EconomyManager / OpeningRunner (followUp.engineers)|
 * | productionRequests   | any manager adds; FactoryManager fulfils/removes  |
 * | huntRequests         | any manager adds; PlatoonManager fulfils/removes  |
 * | platoons             | PlatoonManager                                    |
 * | tech                 | TechManager                                       |
 * | opening              | OpeningRunner                                     |
 * | defense              | DefenseManager                                    |
 * | telemetry            | append-only, every manager                        |
 *
 * Commander handover rule (Vogt-Steuerung): exactly one manager controls the commander
 * (`reservations.acuOwner`). Initially the OpeningRunner; after its handoff the EngineerManager.
 * The PlatoonManager may claim it at any time for local defence, retreat, burst retreat or
 * overcharge (`claimAcu('platoon', …)`); while claimed, build managers issue no orders to it (the
 * OpeningRunner pauses its queue, it is not discarded). The PlatoonManager releases it
 * (`releaseAcu('platoon', …)`) once no enemy combat unit has been within the base radius for 15 s,
 * or immediately when local contacts require neither attack, retreat nor leash correction.
 * Control returns to the previous owner, which re-issues its queue.
 */
import { decayFactor } from './det.ts';
import type { AiProfile } from './profile.ts';
import { TaskBoard } from './taskboard.ts';
import { blipThreat, blipThreatTable, enemyAcuFactor } from './threat.ts';
import type { AiBlueprint, AiStatic, KnownKind, OrderKind, PerceptionEvent, Vec2 } from './types.ts';

// ---- units ----------------------------------------------------------------------------------------

/** Own unit as stored on the blackboard (updated in place every think; do not mutate outside ingest). */
export interface OwnRecord {
  handle: number;
  bp: number;
  blueprint: AiBlueprint;
  x: number;
  z: number;
  hpFrac: number;
  buildFrac: number;
  complete: boolean;
  order: OrderKind;
  orderTarget: number;
  orderBp: number;
  orderX: number;
  orderZ: number;
  queueLength: number;
  factoryBp: number;
  factoryProgress: number;
  factoryRepeat: boolean;
  upgradingTo: number;
  lastDamagedTick: number;
  /** Tick the AI first saw this unit. */
  firstSeenTick: number;
  /** Tick since which the unit is idle (no order, empty queue), −1 while busy. */
  idleSinceTick: number;
  /** Think counter of the last perception containing the unit. */
  seenThink: number;
}

/** Own units, rebuilt by the ingest every think (perception order). */
export class UnitsSection {
  /** All own units in perception order. */
  all: OwnRecord[] = [];
  readonly byHandle = new Map<number, OwnRecord>();
  /** Complete engineers without the commander. */
  engineers: OwnRecord[] = [];
  /** Complete factories. */
  factories: OwnRecord[] = [];
  /** Complete mobile non-engineer units (combat units and scouts). */
  army: OwnRecord[] = [];
  /** All structures incl. construction sites. */
  structures: OwnRecord[] = [];
  /** Structures under construction. */
  sites: OwnRecord[] = [];
  commander: OwnRecord | null = null;

  get(handle: number): OwnRecord | undefined {
    return this.byHandle.get(handle);
  }
}

// ---- enemy memory ---------------------------------------------------------------------------------

export interface EnemyContact {
  readonly id: number;
  army: number;
  bp: number;
  kind: KnownKind;
  x: number;
  z: number;
  hpFrac: number;
  readonly firstSeenTick: number;
  lastSeenTick: number;
  /** Tick from which managers may react (firstSeen + reaction delay, ai.md §2.1). */
  readonly reactableAt: number;
  /** Contained in the current perception. */
  present: boolean;
}

/** Seconds of the counter-table window (ai.md §5.4). */
export const CATEGORY_WINDOW_TICKS = 1800;
/** Forget contacts that have not been in the perception for this long. */
export const CONTACT_FORGET_TICKS = 1800;

interface WindowEntry {
  bp: number;
  lastSeenTick: number;
  weight: number;
}

/**
 * What the AI knows about enemies (owner: ingest). Only visible objects, ghosts and blips of the
 * perception enter — never fog knowledge.
 */
export class EnemyMemory {
  /** All remembered contacts by id (insertion = first-seen order). */
  readonly contacts = new Map<number, EnemyContact>();
  /** Contacts in the current perception that are reactable (perception order). */
  current: EnemyContact[] = [];
  /** Reactable known structures (visible or ghost) of the current perception. */
  structures: EnemyContact[] = [];
  /** Highest enemy tech seen (0 = none yet). */
  highestTechSeen = 0;
  /** An enemy energy storage has been seen (visible or ghost). */
  estoreSeen = false;
  /** Enemy land factories currently known (visible or ghost). */
  landFactories = 0;
  /** An enemy land factory of tech ≥ 2 has been seen (Hard counter prediction). */
  t2LandFactorySeen = false;
  private readonly window = new Map<number, WindowEntry>();

  constructor(
    private readonly s: AiStatic,
    private readonly blipTable: Float64Array,
  ) {}

  /** Threat weight of an entry in the counter window: max(surface, air) threat, blips = median. */
  weightOf(bp: number): number {
    if (bp < 0) return blipThreat(this.blipTable, this.highestTechSeen);
    const b = this.s.bps.list[bp]!;
    return Math.max(b.threatSurface, b.threatAir);
  }

  /** @internal ingest: records a reactable sighting in the 180-s window. */
  noteWindow(id: number, bp: number, tick: number): void {
    const e = this.window.get(id);
    if (e === undefined) this.window.set(id, { bp, lastSeenTick: tick, weight: this.weightOf(bp) });
    else {
      e.lastSeenTick = tick;
      if (bp >= 0 && e.bp !== bp) {
        e.bp = bp;
        e.weight = this.weightOf(bp);
      }
    }
  }

  /** @internal ingest: drops window entries older than 180 s and destroyed ids. */
  pruneWindow(tick: number): void {
    for (const [id, e] of this.window) if (e.lastSeenTick <= tick - CATEGORY_WINDOW_TICKS) this.window.delete(id);
  }

  /** @internal */
  forgetId(id: number): void {
    this.contacts.delete(id);
    this.window.delete(id);
  }

  /**
   * Threat-weighted share (0..1) of enemy objects seen in the last 180 s whose blueprint matches
   * `pred` (blips count as "unknown ground" and never match). 0 if nothing was seen.
   */
  categoryShare(pred: (bp: AiBlueprint) => boolean): number {
    let total = 0;
    let hit = 0;
    for (const e of this.window.values()) {
      total += e.weight;
      if (e.bp >= 0 && pred(this.s.bps.list[e.bp]!)) hit += e.weight;
    }
    return total > 0 ? hit / total : 0;
  }

  /** Number of window entries matching `pred` (e.g. "≥ 5 aircraft"). */
  categoryCount(pred: (bp: AiBlueprint) => boolean): number {
    let n = 0;
    for (const e of this.window.values()) if (e.bp >= 0 && pred(this.s.bps.list[e.bp]!)) n++;
    return n;
  }

  /** Iterates the counter window (insertion order). */
  forEachWindow(fn: (bp: number, weight: number, lastSeenTick: number) => void): void {
    for (const e of this.window.values()) fn(e.bp, e.weight, e.lastSeenTick);
  }
}

// ---- stimuli (reaction delay) ------------------------------------------------------------------

export type Stimulus =
  | { readonly kind: 'event'; readonly event: PerceptionEvent; readonly tick: number; readonly visibleAt: number }
  | {
      readonly kind: 'newContact';
      readonly id: number;
      readonly army: number;
      readonly bp: number;
      readonly x: number;
      readonly z: number;
      readonly tick: number;
      readonly visibleAt: number;
    };

/** Stimuli stay available this long after becoming visible. */
export const STIMULUS_RETAIN_TICKS = 600;

/**
 * New stimuli (events, first contacts) become visible `reactionDelayTicks` after they happened
 * (ai.md §2.1). Managers read them with their own cursor (`forEachVisible(since, now)`), so 1-Hz
 * managers running on alternate thinks miss nothing. Owner: ingest.
 */
export class Stimuli {
  private list: Stimulus[] = [];

  push(s: Stimulus): void {
    this.list.push(s);
  }

  /** Stimuli that became visible in (sinceTick, nowTick], in push order. */
  forEachVisible(sinceTick: number, nowTick: number, fn: (s: Stimulus) => void): void {
    for (const s of this.list) if (s.visibleAt > sinceTick && s.visibleAt <= nowTick) fn(s);
  }

  /** All visible, retained stimuli (visibleAt ≤ now). */
  forEachActive(nowTick: number, fn: (s: Stimulus) => void): void {
    for (const s of this.list) if (s.visibleAt <= nowTick) fn(s);
  }

  /** Drops stimuli visible for longer than the retention. */
  prune(nowTick: number): void {
    if (this.list.length === 0) return;
    this.list = this.list.filter((s) => s.visibleAt > nowTick - STIMULUS_RETAIN_TICKS);
  }

  get size(): number {
    return this.list.length;
  }
}

// ---- reservations -------------------------------------------------------------------------------

export interface Reservation {
  readonly owner: string;
  readonly tick: number;
  /** Builder handle, 0 = none. */
  readonly holder: number;
}

/**
 * Reservations of spots, build sites and units. Spots/sites belong to the claimant until released;
 * a released spot may be locked (30 s after enemy contact, 60 s after 3 placement failures).
 */
export class Reservations {
  private readonly spots = new Map<number, Reservation>();
  private readonly spotLocks = new Map<number, number>();
  private readonly sites = new Map<string, Reservation>();
  private readonly siteLocks = new Map<string, number>();
  private readonly units = new Map<number, string>();
  private acu = { owner: 'opening', previous: 'opening', since: 0, reason: '' };

  /** Reserves a spot; false if held by another owner or locked. */
  reserveSpot(spot: number, owner: string, tick: number, holder = 0): boolean {
    if (!this.isSpotAvailable(spot, tick, owner)) return false;
    this.spots.set(spot, { owner, tick, holder });
    return true;
  }

  /** Releases a spot; with `lockUntilTick` it stays blocked until then. */
  releaseSpot(spot: number, lockUntilTick = -1): void {
    this.spots.delete(spot);
    if (lockUntilTick >= 0) this.spotLocks.set(spot, lockUntilTick);
  }

  lockSpot(spot: number, untilTick: number): void {
    this.spotLocks.set(spot, untilTick);
  }

  spotReservation(spot: number): Reservation | undefined {
    return this.spots.get(spot);
  }

  /** True if the spot is neither reserved by someone else nor locked. */
  isSpotAvailable(spot: number, tick: number, owner?: string): boolean {
    const lock = this.spotLocks.get(spot);
    if (lock !== undefined && lock > tick) return false;
    const r = this.spots.get(spot);
    return r === undefined || (owner !== undefined && r.owner === owner);
  }

  /** Reserved spot indices (insertion order). */
  reservedSpots(): number[] {
    return [...this.spots.keys()];
  }

  reserveSite(key: string, owner: string, tick: number, holder = 0): boolean {
    if (!this.isSiteAvailable(key, tick, owner)) return false;
    this.sites.set(key, { owner, tick, holder });
    return true;
  }

  releaseSite(key: string, lockUntilTick = -1): void {
    this.sites.delete(key);
    if (lockUntilTick >= 0) this.siteLocks.set(key, lockUntilTick);
  }

  isSiteAvailable(key: string, tick: number, owner?: string): boolean {
    const lock = this.siteLocks.get(key);
    if (lock !== undefined && lock > tick) return false;
    const r = this.sites.get(key);
    return r === undefined || (owner !== undefined && r.owner === owner);
  }

  siteReservation(key: string): Reservation | undefined {
    return this.sites.get(key);
  }

  /** Assigns a unit to a manager (e.g. platoon membership); last claim wins. */
  claimUnit(handle: number, owner: string): void {
    this.units.set(handle, owner);
  }

  releaseUnit(handle: number, owner?: string): void {
    if (owner === undefined || this.units.get(handle) === owner) this.units.delete(handle);
  }

  unitOwner(handle: number): string | undefined {
    return this.units.get(handle);
  }

  /** Drops unit claims of dead units and reservations held by dead builders. */
  pruneDead(alive: (handle: number) => boolean): void {
    for (const h of [...this.units.keys()]) if (!alive(h)) this.units.delete(h);
  }

  /** Current controller of the commander. */
  get acuOwner(): string {
    return this.acu.owner;
  }

  get acuReason(): string {
    return this.acu.reason;
  }

  /** Transfers commander control (see module doc); returns true if `by` holds it afterwards. */
  claimAcu(by: string, tick: number, reason = ''): boolean {
    if (this.acu.owner !== by) this.acu = { owner: by, previous: this.acu.owner, since: tick, reason };
    return true;
  }

  /** Returns control to the previous owner if `by` holds it. */
  releaseAcu(by: string, tick: number): void {
    if (this.acu.owner !== by) return;
    this.acu = { owner: this.acu.previous, previous: this.acu.previous, since: tick, reason: '' };
  }

  /** Permanent handover (e.g. OpeningRunner → EngineerManager after the opening). */
  handoverAcu(from: string, to: string, tick: number): void {
    if (this.acu.owner === from) this.acu = { owner: to, previous: to, since: tick, reason: 'handoff' };
    else if (this.acu.previous === from) this.acu = { ...this.acu, previous: to };
  }
}

// ---- eco plan ---------------------------------------------------------------------------------

export interface EcoSink {
  readonly kind: 'mexUpgrade' | 'factory' | 'factoryUpgrade' | 'engineer' | 'assist' | 'tech' | 'other';
  readonly massPerSec: number;
  readonly energyPerSec: number;
  readonly taskId: number;
  readonly tick: number;
}

/** Economy plan (owner: EconomyManager; same-think started load is appended by its issuer). */
export class EcoPlan {
  /** Energy reservation R_E of decided mass sinks (E/s), decays 10 %/s. */
  reservedE = 0;
  /** Upgrade demand issued this think, before it appears in the next perception. */
  startedEnergyTick = -1;
  startedEnergyDemand = 0;
  /** Decided, not yet started sinks (ai.md §5.1 R-03). */
  sinks: EcoSink[] = [];
  /** Seconds until the energy storage runs empty at the current flow (Infinity = never). */
  energyEmptyInS = Infinity;
  /** Current energy deficit of the balance (E/s, ≤ 0 = none). */
  deficitE = 0;
  /** Energy emergency (storage empty within 10 s). */
  emergency = false;

  reserve(energyPerSec: number): void {
    this.reservedE += energyPerSec;
  }

  /** Append transient load in manager order; the tick tag makes old load inert. */
  startEnergy(energyPerSec: number, tick: number): void {
    if (this.startedEnergyTick !== tick) {
      this.startedEnergyTick = tick;
      this.startedEnergyDemand = 0;
    }
    this.startedEnergyDemand += energyPerSec;
  }

  /** One economy second: R_E ← R_E · 0.9. */
  decayOneSecond(): void {
    this.reservedE *= 0.9;
  }

  addSink(s: EcoSink): void {
    this.sinks.push(s);
  }

  removeSink(taskId: number): void {
    this.sinks = this.sinks.filter((s) => s.taskId !== taskId);
  }

  /** Σ mass rate of decided sinks. */
  get sinkMass(): number {
    let m = 0;
    for (const s of this.sinks) m += s.massPerSec;
    return m;
  }
}

// ---- threat query ------------------------------------------------------------------------------

export type ThreatQueryLayer = 'surface' | 'air' | 'antiair';

/** Threat at a point (ai.md §5.6 layers); T_surface = enemy threat against ground. */
export interface ThreatQuery {
  threatAt(layer: ThreatQueryLayer, x: number, z: number): number;
}

/** Radius of the local estimate before the threat grid (ai.md §5.1: 40 WU). */
export const LOCAL_THREAT_RADIUS = 40;

/**
 * Default ThreatQuery (MS9, before the IntelManager's grid): Σ threat of the reactable known enemies
 * within 40 WU, in perception order. surface = ground threat (commander factor R-07, blips = median);
 * air = threat of enemy aircraft; antiair = enemy anti-air threat.
 */
export class LocalThreatEstimate implements ThreatQuery {
  constructor(
    private readonly s: AiStatic,
    private readonly enemy: EnemyMemory,
    private readonly blipTable: Float64Array,
    private readonly now: () => number,
  ) {}

  threatAt(layer: ThreatQueryLayer, x: number, z: number): number {
    const r2 = LOCAL_THREAT_RADIUS * LOCAL_THREAT_RADIUS;
    const list = this.s.bps.list;
    let sum = 0;
    for (const c of this.enemy.current) {
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz > r2) continue;
      const hp = c.kind === 'visible' ? c.hpFrac : 1;
      if (c.bp < 0) {
        if (layer === 'surface') sum += blipThreat(this.blipTable, this.enemy.highestTechSeen);
        continue;
      }
      const b = list[c.bp]!;
      if (layer === 'surface') {
        let t = b.threatSurface * hp;
        if (b.categoryNames.includes('COMMAND')) t *= enemyAcuFactor(this.enemy.estoreSeen, this.now());
        sum += t;
      } else if (layer === 'air') {
        if (b.layer === 'air') sum += Math.max(b.threatSurface, b.threatAir) * hp;
      } else sum += b.threatAir * hp;
    }
    return sum;
  }
}

// ---- requests ---------------------------------------------------------------------------------

export interface ProductionRequest {
  readonly id: number;
  readonly role: string;
  readonly tech: number;
  count: number;
  readonly prio: number;
  readonly source: string;
  readonly createdTick: number;
}

export interface HuntRequest {
  readonly id: number;
  /** Enemy id (handle). */
  readonly target: number;
  x: number;
  z: number;
  readonly source: string;
  readonly createdTick: number;
  /** Hunter handle once assigned, 0 before. */
  hunter: number;
}

/** Ordered request list with monotonic ids. */
export class RequestList<T extends { readonly id: number }> {
  items: T[] = [];
  private nextId = 1;

  add(make: (id: number) => T): T {
    const r = make(this.nextId++);
    this.items.push(r);
    return r;
  }

  remove(id: number): void {
    this.items = this.items.filter((r) => r.id !== id);
  }

  find(pred: (r: T) => boolean): T | undefined {
    return this.items.find(pred);
  }

  get size(): number {
    return this.items.length;
  }
}

// ---- platoons, tech, opening, defense ---------------------------------------------------------

export type PlatoonState = 'forming' | 'staging' | 'attack' | 'retreat' | 'merge' | 'raid';

/** Public view of a platoon (owner: PlatoonManager). */
export interface PlatoonInfo {
  readonly id: number;
  state: PlatoonState;
  units: number[];
  x: number;
  z: number;
  /** Last local strength ratio. */
  ratio: number;
  target: Vec2 | null;
  isFirstWave: boolean;
}

/** Tech state (owner: TechManager). */
export interface TechState {
  /** Highest complete own land factory tech (1 before any factory). */
  level: number;
  upgrading: boolean;
  upgradeHandle: number;
  startTick: number;
  doneTick: number;
}

/** Opening state (owner: OpeningRunner). */
export interface OpeningState {
  /** Selected opening id (set in init). */
  id: string | null;
  active: boolean;
  defenseMode: boolean;
  defenseModeTick: number;
  localDefense: boolean;
  /** Builders/factories handed over to the managers. */
  handedOffAcu: boolean;
  handedOffEngineers: number[];
  handedOffFactories: number[];
  /** Extra units of the first wave (difficultyTiming.waveExtra). */
  waveExtra: number;
}

/** Defense state (owner: DefenseManager). */
export interface DefenseState {
  /** Cluster key → task id of its point defense (at most one per cluster). */
  readonly clusterDefense: Map<string, number>;
  /** Mass spent on defense with tick (15 %-over-3-min rule). */
  spend: { tick: number; mass: number }[];
}

// ---- telemetry --------------------------------------------------------------------------------

export type TelemetryEvent =
  | { readonly kind: 'openingSelected'; readonly tick: number; readonly id: string }
  | { readonly kind: 'handoff'; readonly tick: number; readonly what: 'acu' | 'engineer' | 'factory'; readonly unit: number }
  | { readonly kind: 'defenseMode'; readonly tick: number; readonly reason: string }
  | { readonly kind: 'techStart'; readonly tick: number; readonly unit: number; readonly tech: number }
  | { readonly kind: 'techDone'; readonly tick: number; readonly unit: number; readonly tech: number }
  | {
      readonly kind: 'waveAttack';
      readonly tick: number;
      readonly x: number;
      readonly z: number;
      readonly enemyHalf: boolean;
      readonly units: number;
      readonly forced: boolean;
    }
  | { readonly kind: 'retreat'; readonly tick: number; readonly platoon: number; readonly ratio: number }
  | { readonly kind: 'mexUpgradeStart'; readonly tick: number; readonly unit: number }
  | { readonly kind: 'scoutSeenEnemyBase'; readonly tick: number }
  | { readonly kind: 'aiTimeout'; readonly tick: number };

/** Append-only telemetry for tournaments (owner: every manager, append only). */
export class Telemetry {
  readonly events: TelemetryEvent[] = [];

  push(e: TelemetryEvent): void {
    this.events.push(e);
  }

  /** First event of a kind, undefined if none. */
  first<K extends TelemetryEvent['kind']>(kind: K): Extract<TelemetryEvent, { kind: K }> | undefined {
    return this.events.find((e) => e.kind === kind) as Extract<TelemetryEvent, { kind: K }> | undefined;
  }

  count(kind: TelemetryEvent['kind']): number {
    let n = 0;
    for (const e of this.events) if (e.kind === kind) n++;
    return n;
  }
}

// ---- blackboard ---------------------------------------------------------------------------------

export class Blackboard {
  /** Tick of the current think. */
  tick = 0;
  /** Think counter k = tick / thinkEvery. */
  k = 0;
  /** Number of thinks run so far (incl. the current). */
  thinks = 0;
  readonly static: AiStatic;
  readonly profile: AiProfile;
  /** blipThreatTable of the blueprint table. */
  readonly blipTable: Float64Array;
  readonly units = new UnitsSection();
  readonly enemy: EnemyMemory;
  readonly stimuli = new Stimuli();
  readonly taskBoard = new TaskBoard();
  readonly reservations = new Reservations();
  readonly eco = new EcoPlan();
  /** Threat query; default local estimate, replaced by the IntelManager. */
  threat: ThreatQuery;
  /** Wanted number of engineers. */
  engineerTarget = 0;
  readonly productionRequests = new RequestList<ProductionRequest>();
  readonly huntRequests = new RequestList<HuntRequest>();
  platoons: PlatoonInfo[] = [];
  readonly tech: TechState = { level: 1, upgrading: false, upgradeHandle: 0, startTick: -1, doneTick: -1 };
  readonly opening: OpeningState = {
    id: null,
    active: false,
    defenseMode: false,
    defenseModeTick: -1,
    localDefense: false,
    handedOffAcu: false,
    handedOffEngineers: [],
    handedOffFactories: [],
    waveExtra: 0,
  };
  readonly defense: DefenseState = { clusterDefense: new Map(), spend: [] };
  readonly telemetry = new Telemetry();

  constructor(s: AiStatic, profile: AiProfile) {
    this.static = s;
    this.profile = profile;
    this.blipTable = blipThreatTable(s.bps);
    this.enemy = new EnemyMemory(s, this.blipTable);
    this.threat = new LocalThreatEstimate(s, this.enemy, this.blipTable, () => this.tick);
    this.opening.waveExtra = profile.timing.waveExtra;
  }

  /** Seconds since tick t (10 Hz). */
  secondsSince(t: number): number {
    return (this.tick - t) / 10;
  }

  /** Game time in seconds. */
  get timeS(): number {
    return this.tick / 10;
  }

  /** 0.95^Δs decay factor for threat memory (LUT, ai.md §5.6). */
  decaySince(t: number): number {
    return decayFactor(this.secondsSince(t));
  }
}
