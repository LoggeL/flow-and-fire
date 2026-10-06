import { describe, expect, it } from 'vitest';
import { CmdFlags, Op } from '@faf/protocol';
import { OrderKind, type AiBrain, type ManagerFactory } from '../../../src/index.ts';
import { EngineerManager, SPIRAL, TASK_ROLE_ACU_ONLY } from '../../../src/managers/engineer/index.ts';
import { FakeWorld, flatStatic, runThinks } from '../../../src/testing/index.ts';
import { COMMANDER_ID, T, bpOf, brainFor, builds, idOf, ofOp, streamKey, targetOf } from './build-support.ts';

const MASS = [
  { kind: 'mass' as const, x: 110, z: 64 },
  { kind: 'mass' as const, x: 114, z: 64 },
  { kind: 'mass' as const, x: 64, z: 112 },
  { kind: 'mass' as const, x: 64, z: 116 },
  { kind: 'mass' as const, x: 120, z: 110 },
  { kind: 'mass' as const, x: 124, z: 110 },
  { kind: 'mass' as const, x: 30, z: 40 },
  { kind: 'mass' as const, x: 34, z: 40 },
  { kind: 'mass' as const, x: 40, z: 100 },
  { kind: 'mass' as const, x: 100, z: 30 },
  { kind: 'mass' as const, x: 90, z: 90 },
  { kind: 'mass' as const, x: 94, z: 94 },
];

const managers = new WeakMap<AiBrain, EngineerManager>();

function engineerBrain(spots = MASS): AiBrain {
  let m: EngineerManager | null = null;
  const f: ManagerFactory = { name: 'engineer', create: (init) => (m = new EngineerManager(init)) };
  const brain = brainFor(flatStatic({ bps: T, sizeWu: 256, spots }), { managers: [f] });
  managers.set(brain, m!);
  return brain;
}

