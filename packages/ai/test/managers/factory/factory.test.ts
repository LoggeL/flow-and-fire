import { describe, expect, it } from 'vitest';
import { Xorshift32 } from '../../../src/index.ts';
import {
  applyCounters,
  baseMix,
  buildLoop,
  createFactoryManager,
  factoryManager,
  groupShares,
  resolveMix,
  type FactoryManager,
} from '../../../src/managers/factory/index.ts';
import { bpIndex, decoded, harness, ID, ofOp, Op, streamKey, T, doc } from '../platoon/harness.ts';
import { RoleTable } from '../../../src/index.ts';

const roles = new RoleTable(T, doc.roles);
const resolve = (role: string, tech: number) => roles.tryResolve(role, tech);

function mixOf(m: FactoryManager, fac: number): Record<string, number> {
  return groupShares(m.lastMix.get(fac)!);
}

describe('mix tables (ai.md §5.4)', () => {
  it('T1 base mix normalised; T2 filler only while P_M < 20; roles resolve to the roster units', () => {
    const fac1 = T.byId(ID.fac)!;
    const t1 = resolveMix(baseMix(1, false, 10), fac1, T, resolve);
    expect(t1.map((e) => e.bp.id)).toEqual([ID.tank, ID.arty, ID.bot]);
    expect(groupShares(t1)['tank@1']).toBeCloseTo(45 / 85, 9);
    const air = resolveMix(baseMix(1, true, 10), fac1, T, resolve);
    expect(groupShares(air)['aa@1']).toBeCloseTo(15 / 100, 9);
    const fac2 = T.byId(ID.fac2)!;
    const low = groupShares(resolveMix(baseMix(2, false, 12), fac2, T, resolve));
    expect(low['tank@2']).toBeCloseTo(45 / 90, 9);
    expect(low['tank@1']).toBeCloseTo(15 / 90, 9);
    const high = groupShares(resolveMix(baseMix(2, false, 25), fac2, T, resolve));
    expect(high['tank@1']).toBeUndefined();
    expect(high['arty@2']).toBeCloseTo(20 / 75, 9);
    // a T1 factory cannot build the T2 entries
    expect(resolveMix(baseMix(2, false, 12), fac1, T, resolve).map((e) => e.bp.id)).toEqual([ID.tank, ID.bot]);
  });

  it('counter rules add up, clamp at 0, air rule raises the aa floor, Hard prediction +10 Meißel', () => {
    const m = baseMix(1, false, 10);
    applyCounters(m, ['bots', 'tanks'], false);
    expect(m.map((e) => e.share)).toEqual([45 + 20 + 5, 20 + 10 + 15, 20 - 10, 0]);
    const a = baseMix(1, true, 10);
    applyCounters(a, ['airStrike', 'shield'], false);
    expect(a.map((e) => e.share)).toEqual([60, 10, 20, 30]);
    const t2 = baseMix(2, false, 30);
    applyCounters(t2, [], true);
    expect(t2[0]!.share).toBe(55);
  });

  it('loop by largest deficit: stationary composition from zero, Ist shifts the picks', () => {
    const fac1 = T.byId(ID.fac)!;
    const mix = resolveMix(baseMix(1, false, 10), fac1, T, resolve);
    const rng = new Xorshift32(1);
    const loop = buildLoop(mix, [0, 0, 0], { rng, errorRate: 0, topK: 1 });
    expect(loop).toHaveLength(5);
    // mass shares 52.9 / 23.5 / 23.5 % with Punze 56, Kelle 36, Stichel 30 M
    expect(loop.map((b) => T.list[b]!.id)).toEqual([ID.tank, ID.arty, ID.bot, ID.tank, ID.bot]);
    // army full of tanks ⇒ the loop leans to artillery and bots
    const skew = buildLoop(mix, [56 * 20, 0, 0], { rng, errorRate: 0, topK: 1 });
    expect(skew.filter((b) => b === bpIndex(ID.tank)).length).toBeLessThan(3);
    // error rate draws from the given RNG stream only (deterministic)
    const e1 = buildLoop(mix, [0, 0, 0], { rng: new Xorshift32(7), errorRate: 0.5, topK: 3 });
    const e2 = buildLoop(mix, [0, 0, 0], { rng: new Xorshift32(7), errorRate: 0.5, topK: 3 });
    expect(e1).toEqual(e2);
  });
});

