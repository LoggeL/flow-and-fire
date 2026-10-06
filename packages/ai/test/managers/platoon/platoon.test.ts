import { describe, expect, it } from 'vitest';
import { OrderKind } from '../../../src/index.ts';
import { createPlatoonManager, platoonManager, type PlatoonManager } from '../../../src/managers/platoon/index.ts';
import { decoded, harness, ID, ofOp, Op, streamKey, T } from './harness.ts';

/** eco_standard: waves.first 8, grow 4, maxS 420 s. */
const MAX_S_TICK = 4200;

function positionOf(c: ReturnType<typeof decoded>[number]): { x: number; z: number } {
  if (c.pl.op !== 'position') throw new Error('not a position command');
  return c.pl.value;
}

/** A first wave of n Punzen in ATTACK (Pflichtangriff) at (x|z); returns handles. */
function attackingWave(h: ReturnType<typeof harness<PlatoonManager>>, n: number, x: number, z: number): number[] {
  const w = h.world;
  w.addOwn(ID.fac, 130, 128);
  const units: number[] = [];
  for (let i = 0; i < n; i++) units.push(w.addOwn(ID.tank, x + (i % 4) * 2, z + Math.floor(i / 4) * 2));
  h.run(2); // forming → staging (t ≥ maxS − 60 s) → forced attack (t ≥ maxS)
  const p = h.manager().platoons.find((q) => q.units.length === n)!;
  expect(p.state).toBe('attack');
  expect(p.target!.forced).toBe(true);
  return units;
}

describe('PlatoonManager — AI-PLT-01 retreat at R < 0.7 (ai.md §5.5)', () => {
  it('(a) 7 vs 11 Punzen: retreat command 2 thinks after the contact becomes reactable (P0 group move)', () => {
    const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick: MAX_S_TICK });
    const units = attackingWave(h, 7, 250, 250);
    const contactTick = h.world.tick;
    for (let i = 0; i < 11; i++) h.world.addEnemy(ID.tank, 262 + (i % 4) * 2, 256 + Math.floor(i / 4) * 2);
    const rs = h.run(3);
    // think 1: contact not reactable yet (reaction delay 5 ticks), think 2: R = 0.64 (1st), think 3: retreat
    expect(rs[0]!.commands).toHaveLength(0);
    expect(rs[1]!.commands).toHaveLength(0);
    const moves = ofOp(rs[2]!, Op.Move);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.units.sort((a, b) => a - b)).toEqual([...units].sort((a, b) => a - b));
    const p = h.manager().platoons.find((q) => q.state === 'retreat')!;
    expect(p.ratio).toBeCloseTo(7 / 11, 9);
    const tel = h.brain.blackboard.telemetry.first('retreat')!;
    expect(tel.tick - contactTick).toBeLessThanOrEqual(20 - 3); // ≤ 2 s incl. lead 3
    // retreat point lies behind the platoon (own factory)
    const pos = positionOf(moves[0]!);
    expect(Math.abs(pos.x - 130) + Math.abs(pos.z - 128)).toBeLessThan(1);
  });

  it('(b) 7 vs 10 Punzen is exactly R = 0.7: no retreat', () => {
    const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick: MAX_S_TICK });
    attackingWave(h, 7, 250, 250);
    for (let i = 0; i < 10; i++) h.world.addEnemy(ID.tank, 262 + (i % 4) * 2, 256 + Math.floor(i / 4) * 2);
    const rs = h.run(12);
    for (const r of rs) expect(ofOp(r, Op.Move)).toHaveLength(0);
    const p = h.manager().platoons.find((q) => q.units.length === 7)!;
    expect(p.state).toBe('attack');
    expect(p.ratio).toBeCloseTo(0.7, 9);
    expect(h.brain.blackboard.telemetry.count('retreat')).toBe(0);
  });

  it('(c) after the retreat of (a), 8 vs 10 (R = 0.8) does not re-enter', () => {
    const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick: MAX_S_TICK });
    attackingWave(h, 7, 250, 250);
    const enemies: number[] = [];
    for (let i = 0; i < 11; i++) enemies.push(h.world.addEnemy(ID.tank, 262 + (i % 4) * 2, 256 + Math.floor(i / 4) * 2));
    h.run(3);
    const p = h.manager().platoons.find((q) => q.state === 'retreat')!;
    h.world.addOwn(ID.tank, 252, 254);
    h.world.removeEnemy(enemies[10]!);
    const rs = h.run(10);
    expect(p.state).toBe('retreat');
    expect(p.ratio).toBeCloseTo(0.8, 9);
    for (const r of rs) {
      for (const c of ofOp(r, Op.Move)) {
        const pos = positionOf(c);
        expect(Math.abs(pos.x - h.brain.analysis.staging.x) + Math.abs(pos.z - h.brain.analysis.staging.z)).toBeGreaterThan(1);
      }
    }
    // R ≥ 1.0 and full HP ⇒ re-entry to staging
    for (const id of enemies.slice(0, 3)) h.world.removeEnemy(id);
    h.run(1);
    expect(p.state).toBe('staging');
  });
});