describe('EngineerManager – placement (ai.md §5.3)', () => {
  it('AI-ENG-02: a rejected place is re-planned by spiral search in the next think', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const eng = w.addOwn(idOf('eng'), 70, 70);
    bb.taskBoard.add({ kind: 'build', role: 'fac_land', tech: 1, site: 'slot:fac2', prio: 60, wanted: 1, source: 'economy', key: 'factory:fac2' }, 0);
    const [r1] = runThinks(brain, w, 1);
    const b1 = builds(r1!.commands);
    expect(b1).toHaveLength(1);
    expect(b1[0]!.bp).toBe(bpOf('fac_land'));
    const slot = brain.analysis.factorySlot(2);
    expect(Math.abs(b1[0]!.x - slot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(b1[0]!.z - slot.z)).toBeLessThanOrEqual(1);
    // The sim rejects (a wall appeared after the perception showed the place free).
    w.own(eng).order = OrderKind.Idle;
    w.event({ kind: 'commandRejected', tick: w.tick, seq: b1[0]!.seq, reason: 'placement', unit: eng });
    const rs = runThinks(brain, w, 2);
    const b2 = rs.flatMap((r) => builds(r.commands));
    expect(b2).toHaveLength(1);
    const dx = Math.abs(b2[0]!.x - b1[0]!.x);
    const dz = Math.abs(b2[0]!.z - b1[0]!.z);
    const fw = T.list[bpOf('fac_land')]!.footprint[0];
    // Not overlapping the rejected footprint, within the spiral radius (12 WU).
    expect(dx >= fw || dz >= fw).toBe(true);
    expect(Math.max(dx, dz)).toBeLessThanOrEqual(12);
    expect(SPIRAL).toHaveLength(24);
    expect(bb.taskBoard.byKey('factory:fac2')!.assigned).toEqual([eng]);
  });

  it('lost orders count as failures; three failures lock the place for 60 s', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const eng = w.addOwn(idOf('eng'), 70, 70);
    bb.taskBoard.add({ kind: 'build', role: 'pgen', tech: 1, site: 'slot:estore', prio: 70, wanted: 1, source: 'economy', key: 'x' }, 0);
    const first = builds(runThinks(brain, w, 1)[0]!.commands)[0]!;
    const seen: string[] = [`${first.x},${first.z}`];
    for (let i = 0; i < 6; i++) {
      // The order never shows up (e.g. dropped): the builder stays idle.
      w.own(eng).order = OrderKind.Idle;
      for (const r of runThinks(brain, w, 4, { apply: false })) for (const b of builds(r.commands)) seen.push(`${b.x},${b.z}`);
    }
    expect(bb.reservations.isSiteAvailable('slot:estore', w.tick)).toBe(false);
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});

describe('EngineerManager – safety (ai.md §5.3, R-06)', () => {
  it('AI-ENG-04: standing scouts ⇒ no flight, hunt requests; engineers keep building', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const e1 = w.addOwn(idOf('eng'), 105, 64);
    const e2 = w.addOwn(idOf('eng'), 64, 107);
    const e3 = w.addOwn(idOf('eng'), 118, 104);
    const s1 = w.addEnemy(idOf('scout'), 112, 70);
    const s2 = w.addEnemy(idOf('scout'), 70, 114);
    const s3 = w.addEnemy(idOf('scout'), 122, 104);
    for (let i = 0; i < 3; i++) bb.taskBoard.add({ kind: 'build', role: 'mex', tech: 1, site: 'mex:next', prio: 50, wanted: 1, source: 'economy', key: `mex:${i}` }, 0);
    const rs = runThinks(brain, w, 6);
    const all = rs.flatMap((r) => r.commands);
    expect(ofOp(all, Op.Move)).toHaveLength(0);
    const b = builds(all);
    expect(new Set(b.map((x) => x.unit))).toEqual(new Set([e1, e2, e3]));
    expect(bb.huntRequests.items.map((h) => h.target).sort((a, c) => a - c)).toEqual([s1, s2, s3].sort((a, c) => a - c));
    expect(bb.threat.threatAt('surface', 112, 70)).toBeLessThan(20);
  });

  it('T_surface ≥ 20 without cover ⇒ flight to a defended point, task back on the board, spot locked 30 s', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const fac = w.addOwn(idOf('fac_land'), 60, 60);
    const eng = w.addOwn(idOf('eng'), 106, 64);
    const task = bb.taskBoard.add({ kind: 'build', role: 'mex', tech: 1, site: 'mex:next', prio: 50, wanted: 1, source: 'economy', key: 'mex:0' }, 0);
    const [r1] = runThinks(brain, w, 1);
    const b = builds(r1!.commands)[0]!;
    const spot = brain.static.spots.find((s) => s.x === b.x && s.z === b.z)!;
    for (let i = 0; i < 3; i++) w.addEnemy(idOf('bot'), 108 + i, 70);
    const rs = runThinks(brain, w, 3);
    const moves = ofOp(rs.flatMap((r) => r.commands), Op.Move);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.units).toEqual([eng]);
    expect(task.state).toBe('open');
    expect(task.assigned).toEqual([]);
    expect(bb.reservations.isSpotAvailable(spot.index, w.tick)).toBe(false);
    expect(bb.reservations.isSpotAvailable(spot.index, w.tick + 300)).toBe(true);
    void fac;
  });
});

