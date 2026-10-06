import { describe, expect, it } from 'vitest';
import { Op } from '@faf/protocol';
import {
  Blackboard,
  compareTasks,
  createBrain,
  defineManager,
  EcoPlan,
  OrderKind,
  Prio,
  profileFor,
  Reservations,
  Stimuli,
  TaskBoard,
  TaskPrio,
  Telemetry,
} from '../src/index.ts';
import { FakeWorld, flatStatic, runThinks } from '../src/testing/index.ts';
import { loadOpenings, loadRoster } from './support/fixtures.ts';

const T = loadRoster();
const doc = loadOpenings();

describe('task board (ai.md §5.3)', () => {
  it('stable order prio ↓, createdTick ↑, id ↑; keys dedup live tasks', () => {
    const b = new TaskBoard();
    const a = b.add({ kind: 'build', role: 'mex', prio: TaskPrio.mex, source: 'economy' }, 10);
    const p = b.add({ kind: 'build', role: 'pgen', prio: TaskPrio.power, source: 'economy', key: 'pgen#1' }, 20);
    const c = b.add({ kind: 'build', role: 'mex', prio: TaskPrio.mex, source: 'economy' }, 5);
    const d = b.add({ kind: 'build', role: 'mex', prio: TaskPrio.mex, source: 'economy' }, 5);
    expect(b.add({ kind: 'build', role: 'pgen', prio: 1, source: 'x', key: 'pgen#1' }, 30)).toBe(p);
    expect(b.ordered().map((t) => t.id)).toEqual([p.id, c.id, d.id, a.id]);
    expect([...b.ordered()].sort(compareTasks)).toEqual(b.ordered());
    expect(b.byKey('pgen#1')).toBe(p);
    b.complete(p.id);
    expect(b.byKey('pgen#1')).toBeUndefined();
    expect(b.ordered().map((t) => t.id)).toEqual([c.id, d.id, a.id]);
    b.prune();
    expect(b.get(p.id)).toBeUndefined();
    expect(b.size).toBe(3);
  });

  it('assignment respects wanted, release reopens', () => {
    const b = new TaskBoard();
    const t = b.add({ kind: 'assist', prio: TaskPrio.techAssist, wanted: 2, target: 9, source: 'tech' }, 0);
    expect(b.assign(t.id, 1)).toBe(true);
    expect(b.assign(t.id, 1)).toBe(true);
    expect(b.assign(t.id, 2)).toBe(true);
    expect(b.assign(t.id, 3)).toBe(false);
    expect(t.state).toBe('assigned');
    expect(b.tasksOf(2)).toEqual([t]);
    b.release(1);
    b.release(2);
    expect(t.state).toBe('open');
    expect(t.assigned).toEqual([]);
    b.cancel(t.id);
    expect(b.assign(t.id, 4)).toBe(false);
  });
});

describe('reservations', () => {
  it('spots and sites with locks', () => {
    const r = new Reservations();
    expect(r.reserveSpot(3, 'opening', 0)).toBe(true);
    expect(r.reserveSpot(3, 'economy', 0)).toBe(false);
    expect(r.reserveSpot(3, 'opening', 1)).toBe(true);
    expect(r.isSpotAvailable(3, 0)).toBe(false);
    r.releaseSpot(3, 300);
    expect(r.isSpotAvailable(3, 299)).toBe(false);
    expect(r.isSpotAvailable(3, 300)).toBe(true);
    expect(r.reserveSite('fac2', 'economy', 0)).toBe(true);
    r.releaseSite('fac2', 600);
    expect(r.reserveSite('fac2', 'economy', 100)).toBe(false);
    expect(r.reservedSpots()).toEqual([]);
  });

  it('commander handover rule', () => {
    const r = new Reservations();
    expect(r.acuOwner).toBe('opening');
    r.claimAcu('platoon', 100, 'localDefense');
    expect(r.acuOwner).toBe('platoon');
    expect(r.acuReason).toBe('localDefense');
    r.releaseAcu('opening', 110); // not the holder: no effect
    expect(r.acuOwner).toBe('platoon');
    r.handoverAcu('opening', 'engineer', 120); // handoff while claimed: previous owner changes
    r.releaseAcu('platoon', 150);
    expect(r.acuOwner).toBe('engineer');
    r.claimUnit(5, 'platoon');
    expect(r.unitOwner(5)).toBe('platoon');
    r.pruneDead(() => false);
    expect(r.unitOwner(5)).toBeUndefined();
  });
});