describe('PlatoonManager — waves (AI-PLT-02 unit part, AI-PLT-05)', () => {
  it('AI-PLT-02: the wave gathers, moves to the staging point and attack-moves to the most valuable target', () => {
    const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick: 1000 });
    const a = h.brain.analysis;
    const units: number[] = [];
    for (let i = 0; i < 8; i++) units.push(h.world.addOwn(ID.tank, a.rally.x + i, a.rally.z));
    const mex = h.world.addEnemy(ID.mex, 330, 300);
    h.world.addEnemy(ID.pgen, 300, 330);
    const [r0] = h.run(1);
    const mv = ofOp(r0!, Op.Move);
    expect(mv).toHaveLength(1);
    expect(mv[0]!.units).toHaveLength(8);
    expect(positionOf(mv[0]!).x).toBeCloseTo(a.staging.x, 0);
    const p = h.manager().platoons[0]!;
    expect(p.state).toBe('staging');
    expect(p.isFirstWave).toBe(true);
    // arrive at the staging point
    for (const u of units) {
      const o = h.world.own(u);
      o.x = a.staging.x + (u % 3);
      o.z = a.staging.z;
      o.order = OrderKind.Idle;
    }
    const rs = h.run(2);
    expect(rs[0]!.commands).toHaveLength(0); // R_ziel ≥ 1.2 for the first think
    const am = ofOp(rs[1]!, Op.AttackMove);
    expect(am).toHaveLength(1);
    expect(positionOf(am[0]!)).toMatchObject({ x: 330, z: 300 });
    expect(p.state).toBe('attack');
    expect(p.target!.id).toBe(mex);
    const tel = h.brain.blackboard.telemetry.first('waveAttack')!;
    expect(tel).toMatchObject({ x: 330, z: 300, enemyHalf: true, units: 8, forced: false });
  });

  it('wave thresholds: first = waves.first (+ waveExtra), then + grow', () => {
    const h = harness<PlatoonManager>(platoonManager, { tick: 100 });
    h.run(1);
    const m = h.manager();
    const ctxLike = { bb: h.brain.blackboard } as Parameters<PlatoonManager['waveSize']>[0];
    expect(m.waveSize(ctxLike, 0)).toBe(8);
    expect(m.waveSize(ctxLike, 2)).toBe(16);
    const e = harness<PlatoonManager>(platoonManager, { difficulty: 'easy', tick: 100 });
    e.run(1);
    expect(e.manager().waveSize({ bb: e.brain.blackboard } as Parameters<PlatoonManager['waveSize']>[0], 0)).toBe(12);
  });

  it('AI-PLT-05: Pflichtangriff at waves.maxS against a held bridgehead, retreat rule still applies', () => {
    const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick: MAX_S_TICK - 100 });
    const a = h.brain.analysis;
    h.world.addOwn(ID.fac, 130, 128);
    const units: number[] = [];
    for (let i = 0; i < 8; i++) units.push(h.world.addOwn(ID.tank, a.staging.x + i, a.staging.z));
    // bridgehead: 3 Riegel I (ghosts) with a mex behind; enemy base with a factory and 10 Punzen
    for (let i = 0; i < 3; i++) h.world.addEnemy(ID.pd, 280 + i * 4, 280, { kind: 'ghost' });
    h.world.addEnemy(ID.mex, 290, 292, { kind: 'ghost' });
    h.world.addEnemy(ID.fac, 380, 380, { kind: 'ghost' });
    for (let i = 0; i < 10; i++) h.world.addEnemy(ID.tank, 370 + i, 372);
    // staging, waiting (R_ziel < 1.2 everywhere, point defense rule without artillery)
    const before = h.run(20);
    const p = h.manager().platoons[0]!;
    expect(p.state).toBe('staging');
    expect(before.every((r) => ofOp(r, Op.AttackMove).length === 0)).toBe(true);
    expect(h.world.tick).toBe(MAX_S_TICK);
    const [atMax] = h.run(1);
    expect(p.state).toBe('attack');
    expect(p.target!.forced).toBe(true);
    expect(ofOp(atMax!, Op.AttackMove)).toHaveLength(1);
    const tel = h.brain.blackboard.telemetry.first('waveAttack')!;
    expect(tel.forced).toBe(true);
    expect(tel.enemyHalf).toBe(true);
    expect(tel.tick).toBeLessThanOrEqual(MAX_S_TICK);
    // the wave runs into the point defenses: R = 672 / 1422 < 0.7 ⇒ retreat after 2 thinks
    for (const u of units) {
      const o = h.world.own(u);
      o.x = 276 + (u % 4);
      o.z = 272;
    }
    const rs = h.run(2);
    expect(p.state).toBe('retreat');
    expect(ofOp(rs[1]!, Op.Move)).toHaveLength(1);
  });

  it('merges a second wave arriving for staging and publishes bb.platoons', () => {
    const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick: 1000 });
    const a = h.brain.analysis;
    for (let i = 0; i < 8; i++) h.world.addOwn(ID.tank, a.rally.x + i, a.rally.z);
    h.run(1);
    for (let i = 0; i < 12; i++) h.world.addOwn(ID.bot, a.rally.x + i, a.rally.z + 3);
    h.run(2);
    const live = h.manager().platoons.filter((p) => p.units.length > 0);
    expect(live).toHaveLength(1);
    expect(live[0]!.units).toHaveLength(20);
    expect(h.brain.blackboard.platoons).toHaveLength(1);
    expect(h.brain.blackboard.platoons[0]!.state).toBe('staging');
  });
});

