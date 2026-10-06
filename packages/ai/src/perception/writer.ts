/**
 * Writes perception snapshots (layout.ts, version 2) into reusable buffers — no allocation per unit.
 * The producer writes own units, known enemies and own events in its iteration (slot) order; the AI
 * sums in exactly that order.
 *
 * Two entry points:
 * - the **raw** methods (`setEcoRaw`, `addOwnRaw`, `addKnownRaw`, `addEventRaw`) take the integer
 *   encodings of the layout (Fx raw positions, Q15 fractions, thousandths) — the path of the sim's
 *   FrameWriter profile (MS9), which has no floats;
 * - the **float** methods (`setEco`, `addOwn`, `addKnown`, `addEvent`) take the `PerceptionView`
 *   types and quantize them once (`posRaw`/`fracRaw`/`ecoRaw`) — the path of float producers (the
 *   arena, `FakeWorld`). Both yield identical bytes for identical raw values.
 */
import { REJECT_REASONS, type EcoState, type KnownUnit, type OwnUnit, type PerceptionEvent } from '../types.ts';
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
  FRAC_ONE,
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
  ecoRaw,
  fracRaw,
  posRaw,
} from './layout.ts';

/** Own unit in the integer encoding of the layout (positions Fx raw, fractions Q15). */
export interface OwnUnitRaw {
  handle: number;
  bp: number;
  order: number;
  complete: boolean;
  factoryRepeat: boolean;
  xRaw: number;
  zRaw: number;
  hpQ15: number;
  buildQ15: number;
  orderTarget: number;
  lastDamagedTick: number;
  orderXRaw: number;
  orderZRaw: number;
  factoryProgressQ15: number;
  factoryBp: number;
  upgradingTo: number;
  queueLength: number;
  orderBp: number;
}

/** Known enemy in the integer encoding of the layout. */
export interface KnownUnitRaw {
  id: number;
  army: number;
  kind: KnownUnit['kind'];
  bp: number;
  xRaw: number;
  zRaw: number;
  /** Q15; written only for visible objects (ghost/blip ⇒ FRAC_ONE). */
  hpQ15: number;
  lastSeenTick: number;
}

/** Event with the damage amount in thousandths (`amountMilli`); other kinds as PerceptionEvent. */
export type PerceptionEventRaw = Exclude<PerceptionEvent, { kind: 'ownDamaged' }> | (Omit<Extract<PerceptionEvent, { kind: 'ownDamaged' }>, 'amount'> & { amountMilli: number });

class Section {
  bytes: Uint8Array;
  dv: DataView;
  len = 0;

  constructor(cap: number) {
    this.bytes = new Uint8Array(cap);
    this.dv = new DataView(this.bytes.buffer);
  }

  /** Reserves `n` bytes, returns the offset (grows by doubling). */
  alloc(n: number): number {
    const need = this.len + n;
    if (need > this.bytes.length) {
      let cap = this.bytes.length * 2;
      while (cap < need) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(this.bytes.subarray(0, this.len));
      this.bytes = nb;
      this.dv = new DataView(nb.buffer);
    }
    const off = this.len;
    this.bytes.fill(0, off, need);
    this.len = need;
    return off;
  }
}

function checkI16(what: string, v: number): number {
  if (!Number.isInteger(v) || v < -32768 || v > 32767) throw new RangeError(`perception: ${what} out of i16 range: ${v}`);
  return v;
}

function checkI32(what: string, v: number): number {
  if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) throw new RangeError(`perception: ${what} out of i32 range: ${v}`);
  return v;
}

function checkU(what: string, v: number, max: number): number {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`perception: ${what} out of range: ${v}`);
  return v;
}

export class PerceptionWriter {
  private readonly own = new Section(4096);
  private readonly known = new Section(2048);
  private readonly events = new Section(512);
  private out = new Section(8192);
  private ownCount = 0;
  private knownCount = 0;
  private eventCount = 0;
  private tick = 0;
  private army = 0;
  private readonly eco = new Int32Array(ECO_FIELDS.length);
  private open = false;
  private readonly ownScratch: OwnUnitRaw = {
    handle: 0,
    bp: 0,
    order: 0,
    complete: false,
    factoryRepeat: false,
    xRaw: 0,
    zRaw: 0,
    hpQ15: 0,
    buildQ15: 0,
    orderTarget: 0,
    lastDamagedTick: -1,
    orderXRaw: 0,
    orderZRaw: 0,
    factoryProgressQ15: 0,
    factoryBp: -1,
    upgradingTo: -1,
    queueLength: 0,
    orderBp: -1,
  };
  private readonly knownScratch: KnownUnitRaw = { id: 0, army: 0, kind: 'visible', bp: -1, xRaw: 0, zRaw: 0, hpQ15: FRAC_ONE, lastSeenTick: 0 };

  /** Starts a snapshot for `army` at `tick`. */
  begin(tick: number, army: number): this {
    this.tick = checkU('tick', tick, 0xffffffff);
    this.army = checkU('army', army, 15);
    this.own.len = 0;
    this.known.len = 0;
    this.events.len = 0;
    this.ownCount = 0;
    this.knownCount = 0;
    this.eventCount = 0;
    this.eco.fill(0);
    this.open = true;
    return this;
  }

