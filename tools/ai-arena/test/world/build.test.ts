/**
 * Building, assist, upgrades, factories and flow stall of the arena world (tai-p2).
 */
import { describe, expect, it } from 'vitest';
import { OrderKind } from '@faf/ai';
import { Op } from '@faf/protocol';
import { ArenaWorld } from '../../src/index.ts';
import { Cmds, localFrame, run, runUntil, setonsWorld } from './support.ts';

const FAC = 'core:str_t1_fac_land';
const FAC2 = 'core:str_t2_fac_land';
const PGEN = 'core:str_t1_pgen';
const MEX = 'core:str_t1_mex';
const MEX2 = 'core:str_t2_mex';
const ENG = 'core:lnd_t1_engineer';
const TANK = 'core:lnd_t1_tank';

describe('arena world: building', () => {
  it('commander builds Landwerk I at slot fac1 (eco_standard step 1) ≈ ecosim 31.8 s ± 2 s', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1)(12, 0);
    const vogt = w.commander(0)!;
    const fac = w.bpIndex(FAC);
    expect(w.canPlace(fac, at.x, at.z, 0)).toBe(true);
    // AI think at tick 0 → command applied at tick 0 + lead 3
    run(w, 3);
    w.step([c.build(0, [vogt.handle], fac, at.x, at.z)]);
    const t = runUntil(w, () => w.unitsOf(0).some((u) => u.info.isFactory && u.complete), 600);
    expect(Math.abs(t / 10 - 31.8)).toBeLessThanOrEqual(2);
    // 300 bt / 10 BP = 30 s from the command at tick 3; the commander stands within reach
    expect(t).toBe(303);
    expect(w.eco.statsOf(0).consumedMassMilli).toBe(240_000);
    expect(w.eco.statsOf(0).consumedEnergyMilli).toBe(2_100_000);
    run(w, 1);
    expect(w.ecoOf(0).massCapacity).toBe(650 + 80);
    const events = w.events[0]!.filter((x) => x.kind === 'ownCompleted');
    expect(events.length).toBe(1);
  });

  it('assist with equal build power halves the build time (± 1 tick)', () => {
    const timeWith = (assist: boolean): number => {
      const w = setonsWorld();
      const c = new Cmds();
      const at = localFrame(w, 0, 1)(-10, -8);
      const e1 = w.spawn(0, ENG, at.x + 1, at.z + 1);
      const e2 = w.spawn(0, ENG, at.x - 1, at.z + 1);
      w.setStorage(0, 650, 3900);
      const pgen = w.bpIndex(PGEN);
      w.step([c.build(0, [e1], pgen, at.x, at.z)]);
      const start = w.tick;
      if (assist) {
        const site = w.unit(e1)!.orders[0]!.site;
        expect(site).not.toBe(0);
        w.step([c.target(0, Op.Assist, [e2], site)]);
      }
      const t = runUntil(w, () => w.unitsOf(0).some((u) => u.bp.id === PGEN && u.complete), 1000);
      return t - start;
    };
    const alone = timeWith(false);
    const both = timeWith(true);
    // 125 bt / 5 BP = 25 s alone
    expect(Math.abs(alone - 250)).toBeLessThanOrEqual(1);
    expect(Math.abs(both - alone / 2)).toBeLessThanOrEqual(1);
  });

  it('a site survives its builder and is finished by an assisting engineer', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1)(-10, -8);
    const e1 = w.spawn(0, ENG, at.x + 1, at.z);
    const e2 = w.spawn(0, ENG, at.x - 1, at.z);
    w.step([c.build(0, [e1], w.bpIndex(PGEN), at.x, at.z)]);
    run(w, 50);
    const site = w.unit(e1)!.orders[0]!.site;
    const done = w.unit(site)!.buildDone;
    expect(done).toBeGreaterThan(0.15);
    w.kill(e1);
    run(w, 20);
    expect(w.unit(site)!.buildDone).toBe(done);
    w.step([c.target(0, Op.Assist, [e2], site)]);
    runUntil(w, () => w.unit(site)?.complete === true, 400);
    expect(w.unit(site)!.complete).toBe(true);
    // the finite assist ends with the site
    run(w, 2);
    expect(w.unit(e2)!.orders.length).toBe(0);
  });

  it('builds cost exactly the blueprint price through the flow economy', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1)(-10, -8);
    const e1 = w.spawn(0, ENG, at.x + 1, at.z);
    w.setStorage(0, 20, 3900);
    w.step([c.build(0, [e1], w.bpIndex(PGEN), at.x, at.z)]);
    // mass-stalled most of the time (1 M/s income against 3 M/s demand)
    runUntil(w, () => w.unitsOf(0).some((u) => u.bp.id === PGEN && u.complete), 2000);
    const st = w.eco.statsOf(0);
    expect(st.consumedMassMilli).toBe(75_000);
    expect(st.consumedEnergyMilli).toBe(750_000);
    expect(st.shortfallMassMilli).toBe(0);
    expect(st.massStallTicks).toBeGreaterThan(100);
  });

  it('commandRejected (placement) for a blocked site and for a spot occupied in the fog', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1)(4, 13);
    const vogt = w.commander(0)!;
    const fac = w.bpIndex(FAC);
    expect(w.canPlace(fac, at.x, at.z, 0)).toBe(true);
    w.blockCells(at.x - 1, at.z - 1, at.x + 1, at.z + 1);
    expect(w.canPlace(fac, at.x, at.z, 0)).toBe(false);
    const cmd = c.build(0, [vogt.handle], fac, at.x, at.z);
    w.step([cmd]);
    const rej = w.events[0]!.filter((e) => e.kind === 'commandRejected');
    expect(rej).toEqual([{ kind: 'commandRejected', tick: 0, seq: cmd.seq, reason: 'placement', unit: vogt.handle }]);
    expect(vogt.orders.length).toBe(0);
  });

  it('late rejection: the place is taken after the order was given', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const spot = w.map.spots.find((s) => s.kind === 'mass' && Math.abs(s.x - 354) < 1 && Math.abs(s.z - 728) < 1)!;
    const v = w.commander(0)!;
    const eng = w.unit(w.spawn(0, ENG, v.x + 2, v.z))!;
    const cmd = c.build(0, [eng.handle], w.bpIndex(MEX), spot.x, spot.z);
    w.step([cmd]);
    expect(eng.orders[0]?.kind).toBe(OrderKind.Build);
    // enemy mex appears on the spot while the (unarmed) engineer walks there
    w.spawn(1, MEX, spot.x, spot.z);
    runUntil(w, () => eng.orders.length === 0, 600);
    const rej = w.events[0]!.filter((e) => e.kind === 'commandRejected');
    expect(rej.length).toBe(1);
    expect(rej[0]).toMatchObject({ reason: 'placement', seq: cmd.seq });
  });

  it('in-place upgrade Zapfstelle I → II keeps producing mass; Landwerk I → II pauses production', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const spot = w.map.spots.find((s) => s.kind === 'mass' && s.x === 338 && s.z === 678)!;
    const mex = w.spawn(0, MEX, spot.x, spot.z);
    w.addIncome(0, 20, 500);
    const t0 = w.tick;
    w.step([c.upgrade(0, [mex], w.bpIndex(MEX2))]);
    const u = w.unit(mex)!;
    expect(u.upgradeBp).toBe(w.bpIndex(MEX2));
    run(w, 10);
    expect(w.income[0]!.mass).toBe(1 + 2 + 20); // commander 1 + mex T1 2 while upgrading + cheat 20
    runUntil(w, () => u.upgradeBp < 0, 2000);
    // 900 bt / 10 BP = 90 s
    expect(u.bp.id).toBe(MEX2);
    expect(Math.abs(w.tick - t0 - 900)).toBeLessThanOrEqual(1);
    run(w, 1);
    expect(w.income[0]!.mass).toBe(1 + 6 + 20);
    const done = w.events[0]!.filter((e) => e.kind === 'ownCompleted' && e.unit === mex);
    expect(done.length).toBe(1);

    const at = localFrame(w, 0, 1)(12, 0);
    const fac = w.spawn(0, FAC, at.x, at.z);
    w.addIncome(0, 200, 5000);
    w.step([c.factoryRepeat(0, [fac], [w.bpIndex(TANK)])]);
    run(w, 20);
    const f = w.unit(fac)!;
    expect(f.prodBp).toBe(w.bpIndex(TANK));
    const prog = f.prodDone;
    w.step([c.upgrade(0, [fac], w.bpIndex(FAC2))]);
    run(w, 30);
    expect(f.prodDone).toBe(prog);
    runUntil(w, () => f.upgradeBp < 0, 3000);
    expect(f.bp.id).toBe(FAC2);
    run(w, 5);
    expect(f.prodDone).toBeGreaterThan(prog);
  });

  it('factory queue + repeat + roll-off 2 s + rally', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1)(12, 0);
    const rally = localFrame(w, 0, 1)(45, 0);
    const fac = w.spawn(0, FAC, at.x, at.z);
    w.addIncome(0, 100, 1000);
    const eng = w.bpIndex(ENG);
    const tank = w.bpIndex(TANK);
    w.step([c.rally(0, [fac], rally.x, rally.z), c.factoryQueue(0, [fac], eng, 2, false), c.factoryRepeat(0, [fac], [tank])]);
    const spawned: { tick: number; bp: string }[] = [];
    w.observers.push({
      onCompleted: (_w, u, how, tick) => {
        if (how === 'produced') spawned.push({ tick, bp: u.bp.id });
      },
    });
    runUntil(w, () => spawned.length >= 4, 2000);
    // engineer: 260 bt / 20 BP = 13 s, + 2 s roll-off; the next item starts right after completion
    expect(spawned.map((s) => s.bp)).toEqual([ENG, ENG, TANK, TANK]);
    expect(spawned[0]!.tick).toBe(130 + 20);
    expect(spawned[1]!.tick - spawned[0]!.tick).toBe(130);
    expect(spawned[2]!.tick - spawned[1]!.tick).toBe(150);
    // units walk to the rally point
    run(w, 400);
    const units = w.unitsOf(0).filter((u) => u.bp.id === ENG);
    for (const u of units) expect(Math.sqrt((u.x - rally.x) ** 2 + (u.z - rally.z) ** 2)).toBeLessThan(1);
    const f = w.unit(fac)!;
    expect(f.repeat).toEqual([tank]);
    expect(f.prodBp).toBe(tank);
  });

  it('flow stall: building without energy progresses at the stall ratio', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1)(12, 0);
    const vogt = w.commander(0)!;
    w.setStorage(0, 650, 0);
    w.step([c.build(0, [vogt.handle], w.bpIndex(FAC), at.x, at.z)]);
    run(w, 100);
    // demand 70 E/s against 20 E/s commander income ⇒ ratio ≈ 2/7
    const e = w.ecoOf(0);
    expect(e.energyRatio).toBeLessThan(0.3);
    expect(e.energyRatio).toBeGreaterThan(0.25);
    const site = w.unitsOf(0).find((u) => u.info.isFactory)!;
    expect(site.buildDone).toBeGreaterThan(0.08);
    expect(site.buildDone).toBeLessThan(0.1);
    expect(w.eco.reportOf(0).energyStallPct).toBeGreaterThan(90);
  });

  it('rejects malformed, foreign, dead-unit, unbuildable and reclaim commands', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const v0 = w.commander(0)!;
    const v1 = w.commander(1)!;
    const bad = c.raw(0, Op.Build, [v0.handle], new Uint8Array(3));
    const foreign = c.move(0, [v1.handle], 10, 10);
    const tankOrder = c.build(0, [v0.handle], w.bpIndex(TANK), v0.x, v0.z);
    const reclaim = c.target(0, Op.Reclaim, [v0.handle], v1.handle);
    const cheat = c.raw(0, Op.Cheat, [v0.handle], new Uint8Array([1]));
    w.step([bad, foreign, tankOrder, reclaim, cheat]);
    const reasons = w.events[0]!.filter((e) => e.kind === 'commandRejected').map((e) => (e.kind === 'commandRejected' ? e.reason : ''));
    expect(reasons).toEqual(['malformed', 'notOwner', 'notBuildable', 'noTarget', 'unknownOp']);
    const e = w.spawn(0, ENG, v0.x + 3, v0.z);
    w.kill(e);
    w.step([c.move(0, [e], 1, 1)]);
    expect(w.events[0]!.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'invalidUnit' });
  });

  it('shift queue appends, a plain order replaces', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const v = w.commander(0)!;
    w.step([c.move(0, [v.handle], v.x + 20, v.z), c.move(0, [v.handle], v.x + 20, v.z + 20, true)]);
    expect(v.orders.length).toBe(2);
    w.step([c.move(0, [v.handle], v.x - 5, v.z)]);
    expect(v.orders.length).toBe(1);
  });

  it('overcharge needs 7,500 E stored', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const v = w.commander(0)!;
    const tank = w.spawn(1, TANK, v.x + 10, v.z);
    run(w, 2);
    w.step([c.target(0, Op.Overcharge, [v.handle], tank)]);
    expect(w.events[0]!.at(-1)).toMatchObject({ kind: 'commandRejected', reason: 'noEnergy' });
    const est = w.spawn(0, 'core:str_t1_estore', v.x - 10, v.z - 10);
    expect(est).toBeGreaterThan(0);
    run(w, 1);
    w.setStorage(0, 650, 9000);
    w.step([c.target(0, Op.Overcharge, [v.handle], tank)]);
    run(w, 2);
    expect(w.unit(tank)).toBeNull();
    expect(w.eco.energyStoredMilli(0)).toBeLessThan(9000_000 - 6 * 1250_000 + 100_000);
  });
});

describe('arena world: handles', () => {
  it('handles are index:20|gen:12 with a FIFO freelist and never 0', () => {
    const w = setonsWorld();
    const a = w.spawn(0, TANK, 300, 300);
    const b = w.spawn(0, TANK, 302, 300);
    expect(a).not.toBe(0);
    w.kill(a);
    w.kill(b);
    const c = w.spawn(0, TANK, 300, 300);
    // FIFO: a's slot comes back first with generation + 1
    expect(c & 0xfffff).toBe(a & 0xfffff);
    expect(c >>> 20).toBe((a >>> 20) + 1);
    expect(w.unit(a)).toBeNull();
    expect(w.unit(c)).not.toBeNull();
  });

  it('world creation rejects bad setups', () => {
    expect(() => ArenaWorld.create({ map: 'setons', seed: 1, armies: [{ army: 0, startIndex: 99 }] })).toThrow();
    expect(() =>
      ArenaWorld.create({
        map: 'setons',
        seed: 1,
        armies: [
          { army: 0, startIndex: 0 },
          { army: 1, startIndex: 0 },
        ],
      }),
    ).toThrow();
  });
});