describe('FactoryManager', () => {
  it('AI-FAC-01: 12 visible enemy Stichel ⇒ next mix Punze ≥ 60 %, Kelle ≥ 25 % (Normal, one mix run later)', () => {
    const h = harness<FactoryManager>(factoryManager, { tick: 600 });
    const fac = h.world.addOwn(ID.fac, 140, 128);
    for (let i = 0; i < 12; i++) h.world.addEnemy(ID.bot, 300 + i * 2, 300);
    const rs = h.run(6); // factory runs at k even: ticks 600, 610, 620
    const m = h.manager();
    expect(m.counterApplied).toEqual(['bots']);
    const mix = mixOf(m, fac);
    expect(mix['tank@1']).toBeGreaterThanOrEqual(0.6);
    expect(mix['arty@1']).toBeGreaterThanOrEqual(0.25);
    // the first loop was the base mix, the second the countered one: exactly two FactoryRepeat
    const reps = rs.flatMap((r) => ofOp(r, Op.FactoryRepeat));
    expect(reps).toHaveLength(2);
    const last = reps[1]!.pl;
    if (last.op !== 'factoryRepeat') throw new Error('bad payload');
    const tankMass = last.value.items.filter((b) => b === bpIndex(ID.tank)).length * 56;
    const totalMass = last.value.items.reduce((s, b) => s + T.list[b]!.mass, 0);
    expect(tankMass / totalMass).toBeGreaterThanOrEqual(0.6);
  });

  it('Hard applies the counter table immediately; Easy ignores it', () => {
    const hard = harness<FactoryManager>(factoryManager, { tick: 600, difficulty: 'hard' });
    const f1 = hard.world.addOwn(ID.fac, 140, 128);
    for (let i = 0; i < 12; i++) hard.world.addEnemy(ID.bot, 300 + i * 2, 300);
    hard.run(3); // 600 (not reactable for Hard? delay 0 ⇒ reactable), 605, 610
    expect(mixOf(hard.manager(), f1)['tank@1']).toBeGreaterThanOrEqual(0.6);
    const easy = harness<FactoryManager>(factoryManager, { tick: 600, difficulty: 'easy' });
    const f2 = easy.world.addOwn(ID.fac, 140, 128);
    for (let i = 0; i < 12; i++) easy.world.addEnemy(ID.bot, 300 + i * 2, 300);
    easy.run(8);
    expect(easy.manager().counterApplied).toEqual([]);
    expect(mixOf(easy.manager(), f2)['tank@1']).toBeCloseTo(45 / 85, 9);
  });

  it('mix deficit uses the living army; the loop is rewritten only on a mix change', () => {
    const h = harness<FactoryManager>(factoryManager, { tick: 600 });
    const fac = h.world.addOwn(ID.fac, 140, 128);
    for (let i = 0; i < 8; i++) h.world.addOwn(ID.tank, 180 + i, 180);
    const rs = h.run(20);
    const reps = rs.flatMap((r) => ofOp(r, Op.FactoryRepeat));
    expect(reps).toHaveLength(1);
    const pl = reps[0]!.pl;
    if (pl.op !== 'factoryRepeat') throw new Error('bad payload');
    // 8 living Punzen ⇒ the loop starts with the lacking roles
    expect(pl.value.items[0]).not.toBe(bpIndex(ID.tank));
    expect(pl.value.items.filter((b) => b === bpIndex(ID.tank)).length).toBeLessThan(3);
    // rally once, P4
    expect(rs.flatMap((r) => ofOp(r, Op.SetRally))).toHaveLength(1);
    // mix changes: air contact ⇒ Sieb 15 %, one mix run later the air-strike rule (100 % of the
    // seen threat is a bomber) ⇒ Sieb 30 %: exactly two rewrites, then quiet
    h.world.addEnemy(ID.bomber, 300, 300);
    const more = h.run(20);
    expect(more.flatMap((r) => ofOp(r, Op.FactoryRepeat))).toHaveLength(2);
    expect(mixOf(h.manager(), fac)['aa@1']).toBeCloseTo(30 / 115, 9);
  });

  it('engineers first up to bb.engineerTarget (queued, counted across runs), then production requests', () => {
    const h = harness<FactoryManager>(factoryManager, { tick: 600 });
    const f1 = h.world.addOwn(ID.fac, 140, 128);
    const f2 = h.world.addOwn(ID.fac, 150, 128);
    h.world.addOwn(ID.eng, 130, 130);
    const bb = h.brain.blackboard;
    bb.engineerTarget = 4;
    bb.productionRequests.add((id) => ({ id, role: 'bot', tech: 1, count: 2, prio: 50, source: 'opening', createdTick: 0 }));
    const rs = h.run(12);
    const isEng = (c: ReturnType<typeof decoded>[number]) => c.pl.op === 'factoryQueue' && c.pl.value.bp === bpIndex(ID.eng);
    const q = rs.flatMap((r) => ofOp(r, Op.FactoryQueue));
    // one engineer per factory at a time: 1 alive + 2 in production, the 4th waits for a free factory
    const eng = q.filter(isEng);
    expect(eng).toHaveLength(2);
    expect(new Set(eng.map((c) => c.units[0]))).toEqual(new Set([f1, f2]));
    const req = q.filter((c) => c.pl.op === 'factoryQueue' && c.pl.value.bp === bpIndex(ID.bot));
    expect(req).toHaveLength(1);
    expect(req[0]!.pl.op === 'factoryQueue' && req[0]!.pl.value.count).toBe(2);
    expect(bb.productionRequests.size).toBe(0);
    // engineer orders go out in the same think before the loop of that factory
    const first = decoded(rs[0]!).filter((c) => c.units[0] === f1).map((c) => c.op);
    expect(first.indexOf(Op.FactoryQueue)).toBeLessThan(first.indexOf(Op.FactoryRepeat));
    // f1 finishes its engineer ⇒ exactly one more (target 4 reached), none after that
    const w = h.world;
    w.own(f1).factoryBp = -1;
    w.addOwn(ID.eng, 132, 130);
    const more = h.run(12).flatMap((r) => ofOp(r, Op.FactoryQueue)).filter(isEng);
    expect(more).toHaveLength(1);
    expect(more[0]!.units).toEqual([f1]);
  });

  it('scout: one living scout, replaced after a loss at most every 180 s', () => {
    const h = harness<FactoryManager>(factoryManager, { tick: 1800 });
    h.world.addOwn(ID.fac, 140, 128);
    const rs = h.run(10);
    const scouts = rs.flatMap((r) => ofOp(r, Op.FactoryQueue)).filter((c) => c.pl.op === 'factoryQueue' && c.pl.value.bp === bpIndex(ID.scout));
    expect(scouts).toHaveLength(1);
    // the scout never appears (e.g. lost in production): no second order within 180 s
    const w = h.world;
    w.own(w.ownHandles()[0]!).factoryBp = -1;
    w.own(w.ownHandles()[0]!).queueLength = 0;
    const more = h.run(400);
    const ticks = more
      .map((r) => ({ t: r.tick, n: ofOp(r, Op.FactoryQueue).filter((c) => c.pl.op === 'factoryQueue' && c.pl.value.bp === bpIndex(ID.scout)).length }))
      .filter((x) => x.n > 0);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.t).toBeGreaterThanOrEqual(1800 + 1800);
  });

  it('opening factories stay with the OpeningRunner until handoff (or 5:00); requests are still served', () => {
    const h = harness<FactoryManager>(factoryManager, { tick: 900 });
    const a = h.brain.analysis;
    const slot = a.slots.fac1!;
    const fac = h.world.addOwn(ID.fac, slot.x, slot.z);
    const bb = h.brain.blackboard;
    bb.opening.active = true;
    const rs = h.run(4);
    expect(rs.flatMap((r) => ofOp(r, Op.FactoryRepeat))).toHaveLength(0);
    bb.productionRequests.add((id) => ({ id, role: 'tank', tech: 1, count: 1, prio: 60, source: 'opening', createdTick: bb.tick }));
    const rq = h.run(2);
    expect(rq.flatMap((r) => ofOp(r, Op.FactoryQueue))).toHaveLength(1);
    bb.opening.handedOffFactories.push(fac);
    const after = h.run(2);
    expect(after.flatMap((r) => ofOp(r, Op.FactoryRepeat))).toHaveLength(1);
    expect(bb.reservations.unitOwner(fac)).toBe('factory');
  });

  it('rally moves to the staging point while a platoon holds it with R ≥ 1.0', () => {
    const h = harness<FactoryManager>(factoryManager, { tick: 600 });
    const fac = h.world.addOwn(ID.fac, 140, 128);
    const a = h.brain.analysis;
    h.run(2);
    const bb = h.brain.blackboard;
    bb.platoons = [{ id: 1, state: 'staging', units: [], x: a.staging.x, z: a.staging.z, ratio: 1.3, target: null, isFirstWave: true }];
    const rs = h.run(2);
    const r = rs.flatMap((x) => ofOp(x, Op.SetRally));
    expect(r).toHaveLength(1);
    expect(r[0]!.units).toEqual([fac]);
    expect(r[0]!.pl.op === 'position' && Math.round(r[0]!.pl.value.x)).toBe(Math.round(a.staging.x));
  });

  it('determinism and cursor: identical streams; a tiny budget spreads the survey over runs', () => {
    const run = (scale: number): string => {
      const h = harness<FactoryManager>(createFactoryManager(), { tick: 600 });
      h.world.addOwn(ID.fac, 140, 128);
      h.world.addOwn(ID.fac, 150, 128);
      for (let i = 0; i < 40; i++) h.world.addOwn(i % 2 === 0 ? ID.tank : ID.arty, 180 + i, 180);
      for (let i = 0; i < 12; i++) h.world.addEnemy(ID.bot, 300 + i * 2, 300);
      h.brain.blackboard.engineerTarget = 3;
      return streamKey(h.run(20, { thinkOptions: { budgetScale: scale } }));
    };
    expect(run(1)).toBe(run(1));
    const small = run(0.03); // 30 ops per factory run
    expect(small).toBe(run(0.03));
    expect(small.length).toBeGreaterThan(0);
  });
});
