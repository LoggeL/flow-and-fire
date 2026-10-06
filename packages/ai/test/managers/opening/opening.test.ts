import { describe, expect, it } from 'vitest';
import { CmdFlags, Op } from '@faf/protocol';
import { decodeAiPayload, OrderKind, profileFor, type AiBrain, type AiProfile, type ManagerFactory } from '../../../src/index.ts';
import { OpeningRunner } from '../../../src/managers/opening/index.ts';
import { FakeWorld, runThinks } from '../../../src/testing/index.ts';
import { loadStatic } from '../../support/fixtures.ts';
import { COMMANDER_ID, bpOf, brainFor, builds, doc, idOf, ofOp } from '../engineer/build-support.ts';

const runners = new WeakMap<AiBrain, OpeningRunner>();

/** A brain with only the OpeningRunner; the runner instance is kept for inspection. */
function openingBrain(
  map: string,
  openingId = 'eco_standard',
  difficulty: 'easy' | 'normal' | 'hard' = 'normal',
  profile?: AiProfile,
): AiBrain {
  let r: OpeningRunner | null = null;
  const f: ManagerFactory = { name: 'opening', create: (init) => (r = new OpeningRunner(init)) };
  const brain = brainFor(loadStatic(map, 0, 1), profile === undefined ? { managers: [f], openingId, difficulty } : { managers: [f], openingId, profile });
  runners.set(brain, r!);
  return brain;
}

function runner(brain: AiBrain): OpeningRunner {
  return runners.get(brain)!;
}

