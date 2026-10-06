/**
 * Match loop, metrics, command log and replay of the arena (tai-p2).
 */
import { describe, expect, it } from 'vitest';
import { AiCommandSource, createDefaultBrain, PendingAiSource, profileFor } from '@faf/ai';
import { Op, type CommandEnvelope, type CommandSource } from '@faf/protocol';
import type { Tick } from '@faf/fixed';
import { ArenaWorld, replayMatch, runMatch, runMatchAsync, scenarioOpenings, type MatchSourceContext } from '../../src/index.ts';
import { Cmds, localFrame, ScriptSource } from '../world/support.ts';

const FAC = 'core:str_t1_fac_land';
const PGEN = 'core:str_t1_pgen';
const MEX = 'core:str_t1_mex';
const ENG = 'core:lnd_t1_engineer';
const TANK = 'core:lnd_t1_tank';
const SCOUT = 'core:lnd_t1_scout';

/**
 * Test-only reactive controller of one army (reads the world truth — never an AI): opening like
 * eco_standard (fac1, 2 generators, ring mex, factory: 2 engineers, scout, 2 engineers, tank loop,
 * engineers build the next free mass spots), then attack-moves its tanks at tick `attackAt`.
 */
function openingSource(world: ArenaWorld, army: number, enemy: number, c: Cmds, attackAt = 1e9): CommandSource {
  const at = localFrame(world, army, enemy);
  const bp = (id: string): number => world.bpIndex(id);
  let phase = 0;
  const busy = new Set<number>();
  const taken = new Set<number>();
  const start = world.startOf(army);
  const spots = world.map.spots
    .filter((s) => s.kind === 'mass')
    .map((s) => ({ s, d: (s.x - start.x) ** 2 + (s.z - start.z) ** 2 }))
    .sort((a, b) => a.d - b.d || a.s.index - b.s.index)
    .map((x) => x.s);
  return {
    commandsFor(tick: Tick): readonly CommandEnvelope[] {
      const t = tick as number;
      const out: CommandEnvelope[] = [];
      const v = world.commander(army);
      if (v === null) return out;
      if (t === 3 && phase === 0) {
        phase = 1;
        const f = at(12, 0);
        out.push(c.build(army, [v.handle], bp(FAC), f.x, f.z));
        const g1 = at(12, 5);
        const g2 = at(12, -5);
        out.push(c.build(army, [v.handle], bp(PGEN), g1.x, g1.z, true));
        out.push(c.build(army, [v.handle], bp(PGEN), g2.x, g2.z, true));
        for (const s of spots.slice(0, 2)) {
          taken.add(s.index);
          out.push(c.build(army, [v.handle], bp(MEX), s.x, s.z, true));
        }
      }
      const fac = world.unitsOf(army).find((u) => u.info.isFactory && u.complete);
      if (fac !== undefined && phase === 1) {
        phase = 2;
        const r = at(45, 0);
        out.push(c.rally(army, [fac.handle], r.x, r.z));
        out.push(c.factoryQueue(army, [fac.handle], bp(ENG), 2, false));
        out.push(c.factoryQueue(army, [fac.handle], bp(SCOUT), 1));
        out.push(c.factoryQueue(army, [fac.handle], bp(ENG), 2));
        out.push(c.factoryRepeat(army, [fac.handle], [bp(TANK)]));
      }
      if (t % 5 === 0) {
        for (const u of world.unitsOf(army)) {
          if (!u.info.isEngineer || u.orders.length > 0 || busy.has(u.handle)) continue;
          const s = spots.find((x) => !taken.has(x.index));
          if (s === undefined) continue;
          taken.add(s.index);
          busy.add(u.handle);
          out.push(c.build(army, [u.handle], bp(MEX), s.x, s.z));
        }
        for (const h of [...busy]) {
          const u = world.unit(h);
          if (u === null || u.orders.length === 0) busy.delete(h);
        }
      }
      if (t === attackAt) {
        const tanks = world.unitsOf(army).filter((u) => u.bp.id === TANK).map((u) => u.handle);
        const goal = world.startOf(enemy);
        if (tanks.length > 0) out.push(c.attackMove(army, tanks, goal.x, goal.z));
      }
      return out;
    },
  };
}

function setup(seed: number): { map: string; seed: number; armies: { army: number; startIndex: number }[] } {
  return {
    map: 'setons',
    seed,
    armies: [
      { army: 0, startIndex: 0 },
      { army: 1, startIndex: 1 },
    ],
  };
}

