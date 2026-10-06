/**
 * MatchMetrics details: T2 time, idle-engineer rule (≥ 2 s without order, whole streak), samples.
 */
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../src/index.ts';
import { Cmds, localFrame, ScriptSource } from '../world/support.ts';

describe('arena match metrics', () => {
  it('t2Tick = first completed TECH2 factory (in-place upgrade)', () => {
    const c = new Cmds();
    let fac = 0;
    const r = runMatch({
      map: 'setons',
      seed: 1,
      maxTicks: 3000,
      sides: [
        {
          army: 0,
          source: (ctx) => {
            const w = ctx.world;
            const p = localFrame(w, 0, 1)(12, 0);
            fac = w.spawn(0, 'core:str_t1_fac_land', p.x, p.z);
            w.addIncome(0, 30, 600);
            const up = w.bpIndex('core:str_t2_fac_land');
            return new ScriptSource().add(2, () => c.upgrade(0, [fac], up));
          },
        },
        { army: 1, source: new ScriptSource() },
      ],
    });
    const m = r.metrics.armies[0]!;
    // 2,300 bt / 20 BP = 115 s from tick 2
    expect(m.t2Tick).toBe(2 + 1150);
    expect(m.fac1Tick).toBeNull(); // spawned by cheat, not built
    expect(r.metrics.armies[1]!.t2Tick).toBeNull();
  });

  it('idle engineers: orderless ≥ 2 s counts the whole streak, shorter gaps do not count', () => {
    const c = new Cmds();
    let e = 0;
    const r = runMatch({
      map: 'setons',
      seed: 1,
      maxTicks: 200,
      sides: [
        {
          army: 0,
          source: (ctx) => {
            const w = ctx.world;
            const s = w.startOf(0);
            e = w.spawn(0, 'core:lnd_t1_engineer', s.x + 3, s.z);
            // idle 0…14 (15 ticks < 2 s: not counted), move 15…, then idle from arrival for the rest
            return new ScriptSource().add(15, () => c.move(0, [e], s.x + 3, s.z + 4));
          },
        },
        { army: 1, source: new ScriptSource() },
      ],
    });
    const m = r.metrics.armies[0]!;
    expect(m.engineerAliveTicks).toBe(200);
    // move 4 WU at 1.9 WU/s (arrival radius 0.5 WU) ≈ 19 ticks, then orderless until tick 200
    const idle = m.engineerIdleTicks;
    expect(idle).toBeGreaterThanOrEqual(200 - 15 - 21);
    expect(idle).toBeLessThanOrEqual(200 - 15 - 17);
    expect(m.idleEngineerPct).toBeCloseTo((100 * idle) / 200, 10);
  });
});
