/**
 * Perception writer of the arena: contents, not cheating by construction (AI-PERC-01, AI-PERC-02
 * arena part, AI-PERC-03 arena part) and AiStatic from the match setup.
 */
import { describe, expect, it } from 'vitest';
import { OrderKind, PerceptionWriter, SnapshotPerception, readSnapshotHeader, type PerceptionView } from '@faf/ai';
import { ArenaPerceiver, ArenaWorld, buildArenaStatic, writePerception } from '../../src/index.ts';
import { Cmds, localFrame, run, runUntil, setonsWorld } from '../world/support.ts';

const TANK = 'core:lnd_t1_tank';
const ENG = 'core:lnd_t1_engineer';
const MEX = 'core:str_t1_mex';
const FAC = 'core:str_t1_fac_land';
const PGEN = 'core:str_t1_pgen';

/** A small own base: factory, two generators, two ring mex, one engineer. */
function base(w: ArenaWorld): void {
  const at = localFrame(w, 0, 1);
  const f = at(12, 0);
  w.spawn(0, FAC, f.x, f.z);
  const g1 = at(12, 5);
  const g2 = at(12, -5);
  w.spawn(0, PGEN, g1.x, g1.z);
  w.spawn(0, PGEN, g2.x, g2.z);
  w.spawn(0, MEX, 338, 678);
  w.spawn(0, MEX, 354, 662);
  const e = at(-4, 4);
  w.spawn(0, ENG, e.x, e.z);
}

function bytesAt(w: ArenaWorld, army: number): Uint8Array {
  return writePerception(w, army, w.tick, new PerceptionWriter()).slice();
}

