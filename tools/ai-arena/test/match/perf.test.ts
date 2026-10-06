/**
 * Arena throughput (reported in docs/status/track-ai-tai-p2-arena-world.md): 2 × 300 fighting
 * units over 3,000 ticks, and a 30-min scripted match without AI (target < 10 s). Wall clock is
 * only used here in the test, never in arena code.
 */
import { describe, expect, it } from 'vitest';
import { replayMatch, runMatch } from '../../src/index.ts';
import { Cmds, localFrame, setonsWorld } from '../world/support.ts';

const MIX = [
  ['core:lnd_t1_tank', 150],
  ['core:lnd_t1_bot', 100],
  ['core:lnd_t1_arty', 50],
] as const;

describe('arena performance', () => {
  it('2 × 300 fighting units over 3,000 ticks', () => {
    const w = setonsWorld(1);
    const c = new Cmds();
    const at0 = localFrame(w, 0, 1);
    const sides: number[][] = [[], []];
    for (let side = 0; side < 2; side++) {
      let k = 0;
      for (const [id, n] of MIX) {
        for (let i = 0; i < n; i++, k++) {
          const f = (side === 0 ? 60 : 150) + (side === 0 ? -1 : 1) * 2 * Math.floor(k / 20);
          const p = at0(f, -19 + 2 * (k % 20));
          sides[side]!.push(w.spawn(side, id, p.x, p.z));
        }
      }
    }
    const g0 = at0(170, 0);
    const g1 = at0(40, 0);
    w.step([c.attackMove(0, sides[0]!, g0.x, g0.z), c.attackMove(1, sides[1]!, g1.x, g1.z)]);
    const t0 = performance.now();
    let ticks = 0;
    let firstDeath = -1;
    let battleEnd = -1;
    let battleMs = 0;
    let worstMs = 0;
    for (; ticks < 3000; ticks++) {
      const a = performance.now();
      w.step([]);
      const d = performance.now() - a;
      if (d > worstMs) worstMs = d;
      if (firstDeath < 0 && w.counters[0]!.unitsLost + w.counters[1]!.unitsLost > 0) firstDeath = w.tick;
      if (battleEnd < 0) {
        battleMs += d;
        if (w.counters[0]!.unitsLost >= 300 || w.counters[1]!.unitsLost >= 300) battleEnd = w.tick;
      }
    }
    const ms = performance.now() - t0;
    const alive0 = sides[0]!.filter((h) => w.unit(h) !== null).length;
    const alive1 = sides[1]!.filter((h) => w.unit(h) !== null).length;
    console.log(
      `[arena perf] 2x300 battle: ${ticks} ticks in ${ms.toFixed(0)} ms (${(ms / ticks).toFixed(3)} ms/tick); ` +
        `approach+battle until tick ${battleEnd}: ${battleMs.toFixed(0)} ms (${(battleMs / Math.max(1, battleEnd)).toFixed(3)} ms/tick), ` +
        `worst tick ${worstMs.toFixed(2)} ms, first death at tick ${firstDeath}, survivors ${alive0}/${alive1}`,
    );
    expect(firstDeath).toBeGreaterThan(0);
    expect(alive0 + alive1).toBeLessThan(600);
    expect(ms).toBeLessThan(60_000);
  });

  it('30-min scripted match without AI', () => {
    const c = new Cmds();
    let tanksA: number[] = [];
    const t0 = performance.now();
    const r = runMatch({
      map: 'setons',
      seed: 3,
      maxTicks: 18_000,
      sides: [
        {
          army: 0,
          source: (ctx) => ({
            commandsFor: (tick) => {
              const t = tick as number;
              const w = ctx.world;
              if (t === 0) {
                // factories spawned by cheat produce tanks forever; every 2 min the tanks attack
                const at = localFrame(w, 0, 1);
                const out = [];
                for (let i = 0; i < 4; i++) {
                  const p = at(12 + 10 * i, 20);
                  const f = w.spawn(0, 'core:str_t1_fac_land', p.x, p.z);
                  out.push(c.factoryRepeat(0, [f], [w.bpIndex('core:lnd_t1_tank'), w.bpIndex('core:lnd_t1_bot')]));
                }
                w.addIncome(0, 60, 600);
                return out;
              }
              if (t % 1200 === 600) {
                tanksA = w.unitsOf(0).filter((u) => !u.info.isStructure && !u.info.isCommander).map((u) => u.handle);
                const g = w.startOf(1);
                return tanksA.length > 0 ? [c.attackMove(0, tanksA, g.x, g.z)] : [];
              }
              return [];
            },
          }),
        },
        {
          army: 1,
          source: (ctx) => ({
            commandsFor: (tick) => {
              const t = tick as number;
              const w = ctx.world;
              if (t !== 0) return [];
              const at = localFrame(w, 1, 0);
              const out = [];
              for (let i = 0; i < 4; i++) {
                const p = at(12 + 10 * i, 20);
                const f = w.spawn(1, 'core:str_t1_fac_land', p.x, p.z);
                const r = at(40, 0);
                out.push(c.rally(1, [f], r.x, r.z));
                out.push(c.factoryRepeat(1, [f], [w.bpIndex('core:lnd_t1_tank'), w.bpIndex('core:lnd_t1_arty')]));
              }
              w.addIncome(1, 60, 600);
              return out;
            },
          }),
        },
      ],
    });
    const ms = performance.now() - t0;
    const m = r.metrics;
    console.log(
      `[arena perf] 30-min match: ${r.world.tick} ticks in ${ms.toFixed(0)} ms, end ${m.endReason}, ` +
        `produced ${m.armies[0]!.unitsProduced}/${m.armies[1]!.unitsProduced}, lost ${m.armies[0]!.unitsLost}/${m.armies[1]!.unitsLost}, ` +
        `A* searches ${r.world.paths.stats.searches}, cache hits ${r.world.paths.stats.cacheHits}`,
    );
    expect(ms).toBeLessThan(30_000);
    // cheats issued from inside a source are logged too: the replay matches
    const re = replayMatch(r.log.setup, r.log);
    expect(re.hash).toBe(r.hash);
  });
});
