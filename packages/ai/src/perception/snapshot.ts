/**
 * `PerceptionView` over snapshot bytes (layout.ts, version 2) plus `AiStatic`. Reading is
 * allocation-free for units (flyweights); the free-spot lists and the known-structure list for
 * `canPlace` are built lazily once per snapshot. This is the only place where the integer encodings
 * of the snapshot (Fx raw, Q15, thousandths) become floats (`posOf`/`fracOf`/`ecoOf`).
 */
import type { CompiledCategoryExpr } from '@faf/rules';
import {
  REJECT_REASONS,
  type AiStatic,
  type EcoState,
  type KnownKind,
  type KnownUnit,
  type OrderKind,
  type OwnUnit,
  type PerceptionEvent,
  type PerceptionView,
  type Spot,
} from '../types.ts';
import {
  E_AMOUNT,
  E_ARMY,
  E_A,
  E_B,
  E_BP,
  E_KIND,
  E_REASON,
  E_SEQ,
  E_TICK,
  ECO_FIELDS,
  EVENT_BYTES,
  EVENT_KINDS,
  FLAG_COMPLETE,
  FLAG_REPEAT,
  H_ARMY,
  H_ECO,
  H_EVENTS,
  H_KNOWN,
  H_MAGIC,
  H_OWN,
  H_TICK,
  H_TOTAL,
  H_VERSION,
  HEADER_BYTES,
  K_ARMY,
  K_BP,
  K_HP,
  K_ID,
  K_KIND,
  K_SEEN,
  K_X,
  K_Z,
  KNOWN_BYTES,
  KNOWN_KINDS,
  O_BP,
  O_BUILD,
  O_DAMAGED,
  O_FBP,
  O_FLAGS,
  O_FPROG,
  O_HANDLE,
  O_HP,
  O_OBP,
  O_ORDER,
  O_OX,
  O_OZ,
  O_QUEUE,
  O_TARGET,
  O_UPG,
  O_X,
  O_Z,
  OWN_BYTES,
  PERCEPTION_MAGIC,
  PERCEPTION_VERSION,
  ecoOf,
  fracOf,
  posOf,
} from './layout.ts';
import { canPlaceKnown, freeSpotsKnown, placementContext, type KnownStructure, type PlacementContext } from './place.ts';

/** Mutable OwnUnit (flyweight of the callbacks; also a reusable scratch object for writers). */
export class MutableOwnUnit implements OwnUnit {
  handle = 0;
  bp = 0;
  x = 0;
  z = 0;
  hpFrac = 0;
  buildFrac = 0;
  complete = false;
  order: OrderKind = 0;
  orderTarget = 0;
  orderBp = -1;
  orderX = 0;
  orderZ = 0;
  queueLength = 0;
  factoryBp = -1;
  factoryProgress = 0;
  factoryRepeat = false;
  upgradingTo = -1;
  lastDamagedTick = -1;
}

export class MutableKnownUnit implements KnownUnit {
  id = 0;
  army = 0;
  kind: KnownKind = 'visible';
  bp = -1;
  x = 0;
  z = 0;
  hpFrac = 1;
  lastSeenTick = 0;
}