describe('arena perception', () => {
  it('writes own units with their orders, factory and upgrade state, and consumes events', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1);
    const fp = at(12, 0);
    const fac = w.spawn(0, FAC, fp.x, fp.z);
    const e = w.spawn(0, ENG, at(0, 6).x, at(0, 6).z);
    const mex = w.spawn(0, MEX, 338, 678);
    const pg = at(-10, -8);
    w.addIncome(0, 50, 500);
    w.step([
      c.build(0, [e], w.bpIndex(PGEN), pg.x, pg.z),
      c.factoryQueue(0, [fac], w.bpIndex(ENG), 3, false),
      c.factoryRepeat(0, [fac], [w.bpIndex(TANK)]),
      c.upgrade(0, [mex], w.bpIndex('core:str_t2_mex')),
    ]);
    run(w, 30);
    const p = new ArenaPerceiver(w, 0);
    const view = p.perceive(w.tick);
    const own = new Map<number, { order: number; orderTarget: number; orderBp: number; factoryBp: number; queueLength: number; factoryRepeat: boolean; upgradingTo: number; complete: boolean }>();
    view.forEachOwn(null, (u) => own.set(u.handle, { ...u }));
    expect(view.ownCount).toBe(4); // commander, factory, engineer, mex (+ site = 5?)
    const eng = own.get(e)!;
    expect(eng.order).toBe(OrderKind.Build);
    expect(eng.orderBp).toBe(w.bpIndex(PGEN));
    expect(eng.orderTarget).toBe(0); // still walking, no site yet
    const f = own.get(fac)!;
    expect(f.factoryBp).toBe(w.bpIndex(ENG));
    expect(f.queueLength).toBe(2);
    expect(f.factoryRepeat).toBe(true);
    expect(own.get(mex)!.upgradingTo).toBe(w.bpIndex('core:str_t2_mex'));
    expect(own.get(mex)!.order).toBe(OrderKind.Upgrade);
    // site placed later: orderTarget = site handle, site reported incomplete
    runUntil(w, () => w.unit(e)!.orders[0]?.site !== 0, 300);
    run(w, 1);
    const v2 = p.perceive(w.tick);
    let site = -1;
    v2.forEachOwn(null, (u) => {
      if (u.handle === e) site = u.orderTarget;
    });
    expect(site).toBe(w.unit(e)!.orders[0]!.site);
    let siteFrac = -1;
    v2.forEachOwn(null, (u) => {
      if (u.handle === site) siteFrac = u.complete ? 2 : u.buildFrac;
    });
    expect(siteFrac).toBeGreaterThan(0);
    expect(siteFrac).toBeLessThan(1);
    // events were consumed by the first perception
    const events: string[] = [];
    v2.forEachEvent((ev) => events.push(ev.kind));
    expect(events).not.toContain('commandRejected');
    expect(w.events[0]!.length).toBe(0);
  });

  it('AI-PERC-01: a hidden enemy next to the base does not change the perception bytes', () => {
    const plain = setonsWorld(3);
    const hidden = setonsWorld(3);
    base(plain);
    base(hidden);
    const at = localFrame(hidden, 0, 1);
    // 45 WU to the side of the base: outside every own vision radius (commander 26, structures 12)
    const hp = at(0, -45);
    const h = hidden.spawn(1, TANK, hp.x, hp.z);
    for (let i = 0; i < 60; i++) {
      plain.step([]);
      hidden.step([]);
      if (i % 5 === 4) expect(bytesAt(hidden, 0)).toEqual(bytesAt(plain, 0));
    }
    expect(hidden.unit(h)!.seenMask & 1).toBe(0);
    const hdr = readSnapshotHeader(bytesAt(hidden, 0));
    expect(hdr.known).toBe(0);
  });

  it('AI-PERC-03 (arena part): the enemy energy store does not change the perception bytes', () => {
    const mk = (energy: number): ArenaWorld => {
      const w = setonsWorld(5);
      const e1 = w.startOf(1);
      const e0 = w.startOf(0);
      const dx = e0.x - e1.x;
      const dz = e0.z - e1.z;
      const l = Math.sqrt(dx * dx + dz * dz);
      // own scout 24 WU from the enemy commander: sees it (vision 26), out of its range (22)
      w.spawn(0, 'core:lnd_t1_scout', e1.x + (dx / l) * 24, e1.z + (dz / l) * 24);
      w.setStorage(1, 650, energy);
      return w;
    };
    const empty = mk(0);
    const full = mk(3900);
    run(empty, 40);
    run(full, 40);
    const a = bytesAt(empty, 0);
    const b = bytesAt(full, 0);
    expect(readSnapshotHeader(a).known).toBeGreaterThan(0);
    expect(a).toEqual(b);
    expect(empty.eco.energyStoredMilli(1)).not.toBe(full.eco.energyStoredMilli(1));
  });

  it('AI-PERC-02 (arena part): a hidden enemy extractor on an own spot is unknown until seen, then a ghost', () => {
    const spot = { x: 354, z: 728 };
    const mk = (withEnemyMex: boolean): { w: ArenaWorld; view: () => PerceptionView } => {
      const w = setonsWorld(9);
      if (withEnemyMex) w.spawn(1, MEX, spot.x, spot.z);
      const p = new ArenaPerceiver(w, 0);
      return { w, view: () => p.perceive(w.tick) };
    };
    const a = mk(false);
    const b = mk(true);
    run(a.w, 2);
    run(b.w, 2);
    const va = a.view();
    const vb = b.view();
    const mexBp = a.w.bpIndex(MEX);
    expect(vb.freeMassSpots().map((s) => s.index)).toEqual(va.freeMassSpots().map((s) => s.index));
    expect(vb.canPlace(mexBp, spot.x, spot.z, 0)).toBe(true);
    expect(va.canPlace(mexBp, spot.x, spot.z, 0)).toBe(true);
    // the truth rejects it
    expect(b.w.canPlace(mexBp, spot.x, spot.z, 0)).toBe(false);
    // an engineer is sent there, sees the extractor (ghost), the build is rejected
    const c = new Cmds();
    const v = b.w.commander(0)!;
    const e = b.w.spawn(0, ENG, v.x + 2, v.z);
    const cmd = c.build(0, [e], mexBp, spot.x, spot.z);
    b.w.step([cmd]);
    runUntil(b.w, () => b.w.unit(e)!.orders.length === 0, 600);
    run(b.w, 2);
    const after = b.view();
    const kinds: string[] = [];
    after.forEachKnownEnemy(null, (k) => kinds.push(k.kind));
    expect(kinds).toEqual(['visible']);
    const rejected: number[] = [];
    after.forEachEvent((ev) => {
      if (ev.kind === 'commandRejected') rejected.push(ev.seq);
    });
    expect(rejected).toEqual([cmd.seq]);
    expect(after.freeMassSpots().some((s) => s.x === spot.x && s.z === spot.z)).toBe(false);
    expect(after.canPlace(mexBp, spot.x, spot.z, 0)).toBe(false);
    // walk away: it stays known as a ghost
    const home = b.w.startOf(0);
    b.w.step([c.move(0, [e], home.x + 3, home.z)]);
    runUntil(b.w, () => b.w.unit(e)!.orders.length === 0, 600);
    run(b.w, 2);
    const later = b.view();
    const ghost: string[] = [];
    later.forEachKnownEnemy(null, (k) => ghost.push(k.kind));
    expect(ghost).toEqual(['ghost']);
    expect(later.canPlace(mexBp, spot.x, spot.z, 0)).toBe(false);
  });

  it('buildArenaStatic: starts of the map, armyStart/activeArmies from the match setup', () => {
    const w = ArenaWorld.create({
      map: 'setons',
      seed: 11,
      armies: [
        { army: 0, startIndex: 2 },
        { army: 3, startIndex: 5 },
      ],
    });
    const s = buildArenaStatic(w, 3);
    expect(s.army).toBe(3);
    expect(s.gameSeed).toBe(11);
    expect(s.starts.length).toBe(8);
    expect(s.armyStart[0]).toBe(2);
    expect(s.armyStart[3]).toBe(5);
    expect(s.armyStart[1]).toBe(-1);
    expect(s.activeArmies).toEqual([0, 3]);
    expect(s.map.mapClass).toBe('setons');
    expect(s.passDim).toBe(512);
    expect(w.commander(3)!.x).toBe(s.starts[5]!.x);
    // perceptions carry only the own army
    const view = new SnapshotPerception(s, bytesAt(w, 3));
    expect(view.army).toBe(3);
    expect(view.ownCount).toBe(1);
    expect(() => writePerception(w, 3, w.tick + 1, new PerceptionWriter())).toThrow();
  });
});