describe('PlatoonManager — commander (AI-PLT-04, AI-PERC-03 part)', () => {
  it('AI-PLT-04: the commander never leaves the leash (60 WU around the nearest factory), bait 90 WU out', () => {
    const h = harness<PlatoonManager>(platoonManager, { tick: 2000 });
    const w = h.world;
    const fac = { x: 140, z: 128 };
    w.addOwn(ID.fac, fac.x, fac.z);
    const acu = w.addOwn(ID.acu, 132, 128);
    const baits = [0, 1, 2].map((i) => w.addEnemy(ID.bot, 136 + i, 134));
    const first = h.run(2);
    const atk = ofOp(first[1]!, Op.Attack);
    expect(atk).toHaveLength(1);
    expect(atk[0]!.units).toEqual([acu]);
    expect(h.brain.blackboard.reservations.acuOwner).toBe('platoon');
    // baits run 90 WU in front of the base, 12 Punzen wait there
    for (const id of baits) {
      const e = w.enemy(id);
      e.x = fac.x + 64;
      e.z = fac.z + 64;
    }
    for (let i = 0; i < 12; i++) w.addEnemy(ID.tank, fac.x + 66 + (i % 4), fac.z + 64 + Math.floor(i / 4));
    const leash2 = 60 * 60;
    const rs = h.run(400); // 200 s
    for (const r of rs) {
      for (const c of decoded(r)) {
        if (!c.units.includes(acu)) continue;
        if (c.pl.op === 'position') {
          const d = (c.pl.value.x - fac.x) ** 2 + (c.pl.value.z - fac.z) ** 2;
          expect(d).toBeLessThanOrEqual(leash2);
        } else if (c.pl.op === 'target') {
          const e = w.enemy(c.pl.value);
          expect((e.x - fac.x) ** 2 + (e.z - fac.z) ** 2).toBeLessThanOrEqual(leash2);
        }
      }
    }
    // the chase is broken off at once: the commander is called back to the factory
    const back = decoded(rs[0]!).filter((c) => c.units.includes(acu) && c.op === Op.Move);
    expect(back).toHaveLength(1);
    expect(positionOf(back[0]!)).toMatchObject(fac);
    // 15 s without enemy combat units in the base area ⇒ control goes back
    expect(h.brain.blackboard.reservations.acuOwner).toBe('opening');
  });

  it('commander outside the leash is called back; burst check retreats at once (P0)', () => {
    const h = harness<PlatoonManager>(platoonManager, { tick: 2000 });
    const w = h.world;
    w.addOwn(ID.fac, 140, 128);
    const acu = w.addOwn(ID.acu, 150, 128);
    const bot = w.addEnemy(ID.bot, 156, 128);
    h.run(2);
    expect(h.brain.blackboard.reservations.acuOwner).toBe('platoon');
    w.removeEnemy(bot, true);
    w.own(acu).x = 210; // chased beyond the leash
    const cmds = decoded(h.run(1)[0]!).filter((c) => c.units.includes(acu));
    expect(cmds.some((c) => c.op === Op.Move && positionOf(c).x === 140)).toBe(true);
    // burst: 40 visible Punzen next to a damaged commander
    const b = harness<PlatoonManager>(platoonManager, { tick: 2000 });
    b.world.addOwn(ID.fac, 140, 128);
    const acu2 = b.world.addOwn(ID.acu, 130, 128, { hpFrac: 0.6 });
    for (let i = 0; i < 40; i++) b.world.addEnemy(ID.tank, 120 + (i % 8), 140 + Math.floor(i / 8));
    const rr = b.run(2);
    const mv = decoded(rr[1]!).filter((c) => c.units.includes(acu2) && c.op === Op.Move);
    expect(mv).toHaveLength(1);
    expect(b.manager().commander.action).toBe('burst');
  });

  it('AI-PERC-03 part: enemy commander ×1.5 only after a seen energy storage or from 5:00; identical streams', () => {
    const scenario = (tick: number, estore: boolean) => {
      const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick });
      const w = h.world;
      w.addOwn(ID.fac, 130, 128);
      for (let i = 0; i < 12; i++) w.addOwn(ID.tank, 250 + (i % 4) * 2, 250 + Math.floor(i / 4) * 2);
      // forced attack first (move the clock to maxS for the Pflichtangriff)
      h.run(2, { before: (wd, i) => (wd.tick = i === 0 ? MAX_S_TICK : wd.tick) });
      w.tick = tick;
      w.addEnemy(ID.acu, 262, 256);
      if (estore) w.addEnemy(ID.estore, 380, 380, { kind: 'ghost' });
      const rs = h.run(4);
      const p = h.manager().platoons.find((q) => q.units.length === 12)!;
      return { p, rs };
    };
    // 3:00, no storage seen: 1008 / 1095 = 0.92 ⇒ no retreat
    const a1 = scenario(1800, false);
    const a2 = scenario(1800, false);
    expect(a1.p.state).toBe('attack');
    expect(a1.p.ratio).toBeCloseTo((12 * T.byId(ID.tank)!.threatSurface) / T.byId(ID.acu)!.threatSurface, 6);
    expect(streamKey(a1.rs)).toBe(streamKey(a2.rs));
    // seen storage (ghost) ⇒ ×1.5 ⇒ 0.61 ⇒ retreat
    const b = scenario(1800, true);
    expect(b.p.state).toBe('retreat');
    // 5:00 without storage ⇒ ×1.5 as well
    const c = scenario(3000, false);
    expect(c.p.state).toBe('retreat');
  });
});