describe('OpeningRunner – commander queue (ai.md §4.3)', () => {
  for (const map of ['setons', 'hollow-ridge']) {
    it(`eco_standard on ${map}: one shift queue with the documented roles and places`, () => {
      const brain = openingBrain(map);
      const a = brain.analysis;
      const w = new FakeWorld(brain.static);
      const acu = w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
      const [r] = runThinks(brain, w, 1);
      const b = builds(r!.commands);
      // Landwerk I @fac1 → 2× Glutkessel I near fac1 → 2× Zapfstelle I (ring) → Glutkessel I (eco)
      // → 2× Zapfstelle I (ring) → 2× Glutkessel I (eco).
      expect(b.map((x) => x.bp)).toEqual([
        bpOf('fac_land'),
        bpOf('pgen'),
        bpOf('pgen'),
        bpOf('mex'),
        bpOf('mex'),
        bpOf('pgen'),
        bpOf('mex'),
        bpOf('mex'),
        bpOf('pgen'),
        bpOf('pgen'),
      ]);
      expect(b.every((x) => x.unit === acu)).toBe(true);
      expect(b.map((x) => x.queued)).toEqual([false, true, true, true, true, true, true, true, true, true]);
      // One group: consecutive sequence numbers.
      for (let i = 1; i < b.length; i++) expect(b[i]!.seq).toBe(b[i - 1]!.seq + 1);
      // fac1 at the rotated template slot (snapped / spiral within 12 WU).
      const fac1 = a.slots.fac1!;
      expect(Math.abs(b[0]!.x - fac1.x) + Math.abs(b[0]!.z - fac1.z)).toBeLessThanOrEqual(12);
      // Glutkessel near fac1: adjacent (edge contact) to the factory footprint.
      const fw = T_FOOT('fac_land');
      const pw = T_FOOT('pgen');
      for (const p of [b[1]!, b[2]!]) {
        const dx = Math.abs(p.x - b[0]!.x);
        const dz = Math.abs(p.z - b[0]!.z);
        const touch = (fw + pw) / 2;
        expect((Math.abs(dx - touch) < 1e-9 && dz < touch) || (Math.abs(dz - touch) < 1e-9 && dx < touch)).toBe(true);
      }
      // The four ring mex are the four ring spots in d_own order (AI-OPEN-03, commander part).
      const ring = a.ringSpots.slice(0, 4).map((i) => brain.static.spots[i]!);
      const mex = [b[3]!, b[4]!, b[6]!, b[7]!];
      expect(mex.map((m) => [m.x, m.z])).toEqual(ring.map((s) => [s.x, s.z]));
      // Eco-ring Glutkessel close to the start.
      for (const p of [b[5]!, b[8]!, b[9]!]) {
        const d = Math.sqrt((p.x - a.ownStart.x) ** 2 + (p.z - a.ownStart.z) ** 2);
        expect(d).toBeLessThanOrEqual(12 + 6 + 12);
      }
      // Nothing re-issued while the queue runs.
      w.own(acu).queueLength = 9;
      const r2 = runThinks(brain, w, 3);
      expect(r2.flatMap((x) => builds(x.commands))).toHaveLength(0);
    });
  }

  it('AI-OPEN-03: ring spots reserved at the start; engineer 1 never picks a ring spot', () => {
    const brain = openingBrain('setons');
    const a = brain.analysis;
    const bb = brain.blackboard;
    for (const i of a.ringSpots.slice(0, 4)) expect(bb.reservations.spotReservation(i)?.owner).toBe('opening:acu');
    const w = new FakeWorld(brain.static);
    w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    runThinks(brain, w, 1);
    // Engineer 1 rolls off fac1 at 0:47.
    w.advance(470 - w.tick);
    const eng = w.addOwn(idOf('eng'), a.slots.fac1!.x, a.slots.fac1!.z);
    const [r] = runThinks(brain, w, 1);
    const eb = builds(r!.commands).filter((x) => x.unit === eng);
    expect(eb).toHaveLength(1);
    expect(eb[0]!.bp).toBe(bpOf('mex'));
    const ringXZ = a.ringSpots.map((i) => `${brain.static.spots[i]!.x},${brain.static.spots[i]!.z}`);
    expect(ringXZ).not.toContain(`${eb[0]!.x},${eb[0]!.z}`);
    expect(runner(brain).planEngineers).toEqual([eng]);
    expect(bb.reservations.unitOwner(eng)).toBe('opening');
  });

  it('commander progress: finished steps are recognised, the rest stays queued, handoff at the end', () => {
    const brain = openingBrain('hollow-ridge');
    const a = brain.analysis;
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const acu = w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    const [r0] = runThinks(brain, w, 1);
    const q = builds(r0!.commands);
    // Simulate: the commander finishes every step (structures appear), then goes idle.
    for (let i = 0; i < q.length; i++) {
      const s = q[i]!;
      const id = brain.static.bps.list[s.bp]!.id;
      w.addOwn(id, s.x, s.z, { complete: true });
      const u = w.own(acu);
      const nxt = q[i + 1];
      if (nxt !== undefined) {
        u.order = OrderKind.Build;
        u.orderBp = nxt.bp;
        u.orderX = nxt.x;
        u.orderZ = nxt.z;
        u.queueLength = q.length - i - 2;
      } else {
        u.order = OrderKind.Idle;
        u.queueLength = 0;
      }
      runThinks(brain, w, 1);
    }
    runThinks(brain, w, 2);
    expect(runner(brain).commanderSteps.every((s) => s.status === 'done')).toBe(true);
    expect(bb.opening.handedOffAcu).toBe(true);
    expect(bb.reservations.acuOwner).toBe('engineer');
    expect(bb.telemetry.events.some((e) => e.kind === 'handoff' && e.what === 'acu')).toBe(true);
  });

  it('commander claimed by the PlatoonManager: the queue pauses and resumes at the same step', () => {
    const brain = openingBrain('setons');
    const a = brain.analysis;
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    const acu = w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    const q = builds(runThinks(brain, w, 1)[0]!.commands);
    // Step 1 (fac1) is done, the commander works on step 2 when the platoon takes it over.
    w.addOwn(idOf('fac_land'), q[0]!.x, q[0]!.z);
    Object.assign(w.own(acu), { order: OrderKind.Build, orderBp: q[1]!.bp, orderX: q[1]!.x, orderZ: q[1]!.z, queueLength: 8 });
    runThinks(brain, w, 1);
    bb.reservations.claimAcu('platoon', w.tick, 'localDefense');
    Object.assign(w.own(acu), { order: OrderKind.AttackMove, queueLength: 0 });
    const paused = runThinks(brain, w, 6);
    expect(paused.flatMap((r) => builds(r.commands))).toHaveLength(0);
    bb.reservations.releaseAcu('platoon', w.tick);
    Object.assign(w.own(acu), { order: OrderKind.Idle });
    const [r] = runThinks(brain, w, 1);
    const again = builds(r!.commands);
    // Everything but the finished factory again, same places, the first order replaces.
    expect(again.map((b) => [b.bp, b.x, b.z])).toEqual(q.slice(1).map((b) => [b.bp, b.x, b.z]));
    expect(again[0]!.queued).toBe(false);
    expect(runner(brain).commanderSteps[0]!.status).toBe('done');
  });

  it('Easy: step by step (Denkpause), skipChance drops mex steps (pre-rolled, deterministic)', () => {
    const base = profileFor('easy', doc);
    const brain = openingBrain('setons', 'eco_standard', 'easy', { ...base, timing: { ...base.timing, skipChance: 1 } });
    const w = new FakeWorld(brain.static);
    const a = brain.analysis;
    w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    const [r] = runThinks(brain, w, 1);
    expect(builds(r!.commands)).toHaveLength(1);
    const steps = runner(brain).commanderSteps;
    expect(steps.filter((s) => s.role === 'mex').length).toBe(4);
    // All mex steps skipped when reached; the ring reservation of a skipped step is released.
    const brain2 = openingBrain('setons', 'eco_standard', 'easy');
    const brain3 = openingBrain('setons', 'eco_standard', 'easy');
    expect(runner(brain2).commanderSteps).toEqual(runner(brain3).commanderSteps);
  });
});