describe('EngineerManager – assignment, idle rule, repair (ai.md §5.3)', () => {
  it('base tasks only to builders within 80 WU unless 20 s old; the commander only takes base/@acu tasks', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const far = w.addOwn(idOf('eng'), 200, 30);
    bb.taskBoard.add({ kind: 'build', role: 'pgen', tech: 1, site: 'slot:eco', prio: 90, wanted: 1, source: 'economy', key: 'p' }, 0);
    let rs = runThinks(brain, w, 2);
    expect(rs.flatMap((r) => builds(r.commands))).toHaveLength(0);
    w.advance(200);
    rs = runThinks(brain, w, 1);
    expect(builds(rs[0]!.commands).map((b) => b.unit)).toEqual([far]);

    // Commander after the handoff: base task yes, expansion hydro no, @acu assist yes.
    const b2 = engineerBrain();
    const bb2 = b2.blackboard;
    bb2.reservations.handoverAcu('opening', 'engineer', 0);
    const w2 = new FakeWorld(b2.static);
    const acu = w2.addOwn(COMMANDER_ID, 64, 64);
    const fac = w2.addOwn(idOf('fac_land'), 76, 64, { upgradingTo: bpOf('fac_land', 2) });
    bb2.taskBoard.add({ kind: 'assist', role: TASK_ROLE_ACU_ONLY, target: fac, prio: 80, wanted: 1, source: 'tech', key: 'tech:acu' }, 0);
    const [r] = runThinks(b2, w2, 1);
    const assists = ofOp(r!.commands, Op.Assist);
    expect(assists.map((c) => [c.units[0], targetOf(c)])).toEqual([[acu, fac]]);
    void bb;
  });

  it('idle rule (R-G3): free engineers guard the nearest WORKING factory; with S_M/C_M ≥ 0.3 up to 4 assist a big site', () => {
    const brain = engineerBrain();
    const w = new FakeWorld(brain.static, { eco: { massStored: 50, massCapacity: 650 } });
    const idleFac = w.addOwn(idOf('fac_land'), 70, 70);
    const workingFac = w.addOwn(idOf('fac_land'), 90, 64, { factoryBp: bpOf('tank') });
    const engs = [0, 1, 2, 3, 4, 5].map((i) => w.addOwn(idOf('eng'), 72 + i, 72));
    const [r] = runThinks(brain, w, 1);
    const guards = ofOp(r!.commands, Op.Guard);
    expect(guards).toHaveLength(6);
    expect(new Set(guards.map((c) => targetOf(c)))).toEqual(new Set([workingFac]));
    void idleFac;

    const b2 = engineerBrain();
    const w2 = new FakeWorld(b2.static, { eco: { massStored: 400, massCapacity: 650 } });
    const fac = w2.addOwn(idOf('fac_land'), 90, 64, { factoryBp: bpOf('tank') });
    const site = w2.addOwn(idOf('fac_land'), 70, 90, { complete: false, buildFrac: 0.2 });
    for (let i = 0; i < 6; i++) w2.addOwn(idOf('eng'), 72 + i, 72);
    const [r2] = runThinks(b2, w2, 1);
    const assists = ofOp(r2!.commands, Op.Assist);
    expect(assists).toHaveLength(4);
    expect(new Set(assists.map((c) => targetOf(c)))).toEqual(new Set([site]));
    expect(ofOp(r2!.commands, Op.Guard).map((c) => targetOf(c))).toEqual([fac, fac]);
    void engs;
  });

  it('a board task preempts an idle job; guard is re-evaluated after 10 s', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const fac = w.addOwn(idOf('fac_land'), 90, 64, { factoryBp: bpOf('tank') });
    const eng = w.addOwn(idOf('eng'), 72, 72);
    runThinks(brain, w, 1);
    expect(managers.get(brain)!.jobOf(eng)?.kind).toBe('guard');
    bb.taskBoard.add({ kind: 'build', role: 'pgen', tech: 1, site: 'slot:eco', prio: 90, wanted: 1, source: 'economy', key: 'p' }, w.tick);
    const [r] = runThinks(brain, w, 1);
    expect(builds(r!.commands).map((b) => b.unit)).toEqual([eng]);
    expect(managers.get(brain)!.jobOf(eng)?.kind).toBe('build');
    void fac;
  });

  it('busy builder with ≤ 10 s left gets the next task queued behind its build', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const eng = w.addOwn(idOf('eng'), 72, 72);
    bb.taskBoard.add({ kind: 'build', role: 'pgen', tech: 1, site: 'slot:eco', prio: 90, wanted: 1, source: 'economy', key: 'a' }, 0);
    const b1 = builds(runThinks(brain, w, 1)[0]!.commands)[0]!;
    const site = w.addOwn(idOf('pgen'), b1.x, b1.z, { complete: false, buildFrac: 0.9 });
    w.own(eng).orderTarget = site;
    runThinks(brain, w, 1);
    bb.taskBoard.add({ kind: 'build', role: 'pgen', tech: 1, site: 'slot:eco', prio: 90, wanted: 1, source: 'economy', key: 'b' }, w.tick);
    const [r] = runThinks(brain, w, 1);
    const b2 = builds(r!.commands);
    expect(b2).toHaveLength(1);
    expect(b2[0]!.queued).toBe(true);
    expect(managers.get(brain)!.nextJobOf(eng)).not.toBeNull();
    // The site completes: the queued job becomes current.
    w.own(site).complete = true;
    w.own(site).buildFrac = 1;
    w.own(eng).order = OrderKind.Build;
    w.own(eng).orderBp = b2[0]!.bp;
    w.own(eng).orderX = b2[0]!.x;
    w.own(eng).orderZ = b2[0]!.z;
    w.own(eng).queueLength = 0;
    runThinks(brain, w, 2);
    expect(bb.taskBoard.byKey('a')).toBeUndefined();
    expect(managers.get(brain)!.jobOf(eng)?.x).toBe(b2[0]!.x);
  });

  it('repair tasks (prio 30) for structures < 70 % HP without enemies within 30 WU', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const pgen = w.addOwn(idOf('pgen'), 80, 64, { hpFrac: 0.5 });
    const eng = w.addOwn(idOf('eng'), 72, 72);
    const [r] = runThinks(brain, w, 1);
    const rep = ofOp(r!.commands, Op.Repair);
    expect(rep.map((c) => [c.units[0], targetOf(c)])).toEqual([[eng, pgen]]);
    w.own(pgen).hpFrac = 1;
    runThinks(brain, w, 2);
    expect(bb.taskBoard.byKey(`repair:${pgen}`)).toBeUndefined();
  });

  it('engineer target = min(cap(t) × engineerCapFactor, base + ⌈free spots / perFreeSpots⌉) + sink bonus', () => {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    runThinks(brain, w, 1);
    const fu = brain.opening!.followUp.engineers;
    let free = 0;
    for (const si of brain.analysis.spots) if (si.kind === 'mass' && (si.zone === 'own' || si.zone === 'contested')) free++;
    expect(bb.engineerTarget).toBe(Math.min(fu.cap[0]![1], fu.base + Math.ceil(free / fu.perFreeSpots)));
  });
});

