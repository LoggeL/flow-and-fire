/**
 * PlatoonManager in the arena (ai.md §5.5, §9): AI-PLT-01 a/b/c (retreat at R < 0.7, hysteresis),
 * AI-PLT-02 (first wave and staging), AI-PLT-04 (commander bait), AI-PLT-05 (mandatory attack).
 */
import { describe, expect, it } from 'vitest';
import { Op } from '@faf/protocol';
import type { PlatoonManager, Vec2 } from '@faf/ai';
import { runScenario, type ScenarioResult, type ScenarioRuntime } from '../../src/scenarios/index.ts';
import { dist, ID, managerOf, openingRun, sec, unitsOf } from './support.ts';

/** Point at fraction q of the straight line from the own to the enemy start (Setons: the land bridge). */
function along(rt: ScenarioRuntime, q: number): Vec2 {
  const a = rt.brain(0).analysis;
  return { x: a.ownStart.x + (a.enemyStart.x - a.ownStart.x) * q, z: a.ownStart.z + (a.enemyStart.z - a.ownStart.z) * q };
}

interface DuelOptions {
  readonly own: number;
  readonly enemy: number;
  readonly seconds: number;
  /** After the first retreat: +1 own tank next to the platoon, −1 enemy (case c). */
  readonly reinforceAfterRetreat?: boolean;
}

interface DuelResult {
  readonly r: ScenarioResult;
  readonly contact: number;
  readonly states: { tick: number; state: string; ratio: number }[];
  /** Ratios the platoon saw while in RETREAT (after the reinforcement of case c). */
  readonly retreatRatios: number[];
}

/**
 * 7 own Punzen form the first wave (profile firstWave 7), stage and attack-move towards the enemy start;
 * `enemy` enemy Punzen wait on the bridge (q = 0.55). HP of both sides is held at 100 % every tick, so R
 * stays exactly own/enemy (ai.md: 7:11 = 0.64, 7:10 = 0.70, 8:10 = 0.80). Managers: intel + platoon.
 */
function duel(o: DuelOptions): DuelResult {
  let contact = -1;
  let retreatAt = -1;
  const states: { tick: number; state: string; ratio: number }[] = [];
  const retreatRatios: number[] = [];
  const r = runScenario({
    map: 'setons',
    seed: 3,
    sides: [
      {
        army: 0,
        ai: { openingId: 'eco_standard', managers: ['intel', 'platoon'], profile: (p) => ({ ...p, firstWave: o.own }) },
      },
      { army: 1 },
    ],
    spawns: [
      // Tight packs (no collisions in the arena): the whole enemy group comes into sight at once.
      { name: 'own', army: 0, unit: ID.tank, count: o.own, spacing: 0.5, at: (rt) => rt.brain(0).analysis.rally },
      { name: 'enemy', army: 1, unit: ID.tank, count: o.enemy, spacing: 0.5, at: (rt) => along(rt, 0.55) },
    ],
    cheats: [
      {
        every: 1,
        run: (rt) => {
          for (const g of ['own', 'enemy', 'extra']) for (const h of rt.alive(g)) rt.world.setHp(h, 1);
        },
      },
      {
        every: 1,
        run: (rt, t) => {
          if (o.reinforceAfterRetreat !== true || retreatAt < 0 || rt.spawned('extra').length > 0) return;
          // Case c: 8 vs 10 after the retreat of case a.
          const own = rt.alive('own').map((h) => rt.world.unit(h)!);
          const cx = own.reduce((s, u) => s + u.x, 0) / own.length;
          const cz = own.reduce((s, u) => s + u.z, 0) / own.length;
          const h = rt.world.spawn(0, ID.tank, cx, cz);
          rt.addToGroup('extra', h);
          rt.world.kill(rt.alive('enemy')[0]!);
          void t;
        },
      },
    ],
    commands: [
      {
        // Case c: the enemy follows the retreating platoon at ~12 WU (in sight and in its local radius).
        army: 1,
        every: 5,
        issue: (rt) => {
          if (o.reinforceAfterRetreat !== true || retreatAt < 0) return null;
          const own = rt.alive('own').map((h) => rt.world.unit(h)!);
          const cx = own.reduce((s, u) => s + u.x, 0) / own.length;
          const cz = own.reduce((s, u) => s + u.z, 0) / own.length;
          const a = rt.brain(0).analysis;
          const dx = a.enemyStart.x - a.ownStart.x;
          const dz = a.enemyStart.z - a.ownStart.z;
          const l = Math.sqrt(dx * dx + dz * dz);
          return rt.cmd.move(1, rt.alive('enemy'), cx + (dx / l) * 12, cz + (dz / l) * 12);
        },
      },
    ],
    observe: [
      {
        every: 1,
        run: (rt, t) => {
          if (contact < 0 && rt.alive('enemy').some((h) => rt.world.sees(0, rt.world.unit(h)!))) contact = t;
          const pm = managerOf<PlatoonManager>(rt.brain(0), 'platoon');
          const p = pm.platoons.find((x) => x.units.some((h) => rt.spawned('own').includes(h)));
          if (p !== undefined && p.state === 'retreat' && rt.spawned('extra').length > 0) retreatRatios.push(p.ratio);
          if (p !== undefined) {
            const last = states[states.length - 1];
            if (last === undefined || last.state !== p.state) states.push({ tick: t, state: p.state, ratio: p.ratio });
          }
          if (retreatAt < 0 && rt.brain(0).blackboard.telemetry.first('retreat') !== undefined) retreatAt = t;
        },
      },
    ],
    until: { seconds: o.seconds },
  });
  return { r, contact, states, retreatRatios };
}