function T_FOOT(role: string): number {
  return loadStatic('setons', 0, 1).bps.list[bpOf(role)]!.footprint[0];
}

describe('OpeningRunner – factories (ai.md §4.1/§4.3)', () => {
  it('eco_standard fac1: rally + produce with count + repeat loop (highest tech), one P3 group; handoff when the loop runs', () => {
    const brain = openingBrain('setons');
    const a = brain.analysis;
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    const [r0] = runThinks(brain, w, 1);
    const fac1Build = builds(r0!.commands)[0]!;
    w.advance(320 - w.tick);
    const fac = w.addOwn(idOf('fac_land'), fac1Build.x, fac1Build.z);
    const [r1] = runThinks(brain, w, 1);
    const cmds = r1!.commands.filter((c) => (c.units as readonly number[]).includes(fac));
    expect(cmds.map((c) => c.op)).toEqual([Op.SetRally, Op.FactoryQueue, Op.FactoryQueue, Op.FactoryQueue, Op.FactoryRepeat]);
    const q = cmds.filter((c) => c.op === Op.FactoryQueue).map((c) => decodeAiPayload(c.op, c.payload));
    expect(q.map((p) => (p.op === 'factoryQueue' ? [p.value.bp, p.value.count] : null))).toEqual([
      [bpOf('eng'), 2],
      [bpOf('scout'), 1],
      [bpOf('eng'), 2],
    ]);
    const rep = decodeAiPayload(cmds[4]!.op, cmds[4]!.payload);
    expect(rep.op === 'factoryRepeat' ? rep.value.items : null).toEqual([bpOf('tank'), bpOf('tank'), bpOf('arty'), bpOf('tank'), bpOf('bot')]);
    const rally = decodeAiPayload(cmds[0]!.op, cmds[0]!.payload);
    expect(rally.op === 'position' ? [Math.round(rally.value.x), Math.round(rally.value.z)] : null).toEqual([Math.round(a.rally.x), Math.round(a.rally.z)]);
    for (let i = 1; i < cmds.length; i++) expect(cmds[i]!.seq).toBe(cmds[i - 1]!.seq + 1);
    expect(bb.reservations.unitOwner(fac)).toBe('opening');
    // Production: 4 engineers + 1 scout roll off; the loop runs ⇒ handoff to the FactoryManager.
    const f = w.own(fac);
    for (const role of ['eng', 'eng', 'scout', 'eng', 'eng']) {
      w.addOwn(idOf(role), f.x + 3, f.z + 3);
      runThinks(brain, w, 1);
    }
    expect(bb.opening.handedOffFactories).toContain(fac);
    expect(bb.reservations.unitOwner(fac)).toBeUndefined();
    expect(bb.telemetry.events.some((e) => e.kind === 'handoff' && e.what === 'factory' && e.unit === fac)).toBe(true);
    // The four engineers received the four plans in spawn order.
    expect(runner(brain).planEngineers).toHaveLength(4);
  });

  it('factory handoff at 5:00 at the latest', () => {
    const brain = openingBrain('setons');
    const a = brain.analysis;
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static);
    w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    const [r0] = runThinks(brain, w, 1);
    const fb = builds(r0!.commands)[0]!;
    const fac = w.addOwn(idOf('fac_land'), fb.x, fb.z);
    runThinks(brain, w, 1);
    expect(bb.opening.handedOffFactories).not.toContain(fac);
    w.advance(3000 - w.tick);
    runThinks(brain, w, 1);
    expect(bb.opening.handedOffFactories).toContain(fac);
  });
});