describe('EngineerManager – budget cursor (AI-DET-02, unit part)', () => {
  function scenario(scale: number): { stream: string; brain: AiBrain; world: FakeWorld } {
    const brain = engineerBrain();
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    for (let i = 0; i < 8; i++) w.addOwn(idOf('eng'), 60 + 3 * i, 70);
    for (let i = 0; i < 8; i++) bb.taskBoard.add({ kind: 'build', role: 'mex', tech: 1, site: 'mex:next', prio: 50, wanted: 1, source: 'economy', key: `mex:${i}` }, 0);
    for (let i = 0; i < 4; i++) bb.taskBoard.add({ kind: 'build', role: 'pgen', tech: 1, site: 'slot:eco', prio: 90, wanted: 1, source: 'economy', key: `p:${i}` }, 0);
    const rs = runThinks(brain, w, 40, { thinkOptions: { budgetScale: scale } });
    return { stream: rs.map((r) => streamKey(r.commands)).join('#'), brain, world: w };
  }

  it('halved (and tiny) budget: the same orders later, no duplicates, two runs identical', () => {
    const full = scenario(1);
    const tinyA = scenario(0.04);
    const tinyB = scenario(0.04);
    expect(tinyA.stream).toBe(tinyB.stream);
    expect(scenario(0.5).stream).toBe(scenario(0.5).stream);
    for (const s of [full, tinyA]) {
      const bb = s.brain.blackboard;
      const tasks = bb.taskBoard.ordered();
      // Every engineer got exactly one build; no task has more builders than wanted.
      for (const t of tasks) expect(t.assigned.length).toBeLessThanOrEqual(t.wanted);
      const assigned = tasks.flatMap((t) => t.assigned);
      expect(new Set(assigned).size).toBe(assigned.length);
      expect(assigned).toHaveLength(8);
    }
    const count = (stream: string): number => stream.split(/[|#]/).filter((x) => x.split(':')[2] === String(Op.Build)).length;
    expect(count(tinyA.stream)).toBe(count(full.stream));
    // With the tiny budget the builds are spread over more thinks.
    const firstThinkBuilds = (stream: string): number => count(stream.split('#')[0]!);
    expect(firstThinkBuilds(tinyA.stream)).toBeLessThan(firstThinkBuilds(full.stream));
    void CmdFlags;
  });
});