describe('AI-PLT-01: retreat at R < 0.7 (7 own Punzen against 11 / 10; hysteresis 1.0)', () => {
  it('(a) 7 vs 11 (R = 0.64): retreat command ≤ 2 s after sight contact', () => {
    const { r, contact, states } = duel({ own: 7, enemy: 11, seconds: 240 });
    expect(contact, `contact; states ${JSON.stringify(states)}`).toBeGreaterThan(0);
    const tel = r.first(0, 'retreat');
    expect(tel, 'retreat').toBeDefined();
    expect(tel!.ratio).toBeCloseTo(7 / 11, 6);
    expect(tel!.tick - contact).toBeLessThanOrEqual(sec(2));
    expect(states.some((s) => s.state === 'attack')).toBe(true);
    // The retreat is one group move of all seven (P0), stamped for think + lead.
    const units = [...r.rt.spawned('own')].sort((a, b) => a - b);
    const th = r.thinks(0).find((t) => t.tick === tel!.tick)!;
    const move = th.commands.find((c) => c.op === Op.Move);
    expect(move, 'retreat move').toBeDefined();
    expect([...move!.units].sort((a, b) => a - b)).toEqual(units);
  });

  it('(b) 7 vs 10 (R = 0.70, boundary): no retreat', () => {
    const { r, contact } = duel({ own: 7, enemy: 10, seconds: 240 });
    expect(contact).toBeGreaterThan(0);
    // 30 s of contact at exactly R = 0.7 (HP held): the rule is R < 0.7.
    expect(r.metrics.endTick - contact).toBeGreaterThanOrEqual(sec(30));
    expect(r.first(0, 'retreat')).toBeUndefined();
  });

  it('(c) after the retreat of (a), 8 vs 10 (R = 0.8): no re-entry while R < 1.0', () => {
    const { r, states, retreatRatios } = duel({ own: 7, enemy: 11, seconds: 260, reinforceAfterRetreat: true });
    const tel = r.first(0, 'retreat');
    expect(tel).toBeDefined();
    const i = states.findIndex((s) => s.state === 'retreat');
    const leave = states[i + 1];
    // The platoon saw R = 0.8 (8 vs 10, the enemy following) while retreating …
    expect(retreatRatios.some((x) => Math.abs(x - 0.8) < 1e-6), `ratios ${[...new Set(retreatRatios)].join(',')}`).toBe(true);
    // … and left RETREAT only with R ≥ 1.0 (hysteresis), not before 20 s of R < 1.
    if (leave !== undefined) {
      expect(leave.ratio, JSON.stringify(states)).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(leave.tick - tel!.tick).toBeGreaterThanOrEqual(sec(20));
    }
  });
});

