import { describe, expect, it } from 'vitest';
import { asTick } from '@faf/fixed';
import { Op } from '@faf/protocol';
import {
  AiCommandSource,
  createBrain,
  decodePosition,
  defineManager,
  MANAGER_ORDER,
  PendingAiSource,
  Prio,
  profileFor,
  runsOnThink,
  type AiBrain,
  type ManagerFactory,
  type ManagerName,
} from '../src/index.ts';
import { FakeWorld, flatStatic, runThinks } from '../src/testing/index.ts';
import { loadOpenings, loadRoster, loadStatic } from './support/fixtures.ts';

const doc = loadOpenings();
const T = loadRoster();

function recorder(log: string[], names: readonly ManagerName[]): ManagerFactory[] {
  return names.map((n) => defineManager(n, () => (ctx) => log.push(`${ctx.k}:${n}`)));
}

function smallStatic() {
  return flatStatic({ bps: T, sizeWu: 256, spots: [{ kind: 'mass', x: 70, z: 64 }] });
}

describe('brain scheduling (ai.md §2.2)', () => {
  it('fixed order; 1-Hz managers alternate on even/odd k (Normal/Hard)', () => {
    const log: string[] = [];
    const brain = createBrain({ managers: recorder(log, [...MANAGER_ORDER].reverse()) });
    brain.init(smallStatic(), profileFor('normal', doc), { openings: doc });
    expect(brain.managerNames).toEqual(MANAGER_ORDER);
    runThinks(brain, new FakeWorld(brain.static), 2);
    expect(log).toEqual([
      '0:opening',
      '0:economy',
      '0:tech',
      '0:factory',
      '0:engineer',
      '0:platoon',
      '1:intel',
      '1:opening',
      '1:defense',
      '1:engineer',
      '1:platoon',
    ]);
  });

  it('Easy runs every manager on every think; Hard adds micro; missing managers are skipped', () => {
    const log: string[] = [];
    const brain = createBrain({ managers: recorder(log, ['platoon', 'intel', 'economy', 'micro']) });
    brain.init(smallStatic(), profileFor('easy', doc), { openings: doc });
    runThinks(brain, new FakeWorld(brain.static), 2);
    expect(log).toEqual(['0:intel', '0:economy', '0:platoon', '1:intel', '1:economy', '1:platoon']);
    const p = profileFor('hard', doc);
    expect(runsOnThink('micro', 3, p)).toBe(true);
    expect(runsOnThink('intel', 3, p)).toBe(true);
    expect(runsOnThink('intel', 4, p)).toBe(false);
    expect(runsOnThink('factory', 4, p)).toBe(true);
    expect(() => createBrain({ managers: recorder([], ['intel', 'intel']) })).toThrow(/twice/);
  });

  it('opening selection in init: own RNG stream, filter, forced id, telemetry', () => {
    const b1 = createBrain({ managers: [] });
    const b2 = createBrain({ managers: [] });
    const st = loadStatic('setons', 0, 11);
    b1.init(st, profileFor('hard', doc), { openings: doc });
    b2.init(st, profileFor('hard', doc), { openings: doc });
    expect(b1.opening!.id).toBe(b2.opening!.id);
    expect(b1.blackboard.telemetry.first('openingSelected')).toEqual({ kind: 'openingSelected', tick: 0, id: b1.opening!.id });
    const seen = new Set<string>();
    // Small synthetic map of class 'setons' (the class comes from the name) keeps init cheap.
    const fake = flatStatic({ bps: T, sizeWu: 128, name: 'Setons' });
    for (let seed = 1; seed <= 40; seed++) {
      const b = createBrain({ managers: [] });
      b.init({ ...fake, gameSeed: seed }, profileFor('normal', doc), { openings: doc });
      seen.add(b.opening!.id);
      const e = createBrain({ managers: [] });
      e.init({ ...fake, gameSeed: seed }, profileFor('easy', doc), { openings: doc });
      expect(e.opening!.id).toBe('eco_standard');
    }
    expect([...seen].sort()).toEqual(['eco_standard', 'land_rush', 'tech_greed']);
    const f = createBrain({ managers: [] });
    f.init(st, profileFor('normal', doc), { openings: doc, openingId: 'land_rush' });
    expect(f.opening!.id).toBe('land_rush');
    expect(f.blackboard.opening.id).toBe('land_rush');
    expect(() => f.init(st, profileFor('normal', doc), { openings: doc, openingId: 'nope' })).toThrow(/unknown opening/);
  });

  it('ingest: unit lists, idle tracking, reaction delay for new contacts, ops', () => {
    const brain = createBrain({ managers: [] });
    brain.init(smallStatic(), profileFor('normal', doc), { openings: doc });
    const w = new FakeWorld(brain.static);
    const acu = w.addOwn('core:cmd_commander', 64, 64);
    const eng = w.addOwn('core:lnd_t1_engineer', 66, 64);
    w.addOwn('core:str_t1_fac_land', 76, 64);
    w.addOwn('core:str_t1_mex', 70, 64, { complete: false });
    w.addOwn('core:lnd_t1_tank', 80, 80);
    const enemy = w.addEnemy('core:lnd_t1_bot', 90, 90);
    w.event({ kind: 'ownDamaged', tick: 0, unit: acu, attacker: enemy, attackerBp: T.byId('core:lnd_t1_bot')!.index, amount: 5 });
    const [r0] = runThinks(brain, w, 1);
    const bb = brain.blackboard;
    expect(bb.units.commander!.handle).toBe(acu);
    expect(bb.units.engineers.map((u) => u.handle)).toEqual([eng]);
    expect(bb.units.factories).toHaveLength(1);
    expect(bb.units.sites).toHaveLength(1);
    expect(bb.units.structures).toHaveLength(2);
    expect(bb.units.army).toHaveLength(1);
    expect(bb.units.get(eng)!.idleSinceTick).toBe(0);
    expect(r0!.ingestOps).toBe(5 + 1 + 1);
    // Normal: reaction delay 5 ticks — the new contact and the damage are not visible yet.
    expect(bb.enemy.current).toHaveLength(0);
    let visible = 0;
    bb.stimuli.forEachVisible(-1, bb.tick, () => visible++);
    expect(visible).toBe(0);
    runThinks(brain, w, 1);
    expect(bb.enemy.current.map((c) => c.id)).toEqual([enemy]);
    const kinds: string[] = [];
    bb.stimuli.forEachVisible(0, bb.tick, (s) => kinds.push(s.kind === 'event' ? s.event.kind : s.kind));
    expect(kinds).toEqual(['newContact', 'ownDamaged']);
    expect(bb.enemy.categoryShare((b) => b.categoryNames.includes('BOT'))).toBe(1);
    expect(bb.threat.threatAt('surface', 90, 90)).toBeCloseTo(T.byId('core:lnd_t1_bot')!.threatSurface, 9);
    expect(bb.units.get(eng)!.idleSinceTick).toBe(0);
    // Units that vanish are removed from byHandle.
    w.removeOwn(eng);
    runThinks(brain, w, 1);
    expect(bb.units.get(eng)).toBeUndefined();
  });
});

