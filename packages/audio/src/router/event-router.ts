/**
 * Event router: sim events (Event 32 B, PLAN §3.6) → play requests and alerts, driven only by the
 * event→sound map data (src/events). One `handle` call per received frame/batch.
 *
 * Hot path (per event) is allocation-free after warm-up:
 * - type → kind through a prebuilt `Int16Array(65536)`;
 * - sounds resolved once per kind / weapon ref / impact family × surface / death class into
 *   dense sound indices (`Int32Array`s); a weapon visual id is cached in an `Int16Array(65536)`
 *   (the `visualName` callback and the string lookup run once per visual id);
 * - events are staged in preallocated struct-of-arrays tables, aggregated per
 *   (sound, time cell) through an open-addressing hash with generation stamps, then issued
 *   through one reused `PlayRequest`.
 *
 * Timing: `when = ctxTime + (tick − firstTick + subTick / 256) × tickDurationS`, so the shots of
 * one tick are spread over the tick instead of starting together. Aggregation: all plays of the
 * same sound in the same 1/8-tick cell become one play at the loudest position with
 * +10·log10(min(n, 4)) dB.
 */

import {
  ALERT_KINDS,
  DEATH_SIZE_CLASSES,
  DEFAULT_EVENT_TYPE_TABLE,
  EVENT_FLAG_AIR,
  EVENT_FLAG_STRUCTURE,
  EVENT_FLAG_UNLOCATED,
  IMPACT_SURFACES,
  SIM_EVENT_KINDS,
  collapseAfterDeath,
  deathSound,
  impactSound,
  isSimEventKind,
  type EventSoundMap,
  type SimEventKind,
  type SoundRef,
} from '../events/index.ts';
import {
  FX_ONE,
  type AlertRequest,
  type AudioEventSource,
  type PlayRequest,
  type SoundResolver,
  type SoundSink,
  type SpatialModel,
  type SpatialResult,
} from '../types.ts';

/** Anything that accepts alerts (the AlertQueue; fakes in tests). */
export interface AlertSink {
  push(req: AlertRequest): boolean;
}

export interface EventRouterOptions {
  /** Normalized map from `parseEventSoundMap`. */
  map: EventSoundMap;
  /** Numeric event type → kind name (default: the provisional DEFAULT_EVENT_TYPE_TABLE). */
  eventTypes?: Readonly<Record<number, string>> | undefined;
  resolver: SoundResolver;
  /** Faction scope for the sound lookup ('<faction>:<name>' → 'common:<name>'). */
  faction: string;
  /** Weapon visual id → weapon ref ('core:wpn_*'); called once per visual id. */
  visualName?: ((visual: number) => string | undefined) | undefined;
  alerts: AlertSink;
  /**
   * Optional: used to pick the loudest (= nearest, least attenuated) position when several events
   * are aggregated into one play. Without it the first event with the highest rule gain wins.
   */
  spatial?: SpatialModel | undefined;
  /**
   * The commander death (Lotbruch) ends the match and is heard map-wide: play it unpositioned
   * (centred, no distance/zoom attenuation). Default true.
   */
  commanderDeathGlobal?: boolean | undefined;
}

/** Router counters (plain numbers, reset with `resetStats`). */
export interface EventRouterStats {
  /** Events handled. */
  events: number;
  /** Events without a mapping: unknown type, unknown alert index, sound missing in the catalog, unknown weapon without weaponDefault. */
  eventsUnmapped: number;
  /** Events silent by design (route 'ignore', null impact surface). */
  eventsIgnored: number;
  /** Plays merged away by aggregation (candidates − issued plays). */
  aggregated: number;
  /** Plays issued to the sink. */
  plays: number;
  /** Plays the sink rejected (null). */
  dropped: number;
  alertsPushed: number;
  alertsSuppressed: number;
}