describe('AI-PLT-02: first wave and staging (eco_standard, no enemy military)', () => {
  it('first wave ≤ 8:00 with ≥ 8 units, gathered at the staging point, attack-move into the enemy half', () => {
    let staged = -1;
    const r = openingRun('setons', 'eco_standard', 480, {
      observe: [
        {
          every: 5,
          run: (rt, t) => {
            if (staged >= 0) return;
            const a = rt.brain(0).analysis;
            for (const p of rt.brain(0).blackboard.platoons) {
              if (p.state === 'staging' && dist(p.x, p.z, a.staging.x, a.staging.z) <= 25) staged = t;
            }
          },
        },
      ],
    });
    const wave = r.first(0, 'waveAttack', (e) => e.enemyHalf);
    expect(wave, 'first wave').toBeDefined();
    expect(wave!.tick).toBeLessThanOrEqual(sec(480));
    expect(wave!.units).toBeGreaterThanOrEqual(8);
    expect(staged, 'gathered at the staging point').toBeGreaterThanOrEqual(0);
    expect(staged).toBeLessThanOrEqual(wave!.tick);
    // Attack-move: the wave's orders right after the transition.
    const thinks = r.thinks(0).filter((t) => t.tick >= wave!.tick && t.tick <= wave!.tick + 5);
    const ops = thinks.flatMap((t) => t.commands.map((c) => c.op));
    expect(ops).toContain(2 /* Op.AttackMove */);
  });
});

describe('AI-PLT-04: commander bait (3 Stichel poke and run, 12 Punzen wait 90 WU in front of the base)', () => {
  it('the commander never leaves its leash (60 WU around the nearest factory) and lives after 180 s', () => {
    const t0 = sec(150);
    let maxLeash = 0;
    const r = openingRun('setons', 'eco_standard', 150 + 180, {
      spawns: [
        { name: 'wall', army: 1, unit: ID.tank, count: 12, tick: t0, at: (rt) => rt.brain(0).analysis.toWorld(90, 0) },
        {
          name: 'bait',
          army: 1,
          unit: ID.bot,
          count: 3,
          tick: t0,
          at: (rt) => {
            const c = rt.world.commander(0)!;
            return { x: c.x + 18, z: c.z + 6 };
          },
        },
      ],
      commands: [
        // Every 30 s: attack the commander, 8 s later run back to the waiting Punzen.
        { army: 1, tick: t0 + 1, every: sec(30), issue: (rt) => (rt.alive('bait').length > 0 ? rt.cmd.attack(1, rt.alive('bait'), rt.world.commander(0)!.handle) : null) },
        {
          army: 1,
          tick: t0 + sec(8),
          every: sec(30),
          issue: (rt) => {
            const p = rt.brain(0).analysis.toWorld(92, 4);
            return rt.alive('bait').length > 0 ? rt.cmd.move(1, rt.alive('bait'), p.x, p.z) : null;
          },
        },
      ],
      observe: [
        {
          tick: t0,
          every: 1,
          run: (rt) => {
            const c = rt.world.commander(0);
            if (c === null || !c.alive) return;
            const facs = rt.world.unitsOf(0).filter((u) => u.alive && u.info.isFactory);
            if (facs.length === 0) return;
            const d = Math.min(...facs.map((f) => dist(f.x, f.z, c.x, c.z)));
            maxLeash = Math.max(maxLeash, d);
          },
        },
      ],
    });
    const c = r.world.commander(0);
    expect(c, 'commander alive').not.toBeNull();
    expect(c!.alive).toBe(true);
    expect(r.metrics.endTick).toBe(sec(330));
    // Leash 60 WU (+2 WU: the commander stops at build range + half a footprint around the base).
    expect(maxLeash, `commander ${maxLeash.toFixed(1)} WU from the nearest factory`).toBeLessThanOrEqual(62);
    expect(unitsOf(r.world, 1, ID.tank).length).toBeGreaterThan(0);
  });
});

describe('AI-PLT-05: mandatory attack (enemy holds the bridgehead with 3 Riegel I)', () => {
  it('the first wave attacks at waves.maxS at the latest and retreats at R < 0.7', () => {
    const r = openingRun('setons', 'eco_standard', 540, {
      keepEnemyAlive: true,
      spawns: [{ name: 'pd', army: 1, unit: ID.pd, count: 3, spacing: 8, at: (rt) => along(rt, 0.58) }],
    });
    const maxS = r.brain(0).opening!.followUp.waves.maxS;
    const wave = r.first(0, 'waveAttack', (e) => e.enemyHalf);
    expect(wave, 'first wave').toBeDefined();
    expect(wave!.tick).toBeLessThanOrEqual(sec(maxS) + r.brain(0).profile.thinkEvery);
    const retreat = r.first(0, 'retreat', (e) => e.tick >= wave!.tick);
    expect(retreat, 'retreat against the Riegel').toBeDefined();
    expect(retreat!.ratio).toBeLessThan(0.7);
  });
});