describe('commit semantics and abort (AI-DET-04, unit part)', () => {
  function build(abortAt: number | null): { brain: AiBrain; state: number[] } {
    const state: number[] = [];
    let clock = 0;
    const steps = defineManager('factory', () => (ctx) => {
      for (let i = 0; i < 3; i++) {
        ctx.step(() => {
          clock++;
          ctx.emitter.move([100 + i], i, i, Prio.P2);
          return () => state.push(i);
        });
      }
    });
    const later = defineManager('platoon', () => (ctx) => {
      ctx.emitter.move([200], 9, 9, Prio.P1);
      state.push(99);
    });
    const brain = createBrain({ managers: [steps, later] });
    brain.init(smallStatic(), profileFor('normal', doc), { openings: doc });
    const w = new FakeWorld(brain.static);
    const r = brain.think(w.perceive(), { shouldAbort: () => abortAt !== null && clock >= abortAt });
    (brain as unknown as { lastResult: unknown }).lastResult = r;
    return { brain, state };
  }

  it('without abort every step commits and later managers run', () => {
    const { brain, state } = build(null);
    const r = (brain as unknown as { lastResult: ReturnType<AiBrain['think']> }).lastResult;
    expect(r.aborted).toBe(false);
    expect(state).toEqual([0, 1, 2, 99]);
    expect(r.commands.map((c) => c.units[0])).toEqual([200, 100, 101, 102]);
  });

  it('an abort inside step 2 rolls back its commands, skips its commit and all later managers', () => {
    const { brain, state } = build(2);
    const r = (brain as unknown as { lastResult: ReturnType<AiBrain['think']> }).lastResult;
    expect(r.aborted).toBe(true);
    expect(state).toEqual([0]);
    expect(r.commands.map((c) => c.units[0])).toEqual([100]);
    expect(r.dropped.map((d) => d.reason)).toEqual(['aborted']);
    const again = build(2);
    const r2 = (again.brain as unknown as { lastResult: ReturnType<AiBrain['think']> }).lastResult;
    expect(r2.commands).toEqual(r.commands);
  });

  it('budget scale reaches the managers; ops are reported per manager', () => {
    let left = 0;
    const m = defineManager('engineer', () => (ctx) => {
      left = ctx.budget.left;
      ctx.budget.take(123);
      ctx.emitter.move([5], 1, 1, Prio.P2);
    });
    const brain = createBrain({ managers: [m] });
    brain.init(smallStatic(), profileFor('normal', doc), { openings: doc });
    const r = brain.think(new FakeWorld(brain.static).perceive(), { budgetScale: 0.5 });
    expect(left).toBe(2500);
    expect(r.opsByManager).toEqual({ engineer: 123, emitter: 10 });
    expect(r.opsTotal).toBe(133);
  });
});