/** Validates the header of a snapshot; returns the counts. */
export function readSnapshotHeader(bytes: Uint8Array): {
  version: number;
  army: number;
  tick: number;
  own: number;
  known: number;
  events: number;
} {
  if (bytes.length < HEADER_BYTES) throw new RangeError('perception snapshot too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(H_MAGIC, true) !== PERCEPTION_MAGIC) throw new RangeError('perception snapshot: bad magic');
  const version = dv.getUint16(H_VERSION, true);
  if (version !== PERCEPTION_VERSION) throw new RangeError(`perception snapshot: version ${version} unsupported`);
  const own = dv.getUint32(H_OWN, true);
  const known = dv.getUint32(H_KNOWN, true);
  const events = dv.getUint32(H_EVENTS, true);
  const total = dv.getUint32(H_TOTAL, true);
  const expect = HEADER_BYTES + own * OWN_BYTES + known * KNOWN_BYTES + events * EVENT_BYTES;
  if (total !== expect || bytes.length !== total) throw new RangeError('perception snapshot: length mismatch');
  return { version, army: dv.getUint8(H_ARMY), tick: dv.getUint32(H_TICK, true), own, known, events };
}

export class SnapshotPerception implements PerceptionView {
  readonly static: AiStatic;
  private readonly place: PlacementContext;
  private bytes: Uint8Array = new Uint8Array(0);
  private dv: DataView = new DataView(new ArrayBuffer(0));
  private tickValue = 0;
  private nOwn = 0;
  private nKnown = 0;
  private nEvents = 0;
  private ownOff = HEADER_BYTES;
  private knownOff = HEADER_BYTES;
  private eventsOff = HEADER_BYTES;
  private readonly ownFly = new MutableOwnUnit();
  private readonly knownFly = new MutableKnownUnit();
  private ecoCache: EcoState | null = null;
  private structuresCache: KnownStructure[] | null = null;
  private freeMass: Spot[] | null = null;
  private freeHydro: Spot[] | null = null;

  constructor(s: AiStatic, bytes?: Uint8Array) {
    this.static = s;
    this.place = placementContext(s);
    if (bytes !== undefined) this.reset(bytes);
  }

  /** Binds the view to a new snapshot (validated; the army must match AiStatic.army). */
  reset(bytes: Uint8Array): this {
    const h = readSnapshotHeader(bytes);
    if (h.army !== this.static.army) throw new RangeError(`perception snapshot of army ${h.army}, expected ${this.static.army}`);
    this.bytes = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.tickValue = h.tick;
    this.nOwn = h.own;
    this.nKnown = h.known;
    this.nEvents = h.events;
    this.ownOff = HEADER_BYTES;
    this.knownOff = this.ownOff + h.own * OWN_BYTES;
    this.eventsOff = this.knownOff + h.known * KNOWN_BYTES;
    this.ecoCache = null;
    this.structuresCache = null;
    this.freeMass = null;
    this.freeHydro = null;
    return this;
  }

  /** The bound snapshot bytes. */
  get snapshot(): Uint8Array {
    return this.bytes;
  }

  get tick(): number {
    return this.tickValue;
  }

  get army(): number {
    return this.static.army;
  }

  get ownCount(): number {
    return this.nOwn;
  }

  get knownEnemyCount(): number {
    return this.nKnown;
  }

  eco(): EcoState {
    if (this.ecoCache === null) {
      const v: Record<string, number> = {};
      for (let i = 0; i < ECO_FIELDS.length; i++) v[ECO_FIELDS[i]!] = ecoOf(this.dv.getInt32(H_ECO + 4 * i, true));
      this.ecoCache = v as unknown as EcoState;
    }
    return this.ecoCache;
  }

  /** Reads own unit `i` into `out` (default: the internal flyweight). */
  ownAt(i: number, out: MutableOwnUnit = this.ownFly): OwnUnit {
    if (i < 0 || i >= this.nOwn) throw new RangeError(`own unit ${i} out of range`);
    const dv = this.dv;
    const o = this.ownOff + i * OWN_BYTES;
    const flags = dv.getUint8(o + O_FLAGS);
    out.handle = dv.getUint32(o + O_HANDLE, true);
    out.bp = dv.getUint16(o + O_BP, true);
    out.order = dv.getUint8(o + O_ORDER) as OrderKind;
    out.complete = (flags & FLAG_COMPLETE) !== 0;
    out.factoryRepeat = (flags & FLAG_REPEAT) !== 0;
    out.x = posOf(dv.getInt32(o + O_X, true));
    out.z = posOf(dv.getInt32(o + O_Z, true));
    out.hpFrac = fracOf(dv.getUint16(o + O_HP, true));
    out.buildFrac = fracOf(dv.getUint16(o + O_BUILD, true));
    out.orderTarget = dv.getUint32(o + O_TARGET, true);
    out.lastDamagedTick = dv.getInt32(o + O_DAMAGED, true);
    out.orderX = posOf(dv.getInt32(o + O_OX, true));
    out.orderZ = posOf(dv.getInt32(o + O_OZ, true));
    out.factoryProgress = fracOf(dv.getUint16(o + O_FPROG, true));
    out.factoryBp = dv.getInt16(o + O_FBP, true);
    out.upgradingTo = dv.getInt16(o + O_UPG, true);
    out.queueLength = dv.getUint16(o + O_QUEUE, true);
    out.orderBp = dv.getInt16(o + O_OBP, true);
    return out;
  }

  /** Reads known enemy `i` into `out` (default: the internal flyweight). */
  knownAt(i: number, out: MutableKnownUnit = this.knownFly): KnownUnit {
    if (i < 0 || i >= this.nKnown) throw new RangeError(`known enemy ${i} out of range`);
    const dv = this.dv;
    const o = this.knownOff + i * KNOWN_BYTES;
    out.id = dv.getUint32(o + K_ID, true);
    out.army = dv.getUint8(o + K_ARMY);
    out.kind = KNOWN_KINDS[dv.getUint8(o + K_KIND)] ?? 'visible';
    out.bp = dv.getInt16(o + K_BP, true);
    out.x = posOf(dv.getInt32(o + K_X, true));
    out.z = posOf(dv.getInt32(o + K_Z, true));
    out.hpFrac = fracOf(dv.getUint16(o + K_HP, true));
    out.lastSeenTick = dv.getInt32(o + K_SEEN, true);
    return out;
  }

  forEachOwn(filter: CompiledCategoryExpr | null, fn: (u: OwnUnit) => void): void {
    const list = this.static.bps.list;
    const table = this.static.bps;
    for (let i = 0; i < this.nOwn; i++) {
      const u = this.ownAt(i);
      if (filter !== null) {
        const bp = list[u.bp];
        if (bp === undefined || !table.matches(bp, filter)) continue;
      }
      fn(u);
    }
  }

  forEachKnownEnemy(filter: CompiledCategoryExpr | null, fn: (u: KnownUnit) => void): void {
    const list = this.static.bps.list;
    const table = this.static.bps;
    for (let i = 0; i < this.nKnown; i++) {
      const u = this.knownAt(i);
      if (filter !== null) {
        if (u.bp < 0) continue;
        const bp = list[u.bp];
        if (bp === undefined || !table.matches(bp, filter)) continue;
      }
      fn(u);
    }
  }

  /** Own structures (incl. construction sites) and known enemy structures (visible/ghost). */
  knownStructures(): readonly KnownStructure[] {
    if (this.structuresCache === null) {
      const out: KnownStructure[] = [];
      const list = this.static.bps.list;
      const dv = this.dv;
      for (let i = 0; i < this.nOwn; i++) {
        const o = this.ownOff + i * OWN_BYTES;
        const bp = dv.getUint16(o + O_BP, true);
        if (list[bp]?.isStructure === true) out.push({ bp, x: posOf(dv.getInt32(o + O_X, true)), z: posOf(dv.getInt32(o + O_Z, true)) });
      }
      for (let i = 0; i < this.nKnown; i++) {
        const o = this.knownOff + i * KNOWN_BYTES;
        const bp = dv.getInt16(o + K_BP, true);
        if (bp >= 0 && list[bp]?.isStructure === true) {
          out.push({ bp, x: posOf(dv.getInt32(o + K_X, true)), z: posOf(dv.getInt32(o + K_Z, true)) });
        }
      }
      this.structuresCache = out;
    }
    return this.structuresCache;
  }

  freeMassSpots(): readonly Spot[] {
    if (this.freeMass === null) this.freeMass = freeSpotsKnown(this.place, this.knownStructures(), 'mass');
    return this.freeMass;
  }

  freeHydroSpots(): readonly Spot[] {
    if (this.freeHydro === null) this.freeHydro = freeSpotsKnown(this.place, this.knownStructures(), 'hydro');
    return this.freeHydro;
  }

  canPlace(bp: number, x: number, z: number, rot: number): boolean {
    return canPlaceKnown(this.place, this.knownStructures(), bp, x, z, rot);
  }

  forEachEvent(fn: (e: PerceptionEvent) => void): void {
    const dv = this.dv;
    for (let i = 0; i < this.nEvents; i++) {
      const o = this.eventsOff + i * EVENT_BYTES;
      const kind = EVENT_KINDS[dv.getUint8(o + E_KIND)];
      const tick = dv.getUint32(o + E_TICK, true);
      switch (kind) {
        case 'ownDamaged':
          fn({
            kind,
            tick,
            unit: dv.getUint32(o + E_A, true),
            attacker: dv.getUint32(o + E_B, true),
            attackerBp: dv.getInt16(o + E_BP, true),
            amount: ecoOf(dv.getInt32(o + E_AMOUNT, true)),
          });
          break;
        case 'ownDestroyed':
        case 'ownCompleted':
          fn({ kind, tick, unit: dv.getUint32(o + E_A, true), bp: dv.getInt16(o + E_BP, true) });
          break;
        case 'enemySighted':
        case 'enemyDestroyed':
          fn({ kind, tick, id: dv.getUint32(o + E_A, true), army: dv.getUint8(o + E_ARMY), bp: dv.getInt16(o + E_BP, true) });
          break;
        case 'commandRejected':
          fn({
            kind,
            tick,
            seq: dv.getUint16(o + E_SEQ, true),
            reason: REJECT_REASONS[dv.getUint8(o + E_REASON)] ?? 'other',
            unit: dv.getUint32(o + E_A, true),
          });
          break;
        default:
          throw new RangeError(`perception snapshot: unknown event kind at ${i}`);
      }
    }
  }
}