describe('stimuli, eco plan, telemetry', () => {
  it('stimuli become visible after the delay; per-reader cursors miss nothing', () => {
    const s = new Stimuli();
    s.push({ kind: 'newContact', id: 1, army: 1, bp: 0, x: 0, z: 0, tick: 10, visibleAt: 30 });
    s.push({ kind: 'newContact', id: 2, army: 1, bp: 0, x: 0, z: 0, tick: 12, visibleAt: 32 });
    const at = (since: number, now: number): number[] => {
      const out: number[] = [];
      s.forEachVisible(since, now, (x) => out.push(x.kind === 'newContact' ? x.id : -1));
      return out;
    };
    expect(at(-1, 25)).toEqual([]);
    expect(at(25, 30)).toEqual([1]);
    expect(at(30, 40)).toEqual([2]);
    expect(at(20, 40)).toEqual([1, 2]);
    s.prune(631);
    expect(s.size).toBe(1);
    s.prune(632);
    expect(s.size).toBe(0);
  });

  it('R_E decays 10 %/s, sinks sum', () => {
    const e = new EcoPlan();
    e.reserve(60);
    e.decayOneSecond();
    expect(e.reservedE).toBeCloseTo(54, 12);
    e.addSink({ kind: 'mexUpgrade', massPerSec: 10, energyPerSec: 60, taskId: 1, tick: 0 });
    e.addSink({ kind: 'factory', massPerSec: 3.7, energyPerSec: 19, taskId: 2, tick: 0 });
    expect(e.sinkMass).toBeCloseTo(13.7, 12);
    e.removeSink(1);
    expect(e.sinkMass).toBeCloseTo(3.7, 12);
  });

  it('telemetry', () => {
    const t = new Telemetry();
    t.push({ kind: 'techStart', tick: 1, unit: 2, tech: 2 });
    t.push({ kind: 'waveAttack', tick: 5, x: 1, z: 2, enemyHalf: true, units: 8, forced: false });
    expect(t.first('waveAttack')?.enemyHalf).toBe(true);
    expect(t.count('techStart')).toBe(1);
    expect(t.first('aiTimeout')).toBeUndefined();
  });
});

describe('enemy memory (no fog knowledge)', () => {
  it('counter window 180 s, estore/land-factory/tech flags, forgetting', () => {
    const st = flatStatic({ bps: T, sizeWu: 256 });
    const brain = createBrain({ managers: [] });
    brain.init(st, profileFor('hard', doc), { openings: doc });
    const bb: Blackboard = brain.blackboard;
    const w = new FakeWorld(st);
    const bots = [1, 2, 3].map((i) => w.addEnemy('core:lnd_t1_bot', 150 + i, 150));
    w.addEnemy('core:lnd_t1_tank', 160, 150);
    const fac = w.addEnemy('core:str_t2_fac_land', 200, 200, { kind: 'ghost' });
    w.addEnemy('core:str_t1_estore', 205, 200, { kind: 'ghost' });
    w.addEnemy(null, 100, 100);
    runThinks(brain, w, 1);
    expect(bb.enemy.highestTechSeen).toBe(2);
    expect(bb.enemy.estoreSeen).toBe(true);
    expect(bb.enemy.landFactories).toBe(1);
    expect(bb.enemy.t2LandFactorySeen).toBe(true);
    expect(bb.enemy.structures).toHaveLength(2);
    const bot = T.byId('core:lnd_t1_bot')!;
    const share = bb.enemy.categoryShare((b) => b.index === bot.index);
    // 3 × 37 vs (3 × 37 + 84 + 0 + 0 + blip median at T2 (294))
    expect(share).toBeCloseTo((3 * bot.threatSurface) / (3 * bot.threatSurface + T.byId('core:lnd_t1_tank')!.threatSurface + 294.0 + 0), 1);
    expect(bb.enemy.categoryCount((b) => b.categoryNames.includes('BOT'))).toBe(3);
    // Units leave the perception: the window keeps them for 180 s.
    for (const id of bots) w.removeEnemy(id);
    w.removeEnemy(fac, true);
    runThinks(brain, w, 1);
    expect(bb.enemy.categoryCount((b) => b.categoryNames.includes('BOT'))).toBe(3);
    expect(bb.enemy.contacts.has(fac)).toBe(false);
    w.advance(1800);
    runThinks(brain, w, 1);
    expect(bb.enemy.categoryCount((b) => b.categoryNames.includes('BOT'))).toBe(0);
    expect(bb.enemy.contacts.has(bots[0]!)).toBe(false);
  });
});

describe('FakeWorld.applyOrders + emitter dedup across thinks', () => {
  it('a manager re-issuing the same order emits it only once', () => {
    const st = flatStatic({ bps: T, sizeWu: 256 });
    const m = defineManager('engineer', () => (ctx) => {
      const eng = ctx.bb.units.engineers[0];
      if (eng !== undefined) ctx.emitter.move([eng.handle], 40, 50, Prio.P2);
    });
    const brain = createBrain({ managers: [m] });
    brain.init(st, profileFor('normal', doc), { openings: doc });
    const w = new FakeWorld(st);
    const eng = w.addOwn('core:lnd_t1_engineer', 10, 10);
    const rs = runThinks(brain, w, 3);
    expect(rs.map((r) => r.commands.length)).toEqual([1, 0, 0]);
    expect(rs[1]!.dropped.map((d) => d.reason)).toEqual(['dedup']);
    expect(w.own(eng).order).toBe(OrderKind.Move);
    expect(rs[0]!.commands[0]!.op).toBe(Op.Move);
  });
});