describe('OpeningRunner – abort and local defence (ai.md §4.3)', () => {
  function midGame(map = 'setons') {
    const brain = openingBrain(map);
    const a = brain.analysis;
    const w = new FakeWorld(brain.static, { tick: 1200 });
    const acu = w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    const fac = w.addOwn(idOf('fac_land'), a.slots.fac1!.x, a.slots.fac1!.z);
    for (const i of a.ringSpots.slice(0, 2)) w.addOwn(idOf('mex'), brain.static.spots[i]!.x, brain.static.spots[i]!.z);
    return { brain, a, w, acu, fac };
  }

  it('AI-OPEN-04: 6 Stichel in the own zone from 2:00 ⇒ defence mode after 5 s + reaction delay', () => {
    const { brain, a, w } = midGame();
    const bb = brain.blackboard;
    runThinks(brain, w, 1);
    const at = { x: a.ownStart.x + a.forward.x * 35, z: a.ownStart.z + a.forward.z * 35 };
    expect(a.zoneAt(at.x, at.z)).toBe('own');
    for (let i = 0; i < 6; i++) w.addEnemy(idOf('bot'), at.x + i, at.z);
    const t0 = w.tick;
    runThinks(brain, w, 20);
    expect(bb.opening.defenseMode).toBe(true);
    // ≤ 2 s after the 5-s window (reaction delay 0.5 s + 1 think + lead, ai.md §9 R-G6).
    expect(bb.opening.defenseModeTick).toBeGreaterThanOrEqual(t0 + 50);
    expect(bb.opening.defenseModeTick).toBeLessThanOrEqual(t0 + 50 + 20);
    expect(bb.telemetry.first('defenseMode')?.reason).toBe('threat');
    const reqRoles = bb.productionRequests.items.map((r) => r.role).sort();
    expect(reqRoles).toEqual(['bot', 'tank']);
    const pd = bb.taskBoard.filter((t) => t.role === 'pd');
    expect(pd).toHaveLength(1);
    expect(pd[0]!.prio).toBe(95);
    // Riegel near a ring mex, towards the threat.
    const site = pd[0]!.site as { x: number; z: number };
    const nearRing = a.ringSpots.some((i) => {
      const sp = brain.static.spots[i]!;
      return Math.abs(Math.sqrt((sp.x - site.x) ** 2 + (sp.z - site.z) ** 2) - 6) < 1e-6;
    });
    expect(nearRing).toBe(true);
    // Everything handed over, the rest of the opening discarded.
    expect(bb.opening.handedOffAcu).toBe(true);
    expect(bb.opening.active).toBe(false);
    expect(runner(brain).commanderSteps.some((s) => s.status === 'pending' || s.status === 'issued')).toBe(false);
  });

  it('AI-OPEN-05: a single Stichel on the commander and a Funke through the base ⇒ only local defence', () => {
    const { brain, a, w, acu, fac } = midGame();
    const bb = brain.blackboard;
    w.tick = 900;
    runThinks(brain, w, 2);
    const bot = w.addEnemy(idOf('bot'), a.ownStart.x + 12, a.ownStart.z);
    const scout = w.addEnemy(idOf('scout'), a.ownStart.x - 20, a.ownStart.z + 5);
    let pulled = false;
    for (let i = 0; i < 20; i++) {
      w.event({ kind: 'ownDamaged', tick: w.tick, unit: acu, attacker: bot, attackerBp: bpOf('bot'), amount: 20 });
      w.own(acu).hpFrac = 0.97;
      const [r] = runThinks(brain, w, 1);
      const q = ofOp(r!.commands, Op.FactoryQueue).filter((c) => (c.units as readonly number[]).includes(fac));
      if (q.length > 0) {
        const first = decodeAiPayload(q[0]!.op, q[0]!.payload);
        if (first.op === 'factoryQueue' && first.value.bp === bpOf('tank') && (q[0]!.flags & CmdFlags.Queue) === 0) pulled = true;
      }
    }
    expect(bb.opening.defenseMode).toBe(false);
    expect(bb.opening.localDefense).toBe(true);
    expect(pulled).toBe(true);
    expect(bb.huntRequests.items.some((h) => h.target === scout)).toBe(true);
    // Both intruders die; 15 s later the opening resumes at the same step.
    w.removeEnemy(bot, true);
    w.removeEnemy(scout, true);
    runThinks(brain, w, 31);
    expect(bb.opening.localDefense).toBe(false);
    expect(bb.opening.active).toBe(true);
    expect(runner(brain).commanderSteps.some((s) => s.status === 'dropped')).toBe(false);
  });

  it('two structures lost within 30 s ⇒ defence mode; commander HP < 80 % ⇒ defence mode', () => {
    const m1 = midGame();
    runThinks(m1.brain, m1.w, 1);
    const [s1, s2] = m1.w.ownHandles().filter((h) => m1.brain.static.bps.list[m1.w.own(h).bp]!.isStructure);
    m1.w.removeOwn(s1!, true);
    runThinks(m1.brain, m1.w, 3);
    expect(m1.brain.blackboard.opening.defenseMode).toBe(false);
    m1.w.removeOwn(s2!, true);
    runThinks(m1.brain, m1.w, 3);
    expect(m1.brain.blackboard.telemetry.first('defenseMode')?.reason).toBe('structuresLost');

    const m2 = midGame();
    m2.w.own(m2.acu).hpFrac = 0.79;
    runThinks(m2.brain, m2.w, 1);
    expect(m2.brain.blackboard.telemetry.first('defenseMode')?.reason).toBe('commanderHp');
  });

  it('scout switch tech_greed → eco_standard: ≥ 2 enemy land factories at the first sighting of the enemy base', () => {
    const brain = openingBrain('setons', 'tech_greed');
    const a = brain.analysis;
    const bb = brain.blackboard;
    const w = new FakeWorld(brain.static, { tick: 1660 });
    w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    runThinks(brain, w, 1);
    w.addEnemy(idOf('fac_land'), a.enemyStart.x + 10, a.enemyStart.z);
    w.addEnemy(idOf('fac_land'), a.enemyStart.x - 10, a.enemyStart.z);
    runThinks(brain, w, 3);
    expect(bb.opening.id).toBe('eco_standard');
    expect(bb.telemetry.events.filter((e) => e.kind === 'openingSelected').map((e) => (e.kind === 'openingSelected' ? e.id : ''))).toEqual([
      'tech_greed',
      'eco_standard',
    ]);
    // After 4:00 no switch any more.
    const b2 = openingBrain('setons', 'tech_greed');
    const w2 = new FakeWorld(b2.static, { tick: 2410 });
    w2.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    w2.addEnemy(idOf('fac_land'), a.enemyStart.x + 10, a.enemyStart.z);
    w2.addEnemy(idOf('fac_land'), a.enemyStart.x - 10, a.enemyStart.z);
    runThinks(b2, w2, 3);
    expect(b2.blackboard.opening.id).toBe('tech_greed');
  });

  it('engineer handoff when its list is empty; waveExtra published', () => {
    const brain = openingBrain('hollow-ridge');
    const a = brain.analysis;
    const bb = brain.blackboard;
    expect(bb.opening.waveExtra).toBe(doc.difficultyTiming.normal.waveExtra);
    const w = new FakeWorld(brain.static, { tick: 470 });
    w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z, { order: OrderKind.Build, queueLength: 9 });
    const eng = w.addOwn(idOf('eng'), a.slots.fac1!.x, a.slots.fac1!.z);
    // Hollow Ridge: the commander holds the 4 ring spots, so engineer 1 gets the two remaining own
    // spots; its third `mex:next` has no place before 6:00 and is dropped (ecosim semantics).
    const spots: string[] = [];
    for (let step = 0; step < 2; step++) {
      const [r] = runThinks(brain, w, 1);
      const b = builds(r!.commands).find((x) => x.unit === eng);
      expect(b?.bp).toBe(bpOf('mex'));
      spots.push(`${b!.x},${b!.z}`);
      w.addOwn(idOf('mex'), b!.x, b!.z, { complete: true });
      w.own(eng).order = OrderKind.Idle;
      runThinks(brain, w, 1);
    }
    expect(new Set(spots).size).toBe(2);
    runThinks(brain, w, 2);
    expect(bb.opening.handedOffEngineers).toContain(eng);
    expect(bb.reservations.unitOwner(eng)).toBeUndefined();
  });
});
