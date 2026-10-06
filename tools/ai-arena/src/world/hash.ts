/**
 * Canonical state dump of the arena world and its xxHash32 (@faf/fixed) for determinism tests: two
 * runs with the same setup, cheats and command log must produce the same bytes. Order: header,
 * armies ascending, units in slot order (with their orders, factory and upgrade state), ghosts per
 * army in insertion order, cheat flows, blocked cells. Floats are written as f64 (bit-exact).
 * Event queues are not part of the state (reading the perception consumes them; a replay without
 * AI must hash equal to the original run).
 */
import { xxHash32 } from '@faf/fixed';
import type { ArenaUnit } from './unit.ts';

/**
 * What the dump reads from the world (structural, so this module does not import world.ts — which
 * imports it for `hash()`; tai-p5 removed the import cycle flagged by dep-cruiser).
 */
export interface HashableWorld {
  readonly tick: number;
  readonly seed: number;
  readonly over: boolean;
  readonly winner: number;
  readonly lastVisionTick: number;
  readonly armies: readonly number[];
  readonly defeated: readonly boolean[];
  readonly eco: {
    massStoredMilli(army: number): number;
    energyStoredMilli(army: number): number;
    massCapacityMilli(army: number): number;
    energyCapacityMilli(army: number): number;
  };
  readonly slots: readonly (ArenaUnit | null)[];
  readonly ghosts: readonly ReadonlyMap<number, { readonly handle: number; readonly bp: number; readonly x: number; readonly z: number; readonly lastSeen: number; readonly stale: boolean }>[];
  cheatFlows(): {
    readonly demands: readonly { readonly id: number; readonly army: number; readonly mass: number; readonly energy: number }[];
    readonly incomes: readonly { readonly id: number; readonly army: number; readonly mass: number; readonly energy: number }[];
    readonly blocked: Uint8Array;
  };
}

class DumpWriter {
  buf = new Uint8Array(4096);
  dv = new DataView(this.buf.buffer);
  len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }

  i32(v: number): void {
    this.ensure(4);
    this.dv.setInt32(this.len, v | 0, true);
    this.len += 4;
  }

  u32(v: number): void {
    this.ensure(4);
    this.dv.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }

  f64(v: number): void {
    this.ensure(8);
    this.dv.setFloat64(this.len, v, true);
    this.len += 8;
  }

  bool(v: boolean): void {
    this.i32(v ? 1 : 0);
  }
}

/** Canonical byte dump of the world state. */
export function dumpWorld(w: HashableWorld): Uint8Array {
  const d = new DumpWriter();
  d.u32(0x41524e41); // 'ARNA'
  d.u32(w.tick);
  d.u32(w.seed);
  d.bool(w.over);
  d.i32(w.winner);
  d.i32(w.lastVisionTick);
  for (const a of w.armies) {
    d.i32(a);
    d.bool(w.defeated[a] === true);
    d.f64(w.eco.massStoredMilli(a));
    d.f64(w.eco.energyStoredMilli(a));
    d.f64(w.eco.massCapacityMilli(a));
    d.f64(w.eco.energyCapacityMilli(a));
  }
  d.u32(w.slots.length);
  for (const u of w.slots) {
    if (u === null || !u.alive) {
      d.i32(-1);
      continue;
    }
    d.u32(u.handle);
    d.i32(u.army);
    d.i32(u.bp.index);
    d.f64(u.x);
    d.f64(u.z);
    d.f64(u.hp);
    d.bool(u.complete);
    d.f64(u.buildDone);
    d.i32(u.target);
    d.i32(u.seenMask);
    d.i32(u.lastDamagedTick);
    d.i32(u.kranz);
    // holdFire (scenario cheat) only when set: dumps of runs without it stay unchanged.
    if (u.holdFire) d.i32(-7);
    d.i32(u.orders.length);
    for (const o of u.orders) {
      d.i32(o.kind);
      d.f64(o.x);
      d.f64(o.z);
      d.u32(o.target);
      d.i32(o.bp);
      d.u32(o.site);
      d.i32(o.seq);
      d.f64(o.px);
      d.f64(o.pz);
    }
    d.i32(u.path === null ? -1 : u.path.length);
    d.i32(u.pathIdx);
    d.i32(u.prodBp);
    d.f64(u.prodDone);
    d.i32(u.queueBp.length);
    for (let i = 0; i < u.queueBp.length; i++) {
      d.i32(u.queueBp[i]!);
      d.i32(u.queueCount[i]!);
    }
    d.i32(u.repeat.length);
    for (const r of u.repeat) d.i32(r);
    d.i32(u.repeatIdx);
    d.i32(u.rolloff.length);
    for (const r of u.rolloff) {
      d.i32(r.bp);
      d.i32(r.ticksLeft);
    }
    d.bool(u.hasRally);
    d.f64(u.rallyX);
    d.f64(u.rallyZ);
    d.i32(u.upgradeBp);
    d.f64(u.upgradeDone);
  }
  for (const a of w.armies) {
    const gm = w.ghosts[a]!;
    d.i32(gm.size);
    for (const g of gm.values()) {
      d.u32(g.handle);
      d.i32(g.bp);
      d.f64(g.x);
      d.f64(g.z);
      d.i32(g.lastSeen);
      d.bool(g.stale);
    }
  }
  const flows = w.cheatFlows();
  for (const f of flows.demands) {
    d.i32(f.id);
    d.i32(f.army);
    d.f64(f.mass);
    d.f64(f.energy);
  }
  for (const f of flows.incomes) {
    d.i32(f.id);
    d.i32(f.army);
    d.f64(f.mass);
    d.f64(f.energy);
  }
  let blocked = 0;
  for (let i = 0; i < flows.blocked.length; i++) if (flows.blocked[i] === 1) blocked = (Math.imul(blocked, 31) + i) | 0;
  d.i32(blocked);
  return d.buf.slice(0, d.len);
}

/** xxHash32 (seed 0) of the canonical dump. */
export function worldHash(w: HashableWorld): number {
  const b = dumpWorld(w);
  return xxHash32(b, 0, b.length, 0);
}