/** Aggregation cells per tick (subTick 0..255 → cell = subTick >> 5). */
export const CELLS_PER_TICK = 8;
/** Gain bonus cap of an aggregated play: +10·log10(4) ≈ +6 dB. */
export const AGGREGATE_MAX_COUNT = 4;
/** Events of later ticks in one batch are offset by at most this many ticks. */
export const MAX_TICK_SPREAD = 3;
/** Default tick duration at speed 1 (10 Hz sim). */
export const BASE_TICK_S = 0.1;

const ROUTE_SFX = 0;
const ROUTE_ALERT = 1;
const ROUTE_IGNORE = 2;

const TABLE_NONE = 0;
const TABLE_WEAPON = 1;
const TABLE_IMPACT = 2;
const TABLE_DEATH = 3;
const TABLE_COMMANDER = 4;
const KIND_ALERT = 5;

/** Sound index codes besides ≥ 0. */
const SILENT = -1;
const UNRESOLVED = -2;

const SURFACES = IMPACT_SURFACES.length;
const SIZES = DEATH_SIZE_CLASSES.length;
const NO_SLOT = -1;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export class EventRouter {
  readonly stats: EventRouterStats = {
    events: 0,
    eventsUnmapped: 0,
    eventsIgnored: 0,
    aggregated: 0,
    plays: 0,
    dropped: 0,
    alertsPushed: 0,
    alertsSuppressed: 0,
  };

  private readonly map: EventSoundMap;
  private readonly resolver: SoundResolver;
  private readonly faction: string;
  private readonly visualName: ((visual: number) => string | undefined) | undefined;
  private readonly alerts: AlertSink;
  private readonly spatial: SpatialModel | undefined;
  private tickDurationS = BASE_TICK_S;

  /** Event type (u16) → kind index, −1 unknown. */
  private readonly typeKind = new Int16Array(65536).fill(-1);
  // Per kind (SIM_EVENT_KINDS order).
  private readonly kRoute: Uint8Array;
  private readonly kTable: Uint8Array;
  private readonly kSound: Int32Array;
  private readonly kGain: Float64Array;
  private readonly kRate: Float64Array;
  private readonly kSpatial: Uint8Array;
  private readonly kThenSound: Int32Array;
  private readonly kThenGain: Float64Array;
  private readonly kThenRate: Float64Array;
  private readonly kThenDelayS: Float64Array;
  /** Alert name of route 'alert' kinds (rule.sound) — null for kind 'alert' (aux). */
  private readonly kAlertRoute: (string | null)[];
  /** Additional alert of route 'sfx' kinds (rule.alert). */
  private readonly kAlertExtra: (string | null)[];
  /** Alert name per `alert` event aux (null = unknown index / missing rule). */
  private readonly alertByAux: (string | null)[];

  // Weapon slots (one per distinct weapon ref seen; slot 0 = unknown visual).
  private readonly visualSlot = new Int16Array(65536).fill(NO_SLOT);
  private readonly slotByRef = new Map<string, number>();
  private slotCount = 0;
  private slotSound = new Int32Array(16);
  private slotGain = new Float64Array(16);
  private slotRate = new Float64Array(16);
  private slotFamily = new Int32Array(16);

  // Impacts: family × surface.
  private readonly familyIndex = new Map<string, number>();
  private readonly defaultFamily: number;
  private readonly impSound: Int32Array;
  private readonly impGain: Float64Array;
  private readonly impRate: Float64Array;

  // Deaths: size × air.
  private readonly deathSnd = new Int32Array(SIZES * 2);
  private readonly deathGain = new Float64Array(SIZES * 2);
  private readonly deathRate = new Float64Array(SIZES * 2);
  /** Structure collapse per size class (−1 none). */
  private readonly collapseSnd = new Int32Array(SIZES);
  private readonly collapseGain = new Float64Array(SIZES);
  private readonly collapseRate = new Float64Array(SIZES);
  private readonly collapseDelayS = new Float64Array(SIZES);

  private readonly cmdSound: number;
  private readonly cmdGain: number;
  private readonly cmdRate: number;
  private readonly cmdGlobal: boolean;

  /** Category index per sound index (for loudest-position selection). */
  private readonly soundCategory: Int8Array;
  private readonly soundCount: number;

  // Staged plays (struct of arrays, grown on demand).
  private cap = 0;
  private count = 0;
  private pSound = new Int32Array(0);
  private pOffS = new Float64Array(0);
  private pX = new Float64Array(0);
  private pZ = new Float64Array(0);
  private pHasPos = new Uint8Array(0);
  private pGain = new Float64Array(0);
  private pRate = new Float64Array(0);
  private pN = new Int32Array(0);
  private pLoud = new Float64Array(0);
  // Aggregation hash (open addressing, generation stamps).
  private hMask = 0;
  private hKey = new Int32Array(0);
  private hSlot = new Int32Array(0);
  private hStamp = new Int32Array(0);
  private stamp = 0;

  private readonly req: PlayRequest = {
    sound: 0,
    faction: undefined,
    x: undefined,
    z: undefined,
    gain: 1,
    rate: 1,
    when: undefined,
    priorityBoost: undefined,
    loop: undefined,
  };
  private readonly alertReq: AlertRequest = { kind: '', x: undefined, z: undefined, faction: undefined };
  private readonly spatialOut: SpatialResult = { gain: 1, pan: 0 };

  constructor(opts: EventRouterOptions) {
    this.map = opts.map;
    this.resolver = opts.resolver;
    this.faction = opts.faction;
    this.visualName = opts.visualName;
    this.alerts = opts.alerts;
    this.spatial = opts.spatial;
    const map = opts.map;

    // Type table.
    const types = opts.eventTypes ?? DEFAULT_EVENT_TYPE_TABLE;
    for (const [key, kind] of Object.entries(types)) {
      const t = Number(key);
      if (!Number.isInteger(t) || t < 0 || t > 0xffff) throw new RangeError(`event type ${key} is not a u16`);
      if (!isSimEventKind(kind)) throw new RangeError(`event type ${key}: unknown kind '${kind}'`);
      this.typeKind[t] = SIM_EVENT_KINDS.indexOf(kind);
    }

    // Sound categories for loudness selection.
    this.soundCount = opts.resolver.size;
    this.soundCategory = new Int8Array(this.soundCount);
    for (let i = 0; i < this.soundCount; i++) this.soundCategory[i] = opts.resolver.byIndex(i).categoryIndex;

    // Kind rules.
    const K = SIM_EVENT_KINDS.length;
    this.kRoute = new Uint8Array(K);
    this.kTable = new Uint8Array(K);
    this.kSound = new Int32Array(K).fill(SILENT);
    this.kGain = new Float64Array(K);
    this.kRate = new Float64Array(K);
    this.kSpatial = new Uint8Array(K);
    this.kThenSound = new Int32Array(K).fill(SILENT);
    this.kThenGain = new Float64Array(K);
    this.kThenRate = new Float64Array(K);
    this.kThenDelayS = new Float64Array(K);
    this.kAlertRoute = new Array<string | null>(K).fill(null);
    this.kAlertExtra = new Array<string | null>(K).fill(null);
    for (let k = 0; k < K; k++) {
      const kind: SimEventKind = SIM_EVENT_KINDS[k]!;
      const rule = map.kinds[kind];
      this.kRoute[k] = rule.route === 'sfx' ? ROUTE_SFX : rule.route === 'alert' ? ROUTE_ALERT : ROUTE_IGNORE;
      this.kTable[k] =
        kind === 'weaponFire'
          ? TABLE_WEAPON
          : kind === 'projectileImpact'
            ? TABLE_IMPACT
            : kind === 'unitDeath'
              ? TABLE_DEATH
              : kind === 'commanderDeath'
                ? TABLE_COMMANDER
                : kind === 'alert'
                  ? KIND_ALERT
                  : TABLE_NONE;
      this.kGain[k] = dbToGain(rule.gainDb);
      this.kRate[k] = rule.rate;
      this.kSpatial[k] = rule.spatial ? 1 : 0;
      if (rule.route === 'sfx' && rule.sound !== null) this.kSound[k] = this.resolveIdx(rule.sound);
      if (rule.route === 'alert') this.kAlertRoute[k] = rule.sound;
      if (rule.then !== null) {
        this.kThenSound[k] = this.resolveIdx(rule.then.sound);
        this.kThenGain[k] = dbToGain(rule.then.gainDb);
        this.kThenRate[k] = rule.then.rate;
        this.kThenDelayS[k] = rule.then.delayMs / 1000;
      }
      this.kAlertExtra[k] = rule.alert;
    }
    this.alertByAux = ALERT_KINDS.map((a) => (map.alerts[a.name] !== undefined ? a.name : null));

    // Impact families.
    const families = Object.keys(map.impacts.families);
    families.forEach((f, i) => this.familyIndex.set(f, i));
    this.defaultFamily = this.familyIndex.get(map.impacts.defaultFamily) ?? 0;
    this.impSound = new Int32Array(families.length * SURFACES);
    this.impGain = new Float64Array(families.length * SURFACES);
    this.impRate = new Float64Array(families.length * SURFACES);
    families.forEach((f, fi) => {
      for (let s = 0; s < SURFACES; s++) this.setRef(this.impSound, this.impGain, this.impRate, fi * SURFACES + s, impactSound(map, f, s));
    });

    // Deaths.
    for (let size = 0; size < SIZES; size++) {
      this.setRef(this.deathSnd, this.deathGain, this.deathRate, size * 2, deathSound(map, size, 0));
      this.setRef(this.deathSnd, this.deathGain, this.deathRate, size * 2 + 1, deathSound(map, size, EVENT_FLAG_AIR));
      const c = collapseAfterDeath(map, size, EVENT_FLAG_STRUCTURE);
      this.setRef(this.collapseSnd, this.collapseGain, this.collapseRate, size, c);
      this.collapseDelayS[size] = c === null ? 0 : c.delayMs / 1000;
    }

    this.cmdSound = this.resolveIdx(map.commanderDeath.sound);
    this.cmdGain = dbToGain(map.commanderDeath.gainDb);
    this.cmdRate = map.commanderDeath.rate;
    this.cmdGlobal = opts.commanderDeathGlobal ?? true;

    // Slot 0: visual without a known ref (weaponDefault, default impact family).
    this.addSlot(undefined);
    this.grow(256);
  }

  /** Sim speed factor: tick duration = 0.1 s / speed (non-positive/non-finite values are ignored). */
  setSimSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0) this.tickDurationS = BASE_TICK_S / speed;
  }

  get simTickDurationS(): number {
    return this.tickDurationS;
  }

  resetStats(): void {
    const s = this.stats;
    s.events = s.eventsUnmapped = s.eventsIgnored = s.aggregated = s.plays = s.dropped = s.alertsPushed = s.alertsSuppressed = 0;
  }

  /**
   * Routes one batch of events.
   * @param ctxTime AudioContext time the batch is scheduled against (usually `ctx.currentTime`).
   * @param nowMs wall clock in ms; each play passes `nowMs + scheduled offset` to the sink so
   *   per-sound cooldowns compare scheduled start times.
   */
  handle(src: AudioEventSource, sink: SoundSink, ctxTime: number, nowMs: number): void {
    const n = src.eventCount;
    if (n === 0) return;
    this.count = 0;
    this.stamp++;
    if (this.stamp > 0x3fffffff) {
      this.hStamp.fill(0);
      this.stamp = 1;
    }
    const tickS = this.tickDurationS;
    const baseTick = src.eventTick(0);
    const st = this.stats;

    for (let i = 0; i < n; i++) {
      st.events++;
      const type = src.eventType(i);
      const k = type >= 0 && type <= 0xffff ? this.typeKind[type]! : -1;
      if (k < 0) {
        st.eventsUnmapped++;
        continue;
      }
      const route = this.kRoute[k]!;
      if (route === ROUTE_IGNORE) {
        st.eventsIgnored++;
        continue;
      }
      const flags = src.eventFlags(i);
      const located = (flags & EVENT_FLAG_UNLOCATED) === 0;
      const x = located ? src.eventPos(i, 0) / FX_ONE : 0;
      const z = located ? src.eventPos(i, 2) / FX_ONE : 0;

      if (route === ROUTE_ALERT) {
        const name = this.kTable[k] === KIND_ALERT ? (this.alertByAux[src.eventAux(i)] ?? null) : this.kAlertRoute[k]!;
        if (name === null) st.eventsUnmapped++;
        else this.pushAlert(name, located, x, z);
        continue;
      }

      let dt = src.eventTick(i) - baseTick;
      if (dt < 0) dt = 0;
      else if (dt > MAX_TICK_SPREAD) dt = MAX_TICK_SPREAD;
      const offS = (dt + src.eventSubTick(i) / 256) * tickS;
      let positional = located && this.kSpatial[k] === 1;
      const ruleGain = this.kGain[k]!;
      const ruleRate = this.kRate[k]!;

      let snd: number;
      let gain: number;
      let rate: number;
      switch (this.kTable[k]) {
        case TABLE_WEAPON: {
          const slot = this.slotOf(src.eventVisual(i));
          snd = this.slotSound[slot]!;
          gain = this.slotGain[slot]!;
          rate = this.slotRate[slot]!;
          break;
        }
        case TABLE_IMPACT: {
          const slot = this.slotOf(src.eventVisual(i));
          const aux = src.eventAux(i);
          const j = this.slotFamily[slot]! * SURFACES + (aux >= 0 && aux < SURFACES ? aux : 0);
          snd = this.impSound[j]!;
          gain = this.impGain[j]!;
          rate = this.impRate[j]!;
          break;
        }
        case TABLE_DEATH: {
          const aux = src.eventAux(i);
          const size = aux >= 0 && aux < SIZES ? aux : aux < 0 ? 0 : SIZES - 1;
          const air = (flags & EVENT_FLAG_AIR) !== 0 ? 1 : 0;
          const j = size * 2 + air;
          snd = this.deathSnd[j]!;
          gain = this.deathGain[j]!;
          rate = this.deathRate[j]!;
          if (air === 0 && (flags & EVENT_FLAG_STRUCTURE) !== 0) {
            const c = this.collapseSnd[size]!;
            if (c >= 0) this.stage(c, offS + this.collapseDelayS[size]!, positional, x, z, this.collapseGain[size]! * ruleGain, this.collapseRate[size]! * ruleRate);
          }
          break;
        }
        case TABLE_COMMANDER:
          snd = this.cmdSound;
          gain = this.cmdGain;
          rate = this.cmdRate;
          if (this.cmdGlobal) positional = false;
          break;
        default:
          snd = this.kSound[k]!;
          gain = 1;
          rate = 1;
      }

      if (snd >= 0) this.stage(snd, offS, positional, x, z, gain * ruleGain, rate * ruleRate);
      else if (snd === UNRESOLVED) st.eventsUnmapped++;
      else st.eventsIgnored++;

      const thenSnd = this.kThenSound[k]!;
      if (thenSnd >= 0) this.stage(thenSnd, offS + this.kThenDelayS[k]!, positional, x, z, this.kThenGain[k]!, this.kThenRate[k]!);
      const extra = this.kAlertExtra[k]!;
      if (extra !== null) this.pushAlert(extra, located, x, z);
    }

    this.issue(sink, ctxTime, nowMs);
  }

  // -------------------------------------------------------------------------------------------

  private resolveIdx(name: string): number {
    const r = this.resolver.resolve(name, this.faction);
    return r === null ? UNRESOLVED : r.index;
  }

  private setRef(snd: Int32Array, gain: Float64Array, rate: Float64Array, j: number, ref: SoundRef | null): void {
    if (ref === null) {
      snd[j] = SILENT;
      gain[j] = 0;
      rate[j] = 1;
      return;
    }
    snd[j] = this.resolveIdx(ref.sound);
    gain[j] = dbToGain(ref.gainDb);
    rate[j] = ref.rate;
  }

  private pushAlert(name: string, located: boolean, x: number, z: number): void {
    const a = this.alertReq;
    a.kind = name;
    a.x = located ? x : undefined;
    a.z = located ? z : undefined;
    if (this.alerts.push(a)) this.stats.alertsPushed++;
    else this.stats.alertsSuppressed++;
  }

  /** Weapon slot of a visual id (computed once per id). */
  private slotOf(visual: number): number {
    if (!(visual >= 0 && visual <= 0xffff)) return 0;
    const s = this.visualSlot[visual]!;
    if (s !== NO_SLOT) return s;
    const ref = this.visualName?.(visual);
    const slot = ref === undefined || this.map.weapons[ref] === undefined ? 0 : (this.slotByRef.get(ref) ?? this.addSlot(ref));
    this.visualSlot[visual] = slot;
    return slot;
  }

  private addSlot(ref: string | undefined): number {
    const slot = this.slotCount++;
    if (slot >= this.slotSound.length) {
      const cap = this.slotSound.length * 2;
      this.slotSound = growI32(this.slotSound, cap);
      this.slotGain = growF64(this.slotGain, cap);
      this.slotRate = growF64(this.slotRate, cap);
      this.slotFamily = growI32(this.slotFamily, cap);
    }
    const w = ref === undefined ? undefined : this.map.weapons[ref];
    if (w !== undefined) {
      // Burst weapons (gatling) play their per-shot fallback sound; the keyed burst loop needs a
      // LoopSet and is wired by the engine in MS14 (see docs/status/audioeng-b3.md).
      this.slotSound[slot] = this.resolveIdx(w.sound);
      this.slotGain[slot] = dbToGain(w.gainDb);
      this.slotRate[slot] = w.rate;
      this.slotFamily[slot] = this.familyIndex.get(w.impact) ?? this.defaultFamily;
    } else {
      const d = this.map.weaponDefault;
      this.slotSound[slot] = d === null ? UNRESOLVED : this.resolveIdx(d.sound);
      this.slotGain[slot] = d === null ? 0 : dbToGain(d.gainDb);
      this.slotRate[slot] = d === null ? 1 : d.rate;
      this.slotFamily[slot] = this.defaultFamily;
    }
    if (ref !== undefined) this.slotByRef.set(ref, slot);
    return slot;
  }

  /** Stages one play, merging it into an existing play of the same sound and time cell. */
  private stage(snd: number, offS: number, positional: boolean, x: number, z: number, gain: number, rate: number): void {
    let loud = gain;
    if (positional && this.spatial !== undefined) {
      const out = this.spatialOut;
      loud = this.spatial.spatialize(this.soundCategory[snd]!, x, z, out) ? gain * out.gain : -1;
    }
    const cell = Math.floor((offS / this.tickDurationS) * CELLS_PER_TICK);
    const key = cell * this.soundCount + snd;
    let h = Math.imul(key, 0x9e3779b1) >>> 0;
    const mask = this.hMask;
    for (;;) {
      h &= mask;
      if (this.hStamp[h] !== this.stamp) break;
      if (this.hKey[h] === key) {
        const p = this.hSlot[h]!;
        this.stats.aggregated++;
        if (loud >= 0) this.pN[p]!++;
        if (offS < this.pOffS[p]!) this.pOffS[p] = offS;
        if (loud > this.pLoud[p]!) {
          this.pLoud[p] = loud;
          this.pX[p] = x;
          this.pZ[p] = z;
          this.pHasPos[p] = positional ? 1 : 0;
          this.pGain[p] = gain;
          this.pRate[p] = rate;
        }
        return;
      }
      h++;
    }
    if (this.count === this.cap) {
      this.grow(this.cap * 2);
      this.stage(snd, offS, positional, x, z, gain, rate);
      return;
    }
    const p = this.count++;
    this.pSound[p] = snd;
    this.pOffS[p] = offS;
    this.pX[p] = x;
    this.pZ[p] = z;
    this.pHasPos[p] = positional ? 1 : 0;
    this.pGain[p] = gain;
    this.pRate[p] = rate;
    this.pN[p] = loud >= 0 ? 1 : 0;
    this.pLoud[p] = loud;
    this.hStamp[h] = this.stamp;
    this.hKey[h] = key;
    this.hSlot[h] = p;
  }

  private issue(sink: SoundSink, ctxTime: number, nowMs: number): void {
    const req = this.req;
    const st = this.stats;
    for (let p = 0; p < this.count; p++) {
      let n = this.pN[p]!;
      if (n > AGGREGATE_MAX_COUNT) n = AGGREGATE_MAX_COUNT;
      const off = this.pOffS[p]!;
      req.sound = this.pSound[p]!;
      if (this.pHasPos[p] === 1) {
        req.x = this.pX[p]!;
        req.z = this.pZ[p]!;
      } else {
        req.x = undefined;
        req.z = undefined;
      }
      req.gain = n > 1 ? this.pGain[p]! * Math.sqrt(n) : this.pGain[p]!;
      req.rate = this.pRate[p]!;
      req.when = ctxTime + off;
      st.plays++;
      if (sink.play(req, nowMs + off * 1000) === null) st.dropped++;
    }
    this.count = 0;
  }

  /** Grows the staging tables to `cap` and rebuilds the hash for the staged entries. */
  private grow(cap: number): void {
    this.pSound = growI32(this.pSound, cap);
    this.pOffS = growF64(this.pOffS, cap);
    this.pX = growF64(this.pX, cap);
    this.pZ = growF64(this.pZ, cap);
    this.pHasPos = growU8(this.pHasPos, cap);
    this.pGain = growF64(this.pGain, cap);
    this.pRate = growF64(this.pRate, cap);
    this.pN = growI32(this.pN, cap);
    this.pLoud = growF64(this.pLoud, cap);
    this.cap = cap;
    const size = nextPow2(cap * 2);
    this.hMask = size - 1;
    this.hKey = new Int32Array(size);
    this.hSlot = new Int32Array(size);
    this.hStamp = new Int32Array(size);
    for (let p = 0; p < this.count; p++) {
      const cell = Math.floor((this.pOffS[p]! / this.tickDurationS) * CELLS_PER_TICK);
      const key = cell * this.soundCount + this.pSound[p]!;
      let h = Math.imul(key, 0x9e3779b1) >>> 0;
      for (;;) {
        h &= this.hMask;
        if (this.hStamp[h] !== this.stamp) break;
        h++;
      }
      this.hStamp[h] = this.stamp;
      this.hKey[h] = key;
      this.hSlot[h] = p;
    }
  }
}

function growI32(a: Int32Array, cap: number): Int32Array<ArrayBuffer> {
  const b = new Int32Array(cap);
  b.set(a.subarray(0, Math.min(a.length, cap)));
  return b;
}
function growF64(a: Float64Array, cap: number): Float64Array<ArrayBuffer> {
  const b = new Float64Array(cap);
  b.set(a.subarray(0, Math.min(a.length, cap)));
  return b;
}
function growU8(a: Uint8Array, cap: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(cap);
  b.set(a.subarray(0, Math.min(a.length, cap)));
  return b;
}