describe('CommandSource adapters', () => {
  function tickBrain(difficulty: 'normal' | 'easy'): { brain: AiBrain; perceived: number[] } {
    const perceived: number[] = [];
    const m = defineManager('platoon', () => (ctx) => ctx.emitter.move([1 + ctx.k], ctx.tick, 0, Prio.P1));
    const brain = createBrain({ managers: [m] });
    brain.init(smallStatic(), profileFor(difficulty, doc), { openings: doc });
    return { brain, perceived };
  }

  it('AiCommandSource thinks at N ≡ 0 (mod thinkEvery) and delivers at N + 3 (AI-DET-03 unit part)', () => {
    for (const [d, every] of [
      ['normal', 5],
      ['easy', 10],
    ] as const) {
      const { brain, perceived } = tickBrain(d);
      const w = new FakeWorld(brain.static);
      const src = new AiCommandSource({
        brain,
        perceive: (t) => {
          perceived.push(t);
          w.tick = t;
          return w.perceive();
        },
      });
      const got: [number, number][] = [];
      for (let t = 0; t < 31; t++) {
        for (const c of src.commandsFor(asTick(t))) {
          expect(c.tick).toBe(t);
          expect(c.op).toBe(Op.Move);
          got.push([t, decodePosition(c.payload).x]);
        }
      }
      const thinks = Array.from({ length: Math.floor(30 / every) + 1 }, (_, i) => i * every);
      expect(perceived).toEqual(thinks);
      expect(got).toEqual(thinks.filter((n) => n + 3 <= 30).map((n) => [n + 3, n]));
    }
  });

  it("PendingAiSource answers 'pending' until the due think is delivered, never loses commands", () => {
    const requested: number[] = [];
    const src = new PendingAiSource({ thinkEvery: 5, lead: 3, request: (t) => requested.push(t) });
    expect(src.commandsFor(asTick(0))).toEqual([]);
    expect(src.commandsFor(asTick(0))).toEqual([]);
    expect(requested).toEqual([0]);
    expect(src.commandsFor(asTick(1))).toEqual([]);
    expect(src.commandsFor(asTick(2))).toEqual([]);
    expect(src.commandsFor(asTick(3))).toBe('pending');
    expect(src.commandsFor(asTick(3))).toBe('pending');
    const { brain } = tickBrain('normal');
    const cmds = brain.think(new FakeWorld(brain.static).perceive()).commands;
    src.deliver(0, cmds);
    expect(src.commandsFor(asTick(3))).toEqual(cmds);
    expect(src.commandsFor(asTick(4))).toEqual([]);
    expect(src.commandsFor(asTick(5))).toEqual([]);
    expect(requested).toEqual([0, 5]);
    expect(src.commandsFor(asTick(8))).toBe('pending');
    src.deliver(5, []);
    expect(src.commandsFor(asTick(8))).toEqual([]);
    expect(src.pendingCount).toBe(3);
    expect(() => src.deliver(5, [])).toThrow(/not requested/);
    expect(src.outstandingThinks).toEqual([]);
  });
});