function playScripted(seed: number, maxTicks: number): ReturnType<typeof runMatch> {
  const c = new Cmds();
  return runMatch({
    setup: setup(seed),
    maxTicks,
    sides: [
      { army: 0, source: (ctx: MatchSourceContext) => openingSource(ctx.world, 0, 1, c, 2400) },
      { army: 1, source: (ctx: MatchSourceContext) => openingSource(ctx.world, 1, 0, c) },
    ],
    onTick: (w, t) => {
      // scenario cheat in the middle of the match (logged for the replay)
      if (t === 1500) {
        const p = localFrame(w, 0, 1)(35, 3);
        w.spawn(1, TANK, p.x, p.z);
      }
    },
  });
}

describe('arena match', () => {
  it('scripted opening: metrics like ecosim (fac1, eng1, mex4, samples, idle, APM)', () => {
    const r = playScripted(1, 1900);
    const m = r.metrics.armies[0]!;
    expect(r.metrics.endReason).toBe('maxTicks');
    expect(r.metrics.winner).toBe(-1);
    // fac1 = command at 3 + 300 ticks
    expect(m.fac1Tick).toBe(303);
    // factory queue right after completion, engineer 130 ticks, roll-off 20 (ecosim: fac1 + 15 s)
    expect(m.eng1Tick).toBe(303 + 130 + 20);
    expect(m.eng4Tick).toBeGreaterThan(m.eng1Tick!);
    expect(m.mex4Tick).not.toBeNull();
    expect(m.t2Tick).toBeNull();
    expect(m.massInc['180']).toBe(1 + 2 * (m.mexAt['180'] ?? 0));
    expect(m.massInc['300']).toBeNull();
    expect(m.mexAt['180']).toBeGreaterThanOrEqual(4);
    expect(m.producedByRole['eng']).toBe(4);
    expect(m.producedByRole['scout']).toBe(1);
    expect(m.producedByRole['tank']).toBeGreaterThan(0);
    expect(m.firstCombatUnitTick).not.toBeNull();
    expect(m.idleEngineerPct).toBeGreaterThanOrEqual(0);
    expect(m.idleEngineerPct).toBeLessThan(100);
    expect(m.engineerAliveTicks).toBeGreaterThan(0);
    expect(m.commandsPerWindow.reduce((a, b) => a + b, 0)).toBe(r.log.commands.filter((x) => (x.env.army as number) === 0).length);
    expect(m.apmMax).toBe(Math.max(...m.commandsPerWindow));
  });

  it('determinism: same seed and log ⇒ same world hash; replayMatch reproduces it', () => {
    const a = playScripted(4, 2700);
    const b = playScripted(4, 2700);
    expect(a.hash).toBe(b.hash);
    expect(a.log.cheats.length).toBe(1);
    expect(a.metrics.armies[0]!.firstDamageTick).not.toBeNull();
    const re = replayMatch(a.log.setup, a.log);
    expect(re.hash).toBe(a.hash);
    expect(re.world.tick).toBe(a.world.tick);
    expect(re.metrics).toEqual(a.metrics);
    // a different log changes the hash
    const cut = replayMatch(a.log.setup, { ...a.log, commands: a.log.commands.slice(0, -3) });
    expect(cut.hash).not.toBe(a.hash);
  });

  it('commander death ends the match with a winner', () => {
    const c = new Cmds();
    const tanks: number[] = [];
    const r = runMatch({
      map: 'setons',
      seed: 2,
      maxTicks: 3000,
      sides: [
        {
          army: 0,
          source: new ScriptSource().add(1, () => c.target(0, Op.Attack, tanks, 0x100001)),
        },
        { army: 1, source: new ScriptSource() },
      ],
      onTick: (w, t) => {
        if (t !== 0) return;
        const v1 = w.commander(1)!;
        for (let i = 0; i < 40; i++) tanks.push(w.spawn(0, TANK, v1.x + 15 + (i % 5), v1.z + Math.floor(i / 5)));
        expect(v1.handle).toBe(0x100001);
      },
    });
    expect(r.metrics.endReason).toBe('commanderKilled');
    expect(r.metrics.winner).toBe(0);
    expect(r.metrics.armies[1]!.defeated).toBe(true);
    expect(r.world.tick).toBeLessThan(3000);
    const re = replayMatch(r.log.setup, r.log);
    expect(re.hash).toBe(r.hash);
    expect(re.world.over).toBe(true);
  });

  it("runMatchAsync waits on 'pending' (AI-DET-03 arena part): same result, nothing dropped", async () => {
    const c = new Cmds();
    const mkPending = (world: ArenaWorld): { src: PendingAiSource; requests: number[] } => {
      const inner = openingSource(world, 0, 1, c, 2400);
      const requests: number[] = [];
      const src: PendingAiSource = new PendingAiSource({
        thinkEvery: 1,
        lead: 0,
        request: (n) => {
          requests.push(n);
          // answer after two macrotasks (the "worker" is late); commands computed at the think tick
          const cmds = inner.commandsFor(n as Tick) as CommandEnvelope[];
          setTimeout(() => setTimeout(() => src.deliver(n, cmds), 0), 0);
        },
      });
      return { src, requests };
    };
    let reqs: number[] = [];
    const asyncRun = await runMatchAsync({
      setup: setup(7),
      maxTicks: 400,
      sides: [
        {
          army: 0,
          source: (ctx) => {
            const p = mkPending(ctx.world);
            reqs = p.requests;
            return p.src;
          },
        },
        { army: 1, source: (ctx) => openingSource(ctx.world, 1, 0, c) },
      ],
    });
    expect(asyncRun.pendingWaits).toBeGreaterThan(0);
    expect(asyncRun.ticksWaited).toBe(400);
    expect(reqs.length).toBe(400);
    // the same commands applied synchronously give the same world
    const re = replayMatch(asyncRun.log.setup, asyncRun.log);
    expect(re.hash).toBe(asyncRun.hash);
    const c2 = new Cmds();
    const sync = runMatch({
      setup: setup(7),
      maxTicks: 400,
      sides: [
        { army: 0, source: (ctx) => openingSource(ctx.world, 0, 1, c2, 2400) },
        { army: 1, source: (ctx) => openingSource(ctx.world, 1, 0, c2) },
      ],
    });
    expect(sync.hash).toBe(asyncRun.hash);
    expect(sync.metrics).toEqual(asyncRun.metrics);
    expect(() =>
      runMatch({
        setup: setup(7),
        maxTicks: 10,
        sides: [{ army: 0, source: { commandsFor: () => 'pending' as const } }],
      }),
    ).toThrow(/pending/);
  });

  it('runMatchAsync: a synchronous AI source beside a pending source loses no command on retried ticks (review TRACK-AI)', async () => {
    const openings = scenarioOpenings();
    const aiSide = (ctx: MatchSourceContext): CommandSource => {
      const brain = createDefaultBrain();
      brain.init(ctx.static, profileFor('normal', openings), { openings, openingId: 'eco_standard' });
      return new AiCommandSource({ brain, perceive: (t) => ctx.perceive(t) });
    };
    // Reference: both sides synchronous.
    const c1 = new Cmds();
    const sync = runMatch({
      setup: setup(9),
      maxTicks: 600,
      sides: [
        { army: 0, source: aiSide },
        { army: 1, source: (ctx) => openingSource(ctx.world, 1, 0, c1) },
      ],
    });
    // Army 1 is late at every tick (thinkEvery 1, lead 0): runMatchAsync collects army 0 first, then
    // retries each tick — the AI's commands of the retried ticks must be served again.
    const c2 = new Cmds();
    const late = await runMatchAsync({
      setup: setup(9),
      maxTicks: 600,
      sides: [
        { army: 0, source: aiSide },
        {
          army: 1,
          source: (ctx) => {
            const inner = openingSource(ctx.world, 1, 0, c2);
            const src: PendingAiSource = new PendingAiSource({
              thinkEvery: 1,
              lead: 0,
              request: (n) => {
                const cmds = inner.commandsFor(n as Tick) as CommandEnvelope[];
                setTimeout(() => src.deliver(n, cmds), 0);
              },
            });
            return src;
          },
        },
      ],
    });
    expect(late.ticksWaited).toBe(600);
    const aiCommands = (r: typeof sync): number => r.log.commands.filter((e) => e.env.army === 0).length;
    expect(aiCommands(sync)).toBeGreaterThan(10);
    expect(aiCommands(late)).toBe(aiCommands(sync));
    expect(late.hash).toBe(sync.hash);
  });
});