  private ensureOpen(): void {
    if (!this.open) throw new Error('perception writer: begin() first');
  }

  // ---- raw path (integer producers: the sim from MS9) ---------------------------------------------

  /** Eco values in thousandths, in ECO_FIELDS order. */
  setEcoRaw(values: ArrayLike<number>): this {
    this.ensureOpen();
    if (values.length !== ECO_FIELDS.length) throw new RangeError(`perception: ${ECO_FIELDS.length} eco values expected`);
    for (let i = 0; i < ECO_FIELDS.length; i++) this.eco[i] = checkI32(ECO_FIELDS[i]!, values[i]!);
    return this;
  }

  /** Appends an own unit in the integer encoding (read immediately; callers may reuse the object). */
  addOwnRaw(u: OwnUnitRaw): this {
    this.ensureOpen();
    const s = this.own;
    const o = s.alloc(OWN_BYTES);
    const dv = s.dv;
    dv.setUint32(o + O_HANDLE, checkU('handle', u.handle, 0xffffffff), true);
    dv.setUint16(o + O_BP, checkU('bp', u.bp, 0x7fff), true);
    dv.setUint8(o + O_ORDER, checkU('order', u.order, 255));
    dv.setUint8(o + O_FLAGS, (u.complete ? FLAG_COMPLETE : 0) | (u.factoryRepeat ? FLAG_REPEAT : 0));
    dv.setInt32(o + O_X, checkI32('x', u.xRaw), true);
    dv.setInt32(o + O_Z, checkI32('z', u.zRaw), true);
    dv.setUint16(o + O_HP, checkU('hpFrac', u.hpQ15, FRAC_ONE), true);
    dv.setUint16(o + O_BUILD, checkU('buildFrac', u.buildQ15, FRAC_ONE), true);
    dv.setUint32(o + O_TARGET, checkU('orderTarget', u.orderTarget, 0xffffffff), true);
    dv.setInt32(o + O_DAMAGED, checkI32('lastDamagedTick', u.lastDamagedTick), true);
    dv.setInt32(o + O_OX, checkI32('orderX', u.orderXRaw), true);
    dv.setInt32(o + O_OZ, checkI32('orderZ', u.orderZRaw), true);
    dv.setUint16(o + O_FPROG, checkU('factoryProgress', u.factoryProgressQ15, FRAC_ONE), true);
    dv.setInt16(o + O_FBP, checkI16('factoryBp', u.factoryBp), true);
    dv.setInt16(o + O_UPG, checkI16('upgradingTo', u.upgradingTo), true);
    dv.setUint16(o + O_QUEUE, checkU('queueLength', u.queueLength, 0xffff), true);
    dv.setInt16(o + O_OBP, checkI16('orderBp', u.orderBp), true);
    this.ownCount++;
    return this;
  }

  /** Appends a known enemy in the integer encoding; hpQ15 is written only for visible objects. */
  addKnownRaw(u: KnownUnitRaw): this {
    this.ensureOpen();
    const s = this.known;
    const o = s.alloc(KNOWN_BYTES);
    const dv = s.dv;
    const kind = KNOWN_KINDS.indexOf(u.kind);
    if (kind < 0) throw new RangeError(`perception: unknown kind ${String(u.kind)}`);
    if (u.kind === 'blip' && u.bp !== -1) throw new RangeError('perception: blips carry no blueprint');
    dv.setUint32(o + K_ID, checkU('id', u.id, 0xffffffff), true);
    dv.setUint8(o + K_ARMY, checkU('army', u.army, 15));
    dv.setUint8(o + K_KIND, kind);
    dv.setInt16(o + K_BP, checkI16('bp', u.bp), true);
    dv.setInt32(o + K_X, checkI32('x', u.xRaw), true);
    dv.setInt32(o + K_Z, checkI32('z', u.zRaw), true);
    dv.setUint16(o + K_HP, u.kind === 'visible' ? checkU('hpFrac', u.hpQ15, FRAC_ONE) : FRAC_ONE, true);
    dv.setInt32(o + K_SEEN, checkI32('lastSeenTick', u.lastSeenTick), true);
    this.knownCount++;
    return this;
  }