describe('PlatoonManager — hunts, raids, determinism', () => {
  it('huntRequests: the nearest combat unit attacks the scout (P1), request removed after the kill', () => {
    const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick: 1000 });
    const a = h.brain.analysis;
    const near = h.world.addOwn(ID.tank, a.rally.x, a.rally.z);
    h.world.addOwn(ID.tank, a.rally.x - 30, a.rally.z - 30);
    const scout = h.world.addEnemy(ID.scout, a.rally.x + 20, a.rally.z + 5);
    h.run(2);
    const bb = h.brain.blackboard;
    bb.huntRequests.add((id) => ({ id, target: scout, x: a.rally.x + 20, z: a.rally.z + 5, source: 'engineer', createdTick: bb.tick, hunter: 0 }));
    const [r] = h.run(1);
    const atk = ofOp(r!, Op.Attack);
    expect(atk).toHaveLength(1);
    expect(atk[0]!.units).toEqual([near]);
    expect(bb.huntRequests.items[0]!.hunter).toBe(near);
    expect(h.manager().platoons.some((p) => p.units.includes(near))).toBe(false);
    h.world.removeEnemy(scout, true);
    h.run(2);
    expect(bb.huntRequests.size).toBe(0);
    h.run(1);
    expect(h.manager().platoons.some((p) => p.units.includes(near))).toBe(true);
  });

  it('raid platoon (Normal from 6:00): 3–5 bots/tanks against an unprotected outer mex', () => {
    const h = harness<PlatoonManager>(createPlatoonManager({ commander: false }), { tick: 3600 });
    const a = h.brain.analysis;
    const bots: number[] = [];
    for (let i = 0; i < 4; i++) bots.push(h.world.addOwn(ID.bot, a.rally.x + i, a.rally.z));
    for (let i = 0; i < 3; i++) h.world.addOwn(ID.tank, a.rally.x + i, a.rally.z + 2);
    h.world.addEnemy(ID.mex, 300, 420, { kind: 'ghost' });
    const rs = h.run(2);
    const raid = h.manager().platoons.find((p) => p.kind === 'raid')!;
    expect(raid.units).toHaveLength(5);
    for (const b of bots) expect(raid.units).toContain(b);
    expect(raid.state).toBe('raid');
    const am = rs.flatMap((r) => ofOp(r, Op.AttackMove));
    expect(am.some((c) => positionOf(c).x === 300 && positionOf(c).z === 420)).toBe(true);
    // Easy has no raids
    const e = harness<PlatoonManager>(createPlatoonManager({ commander: false }), { tick: 3600, difficulty: 'easy' });
    for (let i = 0; i < 5; i++) e.world.addOwn(ID.bot, a.rally.x + i, a.rally.z);
    e.run(2);
    expect(e.manager().platoons.some((p) => p.kind === 'raid')).toBe(false);
  });

  it('determinism: two identical runs give the same command stream', () => {
    const run = (): string => {
      const h = harness<PlatoonManager>(platoonManager, { tick: 3000 });
      const w = h.world;
      w.addOwn(ID.fac, 140, 128);
      w.addOwn(ID.acu, 132, 128);
      for (let i = 0; i < 14; i++) w.addOwn(i % 3 === 0 ? ID.bot : ID.tank, 150 + i, 150);
      for (let i = 0; i < 6; i++) w.addEnemy(ID.tank, 300 + i * 3, 290);
      w.addEnemy(null, 260, 260);
      w.addEnemy(ID.mex, 330, 300, { kind: 'ghost' });
      return streamKey(h.run(40));
    };
    expect(run()).toBe(run());
  });

  it('halved budget continues by cursor without duplicate orders', () => {
    const mk = (scale: number) => {
      const h = harness<PlatoonManager>(createPlatoonManager({ commander: false, raids: false }), { tick: MAX_S_TICK });
      h.world.addOwn(ID.fac, 130, 128);
      for (let i = 0; i < 60; i++) h.world.addOwn(ID.tank, 200 + (i % 10) * 3, 200 + Math.floor(i / 10) * 3);
      for (let i = 0; i < 200; i++) h.world.addEnemy(ID.tank, 330 + (i % 20) * 2, 330 + Math.floor(i / 20) * 2);
      return h.run(6, { thinkOptions: { budgetScale: scale } });
    };
    const full = mk(1);
    const half1 = mk(0.5);
    const half2 = mk(0.5);
    expect(streamKey(half1)).toBe(streamKey(half2));
    const count = (rs: typeof full) => rs.flatMap((r) => ofOp(r, Op.AttackMove)).length;
    expect(count(full)).toBe(1);
    expect(count(half1)).toBe(1);
    // a budget below the scene cost stops cleanly: never more ops than the allotment, deterministic
    const tiny = mk(0.05);
    expect(tiny.every((r) => (r.opsByManager.platoon ?? 0) <= 250)).toBe(true);
    expect(streamKey(tiny)).toBe(streamKey(mk(0.05)));
    expect(count(tiny)).toBeLessThanOrEqual(1);
  });
});