  /** Appends an event; the damage amount of `ownDamaged` in thousandths. */
  addEventRaw(e: PerceptionEventRaw): this {
    this.ensureOpen();
    const s = this.events;
    const o = s.alloc(EVENT_BYTES);
    const dv = s.dv;
    dv.setUint8(o + E_KIND, EVENT_KINDS.indexOf(e.kind));
    dv.setUint32(o + E_TICK, checkU('event tick', e.tick, 0xffffffff), true);
    switch (e.kind) {
      case 'ownDamaged':
        dv.setUint32(o + E_A, e.unit, true);
        dv.setUint32(o + E_B, e.attacker, true);
        dv.setInt16(o + E_BP, checkI16('attackerBp', e.attackerBp), true);
        dv.setInt32(o + E_AMOUNT, checkI32('amount', e.amountMilli), true);
        break;
      case 'ownDestroyed':
      case 'ownCompleted':
        dv.setUint32(o + E_A, e.unit, true);
        dv.setInt16(o + E_BP, checkI16('bp', e.bp), true);
        break;
      case 'enemySighted':
      case 'enemyDestroyed':
        dv.setUint32(o + E_A, e.id, true);
        dv.setUint8(o + E_ARMY, checkU('army', e.army, 15));
        dv.setInt16(o + E_BP, checkI16('bp', e.bp), true);
        break;
      case 'commandRejected': {
        const r = REJECT_REASONS.indexOf(e.reason);
        if (r < 0) throw new RangeError(`perception: unknown reject reason ${String(e.reason)}`);
        dv.setUint8(o + E_REASON, r);
        dv.setUint16(o + E_SEQ, checkU('seq', e.seq, 0xffff), true);
        dv.setUint32(o + E_A, e.unit, true);
        break;
      }
    }
    this.eventCount++;
    return this;
  }

  // ---- float path (arena, tests): quantizes once, then the raw path ----------------------------------

  setEco(e: EcoState): this {
    this.ensureOpen();
    for (let i = 0; i < ECO_FIELDS.length; i++) {
      const f = ECO_FIELDS[i]!;
      this.eco[i] = ecoRaw(f, e[f]);
    }
    return this;
  }

  /** Appends an own unit (the object is read immediately; callers may reuse it). */
  addOwn(u: OwnUnit): this {
    const r = this.ownScratch;
    r.handle = u.handle;
    r.bp = u.bp;
    r.order = u.order;
    r.complete = u.complete;
    r.factoryRepeat = u.factoryRepeat;
    r.xRaw = posRaw('x', u.x);
    r.zRaw = posRaw('z', u.z);
    r.hpQ15 = fracRaw('hpFrac', u.hpFrac);
    r.buildQ15 = fracRaw('buildFrac', u.buildFrac);
    r.orderTarget = u.orderTarget;
    r.lastDamagedTick = u.lastDamagedTick;
    r.orderXRaw = posRaw('orderX', u.orderX);
    r.orderZRaw = posRaw('orderZ', u.orderZ);
    r.factoryProgressQ15 = fracRaw('factoryProgress', u.factoryProgress);
    r.factoryBp = u.factoryBp;
    r.upgradingTo = u.upgradingTo;
    r.queueLength = u.queueLength;
    r.orderBp = u.orderBp;
    return this.addOwnRaw(r);
  }

  /** Appends a known enemy; `hpFrac` is written only for visible objects (ghost/blip ⇒ 1). */
  addKnown(u: KnownUnit): this {
    const r = this.knownScratch;
    r.id = u.id;
    r.army = u.army;
    r.kind = u.kind;
    r.bp = u.bp;
    r.xRaw = posRaw('x', u.x);
    r.zRaw = posRaw('z', u.z);
    r.hpQ15 = u.kind === 'visible' ? fracRaw('hpFrac', u.hpFrac) : FRAC_ONE;
    r.lastSeenTick = u.lastSeenTick;
    return this.addKnownRaw(r);
  }

  addEvent(e: PerceptionEvent): this {
    if (e.kind !== 'ownDamaged') return this.addEventRaw(e);
    return this.addEventRaw({ kind: e.kind, tick: e.tick, unit: e.unit, attacker: e.attacker, attackerBp: e.attackerBp, amountMilli: ecoRaw('amount', e.amount) });
  }

  /**
   * Finishes the snapshot. Returns a view into the writer's output buffer, valid until the next
   * `finish()` — copy (`slice()`) to keep or transfer it.
   */
  finish(): Uint8Array {
    this.ensureOpen();
    const total = HEADER_BYTES + this.own.len + this.known.len + this.events.len;
    const out = this.out;
    out.len = 0;
    out.alloc(total);
    const dv = out.dv;
    dv.setUint32(H_MAGIC, PERCEPTION_MAGIC, true);
    dv.setUint16(H_VERSION, PERCEPTION_VERSION, true);
    dv.setUint8(H_ARMY, this.army);
    dv.setUint32(H_TICK, this.tick, true);
    dv.setUint32(H_OWN, this.ownCount, true);
    dv.setUint32(H_KNOWN, this.knownCount, true);
    dv.setUint32(H_EVENTS, this.eventCount, true);
    dv.setUint32(H_TOTAL, total, true);
    for (let i = 0; i < ECO_FIELDS.length; i++) dv.setInt32(H_ECO + 4 * i, this.eco[i]!, true);
    let p = HEADER_BYTES;
    out.bytes.set(this.own.bytes.subarray(0, this.own.len), p);
    p += this.own.len;
    out.bytes.set(this.known.bytes.subarray(0, this.known.len), p);
    p += this.known.len;
    out.bytes.set(this.events.bytes.subarray(0, this.events.len), p);
    this.open = false;
    return out.bytes.subarray(0, total);
  }
}
